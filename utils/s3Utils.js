import { s3, S3_BUCKET_NAME } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Upload a file to S3
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - Original file name
 * @param {string} contentType - MIME type of the file
 * @param {string} folder - Optional folder path within the bucket
 * @returns {Promise<string>} - The S3 URL of the uploaded file
 */
export const uploadFileToS3 = async (fileBuffer, fileName, contentType, folder = '',bucketName = 'workspace-quotes-and-invoices') => {
  console.log('S3 upload started:', {
    fileName,
    contentType,
    folder,
    bucketName: bucketName,
    bufferLength: fileBuffer ? fileBuffer.length : 0
  });
  
  try {
    // Generate a unique file name to avoid collisions
    const fileExtension = fileName.split('.').pop();
    const uniqueFileName = `${folder ? folder + '/' : ''}${uuidv4()}.${fileExtension}`;
    
    console.log('Generated unique filename:', uniqueFileName);
    
    // Set up the S3 upload parameters
    const params = {
      Bucket: bucketName,
      Key: uniqueFileName,
      Body: fileBuffer,
      ContentType: contentType
      // Removed ACL since bucket doesn't support it
    };
    
    console.log('Uploading to S3 with params:', {
      Bucket: params.Bucket,
      Key: params.Key,
      ContentType: params.ContentType,
      ACL: params.ACL
    });
    
    // Upload the file to S3
    const uploadResult = await s3.upload(params).promise();
    
    console.log('S3 upload successful:', {
      Location: uploadResult.Location,
      ETag: uploadResult.ETag,
      Key: uploadResult.Key
    });
    
    // Return the URL of the uploaded file
    return uploadResult.Location;
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      requestId: error.requestId
    });
    throw error;
  }
};

/**
 * Delete a file from S3
 * @param {string} fileUrl - The S3 URL of the file to delete
 * @returns {Promise<boolean>} - True if deletion was successful
 */
export const deleteFileFromS3 = async (fileUrl) => {
  try {
    // Extract the key from the URL
    const key = fileUrl.split('/').slice(3).join('/');
    
    // Set up the S3 delete parameters
    const params = {
      Bucket: bucketName,
      Key: key
    };
    
    // Delete the file from S3
    await s3.deleteObject(params).promise();
    
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    throw error;
  }
};