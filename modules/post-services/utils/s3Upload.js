import { s3, WORKSPACE_UPLOADS_BUCKET } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Upload a file to S3 in the post_services folder
 * @param {Object} file - The file object (from multer)
 * @param {string} workspaceId - The workspace ID
 * @param {string} postId - The post ID (optional, for replies)
 * @returns {Promise<Object>} - Upload result with file details
 */
export const uploadFileToS3 = async (file, workspaceId, postId = null) => {
  try {
    console.log('🚀 Starting S3 upload process...');
    console.log('📋 File details:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      bufferLength: file.buffer ? file.buffer.length : 'NO BUFFER'
    });
    console.log('📋 Upload context:', {
      workspaceId,
      postId,
      bucket: WORKSPACE_UPLOADS_BUCKET
    });

    // Generate unique filename
    const fileExtension = file.originalname.split('.').pop();
    const uniqueFileName = `${uuidv4()}.${fileExtension}`;
    
    // Create folder structure: post_services/workspaceId/postId/filename
    let s3Key;
    if (postId) {
      s3Key = `post_services/${workspaceId}/${postId}/${uniqueFileName}`;
    } else {
      s3Key = `post_services/${workspaceId}/${uniqueFileName}`;
    }

    const uploadParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'private' // Make files private for security
    };

    console.log('📤 Uploading file to S3 with params:', {
      bucket: WORKSPACE_UPLOADS_BUCKET,
      key: s3Key,
      originalName: file.originalname,
      size: file.size,
      type: file.mimetype,
      hasBuffer: !!file.buffer
    });

    const result = await s3.upload(uploadParams).promise();
    
    console.log('✅ File uploaded successfully:', result.Location);

    return {
      success: true,
      fileUrl: result.Location,
      s3Key: s3Key,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      uniqueFileName: uniqueFileName
    };

  } catch (error) {
    console.error('❌ Error uploading file to S3:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
};

/**
 * Delete a file from S3
 * @param {string} s3Key - The S3 key of the file to delete
 * @returns {Promise<Object>} - Delete result
 */
export const deleteFileFromS3 = async (s3Key) => {
  try {
    const deleteParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: s3Key
    };

    console.log('🗑️ Deleting file from S3:', s3Key);

    const result = await s3.deleteObject(deleteParams).promise();
    
    console.log('✅ File deleted successfully:', s3Key);

    return {
      success: true,
      result: result
    };

  } catch (error) {
    console.error('❌ Error deleting file from S3:', error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

/**
 * Generate a presigned URL for file access
 * @param {string} s3Key - The S3 key of the file
 * @param {number} expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns {Promise<string>} - Presigned URL
 */
export const generatePresignedUrl = async (s3Key, expiresIn = 3600) => {
  try {
    const params = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: s3Key,
      Expires: expiresIn
    };

    const url = await s3.getSignedUrlPromise('getObject', params);
    
    console.log('🔗 Generated presigned URL for:', s3Key);
    
    return url;

  } catch (error) {
    console.error('❌ Error generating presigned URL:', error);
    throw new Error(`Failed to generate presigned URL: ${error.message}`);
  }
};
