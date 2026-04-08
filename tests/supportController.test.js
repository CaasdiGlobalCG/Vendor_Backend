import test from 'node:test';
import assert from 'node:assert/strict';

import * as controller from '../modules/support/controllers/supportController.js';
import { dynamoDB, s3 } from '../config/aws.js';

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mockPromise(result) {
  return { promise: () => Promise.resolve(result) };
}

let originalPut;
let originalGet;
let originalScan;
let originalQuery;
let originalUpdate;
let originalS3PutObject;

test.before(() => {
  originalPut = dynamoDB.put;
  originalGet = dynamoDB.get;
  originalScan = dynamoDB.scan;
  originalQuery = dynamoDB.query;
  originalUpdate = dynamoDB.update;
  originalS3PutObject = s3.putObject;
});

test.afterEach(() => {
  dynamoDB.put = originalPut;
  dynamoDB.get = originalGet;
  dynamoDB.scan = originalScan;
  dynamoDB.query = originalQuery;
  dynamoDB.update = originalUpdate;
  s3.putObject = originalS3PutObject;
});

test('vendor createTicket stores vendor portal defaults', async () => {
  const putCalls = [];
  dynamoDB.get = (params) => {
    if (params.TableName === 'projects') {
      return mockPromise({ Item: { projectId: 'PROJ-9', name: 'Office Fit-Out', vendorId: 'VEN-7' } });
    }
    return mockPromise({});
  };
  dynamoDB.put = (params) => {
    putCalls.push(params);
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com', name: 'Vendor User' },
    body: {
      subject: 'Quotation issue',
      description: 'Need help with vendor quotation',
      sourceModule: 'vendor',
      referenceType: 'project',
      referenceId: 'PROJ-9',
    },
    files: [],
  };
  const res = createRes();

  await controller.createTicket(req, res);

  const ticketPut = putCalls.find((entry) => entry.TableName === 'cs_tickets');
  const messagePuts = putCalls.filter((entry) => entry.TableName === 'cs_ticket_messages');

  assert.equal(res.statusCode, 201);
  assert.equal(ticketPut.Item.portalType, 'vendor');
  assert.equal(ticketPut.Item.teamId, 'team-a');
  assert.equal(ticketPut.Item.raisedById, 'VEN-7');
  assert.equal(ticketPut.Item.referenceType, 'project');
  assert.equal(ticketPut.Item.referenceId, 'PROJ-9');
  assert.equal(ticketPut.Item.referenceLabel, 'Office Fit-Out');
  assert.equal(ticketPut.Item.waitingOn, 'support');
  assert.equal(ticketPut.Item.autoCloseAt, null);
  assert.equal(ticketPut.Item.lastUserActivityAt, ticketPut.Item.createdAt);
  assert.equal(messagePuts.length, 2);
  assert.equal(messagePuts[0].Item.senderType, 'system');
  assert.equal(messagePuts[1].Item.senderType, 'support_agent');
});

