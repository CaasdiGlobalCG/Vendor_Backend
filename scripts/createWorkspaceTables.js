import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Configure AWS
AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',

  httpOptions: {
    timeout: 5000,
    connectTimeout: 5000
  }
});

// Create DynamoDB service object
const dynamodb = new AWS.DynamoDB();

// Table names
const WORKSPACE_QUOTATIONS_TABLE = 'workspace_quotations';
const WORKSPACE_INVOICES_TABLE = 'workspace_invoices';
const WORKSPACE_CREDIT_NOTES_TABLE = 'workspace_credit_notes';
const WORKSPACE_PURCHASE_ORDERS_TABLE = 'workspace_purchase_orders';
const WORKSPACE_ITEMS_TABLE = 'workspace_items';
const WORKSPACE_CUSTOMERS_TABLE = 'workspace_customers';
const WORKSPACE_DELIVERY_CHALLANS_TABLE = 'workspace_delivery_challans';
const PROCUREMENT_REQUESTS_TABLE = 'procurement_requests';

/**
 * Create workspace_quotations table
 * Primary Key: vendorId (Partition Key) + quotationId (Sort Key)
 * This ensures vendor isolation - each vendor can only access their own quotations
 */
const createWorkspaceQuotationsTable = async () => {
  const params = {
    TableName: WORKSPACE_QUOTATIONS_TABLE,
    KeySchema: [
      { AttributeName: 'vendorId', KeyType: 'HASH' },      // Partition key
      { AttributeName: 'quotationId', KeyType: 'RANGE' }   // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'quotationId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.describeTable({ TableName: WORKSPACE_QUOTATIONS_TABLE }).promise();
    console.log(`✅ Table ${WORKSPACE_QUOTATIONS_TABLE} already exists`);
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      await dynamodb.createTable(params).promise();
      console.log(`✅ Created table ${WORKSPACE_QUOTATIONS_TABLE}`);
      await dynamodb.waitFor('tableExists', { TableName: WORKSPACE_QUOTATIONS_TABLE }).promise();
      console.log(`✅ Table ${WORKSPACE_QUOTATIONS_TABLE} is now active`);
    } else {
      throw error;
    }
  }
};

/**
 * Create workspace_invoices table
 * Primary Key: vendorId (Partition Key) + invoiceId (Sort Key)
 */
const createWorkspaceInvoicesTable = async () => {
  const params = {
    TableName: WORKSPACE_INVOICES_TABLE,
    KeySchema: [
      { AttributeName: 'vendorId', KeyType: 'HASH' },    // Partition key
      { AttributeName: 'invoiceId', KeyType: 'RANGE' }   // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'invoiceId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.describeTable({ TableName: WORKSPACE_INVOICES_TABLE }).promise();
    console.log(`✅ Table ${WORKSPACE_INVOICES_TABLE} already exists`);
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      await dynamodb.createTable(params).promise();
      console.log(`✅ Created table ${WORKSPACE_INVOICES_TABLE}`);
      await dynamodb.waitFor('tableExists', { TableName: WORKSPACE_INVOICES_TABLE }).promise();
      console.log(`✅ Table ${WORKSPACE_INVOICES_TABLE} is now active`);
    } else {
      throw error;
    }
  }
};

/**
 * Create workspace_credit_notes table
 * Primary Key: vendorId (Partition Key) + creditNoteId (Sort Key)
 */
const createWorkspaceCreditNotesTable = async () => {
  const params = {
    TableName: WORKSPACE_CREDIT_NOTES_TABLE,
    KeySchema: [
      { AttributeName: 'vendorId', KeyType: 'HASH' },      // Partition key
      { AttributeName: 'creditNoteId', KeyType: 'RANGE' }  // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'creditNoteId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.describeTable({ TableName: WORKSPACE_CREDIT_NOTES_TABLE }).promise();
    console.log(`✅ Table ${WORKSPACE_CREDIT_NOTES_TABLE} already exists`);
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      await dynamodb.createTable(params).promise();
      console.log(`✅ Created table ${WORKSPACE_CREDIT_NOTES_TABLE}`);
      await dynamodb.waitFor('tableExists', { TableName: WORKSPACE_CREDIT_NOTES_TABLE }).promise();
      console.log(`✅ Table ${WORKSPACE_CREDIT_NOTES_TABLE} is now active`);
    } else {
      throw error;
    }
  }
};

