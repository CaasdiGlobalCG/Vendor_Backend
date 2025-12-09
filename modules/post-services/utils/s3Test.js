import { s3, WORKSPACE_UPLOADS_BUCKET } from '../../../config/aws.js';

export const testS3Connection = async () => {
  try {
    console.log('🧪 Testing S3 connection...');
    console.log('📋 Bucket name:', WORKSPACE_UPLOADS_BUCKET);
    
    // Test if bucket exists and is accessible
    const params = {
      Bucket: WORKSPACE_UPLOADS_BUCKET
    };
    
    const result = await s3.headBucket(params).promise();
    console.log('✅ S3 bucket is accessible:', WORKSPACE_UPLOADS_BUCKET);
    
    // List objects in bucket
    const listParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      MaxKeys: 5
    };
    
    const listResult = await s3.listObjectsV2(listParams).promise();
    console.log('📋 Objects in bucket:', listResult.Contents?.length || 0);
    if (listResult.Contents && listResult.Contents.length > 0) {
      console.log('📋 Sample objects:', listResult.Contents.map(obj => obj.Key));
    }
    
    return true;
  } catch (error) {
    console.error('❌ S3 connection test failed:', error);
    return false;
  }
};
