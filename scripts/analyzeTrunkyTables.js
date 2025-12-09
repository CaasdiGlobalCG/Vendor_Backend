import { dynamoDB, s3 } from '../config/aws.js';
import AWS from 'aws-sdk';

// Create regular DynamoDB client for admin operations
const dynamoDBClient = new AWS.DynamoDB();

/**
 * Script to analyze DynamoDB tables starting with "trunky" and their S3 relationships
 */

async function analyzeTrunkyTables() {
  try {
    console.log('🔍 Analyzing DynamoDB tables starting with "trunky"...\n');

    // List all DynamoDB tables
    const tablesResult = await dynamoDBClient.listTables().promise();
    const allTables = tablesResult.TableNames || [];
    
    // Filter tables starting with "trunky"
    const trunkyTables = allTables.filter(tableName => 
      tableName.toLowerCase().startsWith('trunky')
    );

    if (trunkyTables.length === 0) {
      console.log('❌ No tables found starting with "trunky"');
      return;
    }

    console.log(`📊 Found ${trunkyTables.length} tables starting with "trunky":`);
    trunkyTables.forEach(table => console.log(`  - ${table}`));
    console.log('\n');

    // Analyze each table
    for (const tableName of trunkyTables) {
      await analyzeTable(tableName);
    }

    // List S3 buckets that might be related
    console.log('\n🪣 Analyzing related S3 buckets...');
    await analyzeS3Buckets();

  } catch (error) {
    console.error('❌ Error analyzing tables:', error);
  }
}

async function analyzeTable(tableName) {
  try {
    console.log(`\n📋 Analyzing table: ${tableName}`);
    console.log('='.repeat(50));

    // Get table description
    const tableDesc = await dynamoDBClient.describeTable({ TableName: tableName }).promise();
    const table = tableDesc.Table;

    console.log(`📊 Table Status: ${table.TableStatus}`);
    console.log(`📈 Item Count: ${table.ItemCount}`);
    console.log(`💾 Table Size: ${(table.TableSizeBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`🔑 Billing Mode: ${table.BillingModeSummary?.BillingMode || 'PROVISIONED'}`);

    // Key Schema
    console.log('\n🔑 Key Schema:');
    table.KeySchema.forEach(key => {
      const attr = table.AttributeDefinitions.find(a => a.AttributeName === key.AttributeName);
      console.log(`  ${key.KeyType}: ${key.AttributeName} (${attr.AttributeType})`);
    });

    // Global Secondary Indexes
    if (table.GlobalSecondaryIndexes && table.GlobalSecondaryIndexes.length > 0) {
      console.log('\n🔍 Global Secondary Indexes:');
      table.GlobalSecondaryIndexes.forEach(gsi => {
        console.log(`  ${gsi.IndexName}:`);
        gsi.KeySchema.forEach(key => {
          console.log(`    ${key.KeyType}: ${key.AttributeName}`);
        });
      });
    }

    // Local Secondary Indexes
    if (table.LocalSecondaryIndexes && table.LocalSecondaryIndexes.length > 0) {
      console.log('\n🔍 Local Secondary Indexes:');
      table.LocalSecondaryIndexes.forEach(lsi => {
        console.log(`  ${lsi.IndexName}:`);
        lsi.KeySchema.forEach(key => {
          console.log(`    ${key.KeyType}: ${key.AttributeName}`);
        });
      });
    }

    // Sample data (first 5 items)
    console.log('\n📄 Sample Data (first 5 items):');
    const scanResult = await dynamoDB.scan({
      TableName: tableName,
      Limit: 5
    }).promise();

    if (scanResult.Items && scanResult.Items.length > 0) {
      scanResult.Items.forEach((item, index) => {
        console.log(`\n  Item ${index + 1}:`);
        console.log('  ' + JSON.stringify(item, null, 4).replace(/\n/g, '\n  '));
      });
    } else {
      console.log('  No items found in table');
    }

    // Look for S3 references in the data
    console.log('\n🔗 S3 References Found:');
    const s3References = findS3References(scanResult.Items || []);
    if (s3References.length > 0) {
      s3References.forEach(ref => {
        console.log(`  - ${ref.attribute}: ${ref.value}`);
      });
    } else {
      console.log('  No S3 references found in sample data');
    }

  } catch (error) {
    console.error(`❌ Error analyzing table ${tableName}:`, error.message);
  }
}

function findS3References(items) {
  const s3References = [];
  
  items.forEach((item, itemIndex) => {
    Object.keys(item).forEach(key => {
      const value = item[key];
      if (value && typeof value === 'object') {
        // Check if it's a DynamoDB string value
        if (value.S && typeof value.S === 'string') {
          if (value.S.includes('amazonaws.com') || value.S.includes('s3://')) {
            s3References.push({
              attribute: key,
              value: value.S,
              itemIndex
            });
          }
        }
        // Check if it's a regular string
        else if (typeof value === 'string') {
          if (value.includes('amazonaws.com') || value.includes('s3://')) {
            s3References.push({
              attribute: key,
              value: value,
              itemIndex
            });
          }
        }
      }
    });
  });
  
  return s3References;
}

async function analyzeS3Buckets() {
  try {
    const bucketsResult = await s3.listBuckets().promise();
    const allBuckets = bucketsResult.Buckets || [];
    
    // Look for buckets that might be related to trunky
    const relatedBuckets = allBuckets.filter(bucket => 
      bucket.Name.toLowerCase().includes('trunky') || 
      bucket.Name.toLowerCase().includes('trunk')
    );

    if (relatedBuckets.length > 0) {
      console.log('\n🪣 Related S3 Buckets:');
      for (const bucket of relatedBuckets) {
        console.log(`\n  📦 ${bucket.Name} (Created: ${bucket.CreationDate})`);
        
        try {
          // List some objects in the bucket
          const objectsResult = await s3.listObjectsV2({
            Bucket: bucket.Name,
            MaxKeys: 10
          }).promise();

          if (objectsResult.Contents && objectsResult.Contents.length > 0) {
            console.log('    Sample objects:');
            objectsResult.Contents.slice(0, 5).forEach(obj => {
              console.log(`      - ${obj.Key} (${(obj.Size / 1024).toFixed(2)} KB)`);
            });
            if (objectsResult.Contents.length > 5) {
              console.log(`      ... and ${objectsResult.Contents.length - 5} more objects`);
            }
          } else {
            console.log('    Bucket is empty');
          }
        } catch (bucketError) {
          console.log(`    ❌ Cannot access bucket contents: ${bucketError.message}`);
        }
      }
    } else {
      console.log('\n🪣 No S3 buckets found with "trunky" in the name');
      
      // Show all buckets for reference
      console.log('\n📋 All available S3 buckets:');
      allBuckets.forEach(bucket => {
        console.log(`  - ${bucket.Name}`);
      });
    }

  } catch (error) {
    console.error('❌ Error analyzing S3 buckets:', error.message);
  }
}

// Run the analysis
analyzeTrunkyTables().then(() => {
  console.log('\n✅ Analysis complete!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