/**
 * Create workspace_purchase_orders table
 * Primary Key: vendorId (Partition Key) + purchaseOrderId (Sort Key)
 */
const createWorkspacePurchaseOrdersTable = async () => {
  const params = {
    TableName: WORKSPACE_PURCHASE_ORDERS_TABLE,
    KeySchema: [
      { AttributeName: 'vendorId', KeyType: 'HASH' }, // Partition key
      { AttributeName: 'purchaseOrderId', KeyType: 'RANGE' } // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'purchaseOrderId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.describeTable({ TableName: WORKSPACE_PURCHASE_ORDERS_TABLE }).promise();
    console.log(`✅ Table ${WORKSPACE_PURCHASE_ORDERS_TABLE} already exists`);
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      await dynamodb.createTable(params).promise();
      console.log(`✅ Created table ${WORKSPACE_PURCHASE_ORDERS_TABLE}`);
      await dynamodb
        .waitFor('tableExists', { TableName: WORKSPACE_PURCHASE_ORDERS_TABLE })
        .promise();
      console.log(`✅ Table ${WORKSPACE_PURCHASE_ORDERS_TABLE} is now active`);
    } else {
      throw error;
    }
  }
};

/**
 * Create workspace_items table
 * Primary Key: vendorId (Partition Key) + itemId (Sort Key)
 */
const createWorkspaceItemsTable = async () => {
  const params = {
    TableName: WORKSPACE_ITEMS_TABLE,
    KeySchema: [
      { AttributeName: 'vendorId', KeyType: 'HASH' },  // Partition key
      { AttributeName: 'itemId', KeyType: 'RANGE' }    // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'itemId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.describeTable({ TableName: WORKSPACE_ITEMS_TABLE }).promise();
    console.log(`✅ Table ${WORKSPACE_ITEMS_TABLE} already exists`);
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      await dynamodb.createTable(params).promise();
      console.log(`✅ Created table ${WORKSPACE_ITEMS_TABLE}`);
      await dynamodb.waitFor('tableExists', { TableName: WORKSPACE_ITEMS_TABLE }).promise();
      console.log(`✅ Table ${WORKSPACE_ITEMS_TABLE} is now active`);
    } else {
      throw error;
    }
  }
};

/**
 * Create workspace_customers table
 * Primary Key: vendorId (Partition Key) + customerId (Sort Key)
 */
const createWorkspaceCustomersTable = async () => {
  const params = {
    TableName: WORKSPACE_CUSTOMERS_TABLE,
    KeySchema: [
      { AttributeName: 'vendorId', KeyType: 'HASH' },     // Partition key
      { AttributeName: 'customerId', KeyType: 'RANGE' }   // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'customerId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.describeTable({ TableName: WORKSPACE_CUSTOMERS_TABLE }).promise();
    console.log(`✅ Table ${WORKSPACE_CUSTOMERS_TABLE} already exists`);
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      await dynamodb.createTable(params).promise();
      console.log(`✅ Created table ${WORKSPACE_CUSTOMERS_TABLE}`);
      await dynamodb.waitFor('tableExists', { TableName: WORKSPACE_CUSTOMERS_TABLE }).promise();
      console.log(`✅ Table ${WORKSPACE_CUSTOMERS_TABLE} is now active`);
    } else {
      throw error;
    }
  }
};

/**
 * Create workspace_delivery_challans table
 * Primary Key: vendorId (Partition Key) + challanId (Sort Key)
 */
