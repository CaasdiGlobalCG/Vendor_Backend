/**
 * Vendor Portal Support Controller
 *
 * Writes to the shared Employee CS DynamoDB tables:
 *   cs_tickets          — one item per ticket
 *   cs_ticket_messages  — messages keyed by ticketId (sort: messageId)
 *
 * Identity: uses req.vendorId (set by attachVendorId middleware) as the
 * primary raisedById so the CS team can correlate tickets to vendors.
 * Falls back to req.auth.sub / req.auth.email if vendorId not resolved.
 *
 * Routes (all guarded by authenticateCognitoJwt + attachVendorId):
 *   POST   /api/support/                           raise a new ticket
 *   GET    /api/support/                           list caller's own tickets
 *   GET    /api/support/:ticketId                  get one ticket + messages
 *   POST   /api/support/:ticketId/messages         add a user reply
 *   PUT    /api/support/:ticketId/rate             submit CSAT rating
 *   PUT    /api/support/:ticketId/reopen           reopen resolved/closed ticket
 */

import {
  dynamoDB,
  s3,
  S3_BUCKET_NAME,
  VENDORS_TABLE,
  PROJECTS_TABLE,
  PM_PROJECTS_TABLE,
  WORKSPACES_TABLE,
  LEADS_TABLE,
} from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

const TICKETS_TABLE  = 'cs_tickets';
const MESSAGES_TABLE = 'cs_ticket_messages';
const AUTO_CLOSE_DAYS = Math.max(parseInt(process.env.CS_TICKET_AUTO_CLOSE_DAYS || '7', 10), 1);
const SALES_SENT_RFQ_TABLE = process.env.SALES_SENT_RFQ_TABLE || process.env.SENT_RFQ_TABLE || 'sent_rfqs';
const SALES_QUOTATIONS_TABLE = process.env.SALES_QUOTATIONS_TABLE || process.env.QUOTATION_OF_VENDOR_TABLE || 'quotations_Of_Vendors';
const SALES_PURCHASE_ORDERS_TABLE = process.env.SALES_PURCHASE_ORDERS_TABLE || process.env.PURCHASE_ORDERS_TABLE || 'purchase_orders';
const SALES_PRODUCTS_TABLE = process.env.SALES_PRODUCTS_TABLE || 'Products';
const SALES_ORDERS_TABLE = process.env.SALES_ORDERS_TABLE || 'Orders';
const SALES_INVENTORY_TABLE = process.env.SALES_INVENTORY_TABLE || process.env.DYNAMODB_INVENTORY_TABLE || process.env.INVENTORY_TABLE || 'Inventory';
const SALES_WARRANTIES_TABLE = process.env.SALES_WARRANTIES_TABLE || process.env.WARRANTY_TABLE || 'Warranties';
const SALES_WARRANTY_CLAIMS_TABLE = process.env.SALES_WARRANTY_CLAIMS_TABLE || process.env.WARRANTY_CLAIM_TABLE || 'Claims';
const WORKSPACE_CREDIT_NOTES_TABLE = process.env.WORKSPACE_CREDIT_NOTES_TABLE || 'workspace_credit_notes';

// ─── Team routing ─────────────────────────────────────────────────────────────
// Vendor portal defaults to team-a (Vendor Support). Modules that cross portals
// still route to their respective teams so the right CS squad sees them.
const SOURCE_TEAM_MAP = {
  sales_enquiry: 'team-a', sales_quotation: 'team-a', sales_purchase_order: 'team-a', sales_shipment: 'team-a', sales_warranty_claim: 'team-a', sales_inventory_item: 'team-a',
  workspace_credit_note: 'team-e',
  general_enquiry: 'team-a', other: 'team-a',
  vendor:    'team-a', project:   'team-a', workspace: 'team-a',
  rfq:       'team-a', quotation: 'team-a', warranty:  'team-a',
  client:    'team-b',
  b2b:       'team-c', b2b_order: 'team-c', payment:   'team-c', cart: 'team-c',
  tender:    'team-d', bid:       'team-d',
  invoice:   'team-e', finance:   'team-e',
  auth:      'team-f', tech:      'team-f', system_error: 'team-f', upload_fail: 'team-f',
};
const TEAM_LABELS = {
  'team-a': 'Vendor Support',
  'team-b': 'Client Support',
  'team-c': 'B2B Commerce Support',
  'team-d': 'Tender Support',
  'team-e': 'Finance & Billing Support',
  'team-f': 'Tech Ops & Escalations',
};
const SLA_MINUTES = {
  urgent: { firstResponse: 60,   resolution: 240  },
  high:   { firstResponse: 240,  resolution: 720  },
  medium: { firstResponse: 480,  resolution: 2880 },
  low:    { firstResponse: 1440, resolution: 7200 },
};
const PORTAL_TYPE = 'vendor';
const REFERENCE_TYPE_BY_MODULE = {
  project: 'project',
  workspace: 'workspace',
  quotation: 'rfq',
  vendor: 'vendor',
  sales_enquiry: 'sales_enquiry',
  sales_quotation: 'sales_quotation',
  sales_purchase_order: 'sales_purchase_order',
  sales_shipment: 'sales_shipment',
  sales_warranty_claim: 'sales_warranty_claim',
  sales_inventory_item: 'sales_inventory_item',
  workspace_credit_note: 'workspace_credit_note',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateTicketId() {
  const year = new Date().getFullYear();
  const rand = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `CS-${year}-${rand}`;
}

function resolveTeam(sourceModule) {
  if (!sourceModule) return 'team-a';
  const key = sourceModule.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return SOURCE_TEAM_MAP[key] || 'team-a';
}

function slaDeadlines(priority, fromDate = new Date()) {
  const mins = SLA_MINUTES[priority?.toLowerCase()] || SLA_MINUTES.medium;
  return {
    firstResponseDeadline: new Date(fromDate.getTime() + mins.firstResponse * 60000).toISOString(),
    resolutionDeadline:    new Date(fromDate.getTime() + mins.resolution    * 60000).toISOString(),
  };
}

function inactivityDeadline(fromDate = new Date()) {
  return new Date(fromDate.getTime() + AUTO_CLOSE_DAYS * 24 * 60 * 60000).toISOString();
}

function compactValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
}

