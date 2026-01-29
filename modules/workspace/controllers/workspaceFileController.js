import { s3, WORKSPACE_UPLOADS_BUCKET } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// Upload file to workspace uploads bucket
export const uploadWorkspaceFile = async (req, res) => {
  try {
    const { workspaceId, vendorId, taskId, subtaskId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    if (!subtaskId) {
      return res.status(400).json({ error: 'Subtask ID is required - uploads must be associated with a specific subtask' });
    }

    const file = req.file;
    const fileId = uuidv4();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${fileId}${fileExtension}`;
    
    // Create S3 key with subtask as the primary scope
    // Structure: subtasks/{subtaskId}/workspaces/{workspaceId}/files/{fileName}
    // This ensures files are scoped to subtasks and not visible across other subtasks
    let s3Key = `subtasks/${subtaskId}/workspaces/${workspaceId}`;
    
    if (taskId) {
      s3Key += `/tasks/${taskId}`;
    }
    
    if (vendorId) {
      s3Key += `/vendors/${vendorId}`;
    }
    
    s3Key += `/files/${fileName}`;

    console.log('📤 WorkspaceFileController: Uploading file to S3:', {
      bucket: WORKSPACE_UPLOADS_BUCKET,
      key: s3Key,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      workspaceId,
      vendorId,
      taskId,
      subtaskId
    });

    // Upload to S3
    const uploadParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // Removed ACL since bucket doesn't support it
      Metadata: {
        'original-name': file.originalname,
        'workspace-id': workspaceId,
        'vendor-id': vendorId || 'unknown',
        'task-id': taskId || 'general',
        'subtask-id': subtaskId || 'none',
        'uploaded-at': new Date().toISOString(),
        'file-id': fileId
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
      vendorId: vendorId || null,
      taskId: taskId || null,
      subtaskId: subtaskId || null,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user?.id || 'unknown'
    };

    console.log('✅ WorkspaceFileController: File uploaded successfully:', fileInfo);

    res.status(200).json({
      success: true,
      file: fileInfo
    });

  } catch (error) {
    console.error('❌ WorkspaceFileController: Error uploading file:', error);
    res.status(500).json({ 
      error: 'Failed to upload file',
      details: error.message 
    });
  }
};

// Get file download URL
export const getWorkspaceFileDownloadUrl = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { workspaceId, subtaskId } = req.query;

    if (!subtaskId) {
      return res.status(400).json({ error: 'Subtask ID is required to download files' });
    }

    // Find the file in S3 by searching subtask prefix
    const prefix = `subtasks/${subtaskId}/workspaces/${workspaceId}/`;
    
    const listParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Prefix: prefix
    };

    const objects = await s3.listObjectsV2(listParams).promise();
    const fileObject = objects.Contents?.find(obj => obj.Key.includes(fileId));

    if (!fileObject) {
      return res.status(404).json({ error: 'File not found in this subtask' });
    }

    // Generate signed URL for download
    const downloadParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: fileObject.Key,
      Expires: 3600 // 1 hour
    };

    const downloadUrl = s3.getSignedUrl('getObject', downloadParams);

    // Get file metadata
    const headParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: fileObject.Key
    };

    const metadata = await s3.headObject(headParams).promise();

    res.status(200).json({
      success: true,
      downloadUrl,
      fileName: metadata.Metadata['original-name'] || fileObject.Key.split('/').pop(),
      fileSize: fileObject.Size,
      lastModified: fileObject.LastModified,
      contentType: metadata.ContentType
    });

  } catch (error) {
    console.error('❌ WorkspaceFileController: Error getting download URL:', error);
    res.status(500).json({ 
      error: 'Failed to get download URL',
      details: error.message 
    });
  }
};

// Get signed URL for file viewing
export const getWorkspaceFileViewUrl = async (req, res) => {
  try {
    const { s3Key } = req.body;

    if (!s3Key) {
      return res.status(400).json({ error: 'S3 key is required' });
    }

    console.log('📤 WorkspaceFileController: Generating signed URL for:', s3Key);

    // Generate signed URL for viewing
    const viewParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
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
    console.error('❌ WorkspaceFileController: Error generating view URL:', error);
    res.status(500).json({ 
      error: 'Failed to generate view URL',
      details: error.message 
    });
  }
};

// Delete workspace file
export const deleteWorkspaceFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { workspaceId, subtaskId } = req.query;

    if (!subtaskId) {
      return res.status(400).json({ error: 'Subtask ID is required to delete files' });
    }

    // Find and delete the file
    const prefix = `subtasks/${subtaskId}/workspaces/${workspaceId}/`;
    
    const listParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Prefix: prefix
    };

    const objects = await s3.listObjectsV2(listParams).promise();
    const fileObject = objects.Contents?.find(obj => obj.Key.includes(fileId));

    if (!fileObject) {
      return res.status(404).json({ error: 'File not found in this subtask' });
    }

    const deleteParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: fileObject.Key
    };

    await s3.deleteObject(deleteParams).promise();

    console.log('🗑️ WorkspaceFileController: File deleted successfully:', fileObject.Key);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('❌ WorkspaceFileController: Error deleting file:', error);
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
    const { vendorId, taskId, subtaskId } = req.query;

    // If subtaskId is provided, filter files to only that subtask
    // Otherwise, return no files (require explicit subtask filter)
    if (!subtaskId) {
      console.log('📋 WorkspaceFileController: No subtaskId provided, returning empty file list');
      return res.status(200).json({
        success: true,
        files: [],
        count: 0,
        message: 'Subtask ID required to list files - files are scoped to subtasks'
      });
    }

    // Build prefix with subtask as primary scope
    // Structure: subtasks/{subtaskId}/workspaces/{workspaceId}/...
    let prefix = `subtasks/${subtaskId}/workspaces/${workspaceId}`;
    
    if (taskId) {
      prefix += `/tasks/${taskId}`;
    }
    
    if (vendorId) {
      prefix += `/vendors/${vendorId}`;
    }
    
    prefix += `/`;
    
    const listParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Prefix: prefix
    };

    console.log('📋 WorkspaceFileController: Listing files for subtask with prefix:', prefix);

    const objects = await s3.listObjectsV2(listParams).promise();

    const files = [];
    
    if (objects.Contents) {
      for (const obj of objects.Contents) {
        try {
          // Get metadata for each file
          const headParams = {
            Bucket: WORKSPACE_UPLOADS_BUCKET,
            Key: obj.Key
          };
          
          const metadata = await s3.headObject(headParams).promise();
          
          // Extract fileId from metadata or key
          const fileId = metadata.Metadata['file-id'] || obj.Key.split('/').pop().split('.')[0];
          
          files.push({
            fileId,
            key: obj.Key,
            fileName: metadata.Metadata['original-name'] || obj.Key.split('/').pop(),
            size: obj.Size,
            lastModified: obj.LastModified,
            contentType: metadata.ContentType,
            workspaceId: metadata.Metadata['workspace-id'],
            vendorId: metadata.Metadata['vendor-id'],
            taskId: metadata.Metadata['task-id'],
            subtaskId: metadata.Metadata['subtask-id'],
            uploadedAt: metadata.Metadata['uploaded-at']
          });
        } catch (metadataError) {
          console.warn('Could not get metadata for file:', obj.Key, metadataError.message);
          // Fallback without metadata
          const fileId = obj.Key.split('/').pop().split('.')[0];
          files.push({
            fileId,
            key: obj.Key,
            fileName: obj.Key.split('/').pop(),
            size: obj.Size,
            lastModified: obj.LastModified,
            contentType: 'application/octet-stream'
          });
        }
      }
    }

    console.log(`✅ WorkspaceFileController: Found ${files.length} files`);

    res.status(200).json({
      success: true,
      files,
      count: files.length
    });

  } catch (error) {
    console.error('❌ WorkspaceFileController: Error listing files:', error);
    res.status(500).json({ 
      error: 'Failed to list files',
      details: error.message 
    });
  }
};

// Get file metadata
export const getWorkspaceFileMetadata = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { workspaceId, subtaskId } = req.query;

    if (!subtaskId) {
      return res.status(400).json({ error: 'Subtask ID is required to access file metadata' });
    }

    // Find the file in S3
    const prefix = `subtasks/${subtaskId}/workspaces/${workspaceId}/`;
    
    const listParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Prefix: prefix
    };

    const objects = await s3.listObjectsV2(listParams).promise();
    const fileObject = objects.Contents?.find(obj => obj.Key.includes(fileId));

    if (!fileObject) {
      return res.status(404).json({ error: 'File not found in this subtask' });
    }

    // Get detailed metadata
    const headParams = {
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: fileObject.Key
    };

    const metadata = await s3.headObject(headParams).promise();

    const fileMetadata = {
      fileId,
      key: fileObject.Key,
      fileName: metadata.Metadata['original-name'] || fileObject.Key.split('/').pop(),
      size: fileObject.Size,
      lastModified: fileObject.LastModified,
      contentType: metadata.ContentType,
      workspaceId: metadata.Metadata['workspace-id'],
      vendorId: metadata.Metadata['vendor-id'],
      taskId: metadata.Metadata['task-id'],
      subtaskId: metadata.Metadata['subtask-id'],
      uploadedAt: metadata.Metadata['uploaded-at'],
      etag: metadata.ETag
    };

    res.status(200).json({
      success: true,
      file: fileMetadata
    });

  } catch (error) {
    console.error('❌ WorkspaceFileController: Error getting file metadata:', error);
    res.status(500).json({ 
      error: 'Failed to get file metadata',
      details: error.message 
    });
  }
};