test('vendor createTicket resolves every supported linked reference type', async () => {
  const cases = [
    {
      name: 'vendor',
      body: { sourceModule: 'vendor', referenceType: 'vendor', referenceId: 'VEN-7' },
      expected: {
        teamId: 'team-a',
        referenceType: 'vendor',
        referenceId: 'VEN-7',
        referenceLabel: 'North Axis Interiors',
        contextKey: 'vendorId',
        contextValue: 'VEN-7',
      },
    },
    {
      name: 'project',
      body: { sourceModule: 'project', referenceType: 'project', referenceId: 'PROJ-9' },
      expected: {
        teamId: 'team-a',
        referenceType: 'project',
        referenceId: 'PROJ-9',
        referenceLabel: 'Office Fit-Out',
        contextKey: 'projectId',
        contextValue: 'PROJ-9',
      },
    },
    {
      name: 'workspace',
      body: { sourceModule: 'workspace', referenceType: 'workspace', referenceId: 'WS-44' },
      expected: {
        teamId: 'team-a',
        referenceType: 'workspace',
        referenceId: 'WS-44',
        referenceLabel: 'Airport Lighting Workspace',
        contextKey: 'workspaceId',
        contextValue: 'WS-44',
      },
    },
    {
      name: 'rfq',
      body: { sourceModule: 'quotation', referenceType: 'rfq', referenceId: 'LEAD-88' },
      expected: {
        teamId: 'team-a',
        referenceType: 'rfq',
        referenceId: 'LEAD-88',
        referenceLabel: 'Airport Signage Package',
        contextKey: 'leadId',
        contextValue: 'LEAD-88',
      },
    },
    {
      name: 'sales_enquiry',
      body: { sourceModule: 'sales_enquiry', referenceType: 'sales_enquiry', referenceId: 'RFQ-44' },
      expected: {
        teamId: 'team-a',
        referenceType: 'sales_enquiry',
        referenceId: 'RFQ-44',
        referenceLabel: 'Copper Cable',
        contextKey: 'sentRfqId',
        contextValue: 'RFQ-44',
      },
    },
    {
      name: 'sales_quotation',
      body: { sourceModule: 'sales_quotation', referenceType: 'sales_quotation', referenceId: 'Q-101' },
      expected: {
        teamId: 'team-a',
        referenceType: 'sales_quotation',
        referenceId: 'Q-101',
        referenceLabel: 'Airport Lighting Package',
        contextKey: 'quotationId',
        contextValue: 'Q-101',
      },
    },
    {
      name: 'sales_purchase_order',
      body: { sourceModule: 'sales_purchase_order', referenceType: 'sales_purchase_order', referenceId: 'PO-8' },
      expected: {
        teamId: 'team-a',
        referenceType: 'sales_purchase_order',
        referenceId: 'PO-8',
        referenceLabel: 'PO-8',
        contextKey: 'purchaseOrderId',
        contextValue: 'PO-8',
      },
    },
    {
      name: 'sales_shipment',
      body: { sourceModule: 'sales_shipment', referenceType: 'sales_shipment', referenceId: 'TRK-9' },
      expected: {
        teamId: 'team-a',
        referenceType: 'sales_shipment',
        referenceId: 'TRK-9',
        referenceLabel: 'Airport Lighting Package',
        contextKey: 'trackId',
        contextValue: 'TRK-9',
      },
    },
    {
      name: 'sales_warranty_claim',
      body: { sourceModule: 'sales_warranty_claim', referenceType: 'sales_warranty_claim', referenceId: 'CLM-9' },
      expected: {
        teamId: 'team-a',
        referenceType: 'sales_warranty_claim',
        referenceId: 'CLM-9',
        referenceLabel: 'Airport Lighting Package',
        contextKey: 'claimId',
        contextValue: 'CLM-9',
      },
    },
    {
      name: 'sales_inventory_item',
      body: { sourceModule: 'sales_inventory_item', referenceType: 'sales_inventory_item', referenceId: 'PROD-1' },
      expected: {
        teamId: 'team-a',
        referenceType: 'sales_inventory_item',
        referenceId: 'PROD-1',
        referenceLabel: 'Airport Lighting Package',
        contextKey: 'productId',
        contextValue: 'PROD-1',
      },
    },
    {
      name: 'workspace_credit_note',
      body: { sourceModule: 'workspace_credit_note', referenceType: 'workspace_credit_note', referenceId: 'CN-100' },
      expected: {
        teamId: 'team-e',
        referenceType: 'workspace_credit_note',
        referenceId: 'CN-100',
        referenceLabel: 'WCN-2026-001',
        contextKey: 'creditNoteId',
        contextValue: 'CN-100',
      },
    },
  ];

  for (const testCase of cases) {
    const putCalls = [];

    dynamoDB.get = (params) => {
      if (params.TableName === 'vendors' && params.Key?.vendorId === 'VEN-7') {
        return mockPromise({ Item: { vendorId: 'VEN-7', companyName: 'North Axis Interiors', status: 'approved' } });
      }
      if (params.TableName === 'projects' && params.Key?.projectId === 'PROJ-9') {
        return mockPromise({ Item: { projectId: 'PROJ-9', name: 'Office Fit-Out', vendorId: 'VEN-7', status: 'active' } });
      }
      if (params.TableName === 'workspaces_table' && params.Key?.workspaceId === 'WS-44') {
        return mockPromise({ Item: { workspaceId: 'WS-44', title: 'Airport Lighting Workspace', projectId: 'PROJ-9', vendorId: 'VEN-7', status: 'active' } });
      }
      if (params.TableName === 'leads' && params.Key?.leadId === 'LEAD-88') {
        return mockPromise({ Item: { leadId: 'LEAD-88', leadTitle: 'Airport Signage Package', projectId: 'PROJ-9', assignedVendorId: 'VEN-7', status: 'pm_approved' } });
      }
      if (params.TableName === 'sent_rfqs' && params.Key?.sentRfqId === 'RFQ-44') {
        return mockPromise({ Item: { sentRfqId: 'RFQ-44', material: 'Copper Cable', status: 'rfqsent', vendorIds: ['VEN-7'] } });
      }
      if (params.TableName === 'quotations_Of_Vendors' && params.Key?.quotationId === 'Q-101') {
        return mockPromise({ Item: { quotationId: 'Q-101', vendorId: 'VEN-7', sentRfqId: 'RFQ-44', material: 'Airport Lighting Package', status: 'po raised for order', purchaseOrderId: 'PO-8' } });
      }
      if (params.TableName === 'purchase_orders' && params.Key?.purchaseOrderId === 'PO-8') {
        return mockPromise({ Item: { purchaseOrderId: 'PO-8', vendorId: 'VEN-7', status: 'approved', clientApprovalStatus: 'approved', invoicePdfUrl: 'https://example.test/invoice.pdf' } });
      }
      if (params.TableName === 'Claims' && params.Key?.claimId === 'CLM-9') {
        return mockPromise({ Item: { claimId: 'CLM-9', warrantyId: 'WAR-1', orderId: 'ORD-9', eligibility: 'approved', vendorStatus: 'approved', resolutionType: 'onsite_replacement' } });
      }
      if (params.TableName === 'Warranties' && params.Key?.warrantyId === 'WAR-1') {
        return mockPromise({ Item: { warrantyId: 'WAR-1', vendorId: 'VEN-7', productName: 'Airport Lighting Package', status: 'active' } });
      }
      if (params.TableName === 'workspace_credit_notes' && params.Key?.creditNoteId === 'CN-100') {
        return mockPromise({ Item: { vendorId: 'VEN-7', creditNoteId: 'CN-100', customCreditNoteId: 'WCN-2026-001', invoiceId: 'INV-44', customerName: 'Airport Authority', projectName: 'Terminal Upgrade', status: 'vendor_issued', totalAmount: '12500' } });
      }
      return mockPromise({});
    };

    dynamoDB.scan = (params) => {
      if (params.TableName === 'Orders') {
        return mockPromise({
          Items: [{
            orderId: 'ORD-9',
            trackId: 'TRK-9',
            status: 'In Transit',
            deliveryFlow: 'direct',
            expectedDelivery: '2026-04-05',
            shipmentProducts: [{ productId: 'PROD-1', productName: 'Airport Lighting Package' }],
          }],
        });
      }
      if (params.TableName === 'Products') {
        return mockPromise({
          Items: [{
            productId: 'PROD-1',
            vendorId: 'VEN-7',
            productName: 'Airport Lighting Package',
            sku: 'ALP-001',
            productCategory: 'Electrical',
          }],
        });
      }
      if (params.TableName === 'Inventory') {
        return mockPromise({
          Items: [{
            vendorId: 'VEN-7',
            productId: 'PROD#PROD-1#WH#DEFAULT#SKU#ALP-001',
            baseProductId: 'PROD-1',
            warehouseId: 'DEFAULT',
            available: 4,
            onHand: 12,
            reorderPoint: 5,
          }],
        });
      }
      return mockPromise({ Items: [] });
    };

    dynamoDB.put = (params) => {
      putCalls.push(params);
      return mockPromise({});
    };

    const req = {
      vendorId: 'VEN-7',
      auth: { email: 'vendor@example.com', name: 'Vendor User' },
      body: {
        subject: `Need help with ${testCase.name}`,
        description: `Ticket for ${testCase.name}`,
        priority: 'medium',
        ...testCase.body,
      },
      files: [],
    };
    const res = createRes();

    await controller.createTicket(req, res);

    const ticketPut = putCalls.find((entry) => entry.TableName === 'cs_tickets');
    assert.equal(res.statusCode, 201, testCase.name);
    assert.equal(ticketPut.Item.teamId, testCase.expected.teamId, testCase.name);
    assert.equal(ticketPut.Item.referenceType, testCase.expected.referenceType, testCase.name);
    assert.equal(ticketPut.Item.referenceId, testCase.expected.referenceId, testCase.name);
    assert.equal(ticketPut.Item.referenceLabel, testCase.expected.referenceLabel, testCase.name);
    assert.equal(ticketPut.Item.referenceContext?.[testCase.expected.contextKey], testCase.expected.contextValue, testCase.name);
  }
});

