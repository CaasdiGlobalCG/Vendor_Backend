/**
 * Mock: seed a workspace quotation that has already gone through the
 * quotation lifecycle up to "Finance added commission and sent it back to PM".
 *
 * Resulting record state:
 *   status = 'approved'  (PM sees it as ready to send to the client)
 *   commissionData / commissionedQuotationUrl populated
 *   clientId set so PM → client → client approval → PO upload all work
 *
 * From here the manual flow is:
 *   PM sends quotation to client → client approves → client uploads their PO
 *   (or picks "use your PO") → PM runs Auto check → (reason → finance) →
 *   PM sends PO to vendor → vendor submits invoice → red-flag check.
 *
 * Usage:
 *   node scripts/mockFinanceApprovedQuotation.js
 *
 * Optional env overrides:
 *   MOCK_VENDOR_ID, MOCK_CLIENT_ID, MOCK_WORKSPACE_ID, AWS_REGION
 *   MOCK_QUOTATION_ID  — reuse an existing quotationId instead of generating one
 *   MOCK_STAGE         — finance_approved (default) | sent_to_client | client_approved
 *
 * NOTE: pass a REAL clientId via MOCK_CLIENT_ID if you want the client-side
 * portal to actually see the quotation and upload a PO against it.
 */
import dotenv from 'dotenv';
dotenv.config();