const createWorkspaceDeliveryChallansTable = async () => {
  const params = {
    TableName: WORKSPACE_DELIVERY_CHALLANS_TABLE,
    KeySchema: [
      { AttributeName: 'vendorId', KeyType: 'HASH' },      // Partition key
      { AttributeName: 'challanId', KeyType: 'RANGE' }     // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'challanId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.describeTable({ TableName: WORKSPACE_DELIVERY_CHALLANS_TABLE }).promise();
    console.log(`✅ Table ${WORKSPACE_DELIVERY_CHALLANS_TABLE} already exists`);
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      await dynamodb.createTable(params).promise();
      console.log(`✅ Created table ${WORKSPACE_DELIVERY_CHALLANS_TABLE}`);
      await dynamodb.waitFor('tableExists', { TableName: WORKSPACE_DELIVERY_CHALLANS_TABLE }).promise();
      console.log(`✅ Table ${WORKSPACE_DELIVERY_CHALLANS_TABLE} is now active`);
    } else {
      throw error;
    }
  }
};

/**
 * Create procurement_requests table
 * Primary Key: requestId (Partition Key)
 * This table stores procurement requests from workspace
 */
const createProcurementRequestsTable = async () => {
  const params = {
    TableName: PROCUREMENT_REQUESTS_TABLE,
    KeySchema: [
      { AttributeName: 'requestId', KeyType: 'HASH' }  // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'requestId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.describeTable({ TableName: PROCUREMENT_REQUESTS_TABLE }).promise();
    console.log(`✅ Table ${PROCUREMENT_REQUESTS_TABLE} already exists`);
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      await dynamodb.createTable(params).promise();
      console.log(`✅ Created table ${PROCUREMENT_REQUESTS_TABLE}`);
      await dynamodb.waitFor('tableExists', { TableName: PROCUREMENT_REQUESTS_TABLE }).promise();
      console.log(`✅ Table ${PROCUREMENT_REQUESTS_TABLE} is now active`);
    } else {
      throw error;
    }
  }
};

/**
 * Main function to create all workspace tables
 */
const createAllWorkspaceTables = async () => {
  console.log('🚀 Creating workspace tables with vendor isolation...');
  
  try {
    await createWorkspaceQuotationsTable();
    await createWorkspaceInvoicesTable();
    await createWorkspaceCreditNotesTable();
    await createWorkspacePurchaseOrdersTable();
    await createWorkspaceItemsTable();
    await createWorkspaceCustomersTable();
    await createWorkspaceDeliveryChallansTable();
    await createProcurementRequestsTable();
    
    console.log('✅ All workspace tables created successfully!');
    console.log('\n📊 Table Structure Summary:');
    console.log('┌─────────────────────────────────────┬─────────────────────────────┐');
    console.log('│ Table Name                          │ Primary Key Structure       │');
    console.log('├─────────────────────────────────────┼─────────────────────────────┤');
    console.log('│ workspace_quotations                │ vendorId + quotationId      │');
    console.log('│ workspace_invoices                  │ vendorId + invoiceId        │');
    console.log('│ workspace_credit_notes              │ vendorId + creditNoteId     │');
    console.log('│ workspace_purchase_orders           │ vendorId + purchaseOrderId  │');
    console.log('│ workspace_items                     │ vendorId + itemId           │');
    console.log('│ workspace_customers                 │ vendorId + customerId       │');
    console.log('│ workspace_delivery_challans         │ vendorId + challanId        │');
    console.log('│ procurement_requests                │ requestId                   │');
    console.log('└─────────────────────────────────────┴─────────────────────────────┘');
    console.log('\n🔒 Security Features:');
    console.log('• Vendor isolation: Each vendor can only access their own data');
    console.log('• PM access: PMs can access all vendor data for collaboration');
    console.log('• Role-based permissions: Vendors create, PMs approve');
    console.log('• Composite keys: Ensures data separation and efficient queries');
    
  } catch (error) {
    console.error('❌ Error creating workspace tables:', error);
    process.exit(1);
  }
};

// Run the script
createAllWorkspaceTables();