test('vendor listReferenceOptions returns filtered project choices for the caller', async () => {
  dynamoDB.scan = (params) => {
    assert.equal(params.TableName, 'projects');
    assert.equal(params.ExpressionAttributeValues[':vendorId'], 'VEN-7');
    return mockPromise({
      Items: [
        { projectId: 'PROJ-1', name: 'Showroom Revamp', vendorId: 'VEN-7', status: 'active', updatedAt: '2026-03-02T00:00:00.000Z' },
        { projectId: 'PROJ-2', name: 'Airport Lighting', vendorId: 'VEN-7', status: 'hold', updatedAt: '2026-03-03T00:00:00.000Z' },
      ],
    });
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    query: { module: 'project', search: 'airport', limit: '1' },
  };
  const res = createRes();

  await controller.listReferenceOptions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.options.length, 1);
  assert.equal(res.body.items.length, 1);
  assert.deepEqual(res.body.options[0], {
    value: 'PROJ-2',
    label: 'Airport Lighting',
    description: 'hold',
    referenceType: 'project',
    context: {
      projectId: 'PROJ-2',
      name: 'Airport Lighting',
      status: 'hold',
      clientId: '',
      manager: '',
    },
  });
});

test('vendor listReferenceOptions returns filtered sales quotation choices for the caller', async () => {
  dynamoDB.scan = (params) => {
    assert.equal(params.TableName, 'quotations_Of_Vendors');
    assert.equal(params.ExpressionAttributeValues[':vendorId'], 'VEN-7');
    return mockPromise({
      Items: [
        {
          quotationId: 'Q-100',
          vendorId: 'VEN-7',
          sentRfqId: 'RFQ-9',
          status: 'pending review',
          material: 'Copper Cable',
          updatedAt: '2026-03-04T00:00:00.000Z',
        },
        {
          quotationId: 'Q-101',
          vendorId: 'VEN-7',
          sentRfqId: 'RFQ-10',
          status: 'po raised for order',
          material: 'Airport Lighting Package',
          purchaseOrderId: 'PO-8',
          updatedAt: '2026-03-05T00:00:00.000Z',
        },
      ],
    });
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    query: { module: 'sales_quotation', search: 'airport', limit: '1' },
  };
  const res = createRes();

  await controller.listReferenceOptions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.options.length, 1);
  assert.deepEqual(res.body.options[0], {
    value: 'Q-101',
    label: 'Airport Lighting Package',
    description: 'po raised for order',
    referenceType: 'sales_quotation',
    context: {
      quotationId: 'Q-101',
      sentRfqId: 'RFQ-10',
      status: 'po raised for order',
      purchaseOrderId: 'PO-8',
      enquiryId: '',
      title: 'Airport Lighting Package',
    },
  });
});