function compactText(value, max = 240) {
  const normalized = compactValue(value);
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function normalizeReferenceContext(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function buildSystemMessage(ticketId, body, createdAt = new Date().toISOString()) {
  return {
    ticketId,
    messageId: `${createdAt}#system#${uuidv4().slice(0, 8)}`,
    body,
    content: body,
    senderType: 'system',
    senderName: 'Vendor Support',
    senderId: 'system',
    authorId: 'system',
    authorName: 'Vendor Support',
    isInternal: false,
    attachments: [],
    createdAt,
  };
}

function buildSupportTeamMessage(ticketId, body, createdAt = new Date().toISOString()) {
  return {
    ticketId,
    messageId: `${createdAt}#support#${uuidv4().slice(0, 8)}`,
    body,
    content: body,
    senderType: 'support_agent',
    senderName: 'Vendor Support Team',
    senderId: 'support-team',
    authorId: 'support-team',
    authorName: 'Vendor Support Team',
    isInternal: false,
    attachments: [],
    createdAt,
  };
}

async function putPublicSystemMessage(ticketId, body, createdAt = new Date().toISOString()) {
  const message = buildSystemMessage(ticketId, body, createdAt);
  await dynamoDB.put({ TableName: MESSAGES_TABLE, Item: message }).promise();
  return message;
}

async function putPublicSupportTeamMessage(ticketId, body, createdAt = new Date().toISOString()) {
  const message = buildSupportTeamMessage(ticketId, body, createdAt);
  await dynamoDB.put({ TableName: MESSAGES_TABLE, Item: message }).promise();
  return message;
}

function buildCreateAcknowledgement(ticket) {
  return `We have received your ticket and routed it to ${ticket.teamLabel}. We will share updates here. If our team replies and we do not hear back from you for ${AUTO_CLOSE_DAYS} day(s), this ticket may close automatically, and you can reopen it anytime.`;
}

function buildCreateTeamGreeting(ticket) {
  return `Hello, and sorry for the inconvenience. Your request is now with our ${ticket.teamLabel}. A support specialist will review it shortly and continue the conversation with you here.`;
}

function buildAutoCloseSystemMessage() {
  return `This ticket was closed automatically because there was no reply from the vendor for ${AUTO_CLOSE_DAYS} day(s) after the latest support update. You can reopen it anytime if help is still needed.`;
}

function shouldAutoCloseTicket(ticket, nowIso = new Date().toISOString()) {
  if (!ticket) return false;
  if (String(ticket.portalType || '') !== PORTAL_TYPE) return false;
  if (!['open', 'in_progress', 'resolved'].includes(String(ticket.status || '').toLowerCase())) return false;
  if (String(ticket.waitingOn || '') !== 'user') return false;
  if (!ticket.autoCloseAt) return false;
  return String(ticket.autoCloseAt) <= String(nowIso);
}

async function closeTicketForInactivity(ticket, now = new Date()) {
  const nowIso = now.toISOString();
  if (!shouldAutoCloseTicket(ticket, nowIso)) return ticket;

  await dynamoDB.update({
    TableName: TICKETS_TABLE,
    Key: { ticketId: ticket.ticketId },
    ConditionExpression: '#waitingOn = :waitingUser AND #status <> :closed',
    UpdateExpression: 'SET #status = :closed, updatedAt = :updatedAt, closedAt = if_not_exists(closedAt, :updatedAt), autoClosedAt = :updatedAt, autoCloseReason = :reason, #waitingOn = :waitingClosed, #history = list_append(if_not_exists(#history, :empty), :historyItem) REMOVE autoCloseAt',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#waitingOn': 'waitingOn',
      '#history': 'history',
    },
    ExpressionAttributeValues: {
      ':closed': 'closed',
      ':updatedAt': nowIso,
      ':reason': 'user_inactivity_timeout',
      ':waitingUser': 'user',
      ':waitingClosed': 'closed',
      ':empty': [],
      ':historyItem': [{ action: 'auto_closed', by: 'system', at: nowIso, detail: 'Ticket closed automatically after vendor inactivity.' }],
    },
  }).promise().catch((err) => {
    if (err && err.code === 'ConditionalCheckFailedException') return null;
    throw err;
  });

  await putPublicSystemMessage(ticket.ticketId, buildAutoCloseSystemMessage(), nowIso);

  return {
    ...ticket,
    status: 'closed',
    updatedAt: nowIso,
    closedAt: ticket.closedAt || nowIso,
    autoClosedAt: nowIso,
    autoCloseReason: 'user_inactivity_timeout',
    waitingOn: 'closed',
    autoCloseAt: undefined,
  };
}

function buildReferenceSearchHaystack(option) {
  return [
    option?.value,
    option?.label,
    option?.description,
    option?.referenceType,
    ...(option?.context && typeof option.context === 'object' ? Object.values(option.context) : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function filterAndLimitReferenceOptions(options, search = '', limit = 5) {
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 25)) : 5;
  const query = compactValue(search)?.toLowerCase() || '';
  return (options || [])
    .filter((option) => !query || buildReferenceSearchHaystack(option).includes(query))
    .slice(0, normalizedLimit);
}

function sortByRecent(records) {
  return [...records].sort((a, b) => {
    const aTime = compactValue(a?.updatedAt, a?.createdAt, a?.lastModifiedAt, a?.lastActivityAt, a?.submittedAt, a?.assignedAt) || '';
    const bTime = compactValue(b?.updatedAt, b?.createdAt, b?.lastModifiedAt, b?.lastActivityAt, b?.submittedAt, b?.assignedAt) || '';
    return bTime.localeCompare(aTime);
  });
}

function ticketBelongsToCaller(ticket, caller) {
  if (ticket?.portalType && ticket.portalType !== PORTAL_TYPE) return false;
  return ticket?.raisedById === caller.userId || ticket?.raisedByEmail === caller.email;
}

function inferReferenceType(sourceModule, explicitReferenceType) {
  const explicit = compactValue(explicitReferenceType).toLowerCase();
  if (explicit) return explicit;
  const normalizedModule = compactValue(sourceModule).toLowerCase();
  return REFERENCE_TYPE_BY_MODULE[normalizedModule] || '';
}

async function getRecordByKey(tableName, keyName, value) {
  if (!tableName || !keyName || !compactValue(value)) return null;
  const result = await dynamoDB.get({
    TableName: tableName,
    Key: { [keyName]: value },
  }).promise();
  return result.Item || null;
}

async function scanSingleRecord(tableName, attributeNames, value) {
  const attributes = Array.isArray(attributeNames) ? attributeNames : [attributeNames];
  const validAttributes = attributes.filter(Boolean);
  if (!tableName || !validAttributes.length || !compactValue(value)) return null;

  const expressionAttributeNames = {};
  const clauses = validAttributes.map((attributeName, index) => {
    const token = `#f${index}`;
    expressionAttributeNames[token] = attributeName;
    return `${token} = :value`;
  });

  const result = await dynamoDB.scan({
    TableName: tableName,
    FilterExpression: clauses.join(' OR '),
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: { ':value': value },
  }).promise();

  return result.Items?.[0] || null;
}

async function scanRecords(tableName, filterExpression, expressionAttributeValues, expressionAttributeNames) {
  const result = await dynamoDB.scan({
    TableName: tableName,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ...(expressionAttributeNames ? { ExpressionAttributeNames: expressionAttributeNames } : {}),
  }).promise();
  return result.Items || [];
}

function buildVendorReferenceDetails(item) {
  const vendorId = compactValue(item?.vendorId, item?.id);
  const companyName = compactValue(
    item?.companyName,
    item?.companyDetails?.companyName,
    item?.vendorName,
    item?.name,
    item?.vendorDetails?.primaryContactName,
    vendorId,
  );
  const primaryEmail = compactValue(item?.email, item?.vendorDetails?.primaryContactEmail);
  const status = compactValue(item?.status);
  const gstin = compactValue(item?.companyDetails?.taxIdentificationNumber, item?.companyDetails?.gstin);

  return {
    referenceType: 'vendor',
    referenceId: vendorId,
    label: companyName || vendorId,
    title: companyName || 'Vendor account',
    description: compactText(item?.companyDetails?.companyOverview || item?.vendorDetails?.servicesDescription || status, 220),
    fields: [
      { label: 'Vendor ID', value: vendorId, mono: true },
      primaryEmail ? { label: 'Primary Email', value: primaryEmail } : null,
      status ? { label: 'Status', value: status } : null,
      gstin ? { label: 'GSTIN', value: gstin, mono: true } : null,
    ].filter(Boolean),
    context: {
      vendorId,
      companyName,
      status,
      primaryEmail,
    },
  };
}

function buildProjectReferenceDetails(item) {
  const projectId = compactValue(item?.projectId, item?.id, item?.clientId);
  const name = compactValue(item?.name, item?.projectName, item?.title, projectId);
  const status = compactValue(item?.status);
  const clientId = compactValue(item?.clientId);
  const manager = compactValue(item?.manager, item?.projectManager, item?.pmName);

  return {
    referenceType: 'project',
    referenceId: projectId,
    label: name || projectId,
    title: name || 'Project',
    description: compactText(item?.description || item?.projectDescription || status, 220),
    fields: [
      { label: 'Project ID', value: projectId, mono: true },
      clientId ? { label: 'Client ID', value: clientId, mono: true } : null,
      status ? { label: 'Status', value: status } : null,
      manager ? { label: 'Manager', value: manager } : null,
    ].filter(Boolean),
    context: {
      projectId,
      name,
      status,
      clientId,
      manager,
    },
  };
}

function buildWorkspaceReferenceDetails(item) {
  const workspaceId = compactValue(item?.workspaceId, item?.id, item?.projectId);
  const title = compactValue(item?.title, item?.workspaceName, item?.name, workspaceId);
  const projectId = compactValue(item?.projectId);
  const leadId = compactValue(item?.leadId);
  const status = compactValue(item?.status);

  return {
    referenceType: 'workspace',
    referenceId: workspaceId,
    label: title || workspaceId,
    title: title || 'Workspace',
    description: compactText(item?.description || `Workspace for project ${projectId || '—'}`, 220),
    fields: [
      { label: 'Workspace ID', value: workspaceId, mono: true },
      projectId ? { label: 'Project ID', value: projectId, mono: true } : null,
      leadId ? { label: 'Lead ID', value: leadId, mono: true } : null,
      status ? { label: 'Status', value: status } : null,
    ].filter(Boolean),
    context: {
      workspaceId,
      title,
      projectId,
      leadId,
      status,
    },
  };
}

function buildRfqReferenceDetails(item) {
  const leadId = compactValue(item?.leadId, item?.id);
  const title = compactValue(item?.leadTitle, item?.name, item?.title, leadId);
  const status = compactValue(item?.status);
  const projectId = compactValue(item?.projectId, item?.clientId);
  const pmName = compactValue(item?.pmName, item?.projectManagerName);

  return {
    referenceType: 'rfq',
    referenceId: leadId,
    label: title || leadId,
    title: title || 'Lead / RFQ',
    description: compactText(item?.leadDescription || item?.description || status, 220),
    fields: [
      { label: 'Lead ID', value: leadId, mono: true },
      projectId ? { label: 'Project ID', value: projectId, mono: true } : null,
      status ? { label: 'Status', value: status } : null,
      pmName ? { label: 'PM', value: pmName } : null,
    ].filter(Boolean),
    context: {
      leadId,
      title,
      projectId,
      status,
      pmName,
    },
  };
}

function buildSalesEnquiryReferenceDetails(item) {
  const sentRfqId = compactValue(item?.sentRfqId, item?.rfqId, item?.id);
  const title = compactValue(item?.material, item?.category, item?.specification, sentRfqId);
  const status = compactValue(item?.status);
  const quantity = compactValue(item?.quantity);

  return {
    referenceType: 'sales_enquiry',
    referenceId: sentRfqId,
    label: title || sentRfqId,
    title: title || 'Sales enquiry',
    description: compactText(item?.specification || status, 220),
    fields: [
      { label: 'RFQ ID', value: sentRfqId, mono: true },
      status ? { label: 'Status', value: status } : null,
      quantity ? { label: 'Quantity', value: quantity } : null,
      item?.createdAt ? { label: 'Created', value: item.createdAt } : null,
    ].filter(Boolean),
    context: {
      sentRfqId,
      title,
      status,
      quantity,
      enquiryId: compactValue(item?.enquiryId),
    },
  };
}

function buildSalesQuotationReferenceDetails(item) {
  const quotationId = compactValue(item?.quotationId, item?.id);
  const sentRfqId = compactValue(item?.sentRfqId);
  const status = compactValue(item?.status);
  const title = compactValue(item?.material, item?.productName, item?.itemName, sentRfqId, quotationId);

  return {
    referenceType: 'sales_quotation',
    referenceId: quotationId,
    label: title || quotationId,
    title: title || 'Sales quotation',
    description: compactText(status || item?.notes || item?.description, 220),
    fields: [
      { label: 'Quotation ID', value: quotationId, mono: true },
      sentRfqId ? { label: 'RFQ ID', value: sentRfqId, mono: true } : null,
      status ? { label: 'Status', value: status } : null,
      item?.purchaseOrderId ? { label: 'PO ID', value: item.purchaseOrderId, mono: true } : null,
    ].filter(Boolean),
    context: {
      quotationId,
      sentRfqId,
      status,
      purchaseOrderId: compactValue(item?.purchaseOrderId),
      enquiryId: compactValue(item?.enquiryId),
      title,
    },
  };
}

function buildSalesPurchaseOrderReferenceDetails(item) {
  const purchaseOrderId = compactValue(item?.purchaseOrderId, item?.id);
  const status = compactValue(item?.status);
  const invoiceUploaded = item?.invoicePdfUrl ? 'Uploaded' : 'Pending';
  const lineCount = Array.isArray(item?.products) ? String(item.products.length) : '';

  return {
    referenceType: 'sales_purchase_order',
    referenceId: purchaseOrderId,
    label: purchaseOrderId,
    title: purchaseOrderId || 'Sales purchase order',
    description: compactText(status || item?.clientApprovalStatus || invoiceUploaded, 220),
    fields: [
      { label: 'PO ID', value: purchaseOrderId, mono: true },
      status ? { label: 'Status', value: status } : null,
      item?.clientApprovalStatus ? { label: 'Client Approval', value: item.clientApprovalStatus } : null,
      { label: 'Invoice', value: invoiceUploaded },
      lineCount ? { label: 'Line Items', value: lineCount } : null,
    ].filter(Boolean),
    context: {
      purchaseOrderId,
      status,
      clientApprovalStatus: compactValue(item?.clientApprovalStatus),
      invoiceUploaded,
      lineCount,
    },
  };
}

function buildSalesShipmentReferenceDetails(item) {
  const trackId = compactValue(item?.trackId, item?.trackingId, item?.orderId, item?.id);
  const productLabel = Array.isArray(item?.shipmentProducts) && item.shipmentProducts.length > 0
    ? compactValue(item.shipmentProducts[0]?.productName, item?.productName)
    : compactValue(item?.productName);
  const status = compactValue(item?.status);
  const deliveryFlow = compactValue(item?.deliveryFlow);
  const expectedDelivery = compactValue(item?.expectedDelivery, item?.expectedDeliveryDate);

  return {
    referenceType: 'sales_shipment',
    referenceId: trackId,
    label: productLabel || trackId,
    title: productLabel || trackId || 'Sales shipment',
    description: compactText(status || deliveryFlow || expectedDelivery, 220),
    fields: [
      { label: 'Tracking ID', value: trackId, mono: true },
      item?.orderId ? { label: 'Order ID', value: item.orderId, mono: true } : null,
      status ? { label: 'Status', value: status } : null,
      deliveryFlow ? { label: 'Delivery Flow', value: deliveryFlow } : null,
      expectedDelivery ? { label: 'ETA', value: expectedDelivery } : null,
    ].filter(Boolean),
    context: {
      trackId,
      orderId: compactValue(item?.orderId),
      status,
      deliveryFlow,
      expectedDelivery,
      productName: productLabel,
    },
  };
}

function buildSalesWarrantyClaimReferenceDetails(item) {
  const claimId = compactValue(item?.claimId, item?.id);
  const productName = compactValue(item?.productName, item?.warrantyData?.productName, item?.warrantyData?.warrantyPolicy?.type, claimId);
  const vendorStatus = compactValue(item?.vendorStatus);
  const eligibility = compactValue(item?.eligibility);
  const resolutionType = compactValue(item?.resolutionType);

  return {
    referenceType: 'sales_warranty_claim',
    referenceId: claimId,
    label: productName || claimId,
    title: productName || claimId || 'Sales warranty claim',
    description: compactText(vendorStatus || eligibility || resolutionType, 220),
    fields: [
      { label: 'Claim ID', value: claimId, mono: true },
      item?.warrantyId ? { label: 'Warranty ID', value: item.warrantyId, mono: true } : null,
      item?.orderId ? { label: 'Order ID', value: item.orderId, mono: true } : null,
      eligibility ? { label: 'Eligibility', value: eligibility } : null,
      vendorStatus ? { label: 'Vendor Status', value: vendorStatus } : null,
      resolutionType ? { label: 'Resolution', value: resolutionType } : null,
    ].filter(Boolean),
    context: {
      claimId,
      warrantyId: compactValue(item?.warrantyId),
      orderId: compactValue(item?.orderId),
      productName,
      eligibility,
      vendorStatus,
      resolutionType,
    },
  };
}

function summarizeSalesInventoryRows(rows) {
  const inventoryRows = Array.isArray(rows) ? rows : [];
  const onHand = inventoryRows.reduce((sum, row) => sum + Number(row?.onHand || 0), 0);
  const available = inventoryRows.reduce((sum, row) => sum + Number(row?.available || 0), 0);
  const warehouseCount = new Set(inventoryRows.map((row) => compactValue(row?.warehouseId, row?.warehouse)).filter(Boolean)).size;
  const reorderAlert = inventoryRows.some((row) => {
    const reorderPoint = Number(row?.reorderPoint ?? 10);
    return Number.isFinite(reorderPoint) && Number(row?.available || 0) <= reorderPoint;
  });
  return {
    onHand,
    available,
    warehouseCount,
    reorderAlert,
  };
}

function buildSalesInventoryReferenceDetails(item) {
  const productId = compactValue(item?.productId, item?.baseProductId, item?.id);
  const productName = compactValue(item?.productName, item?.name, productId);
  const category = compactValue(item?.productCategory, item?.category);
  const sku = compactValue(item?.sku, item?.inventorySummary?.sku);
  const inventorySummary = item?.inventorySummary || summarizeSalesInventoryRows(item?.inventoryRows || []);
  const stockStatus = inventorySummary.available <= 0
    ? 'Out of stock'
    : inventorySummary.reorderAlert
      ? 'Low stock'
      : 'In stock';

  return {
    referenceType: 'sales_inventory_item',
    referenceId: productId,
    label: productName || productId,
    title: productName || productId || 'Sales inventory item',
    description: compactText(stockStatus || category || sku, 220),
    fields: [
      { label: 'Product ID', value: productId, mono: true },
      sku ? { label: 'SKU', value: sku, mono: true } : null,
      category ? { label: 'Category', value: category } : null,
      { label: 'Available', value: String(inventorySummary.available || 0) },
      { label: 'On Hand', value: String(inventorySummary.onHand || 0) },
      inventorySummary.warehouseCount ? { label: 'Warehouses', value: String(inventorySummary.warehouseCount) } : null,
      { label: 'Stock Status', value: stockStatus },
    ].filter(Boolean),
    context: {
      productId,
      sku,
      category,
      available: inventorySummary.available || 0,
      onHand: inventorySummary.onHand || 0,
      warehouseCount: inventorySummary.warehouseCount || 0,
      stockStatus,
      productName,
    },
  };
}

function buildWorkspaceCreditNoteReferenceDetails(item) {
  const creditNoteId = compactValue(item?.creditNoteId, item?.id);
  const displayCreditNoteId = compactValue(
    item?.customCreditNoteId,
    item?.creditNoteNumber,
    item?.displayCreditNoteId,
    creditNoteId,
  );
  const customerName = compactValue(item?.customerName, item?.customer, item?.customerDetails?.companyName, item?.customerDetails?.name);
  const status = compactValue(item?.status, item?.creditNoteStatus);
  const totalAmount = compactValue(item?.totalAmount, item?.total, item?.grandTotal);
  const invoiceId = compactValue(item?.invoiceId);
  const projectName = compactValue(item?.projectName);

  return {
    referenceType: 'workspace_credit_note',
    referenceId: creditNoteId,
    label: displayCreditNoteId || creditNoteId,
    title: displayCreditNoteId || creditNoteId || 'Workspace credit note',
    description: compactText(status || customerName || projectName || invoiceId, 220),
    fields: [
      { label: 'Credit Note ID', value: creditNoteId, mono: true },
      displayCreditNoteId && displayCreditNoteId !== creditNoteId ? { label: 'Display Number', value: displayCreditNoteId, mono: true } : null,
      invoiceId ? { label: 'Invoice ID', value: invoiceId, mono: true } : null,
      customerName ? { label: 'Client', value: customerName } : null,
      projectName ? { label: 'Project', value: projectName } : null,
      status ? { label: 'Status', value: status } : null,
      totalAmount ? { label: 'Amount', value: totalAmount } : null,
    ].filter(Boolean),
    context: {
      creditNoteId,
      displayCreditNoteId,
      invoiceId,
      customerName,
      projectName,
      status,
      totalAmount,
    },
  };
}

function buildFallbackReference(referenceType, referenceId, referenceLabel, referenceContext) {
  const fallbackId = compactValue(referenceId);
  const fallbackLabel = compactValue(referenceLabel, fallbackId, 'Linked record');
  return {
    referenceType,
    referenceId: fallbackId,
    label: fallbackLabel,
    title: fallbackLabel,
    description: '',
    fields: fallbackId ? [{ label: 'Reference ID', value: fallbackId, mono: true }] : [],
    context: referenceContext && typeof referenceContext === 'object' ? referenceContext : null,
  };
}

async function fetchVendorReferenceRecord(referenceId, caller) {
  const normalizedId = compactValue(referenceId, caller.userId, caller.email);
  const exact = await getRecordByKey(VENDORS_TABLE, 'vendorId', normalizedId);
  if (exact) return exact;
  const scanned = await scanSingleRecord(VENDORS_TABLE, ['vendorId', 'id', 'email'], normalizedId);
  if (scanned) return scanned;
  if (caller.email && normalizedId === caller.userId) {
    return scanSingleRecord(VENDORS_TABLE, ['email', 'vendorDetails.primaryContactEmail'], caller.email);
  }
  return null;
}

async function fetchProjectReferenceRecord(referenceId) {
  const exact = await getRecordByKey(PROJECTS_TABLE, 'projectId', referenceId);
  if (exact) return exact;
  const scanned = await scanSingleRecord(PROJECTS_TABLE, ['projectId', 'id', 'clientId'], referenceId);
  if (scanned) return scanned;
  const pmProject = await getRecordByKey(PM_PROJECTS_TABLE, 'projectId', referenceId);
  if (pmProject) return pmProject;
  return scanSingleRecord(PM_PROJECTS_TABLE, ['projectId', 'id'], referenceId);
}

async function fetchWorkspaceReferenceRecord(referenceId) {
  const exact = await getRecordByKey(WORKSPACES_TABLE, 'workspaceId', referenceId);
  if (exact) return exact;
  return scanSingleRecord(WORKSPACES_TABLE, ['workspaceId', 'id', 'projectId', 'leadId'], referenceId);
}

async function fetchRfqReferenceRecord(referenceId) {
  const exact = await getRecordByKey(LEADS_TABLE, 'leadId', referenceId);
  if (exact) return exact;
  return scanSingleRecord(LEADS_TABLE, ['leadId', 'id', 'projectId'], referenceId);
}

async function fetchSalesEnquiryReferenceRecord(referenceId, caller) {
  const record = await getRecordByKey(SALES_SENT_RFQ_TABLE, 'sentRfqId', referenceId);
  if (!record) return scanSingleRecord(SALES_SENT_RFQ_TABLE, ['sentRfqId', 'enquiryId', 'id'], referenceId);
  if (Array.isArray(record.vendorIds) && caller.userId && !record.vendorIds.includes(caller.userId)) return null;
  return record;
}

async function fetchSalesQuotationReferenceRecord(referenceId, caller) {
  const record = await getRecordByKey(SALES_QUOTATIONS_TABLE, 'quotationId', referenceId);
  const fallback = record || await scanSingleRecord(SALES_QUOTATIONS_TABLE, ['quotationId', 'sentRfqId', 'purchaseOrderId'], referenceId);
  if (fallback && fallback.vendorId && caller.userId && fallback.vendorId !== caller.userId) return null;
  return fallback;
}

async function fetchSalesPurchaseOrderReferenceRecord(referenceId, caller) {
  const record = await getRecordByKey(SALES_PURCHASE_ORDERS_TABLE, 'purchaseOrderId', referenceId);
  const fallback = record || await scanSingleRecord(SALES_PURCHASE_ORDERS_TABLE, ['purchaseOrderId', 'id'], referenceId);
  if (fallback && fallback.vendorId && caller.userId && fallback.vendorId !== caller.userId) return null;
  return fallback;
}

async function fetchSalesShipmentReferenceRecord(referenceId) {
  const exact = await scanSingleRecord(SALES_ORDERS_TABLE, ['trackId', 'trackingId'], referenceId);
  return exact || null;
}

async function fetchSalesWarrantyClaimReferenceRecord(referenceId, caller) {
  const record = await getRecordByKey(SALES_WARRANTY_CLAIMS_TABLE, 'claimId', referenceId)
    || await scanSingleRecord(SALES_WARRANTY_CLAIMS_TABLE, ['claimId', 'id'], referenceId);
  if (!record) return null;

  const warrantyId = compactValue(record?.warrantyId);
  if (!warrantyId) return null;

  const warranty = await getRecordByKey(SALES_WARRANTIES_TABLE, 'warrantyId', warrantyId)
    || await scanSingleRecord(SALES_WARRANTIES_TABLE, ['warrantyId', 'id'], warrantyId);
  if (!warranty) return null;
  if (caller.userId && compactValue(warranty?.vendorId) && compactValue(warranty.vendorId) !== caller.userId) return null;

  return {
    ...record,
    warrantyData: warranty,
    productName: compactValue(record?.productName, warranty?.productName, record?.warrantyData?.productName),
  };
}

async function fetchSalesInventoryRowsForVendor(vendorId) {
  if (!compactValue(vendorId)) return [];
  return scanRecords(
    SALES_INVENTORY_TABLE,
    'vendorId = :vendorId AND begins_with(productId, :prefix)',
    { ':vendorId': vendorId, ':prefix': 'PROD#' },
  );
}

async function fetchSalesInventoryReferenceRecord(referenceId, caller) {
  const product = await scanSingleRecord(SALES_PRODUCTS_TABLE, ['productId', 'id'], referenceId);
  if (!product) return null;
  if (caller.userId && compactValue(product?.vendorId) && compactValue(product.vendorId) !== caller.userId) return null;

  const inventoryRows = await fetchSalesInventoryRowsForVendor(compactValue(product?.vendorId, caller.userId));
  const matchingRows = (inventoryRows || []).filter((row) => compactValue(row?.baseProductId) === compactValue(referenceId));

  return {
    ...product,
    inventoryRows: matchingRows,
    inventorySummary: summarizeSalesInventoryRows(matchingRows),
  };
}

async function fetchWorkspaceCreditNoteReferenceRecord(referenceId, caller) {
  if (!compactValue(referenceId) || !compactValue(caller.userId)) return null;

  const exact = await dynamoDB.get({
    TableName: WORKSPACE_CREDIT_NOTES_TABLE,
    Key: { vendorId: caller.userId, creditNoteId: referenceId },
  }).promise();
  if (exact.Item) return exact.Item;

  const records = await scanRecords(
    WORKSPACE_CREDIT_NOTES_TABLE,
    'vendorId = :vendorId AND (creditNoteId = :referenceId OR customCreditNoteId = :referenceId OR creditNoteNumber = :referenceId)',
    {
      ':vendorId': caller.userId,
      ':referenceId': referenceId,
    },
  );

  return records[0] || null;
}

async function fetchSalesShipmentRecordsForVendor(vendorId) {
  if (!compactValue(vendorId)) return [];
  const products = await scanRecords(
    SALES_PRODUCTS_TABLE,
    'vendorId = :vendorId',
    { ':vendorId': vendorId },
  );
  const vendorProductIds = new Set((products || []).map((item) => compactValue(item?.productId)).filter(Boolean));
  if (!vendorProductIds.size) return [];

  const orders = await scanRecords(SALES_ORDERS_TABLE, 'attribute_exists(trackId)', {});

  return (orders || []).reduce((results, order) => {
    let vendorProductsInOrder = [];
    let isMatch = false;

    if (Array.isArray(order?.shipmentProducts) && order.shipmentProducts.length > 0) {
      vendorProductsInOrder = order.shipmentProducts.filter((product) => vendorProductIds.has(compactValue(product?.productId)));
      if (vendorProductsInOrder.length > 0) isMatch = true;
    }

    if (!isMatch && order?.quotationSnapshot && Array.isArray(order.quotationSnapshot.products)) {
      vendorProductsInOrder = order.quotationSnapshot.products.filter((product) => vendorProductIds.has(compactValue(product?.productId)));
      if (vendorProductsInOrder.length > 0) isMatch = true;
    }

    if (!isMatch && vendorProductIds.has(compactValue(order?.productId))) {
      isMatch = true;
      vendorProductsInOrder = [{
        productId: order.productId,
        productName: order.productName,
        quantity: order.units || 1,
      }];
    }

    if (isMatch) {
      results.push({
        ...order,
        shipmentProducts: vendorProductsInOrder,
      });
    }

    return results;
  }, []);
}

async function fetchSalesWarrantyClaimRecordsForVendor(vendorId) {
  if (!compactValue(vendorId)) return [];

  const warranties = await scanRecords(
    SALES_WARRANTIES_TABLE,
    'vendorId = :vendorId',
    { ':vendorId': vendorId },
  );
  const warrantyIds = (warranties || []).map((item) => compactValue(item?.warrantyId)).filter(Boolean);
  if (!warrantyIds.length) return [];

  const expressionAttributeValues = { ':eligibility': 'approved' };
  const warrantyTokens = warrantyIds.map((warrantyId, index) => {
    const token = `:warrantyId${index}`;
    expressionAttributeValues[token] = warrantyId;
    return token;
  });

  const claims = await scanRecords(
    SALES_WARRANTY_CLAIMS_TABLE,
    `eligibility = :eligibility AND warrantyId IN (${warrantyTokens.join(', ')})`,
    expressionAttributeValues,
  );

  const warrantyMap = new Map((warranties || []).map((item) => [compactValue(item?.warrantyId), item]));

  return (claims || []).map((claim) => ({
    ...claim,
    warrantyData: warrantyMap.get(compactValue(claim?.warrantyId)) || null,
    productName: compactValue(claim?.productName, claim?.warrantyData?.productName, warrantyMap.get(compactValue(claim?.warrantyId))?.productName),
  }));
}

async function fetchSalesInventoryReferenceOptionsForVendor(vendorId) {
  if (!compactValue(vendorId)) return [];

  const [products, inventoryRows] = await Promise.all([
    scanRecords(
      SALES_PRODUCTS_TABLE,
      'vendorId = :vendorId',
      { ':vendorId': vendorId },
    ),
    fetchSalesInventoryRowsForVendor(vendorId),
  ]);

  const groupedInventory = new Map();
  for (const row of (inventoryRows || [])) {
    const baseProductId = compactValue(row?.baseProductId);
    if (!baseProductId) continue;
    const existing = groupedInventory.get(baseProductId) || [];
    existing.push(row);
    groupedInventory.set(baseProductId, existing);
  }

  return (products || []).map((product) => {
    const productId = compactValue(product?.productId, product?.id);
    const matchingRows = groupedInventory.get(productId) || [];
    return {
      ...product,
      inventoryRows: matchingRows,
      inventorySummary: summarizeSalesInventoryRows(matchingRows),
    };
  });
}

async function fetchWorkspaceCreditNoteReferenceOptionsForVendor(vendorId) {
  if (!compactValue(vendorId)) return [];
  return scanRecords(
    WORKSPACE_CREDIT_NOTES_TABLE,
    'vendorId = :vendorId',
    { ':vendorId': vendorId },
  );
}

async function fetchReferenceRecord(referenceType, referenceId, caller) {
  switch (referenceType) {
    case 'vendor':
      return fetchVendorReferenceRecord(referenceId, caller);
    case 'project':
      return fetchProjectReferenceRecord(referenceId);
    case 'workspace':
      return fetchWorkspaceReferenceRecord(referenceId);
    case 'rfq':
      return fetchRfqReferenceRecord(referenceId);
    case 'sales_enquiry':
      return fetchSalesEnquiryReferenceRecord(referenceId, caller);
    case 'sales_quotation':
      return fetchSalesQuotationReferenceRecord(referenceId, caller);
    case 'sales_purchase_order':
      return fetchSalesPurchaseOrderReferenceRecord(referenceId, caller);
    case 'sales_shipment':
      return fetchSalesShipmentReferenceRecord(referenceId);
    case 'sales_warranty_claim':
      return fetchSalesWarrantyClaimReferenceRecord(referenceId, caller);
    case 'sales_inventory_item':
      return fetchSalesInventoryReferenceRecord(referenceId, caller);
    case 'workspace_credit_note':
      return fetchWorkspaceCreditNoteReferenceRecord(referenceId, caller);
    default:
      return null;
  }
}

function buildReferenceDetails(referenceType, item, fallback) {
  if (!item) return buildFallbackReference(referenceType, fallback?.referenceId, fallback?.referenceLabel, fallback?.referenceContext);
  switch (referenceType) {
    case 'vendor':
      return buildVendorReferenceDetails(item);
    case 'project':
      return buildProjectReferenceDetails(item);
    case 'workspace':
      return buildWorkspaceReferenceDetails(item);
    case 'rfq':
      return buildRfqReferenceDetails(item);
    case 'sales_enquiry':
      return buildSalesEnquiryReferenceDetails(item);
    case 'sales_quotation':
      return buildSalesQuotationReferenceDetails(item);
    case 'sales_purchase_order':
      return buildSalesPurchaseOrderReferenceDetails(item);
    case 'sales_shipment':
      return buildSalesShipmentReferenceDetails(item);
    case 'sales_warranty_claim':
      return buildSalesWarrantyClaimReferenceDetails(item);
    case 'sales_inventory_item':
      return buildSalesInventoryReferenceDetails(item);
    case 'workspace_credit_note':
      return buildWorkspaceCreditNoteReferenceDetails(item);
    default:
      return buildFallbackReference(referenceType, fallback?.referenceId, fallback?.referenceLabel, fallback?.referenceContext);
  }
}

async function resolveTicketReference({ sourceModule, referenceType, referenceId, referenceLabel, referenceContext }, caller) {
  const normalizedType = inferReferenceType(sourceModule, referenceType);
  const normalizedId = compactValue(referenceId);
  if (!normalizedType || !normalizedId) return null;

  const record = await fetchReferenceRecord(normalizedType, normalizedId, caller);
  return buildReferenceDetails(normalizedType, record, {
    referenceId: normalizedId,
    referenceLabel,
    referenceContext,
  });
}

function toReferenceOption(reference) {
  return {
    value: reference.referenceId,
    label: reference.label || reference.referenceId,
    description: reference.description || '',
    referenceType: reference.referenceType,
    context: reference.context || null,
  };
}

async function listReferenceOptionsByModule(moduleName, caller, { search = '', limit = 5 } = {}) {
  const normalizedModule = compactValue(moduleName).toLowerCase();

  if (normalizedModule === 'vendor') {
    const vendor = await fetchVendorReferenceRecord(caller.userId, caller);
    return filterAndLimitReferenceOptions(vendor ? [toReferenceOption(buildVendorReferenceDetails(vendor))] : [], search, limit);
  }

  if (normalizedModule === 'project') {
    const records = await scanRecords(
      PROJECTS_TABLE,
      'vendorId = :vendorId',
      { ':vendorId': caller.userId },
    );
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildProjectReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .sort((a, b) => (b.context?.status || '').localeCompare(a.context?.status || '') || a.label.localeCompare(b.label))
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'workspace') {
    const records = await scanRecords(
      WORKSPACES_TABLE,
      'vendorId = :vendorId',
      { ':vendorId': caller.userId },
    );
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildWorkspaceReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'quotation') {
    const records = await scanRecords(
      LEADS_TABLE,
      'assignedVendorId = :vendorId OR vendorId = :vendorId',
      { ':vendorId': caller.userId },
    );
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildRfqReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'sales_enquiry') {
    const records = await scanRecords(
      SALES_SENT_RFQ_TABLE,
      'contains(vendorIds, :vendorId)',
      { ':vendorId': caller.userId },
    );
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildSalesEnquiryReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'sales_quotation') {
    const records = await scanRecords(
      SALES_QUOTATIONS_TABLE,
      'vendorId = :vendorId',
      { ':vendorId': caller.userId },
    );
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildSalesQuotationReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'sales_purchase_order') {
    const records = await scanRecords(
      SALES_PURCHASE_ORDERS_TABLE,
      'vendorId = :vendorId',
      { ':vendorId': caller.userId },
    );
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildSalesPurchaseOrderReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'sales_shipment') {
    const records = await fetchSalesShipmentRecordsForVendor(caller.userId);
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildSalesShipmentReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'sales_warranty_claim') {
    const records = await fetchSalesWarrantyClaimRecordsForVendor(caller.userId);
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildSalesWarrantyClaimReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'sales_inventory_item') {
    const records = await fetchSalesInventoryReferenceOptionsForVendor(caller.userId);
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildSalesInventoryReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .map(toReferenceOption), search, limit);
  }

  if (normalizedModule === 'workspace_credit_note') {
    const records = await fetchWorkspaceCreditNoteReferenceOptionsForVendor(caller.userId);
    return filterAndLimitReferenceOptions(sortByRecent(records)
      .map((record) => buildWorkspaceCreditNoteReferenceDetails(record))
      .filter((reference) => reference.referenceId)
      .map(toReferenceOption), search, limit);
  }

  return [];
}

/**
 * Resolve the caller's stable identity from the request.
 * Priority: req.vendorId (from attachVendorId) → req.auth.sub → req.auth.email
 */
function resolveUser(req) {
  const vendorId = req.vendorId || req.auth?.sub || req.auth?.email || 'unknown';
  const email    = req.auth?.email || '';
  const name     = req.auth?.name  || '';
  return { userId: vendorId, email, name };
}

/**
 * Upload a single multer file to S3; returns attachment metadata or null.
 */
async function uploadToS3(file, ticketId) {
  const bucket = process.env.S3_BUCKET_NAME || S3_BUCKET_NAME;
  if (!bucket) return null;
  const ext   = (file.originalname.split('.').pop() || 'bin').toLowerCase();
  const s3Key = `support_attachments/${ticketId}/${uuidv4()}.${ext}`;
  await s3.putObject({
    Bucket:      bucket,
    Key:         s3Key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }).promise();
  const region = process.env.AWS_REGION || 'ap-south-1';
  return {
    name: file.originalname,
    url:  `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`,
    type: file.mimetype,
    size: file.size,
  };
}

// ─── POST / — create ticket ───────────────────────────────────────────────────
export const createTicket = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const {
      subject,
      description,
      priority       = 'medium',
      sourceModule,
      category,           // alias — frontend may send either field name
      sourceRecordId,
      referenceType,
      referenceId,
      referenceLabel,
      referenceContext,
      raisedByName:  bodyName,
      raisedByEmail: bodyEmail,
    } = req.body;

    if (!subject?.trim() || !description?.trim()) {
      return res.status(400).json({ success: false, message: 'subject and description are required.' });
    }

    const now      = new Date();
    const ticketId = generateTicketId();
    const normalizedSourceModule = compactValue(sourceModule, category, 'vendor').toLowerCase();
    const teamId   = resolveTeam(normalizedSourceModule);
    const sla      = slaDeadlines(priority, now);
    const resolvedReference = await resolveTicketReference({
      sourceModule: normalizedSourceModule,
      referenceType,
      referenceId: compactValue(referenceId, sourceRecordId),
      referenceLabel,
      referenceContext: normalizeReferenceContext(referenceContext),
    }, caller);

    // Upload any attachments
    const files = req.files || [];
    const attachments = [];
    for (const file of files) {
      try {
        const att = await uploadToS3(file, ticketId);
        if (att) attachments.push(att);
      } catch (e) {
        console.warn('[Vendor-Support] createTicket S3 upload skipped:', e.message);
      }
    }

    const ticket = {
      ticketId,
      subject:        subject.trim(),
      description:    description.trim(),
      priority:       (priority || 'medium').toLowerCase(),
      status:         'open',
      portalType:     PORTAL_TYPE,
      sourceModule:   normalizedSourceModule,
      sourceRecordId: compactValue(resolvedReference?.referenceId, sourceRecordId) || null,
      referenceType:  resolvedReference?.referenceType || null,
      referenceId:    resolvedReference?.referenceId || null,
      referenceLabel: resolvedReference?.label || null,
      referenceContext: resolvedReference?.context || null,
      teamId,
      teamLabel:      TEAM_LABELS[teamId] || teamId,
      raisedById:     caller.userId,
      raisedByEmail:  bodyEmail || caller.email,
      raisedByName:   bodyName  || caller.name,
      attachments,
      satisfactionRating: null,
      escalatedTo:    null,
      escalationNote: null,
      createdAt:      now.toISOString(),
      updatedAt:      now.toISOString(),
      lastUserActivityAt: now.toISOString(),
      firstResponseDeadline: sla.firstResponseDeadline,
      resolutionDeadline:    sla.resolutionDeadline,
      waitingOn: 'support',
      autoCloseAt: null,
      autoClosedAt: null,
      autoCloseReason: null,
      firstRespondedAt: null,
      resolvedAt:       null,
      closedAt:         null,
      history: [
        {
          action: 'created',
          by:     caller.userId,
          at:     now.toISOString(),
          detail: `Ticket raised via Vendor portal. Routed to ${TEAM_LABELS[teamId]}.`,
        },
      ],
    };

    await dynamoDB.put({ TableName: TICKETS_TABLE, Item: ticket }).promise();
  await putPublicSystemMessage(ticketId, buildCreateAcknowledgement(ticket), now.toISOString());
  await putPublicSupportTeamMessage(ticketId, buildCreateTeamGreeting(ticket), now.toISOString());

    return res.status(201).json({ success: true, ticket });
  } catch (err) {
    console.error('[Vendor-Support] createTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create support ticket.' });
  }
};