import {
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const TABLE = process.env.DYNAMODB_WORKSPACE_QUOTATIONS_TABLE || 'workspace_quotations';

const vendorId = process.env.MOCK_VENDOR_ID || 'VENDOR-MOCK-001';
const clientId = process.env.MOCK_CLIENT_ID || 'MOCK-CLIENT-001';
const workspaceId = process.env.MOCK_WORKSPACE_ID || 'WS-MOCK-001';
const now = new Date().toISOString();
const quotationId = process.env.MOCK_QUOTATION_ID || `QT-MOCK-${Date.now()}`;
const customQuoteId = `MOCK-${new Date().getFullYear()}-0001`;

// ---- Items at the vendor's base rates (what the vendor originally quoted) ----
const items = [
  {
    id: 'item-1',
    itemCode: 'CHR-ERGO-01',
    description: 'Ergonomic Office Chair',
    quantity: 10,
    rate: 5000,
    amount: 50000,
    gstPercent: 18,
    cgst: 4500,
    sgst: 4500,
    igst: 0,
  },
  {
    id: 'item-2',
    itemCode: 'DSK-STD-02',
    description: 'Standing Desk 120x60cm',
    quantity: 5,
    rate: 12000,
    amount: 60000,
    gstPercent: 18,
    cgst: 5400,
    sgst: 5400,
    igst: 0,
  },
];

const baseSubtotal = items.reduce((s, i) => s + i.amount, 0); // 110000
const baseGst = items.reduce((s, i) => s + i.cgst + i.sgst + i.igst, 0); // 19800
const baseTotal = baseSubtotal + baseGst; // 129800

// ---- Finance commission (10% on each line) ----
const COMMISSION = 10;
const commissionData = {
  items: items.map((i) => ({
    percent: COMMISSION,
    originalRate: i.rate,
    newRate: Math.round(i.rate * (1 + COMMISSION / 100) * 100) / 100,
  })),
  extraItems: [],
  subtotal: baseSubtotal,
  newSubtotal: Math.round(baseSubtotal * (1 + COMMISSION / 100) * 100) / 100, // 121000
  newTotal: Math.round(baseTotal * (1 + COMMISSION / 100) * 100) / 100,       // 142780
  paymentTerms: '30 days',
  advancePercentage: 0,
  savedAt: now,
};

const quotation = {
  // Composite key
  vendorId,
  quotationId,

  customQuoteId,
  quoteNumber: customQuoteId,
  status: 'approved', // "finance added commission and sent back to PM"
  quotationDate: now.split('T')[0],

  // Parties
  vendorName: 'Mock Vendor Pvt Ltd',
  vendorEmail: 'mock.vendor@example.com',
  clientId,
  customerName: 'Mock Client Industries',
  customerDetails: {
    displayName: 'Mock Client Industries',
    email: 'mock.client@example.com',
    address: {
      billing: '12 MG Road, Bengaluru, Karnataka 560001',
      shipping: '12 MG Road, Bengaluru, Karnataka 560001',
    },
  },

  // Hierarchy (so it shows under a workspace/project/task in the UI)
  workspaceId,
  workspaceName: 'Mock Workspace',
  projectId: 'PROJ-MOCK-001',
  projectName: 'Mock Project',
  taskId: 'TASK-MOCK-001',
  taskName: 'Office Setup',
  subtaskId: 'SUB-MOCK-001',
  subtaskName: 'Furniture',

  // Money
  items,
  subtotal: baseSubtotal,
  total: baseTotal,
  currency: 'INR',

  // Finance commission — "saved as draft" then sent to PM (status 'approved')
  commissionData,
  commissionedQuotationUrl: 'https://example.com/mock-commissioned-quotation.pdf',
  pdfUrl: 'https://example.com/mock-vendor-quotation.pdf',
  sentToPM: true,

  createdAt: now,
  updatedAt: now,
};

// PM's "send to client" reads from vendor_quotes_to_pm (the copy the vendor
// created when it first sent the quote to PM). Seed it too, at the post-
// commission state ('approved' = finance sent it back to PM).
const PM_TABLE = process.env.DYNAMODB_VENDOR_QUOTES_TO_PM_TABLE || 'vendor_quotes_to_pm';

const quoteToPM = {
  vendorId,
  quotationId,
  customQuoteId,
  quotation_number: customQuoteId,
  customerName: quotation.customerName,
  customer_name: quotation.customerName,
  customer_email: quotation.customerDetails.email,
  customerDetails: quotation.customerDetails,
  quotationDate: quotation.quotationDate,
  expiryDate: null,
  billingAddress: { line1: quotation.customerDetails.address.billing },
  shippingAddress: { line1: quotation.customerDetails.address.shipping },
  billing_address: quotation.customerDetails.address.billing,
  gstin: '',
  items,
  subtotal: String(baseSubtotal),
  cgst: 9900,
  sgst: 9900,
  igst: 0,
  cgst_amount: '9900.00',
  sgst_amount: '9900.00',
  igst_amount: '0.00',
  totalCgst: 9900,
  totalSgst: 9900,
  totalIgst: 0,
  totalTax: baseGst,
  total: baseTotal,
  total_amount: String(baseTotal),
  customerNotes: '',
  termsAndConditions: 'Standard terms apply',
  // Finance added commission and sent it back — PM sees it as approved and
  // can send it to the client
  status: 'approved',
  pmReviewedAt: now,
  pmId: null,
  clientId,
  commissionedQuotationUrl: quotation.commissionedQuotationUrl,
  pdfUrl: quotation.pdfUrl,
  projectId: quotation.projectId,
  projectName: quotation.projectName,
  workspaceId,
  workspaceName: quotation.workspaceName,
  taskId: quotation.taskId,
  taskName: quotation.taskName,
  subtaskId: quotation.subtaskId,
  subtaskName: quotation.subtaskName,
  sentToPmAt: now,
  createdAt: now,
  updatedAt: now,
};

// ---- Optional stage advancement (for when you can't click the email link) ----
// MOCK_STAGE=sent_to_client    → PM already sent it to the client
// MOCK_STAGE=client_approved   → client already approved it (skips the email)
const STAGE = (process.env.MOCK_STAGE || 'finance_approved').toLowerCase();

if (STAGE === 'sent_to_client' || STAGE === 'client_approved') {
  // Matches updateQuoteStatus → 'sent_to_client_for_approval'
  quotation.status = 'sent to client for approval';
  quoteToPM.status = 'sent_to_client_for_approval';
}
if (STAGE === 'client_approved') {
  // Matches confirmCrmQuotationApproval
  quotation.status = 'Client approved';
  quotation.clientApprovalStatus = 'approved';
  quotation.clientApprovedAt = now;
}

const run = async () => {
  console.log(`Seeding mock quotation ${quotationId} (${customQuoteId}) into ${TABLE} ...`);

  await dbClient.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: marshall(quotation, { removeUndefinedValues: true }),
    })
  );

  console.log(`Seeding PM-side copy into ${PM_TABLE} ...`);

  await dbClient.send(
    new PutItemCommand({
      TableName: PM_TABLE,
      Item: marshall(quoteToPM, { removeUndefinedValues: true }),
    })
  );

  console.log('Done.\n');
  console.log('Seeded state:');
  console.log(`  vendorId:     ${vendorId}`);
  console.log(`  quotationId:  ${quotationId}`);
  console.log(`  clientId:     ${clientId}${clientId === 'MOCK-CLIENT-001' ? '  (fake — set MOCK_CLIENT_ID to a real client for the client portal)' : ''}`);
  console.log(`  status:       approved (finance commission done, back with PM)`);
  console.log(`  base total:   ₹${baseTotal}  |  client-facing total: ₹${commissionData.newTotal} (10% commission)`);
  console.log('\nManual flow from here:');
  console.log('  1. PM sends quotation to client  → status: sent to client for approval');
  console.log('  2. Client approves             → status: Client approved');
  console.log('  3. Client uploads their PO     → status: requested_po_from_pm + clientPOFile');
  console.log('  4. PM runs Auto check          → discrepancies? submit reason → finance approves');
  console.log('  5. PM generates + sends PO     → vendor accepts → vendor invoice → red-flag check');
};

run().catch((err) => {
  console.error('Failed to seed mock quotation:', err);
  process.exit(1);
});