test('vendor listReferenceOptions returns sales shipment choices for the caller', async () => {
  let scanCount = 0;
  dynamoDB.scan = (params) => {
    scanCount += 1;
    if (params.TableName === 'Products') {
      assert.equal(params.ExpressionAttributeValues[':vendorId'], 'VEN-7');
      return mockPromise({
        Items: [
          { productId: 'PROD-1', vendorId: 'VEN-7' },
        ],
      });
    }

    if (params.TableName === 'Orders') {
      return mockPromise({
        Items: [
          {
            orderId: 'ORD-9',
            trackId: 'TRK-9',
            status: 'In Transit',
            deliveryFlow: 'direct',
            expectedDelivery: '2026-04-05',
            updatedAt: '2026-03-07T00:00:00.000Z',
            shipmentProducts: [{ productId: 'PROD-1', productName: 'Airport Lighting Package' }],
          },
        ],
      });
    }

    return mockPromise({ Items: [] });
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    query: { module: 'sales_shipment', search: 'airport', limit: '5' },
  };
  const res = createRes();

  await controller.listReferenceOptions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(scanCount >= 2, true);
  assert.equal(res.body.options.length, 1);
  assert.deepEqual(res.body.options[0], {
    value: 'TRK-9',
    label: 'Airport Lighting Package',
    description: 'In Transit',
    referenceType: 'sales_shipment',
    context: {
      trackId: 'TRK-9',
      orderId: 'ORD-9',
      status: 'In Transit',
      deliveryFlow: 'direct',
      expectedDelivery: '2026-04-05',
      productName: 'Airport Lighting Package',
    },
  });
});