// ─── GET / — list my tickets ──────────────────────────────────────────────────
export const listMyTickets = async (req, res) => {
  try {
    const caller = resolveUser(req);

    const result = await dynamoDB.scan({
      TableName: TICKETS_TABLE,
      FilterExpression: 'portalType = :portalType AND (raisedById = :uid OR raisedByEmail = :email)',
      ExpressionAttributeValues: {
        ':portalType': PORTAL_TYPE,
        ':uid':   caller.userId,
        ':email': caller.email,
      },
    }).promise();

    const tickets = (await Promise.all((result.Items || []).map((ticket) => closeTicketForInactivity(ticket)))).sort(
      (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')
    );

    return res.json({ success: true, tickets });
  } catch (err) {
    console.error('[Vendor-Support] listMyTickets error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load tickets.' });
  }
};

// ─── GET /:ticketId — get single ticket + messages ────────────────────────────
export const getTicket = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const { ticketId } = req.params;

    const result = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!result.Item) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }
    const ticket = await closeTicketForInactivity(result.Item);

    if (!ticketBelongsToCaller(ticket, caller)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const msgResult = await dynamoDB.query({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: 'ticketId = :t',
      ExpressionAttributeValues: { ':t': ticketId },
      ScanIndexForward: true,
    }).promise();

    const messages = (msgResult.Items || []).filter(m => !m.isInternal);

    return res.json({ success: true, ticket, messages });
  } catch (err) {
    console.error('[Vendor-Support] getTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load ticket.' });
  }
};

