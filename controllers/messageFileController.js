import { s3, MESSAGE_UPLOADS_BUCKET } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// Upload file for message attachment
export const uploadMessageFile = async (req, res) => {
  try {
    const { workspaceId, vendorId, messageId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    if (!workspaceId || !vendorId) {
      return res.status(400).json({ error: 'Workspace ID and Vendor ID are required' });
    }

    const file = req.file;
    const fileId = uuidv4();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${fileId}${fileExtension}`;
    
    // Create S3 key with workspace and vendor organization
    const s3Key = `workspaces/${workspaceId}/vendors/${vendorId}/messages/${messageId || 'temp'}/${fileName}`;

    console.log('📤 MessageFileController: Uploading file to S3:', {
      bucket: MESSAGE_UPLOADS_BUCKET,
      key: s3Key,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype
    });

    // Upload to S3
    const uploadParams = {
      Bucket: MESSAGE_UPLOADS_BUCKET,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // Removed ACL since bucket doesn't support it
      Metadata: {
        'original-name': file.originalname,
        'workspace-id': workspaceId,
        'vendor-id': vendorId,
        'message-id': messageId || 'temp',
        'uploaded-at': new Date().toISOString()
      }
    };

    const uploadResult = await s3.upload(uploadParams).promise();

    // Generate file info
    const fileInfo = {
      fileId,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      s3Key,
      s3Url: uploadResult.Location,
      workspaceId,
      vendorId,
      messageId: messageId || null,
      uploadedAt: new Date().toISOString()
    };

    console.log('✅ MessageFileController: File uploaded successfully:', fileInfo);

    res.status(200).json({
      success: true,
      file: fileInfo
    });

  } catch (error) {
    console.error('❌ MessageFileController: Error uploading file:', error);
    res.status(500).json({ 
      error: 'Failed to upload file',
      details: error.message 
    });
  }
};

// Get file download URL
export const getFileDownloadUrl = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { workspaceId, vendorId } = req.query;

    if (!workspaceId || !vendorId) {
      return res.status(400).json({ error: 'Workspace ID and Vendor ID are required' });
    }

    // Find the file in S3 (we'll need to search by prefix)
    const prefix = `workspaces/${workspaceId}/vendors/${vendorId}/messages/`;
    
    const listParams = {
      Bucket: MESSAGE_UPLOADS_BUCKET,
      Prefix: prefix
    };

    const objects = await s3.listObjectsV2(listParams).promise();
    const fileObject = objects.Contents?.find(obj => obj.Key.includes(fileId));

    if (!fileObject) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Generate signed URL for download
    const downloadParams = {
      Bucket: MESSAGE_UPLOADS_BUCKET,
      Key: fileObject.Key,
      Expires: 3600 // 1 hour
    };

    const downloadUrl = s3.getSignedUrl('getObject', downloadParams);

    res.status(200).json({
      success: true,
      downloadUrl,
      fileName: fileObject.Key.split('/').pop()
    });

  } catch (error) {
    console.error('❌ MessageFileController: Error getting download URL:', error);
    res.status(500).json({ 
      error: 'Failed to get download URL',
      details: error.message 
    });
  }
};

// Get signed URL for file viewing (for existing private files)
export const getFileViewUrl = async (req, res) => {
  try {
    const { s3Key } = req.body;

    if (!s3Key) {
      return res.status(400).json({ error: 'S3 key is required' });
    }

    console.log('📤 MessageFileController: Generating signed URL for:', s3Key);

    // Generate signed URL for viewing
    const viewParams = {
      Bucket: MESSAGE_UPLOADS_BUCKET,
      Key: s3Key,
      Expires: 3600 // 1 hour
    };

    const viewUrl = s3.getSignedUrl('getObject', viewParams);

    res.status(200).json({
      success: true,
      viewUrl,
      expiresIn: 3600
    });

  } catch (error) {
    console.error('❌ MessageFileController: Error generating view URL:', error);
    res.status(500).json({ 
      error: 'Failed to generate view URL',
      details: error.message 
    });
  }
};

// Delete file
export const deleteMessageFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { workspaceId, vendorId } = req.query;

    if (!workspaceId || !vendorId) {
      return res.status(400).json({ error: 'Workspace ID and Vendor ID are required' });
    }

    // Find and delete the file
    const prefix = `workspaces/${workspaceId}/vendors/${vendorId}/messages/`;
    
    const listParams = {
      Bucket: MESSAGE_UPLOADS_BUCKET,
      Prefix: prefix
    };

    const objects = await s3.listObjectsV2(listParams).promise();
    const fileObject = objects.Contents?.find(obj => obj.Key.includes(fileId));

    if (!fileObject) {
      return res.status(404).json({ error: 'File not found' });
    }

    const deleteParams = {
      Bucket: MESSAGE_UPLOADS_BUCKET,
      Key: fileObject.Key
    };

    await s3.deleteObject(deleteParams).promise();

    console.log('🗑️ MessageFileController: File deleted successfully:', fileObject.Key);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('❌ MessageFileController: Error deleting file:', error);
    res.status(500).json({ 
      error: 'Failed to delete file',
      details: error.message 
    });
  }
};

// List files for a workspace
export const listWorkspaceFiles = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { vendorId } = req.query;

    if (!vendorId) {
      return res.status(400).json({ error: 'Vendor ID is required' });
    }

    const prefix = `workspaces/${workspaceId}/vendors/${vendorId}/messages/`;
    
    const listParams = {
      Bucket: MESSAGE_UPLOADS_BUCKET,
      Prefix: prefix
    };

    const objects = await s3.listObjectsV2(listParams).promise();

    const files = objects.Contents?.map(obj => ({
      key: obj.Key,
      fileName: obj.Key.split('/').pop(),
      size: obj.Size,
      lastModified: obj.LastModified,
      fileId: obj.Key.split('/').pop().split('.')[0] // Extract fileId from filename
    })) || [];

    res.status(200).json({
      success: true,
      files
    });

  } catch (error) {
    console.error('❌ MessageFileController: Error listing files:', error);
    res.status(500).json({ 
      error: 'Failed to list files',
      details: error.message 
    });
  }
};