test('vendor listReferenceOptions returns sales warranty claim choices for the caller', async () => {
  dynamoDB.scan = (params) => {
    if (params.TableName === 'Warranties') {
      assert.equal(params.ExpressionAttributeValues[':vendorId'], 'VEN-7');
      return mockPromise({
        Items: [
          {
            warrantyId: 'WAR-1',
            vendorId: 'VEN-7',
            productName: 'Airport Lighting Package',
          },
        ],
      });
    }

    if (params.TableName === 'Claims') {
      assert.equal(params.ExpressionAttributeValues[':eligibility'], 'approved');
      return mockPromise({
        Items: [
          {
            claimId: 'CLM-9',
            warrantyId: 'WAR-1',
            orderId: 'ORD-9',
            eligibility: 'approved',
            vendorStatus: 'approved',
            resolutionType: 'onsite_replacement',
            updatedAt: '2026-03-08T00:00:00.000Z',
          },
        ],
      });
    }

    return mockPromise({ Items: [] });
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    query: { module: 'sales_warranty_claim', search: 'airport', limit: '5' },
  };
  const res = createRes();

  await controller.listReferenceOptions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.options.length, 1);
  assert.deepEqual(res.body.options[0], {
    value: 'CLM-9',
    label: 'Airport Lighting Package',
    description: 'approved',
    referenceType: 'sales_warranty_claim',
    context: {
      claimId: 'CLM-9',
      warrantyId: 'WAR-1',
      orderId: 'ORD-9',
      productName: 'Airport Lighting Package',
      eligibility: 'approved',
      vendorStatus: 'approved',
      resolutionType: 'onsite_replacement',
    },
  });
});

test('vendor listReferenceOptions returns sales inventory item choices for the caller', async () => {
  let scanCount = 0;
  dynamoDB.scan = (params) => {
    scanCount += 1;
    if (params.TableName === 'Products') {
      assert.equal(params.ExpressionAttributeValues[':vendorId'], 'VEN-7');
      return mockPromise({
        Items: [
          {
            productId: 'PROD-1',
            vendorId: 'VEN-7',
            productName: 'Airport Lighting Package',
            sku: 'ALP-001',
            productCategory: 'Electrical',
            updatedAt: '2026-03-09T00:00:00.000Z',
          },
        ],
      });
    }

    if (params.TableName === 'Inventory') {
      return mockPromise({
        Items: [
          {
            vendorId: 'VEN-7',
            productId: 'PROD#PROD-1#WH#DEFAULT#SKU#ALP-001',
            baseProductId: 'PROD-1',
            warehouseId: 'DEFAULT',
            available: 4,
            onHand: 12,
            reorderPoint: 5,
          },
        ],
      });
    }

    return mockPromise({ Items: [] });
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    query: { module: 'sales_inventory_item', search: 'airport', limit: '5' },
  };
  const res = createRes();

  await controller.listReferenceOptions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(scanCount >= 2, true);
  assert.equal(res.body.options.length, 1);
  assert.deepEqual(res.body.options[0], {
    value: 'PROD-1',
    label: 'Airport Lighting Package',
    description: 'Low stock',
    referenceType: 'sales_inventory_item',
    context: {
      productId: 'PROD-1',
      sku: 'ALP-001',
      category: 'Electrical',
      available: 4,
      onHand: 12,
      warehouseCount: 1,
      stockStatus: 'Low stock',
      productName: 'Airport Lighting Package',
    },
  });
});