// ─── POST /:ticketId/messages — add reply ─────────────────────────────────────
export const addMessage = async (req, res) => {
  try {
    const caller   = resolveUser(req);
    const { ticketId } = req.params;
    const content  = (req.body.content || req.body.body || '').trim();
    const files    = req.files || [];

    if (!content && files.length === 0) {
      return res.status(400).json({ success: false, message: 'Message content or an attachment is required.' });
    }

    const ticketResult = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!ticketResult.Item) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }
    const ticket = ticketResult.Item;

    if (!ticketBelongsToCaller(ticket, caller)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ success: false, message: 'Cannot reply to a closed ticket.' });
    }

    const attachments = [];
    for (const file of files) {
      try {
        const att = await uploadToS3(file, ticketId);
        if (att) attachments.push(att);
      } catch (e) {
        console.warn('[Vendor-Support] S3 upload skipped:', e.message);
      }
    }

    const now       = new Date();
    const messageId = uuidv4();
    const message   = {
      ticketId,
      messageId,
      content,
      body:        content,
      senderType:  'vendor_user',
      senderName:  caller.name || caller.email,
      senderId:    caller.userId,
      authorId:    caller.userId,
      authorName:  caller.name || caller.email,
      isInternal:  false,
      attachments,
      createdAt:   now.toISOString(),
    };

    await dynamoDB.put({ TableName: MESSAGES_TABLE, Item: message }).promise();

    await dynamoDB.update({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET updatedAt = :u, lastUserActivityAt = :u, #waitingOn = :waitingOn, autoCloseAt = :clearAutoClose, #hist = list_append(if_not_exists(#hist, :empty), :h)',
      ExpressionAttributeNames: { '#hist': 'history', '#waitingOn': 'waitingOn' },
      ExpressionAttributeValues: {
        ':u':     now.toISOString(),
        ':waitingOn': 'support',
        ':clearAutoClose': null,
        ':h':     [{ action: 'replied', by: caller.userId, at: now.toISOString(), detail: 'Vendor replied.' }],
        ':empty': [],
      },
    }).promise();

    return res.status(201).json({ success: true, message });
  } catch (err) {
    console.error('[Vendor-Support] addMessage error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
};

// ─── PUT /:ticketId/reopen ────────────────────────────────────────────────────
export const reopenTicket = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const { ticketId } = req.params;

    const result = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!result.Item) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const ticket = result.Item;

    if (!ticketBelongsToCaller(ticket, caller)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({ success: false, message: 'Only resolved or closed tickets can be reopened.' });
    }

    const now = new Date();
    await dynamoDB.update({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET #s = :open, updatedAt = :u, lastUserActivityAt = :u, #waitingOn = :waitingOn, autoCloseAt = :clearAutoClose, #hist = list_append(if_not_exists(#hist, :empty), :h)',
      ExpressionAttributeNames: { '#s': 'status', '#hist': 'history', '#waitingOn': 'waitingOn' },
      ExpressionAttributeValues: {
        ':open':  'open',
        ':u':     now.toISOString(),
        ':waitingOn': 'support',
        ':clearAutoClose': null,
        ':h':     [{ action: 'reopened', by: caller.userId, at: now.toISOString(), detail: 'Vendor reopened the ticket.' }],
        ':empty': [],
      },
    }).promise();

    return res.json({ success: true });
  } catch (err) {
    console.error('[Vendor-Support] reopenTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reopen ticket.' });
  }
};

