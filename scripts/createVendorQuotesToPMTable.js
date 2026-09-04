import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    httpOptions: {
        timeout: 5000,
        connectTimeout: 5000
    }
});

// Create DynamoDB service object
const dynamodb = new AWS.DynamoDB();

// Table name
const VENDOR_QUOTES_TO_PM_TABLE = 'vendor_quotes_to_pm';

/**
 * Create vendor_quotes_to_pm table
 * This table stores complete quotation details when vendors send quotes to PM for review
 * 
 * Primary Key: vendorId (Partition Key) + quotationId (Sort Key)
 * 
 * GSI (Global Secondary Index): 
 * - pmReviewIndex: status (Partition Key) + sentToPmAt (Sort Key)
 *   This allows PMs to query quotes by status and sort by submission time
 * 
 * Table Structure:
 * - vendorId: The vendor who created the quote
 * - quotationId: Unique identifier for the quotation
 * - customQuoteId: Custom quote number (e.g., "Quote #123")
 * - customerName: Name of the customer
 * - customerDetails: Complete customer information
 * - quotationDate: Date the quote was created
 * - expiryDate: Quote expiration date
 * - items: Array of line items in the quote
 * - subtotal: Subtotal amount
 * - cgst, sgst, igst: Tax amounts
 * - total: Total amount
 * - status: Current status (e.g., "sent to pm for review", "approved by pm", "rejected")
 * - sentToPmAt: Timestamp when sent to PM
 * - pmReviewedAt: Timestamp when PM reviewed
 * - pmFeedback: PM's feedback/comments
 * - pmId: ID of the PM who reviewed
 * - pdfUrl: URL to the quote PDF
 * - createdAt: Original creation timestamp
 * - updatedAt: Last update timestamp
 */
const createVendorQuotesToPMTable = async () => {
    const params = {
        TableName: VENDOR_QUOTES_TO_PM_TABLE,
        KeySchema: [
            { AttributeName: 'vendorId', KeyType: 'HASH' },      // Partition key
            { AttributeName: 'quotationId', KeyType: 'RANGE' }   // Sort key
        ],
        AttributeDefinitions: [
            { AttributeName: 'vendorId', AttributeType: 'S' },
            { AttributeName: 'quotationId', AttributeType: 'S' },
            { AttributeName: 'status', AttributeType: 'S' },
            { AttributeName: 'sentToPmAt', AttributeType: 'S' }
        ],
        GlobalSecondaryIndexes: [
            {
                IndexName: 'pmReviewIndex',
                KeySchema: [
                    { AttributeName: 'status', KeyType: 'HASH' },
                    { AttributeName: 'sentToPmAt', KeyType: 'RANGE' }
                ],
                Projection: {
                    ProjectionType: 'ALL'
                },
                ProvisionedThroughput: {
                    ReadCapacityUnits: 5,
                    WriteCapacityUnits: 5
                }
            }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
        }
    };

    try {
        await dynamodb.describeTable({ TableName: VENDOR_QUOTES_TO_PM_TABLE }).promise();
        console.log(`✅ Table ${VENDOR_QUOTES_TO_PM_TABLE} already exists`);
    } catch (error) {
        if (error.code === 'ResourceNotFoundException') {
            console.log(`📋 Creating table ${VENDOR_QUOTES_TO_PM_TABLE}...`);
            await dynamodb.createTable(params).promise();
            console.log(`✅ Created table ${VENDOR_QUOTES_TO_PM_TABLE}`);

            console.log('⏳ Waiting for table to become active...');
            await dynamodb.waitFor('tableExists', { TableName: VENDOR_QUOTES_TO_PM_TABLE }).promise();
            console.log(`✅ Table ${VENDOR_QUOTES_TO_PM_TABLE} is now active`);
        } else {
            throw error;
        }
    }
};

/**
 * Main function to create the vendor_quotes_to_pm table
 */
const createTable = async () => {
    console.log('🚀 Creating vendor_quotes_to_pm table...\n');

    try {
        await createVendorQuotesToPMTable();

        console.log('\n✅ Table created successfully!\n');
        console.log('📊 Table Structure Summary:');
        console.log('┌─────────────────────────────────────────────────────────────────┐');
        console.log('│ Table Name: vendor_quotes_to_pm                                 │');
        console.log('├─────────────────────────────────────────────────────────────────┤');
        console.log('│ Primary Key:                                                    │');
        console.log('│   • Partition Key: vendorId (String)                            │');
        console.log('│   • Sort Key: quotationId (String)                              │');
        console.log('├─────────────────────────────────────────────────────────────────┤');
        console.log('│ Global Secondary Index (pmReviewIndex):                         │');
        console.log('│   • Partition Key: status (String)                              │');
        console.log('│   • Sort Key: sentToPmAt (String)                               │');
        console.log('│   • Projection: ALL                                             │');
        console.log('├─────────────────────────────────────────────────────────────────┤');
        console.log('│ Purpose:                                                        │');
        console.log('│   Stores complete quotation details when vendors send quotes    │');
        console.log('│   to PM for review. Includes all quote data, customer info,     │');
        console.log('│   line items, and review status.                                │');
        console.log('├─────────────────────────────────────────────────────────────────┤');
        console.log('│ Key Features:                                                   │');
        console.log('│   • Vendor isolation (partition by vendorId)                    │');
        console.log('│   • PM can query by status using GSI                            │');
        console.log('│   • Complete audit trail with timestamps                        │');
        console.log('│   • Stores full quotation snapshot at submission time           │');
        console.log('└─────────────────────────────────────────────────────────────────┘');

        console.log('\n🔍 Usage Examples:');
        console.log('  • Get all quotes from a vendor: Query by vendorId');
        console.log('  • Get pending PM reviews: Query pmReviewIndex with status="sent to pm for review"');
        console.log('  • Get approved quotes: Query pmReviewIndex with status="approved by pm"');
        console.log('  • Get quotes by submission time: Sort by sentToPmAt in pmReviewIndex');

    } catch (error) {
        console.error('\n❌ Error creating table:', error);
        process.exit(1);
    }
};

// Run the script
createTable();