test('vendor listReferenceOptions returns workspace credit note choices for the caller', async () => {
  dynamoDB.scan = (params) => {
    assert.equal(params.TableName, 'workspace_credit_notes');
    assert.equal(params.ExpressionAttributeValues[':vendorId'], 'VEN-7');
    return mockPromise({
      Items: [
        {
          vendorId: 'VEN-7',
          creditNoteId: 'CN-100',
          customCreditNoteId: 'WCN-2026-001',
          invoiceId: 'INV-44',
          customerName: 'Airport Authority',
          projectName: 'Terminal Upgrade',
          status: 'vendor_issued',
          totalAmount: '12500',
          updatedAt: '2026-03-10T00:00:00.000Z',
        },
      ],
    });
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    query: { module: 'workspace_credit_note', search: 'wcn', limit: '5' },
  };
  const res = createRes();

  await controller.listReferenceOptions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.options.length, 1);
  assert.deepEqual(res.body.options[0], {
    value: 'CN-100',
    label: 'WCN-2026-001',
    description: 'vendor_issued',
    referenceType: 'workspace_credit_note',
    context: {
      creditNoteId: 'CN-100',
      displayCreditNoteId: 'WCN-2026-001',
      invoiceId: 'INV-44',
      customerName: 'Airport Authority',
      projectName: 'Terminal Upgrade',
      status: 'vendor_issued',
      totalAmount: '12500',
    },
  });
});