// ─── PUT /:ticketId/rate — CSAT ───────────────────────────────────────────────
export const rateTicket = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const { ticketId } = req.params;
    const { rating }   = req.body;

    const ratingNum = Number(rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: 'rating must be 1–5.' });
    }

    const ticketResult = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!ticketResult.Item) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }
    const ticket = ticketResult.Item;

    if (!ticketBelongsToCaller(ticket, caller)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({ success: false, message: 'Can only rate resolved or closed tickets.' });
    }

    const now = new Date();
    await dynamoDB.update({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET satisfactionRating = :r, csatRating = :r, updatedAt = :u',
      ExpressionAttributeValues: { ':r': ratingNum, ':u': now.toISOString() },
    }).promise();

    return res.json({ success: true, satisfactionRating: ratingNum, csatRating: ratingNum });
  } catch (err) {
    console.error('[Vendor-Support] rateTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save rating.' });
  }
};

// ─── GET /reference-options — linked-record picker data ──────────────────────
export const listReferenceOptions = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const moduleName = compactValue(req.query.module, req.query.category, req.query.type);
    const search = compactValue(req.query.search) || '';
    const limit = compactValue(req.query.limit) || '5';
    if (!moduleName) {
      return res.status(400).json({ success: false, message: 'module is required.' });
    }

    const options = await listReferenceOptionsByModule(moduleName, caller, { search, limit });
    return res.json({ success: true, options, items: options });
  } catch (err) {
    console.error('[Vendor-Support] listReferenceOptions error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load linked records.' });
  }
};

// ─── GET /:ticketId/reference — resolved linked-record data ──────────────────
export const getTicketReference = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const { ticketId } = req.params;

    const result = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!result.Item) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    const ticket = result.Item;
    if (!ticketBelongsToCaller(ticket, caller)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const reference = await resolveTicketReference({
      sourceModule: ticket.sourceModule,
      referenceType: ticket.referenceType,
      referenceId: compactValue(ticket.referenceId, ticket.sourceRecordId),
      referenceLabel: ticket.referenceLabel,
      referenceContext: ticket.referenceContext,
    }, caller);

    return res.json({ success: true, reference });
  } catch (err) {
    console.error('[Vendor-Support] getTicketReference error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load linked record.' });
  }
};