test('vendor addMessage resets lifecycle back to support', async () => {
  let updateParams;
  const putCalls = [];
  dynamoDB.get = () => mockPromise({
    Item: {
      ticketId: 'CS-2026-20004',
      portalType: 'vendor',
      status: 'open',
      raisedById: 'VEN-7',
      raisedByEmail: 'vendor@example.com',
      waitingOn: 'user',
      autoCloseAt: '2026-03-10T00:00:00.000Z',
    },
  });
  dynamoDB.put = (params) => {
    putCalls.push(params);
    return mockPromise({});
  };
  dynamoDB.update = (params) => {
    updateParams = params;
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com', name: 'Vendor User' },
    params: { ticketId: 'CS-2026-20004' },
    body: { content: 'Here is the information you asked for.' },
    files: [],
  };
  const res = createRes();

  await controller.addMessage(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(putCalls[0].TableName, 'cs_ticket_messages');
  assert.match(updateParams.UpdateExpression, /lastUserActivityAt/);
  assert.equal(updateParams.ExpressionAttributeValues[':waitingOn'], 'support');
  assert.equal(updateParams.ExpressionAttributeValues[':clearAutoClose'], null);
});

test('vendor reopenTicket resets lifecycle back to support', async () => {
  let updateParams;
  dynamoDB.get = () => mockPromise({
    Item: {
      ticketId: 'CS-2026-20005',
      portalType: 'vendor',
      status: 'closed',
      raisedById: 'VEN-7',
      raisedByEmail: 'vendor@example.com',
    },
  });
  dynamoDB.update = (params) => {
    updateParams = params;
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20005' },
  };
  const res = createRes();

  await controller.reopenTicket(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(updateParams.UpdateExpression, /lastUserActivityAt/);
  assert.equal(updateParams.ExpressionAttributeValues[':waitingOn'], 'support');
  assert.equal(updateParams.ExpressionAttributeValues[':clearAutoClose'], null);
});

test('vendor getTicketReference resolves workspace links for vendor tickets', async () => {
  dynamoDB.get = (params) => {
    if (params.TableName === 'cs_tickets') {
      return mockPromise({
        Item: {
          ticketId: 'CS-2026-20003',
          portalType: 'vendor',
          raisedById: 'VEN-7',
          raisedByEmail: 'vendor@example.com',
          sourceModule: 'workspace',
          referenceType: 'workspace',
          referenceId: 'WS-44',
        },
      });
    }
    if (params.TableName === 'workspaces_table') {
      return mockPromise({
        Item: {
          workspaceId: 'WS-44',
          title: 'Airport Lighting Workspace',
          projectId: 'PROJ-8',
          leadId: 'LEAD-10',
          status: 'active',
        },
      });
    }
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20003' },
  };
  const res = createRes();

  await controller.getTicketReference(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference.referenceType, 'workspace');
  assert.equal(res.body.reference.referenceId, 'WS-44');
  assert.equal(res.body.reference.title, 'Airport Lighting Workspace');
  assert.equal(res.body.reference.fields[1].value, 'PROJ-8');
});

test('vendor getTicketReference resolves sales purchase-order links for vendor tickets', async () => {
  dynamoDB.get = (params) => {
    if (params.TableName === 'cs_tickets') {
      return mockPromise({
        Item: {
          ticketId: 'CS-2026-20006',
          portalType: 'vendor',
          raisedById: 'VEN-7',
          raisedByEmail: 'vendor@example.com',
          sourceModule: 'sales_purchase_order',
          referenceType: 'sales_purchase_order',
          referenceId: 'PO-8',
        },
      });
    }
    if (params.TableName === 'purchase_orders') {
      return mockPromise({
        Item: {
          purchaseOrderId: 'PO-8',
          vendorId: 'VEN-7',
          status: 'approved',
          clientApprovalStatus: 'approved',
          invoicePdfUrl: 'https://example.test/invoice.pdf',
          products: [{ sourceVendorQuotationId: 'Q-101' }],
        },
      });
    }
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20006' },
  };
  const res = createRes();

  await controller.getTicketReference(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference.referenceType, 'sales_purchase_order');
  assert.equal(res.body.reference.referenceId, 'PO-8');
  assert.equal(res.body.reference.fields[1].value, 'approved');
  assert.equal(res.body.reference.fields[3].value, 'Uploaded');
});

test('vendor getTicketReference resolves sales shipment links for vendor tickets', async () => {
  dynamoDB.get = (params) => {
    if (params.TableName === 'cs_tickets') {
      return mockPromise({
        Item: {
          ticketId: 'CS-2026-20007',
          portalType: 'vendor',
          raisedById: 'VEN-7',
          raisedByEmail: 'vendor@example.com',
          sourceModule: 'sales_shipment',
          referenceType: 'sales_shipment',
          referenceId: 'TRK-9',
        },
      });
    }
    return mockPromise({});
  };
  dynamoDB.scan = (params) => {
    if (params.TableName === 'Orders') {
      return mockPromise({
        Items: [{
          orderId: 'ORD-9',
          trackId: 'TRK-9',
          status: 'In Transit',
          deliveryFlow: 'direct',
          expectedDelivery: '2026-04-05',
          shipmentProducts: [{ productId: 'PROD-1', productName: 'Airport Lighting Package' }],
        }],
      });
    }
    return mockPromise({ Items: [] });
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20007' },
  };
  const res = createRes();

  await controller.getTicketReference(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference.referenceType, 'sales_shipment');
  assert.equal(res.body.reference.referenceId, 'TRK-9');
  assert.equal(res.body.reference.title, 'Airport Lighting Package');
  assert.equal(res.body.reference.fields[1].value, 'ORD-9');
});

test('vendor getTicketReference resolves sales warranty claim links for vendor tickets', async () => {
  dynamoDB.get = (params) => {
    if (params.TableName === 'cs_tickets') {
      return mockPromise({
        Item: {
          ticketId: 'CS-2026-20008',
          portalType: 'vendor',
          raisedById: 'VEN-7',
          raisedByEmail: 'vendor@example.com',
          sourceModule: 'sales_warranty_claim',
          referenceType: 'sales_warranty_claim',
          referenceId: 'CLM-9',
        },
      });
    }
    if (params.TableName === 'Claims') {
      return mockPromise({
        Item: {
          claimId: 'CLM-9',
          warrantyId: 'WAR-1',
          orderId: 'ORD-9',
          eligibility: 'approved',
          vendorStatus: 'approved',
          resolutionType: 'onsite_replacement',
        },
      });
    }
    if (params.TableName === 'Warranties') {
      return mockPromise({
        Item: {
          warrantyId: 'WAR-1',
          vendorId: 'VEN-7',
          productName: 'Airport Lighting Package',
        },
      });
    }
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20008' },
  };
  const res = createRes();

  await controller.getTicketReference(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference.referenceType, 'sales_warranty_claim');
  assert.equal(res.body.reference.referenceId, 'CLM-9');
  assert.equal(res.body.reference.title, 'Airport Lighting Package');
  assert.equal(res.body.reference.fields[1].value, 'WAR-1');
  assert.equal(res.body.reference.fields[4].value, 'approved');
});

test('vendor getTicketReference resolves sales inventory item links for vendor tickets', async () => {
  dynamoDB.get = (params) => {
    if (params.TableName === 'cs_tickets') {
      return mockPromise({
        Item: {
          ticketId: 'CS-2026-20009',
          portalType: 'vendor',
          raisedById: 'VEN-7',
          raisedByEmail: 'vendor@example.com',
          sourceModule: 'sales_inventory_item',
          referenceType: 'sales_inventory_item',
          referenceId: 'PROD-1',
        },
      });
    }
    return mockPromise({});
  };
  dynamoDB.scan = (params) => {
    if (params.TableName === 'Products') {
      return mockPromise({
        Items: [{
          productId: 'PROD-1',
          vendorId: 'VEN-7',
          productName: 'Airport Lighting Package',
          sku: 'ALP-001',
          productCategory: 'Electrical',
        }],
      });
    }
    if (params.TableName === 'Inventory') {
      return mockPromise({
        Items: [{
          vendorId: 'VEN-7',
          productId: 'PROD#PROD-1#WH#DEFAULT#SKU#ALP-001',
          baseProductId: 'PROD-1',
          warehouseId: 'DEFAULT',
          available: 9,
          onHand: 18,
          reorderPoint: 5,
        }],
      });
    }
    return mockPromise({ Items: [] });
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20009' },
  };
  const res = createRes();

  await controller.getTicketReference(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference.referenceType, 'sales_inventory_item');
  assert.equal(res.body.reference.referenceId, 'PROD-1');
  assert.equal(res.body.reference.title, 'Airport Lighting Package');
  assert.equal(res.body.reference.fields[1].value, 'ALP-001');
  assert.equal(res.body.reference.fields[5].value, '1');
});

test('vendor getTicketReference resolves workspace credit note links for vendor tickets', async () => {
  dynamoDB.get = (params) => {
    if (params.TableName === 'cs_tickets') {
      return mockPromise({
        Item: {
          ticketId: 'CS-2026-20010',
          portalType: 'vendor',
          raisedById: 'VEN-7',
          raisedByEmail: 'vendor@example.com',
          sourceModule: 'workspace_credit_note',
          referenceType: 'workspace_credit_note',
          referenceId: 'CN-100',
        },
      });
    }
    if (params.TableName === 'workspace_credit_notes') {
      return mockPromise({
        Item: {
          vendorId: 'VEN-7',
          creditNoteId: 'CN-100',
          customCreditNoteId: 'WCN-2026-001',
          invoiceId: 'INV-44',
          customerName: 'Airport Authority',
          projectName: 'Terminal Upgrade',
          status: 'vendor_issued',
          totalAmount: '12500',
        },
      });
    }
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20010' },
  };
  const res = createRes();

  await controller.getTicketReference(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference.referenceType, 'workspace_credit_note');
  assert.equal(res.body.reference.referenceId, 'CN-100');
  assert.equal(res.body.reference.title, 'WCN-2026-001');
  assert.equal(res.body.reference.fields[2].value, 'INV-44');
  assert.equal(res.body.reference.fields[5].value, 'vendor_issued');
});

test('vendor getTicket denies access to a different caller', async () => {
  dynamoDB.get = () => mockPromise({
    Item: {
      ticketId: 'CS-2026-20001',
      portalType: 'vendor',
      raisedById: 'VEN-OTHER',
      raisedByEmail: 'other@example.com',
    },
  });

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20001' },
  };
  const res = createRes();

  await controller.getTicket(req, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /access denied/i);
});

test('vendor rateTicket saves rating for resolved tickets', async () => {
  let updateParams;
  dynamoDB.get = () => mockPromise({
    Item: {
      ticketId: 'CS-2026-20002',
      portalType: 'vendor',
      status: 'resolved',
      raisedById: 'VEN-7',
      raisedByEmail: 'vendor@example.com',
    },
  });
  dynamoDB.update = (params) => {
    updateParams = params;
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20002' },
    body: { rating: 5 },
  };
  const res = createRes();

  await controller.rateTicket(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updateParams.TableName, 'cs_tickets');
  assert.equal(updateParams.ExpressionAttributeValues[':r'], 5);
});

test.todo('vendor listMyTickets should filter portalType to vendor to prevent cross-portal leakage');
test.todo('vendor ticket access checks should reject non-vendor portal tickets even when email overlaps');
test.todo('vendor support should move ticket listing off DynamoDB Scan onto a scoped index');