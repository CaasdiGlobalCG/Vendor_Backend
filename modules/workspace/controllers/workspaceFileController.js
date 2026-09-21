import { s3, WORKSPACE_UPLOADS_BUCKET } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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

// Stream file bytes directly (same-origin proxy for viewers that need
// fetch/arrayBuffer access — e.g. the CAD 3D preview — where presigned S3
// URLs would be blocked by missing bucket CORS)
export const streamWorkspaceFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { workspaceId, subtaskId } = req.query;

    if (!subtaskId) {
      return res.status(400).json({ error: 'Subtask ID is required to stream files' });
    }

    const fileObject = await findFileObject(workspaceId, subtaskId, fileId);
    if (!fileObject) {
      return res.status(404).json({ error: 'File not found in this subtask' });
    }

    await streamS3Object(req, res, fileObject.Key);
  } catch (error) {
    console.error('❌ WorkspaceFileController: Error streaming file:', error);
    res.status(500).json({
      error: 'Failed to stream file',
      details: error.message
    });
  }
};

// ---- CAD preview conversion (dwg -> dxf, cdr -> svg) via LibreOffice ----
// soffice resolves from SOFFICE_PATH env, PATH, or common install locations.
const SOFFICE_CANDIDATES = [
  process.env.SOFFICE_PATH,
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  'C:\\Users\\Sanjay Kumar\\Downloads\\LibreOfficePortable\\App\\libreoffice\\program\\soffice.exe', // portable install on this machine
  'soffice', // PATH
  '/usr/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice'
].filter(Boolean);

const findSoffice = () => SOFFICE_CANDIDATES.find(p => p === 'soffice' || fs.existsSync(p));

// dwg is handled client-side via libredwg WASM — LibreOffice cannot load DWG.
const PREVIEW_CONVERSIONS = {
  cdr: { target: 'svg', contentType: 'image/svg+xml' }
};

const findFileObject = async (workspaceId, subtaskId, fileId) => {
  const prefix = `subtasks/${subtaskId}/workspaces/${workspaceId}/`;
  const objects = await s3.listObjectsV2({ Bucket: WORKSPACE_UPLOADS_BUCKET, Prefix: prefix }).promise();
  return objects.Contents?.find(obj => obj.Key.includes(fileId)) || null;
};

const streamS3Object = async (req, res, s3Key) => {
  const metadata = await s3.headObject({ Bucket: WORKSPACE_UPLOADS_BUCKET, Key: s3Key }).promise();
  res.setHeader('Content-Type', metadata.ContentType || 'application/octet-stream');
  if (metadata.ContentLength) res.setHeader('Content-Length', metadata.ContentLength);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  s3.getObject({ Bucket: WORKSPACE_UPLOADS_BUCKET, Key: s3Key })
    .createReadStream()
    .on('error', (err) => {
      console.error('❌ S3 stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to stream file' });
    })
    .pipe(res);
};

// GET /preview/:fileId?workspaceId=&subtaskId=
// Converts proprietary CAD formats to a browser-renderable one, caches the
// result back in S3 next to the source file, and streams it to the client.
export const previewWorkspaceFile = async (req, res) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-preview-'));
  try {
    const { fileId } = req.params;
    const { workspaceId, subtaskId } = req.query;

    if (!subtaskId) {
      return res.status(400).json({ error: 'Subtask ID is required to preview files' });
    }

    const fileObject = await findFileObject(workspaceId, subtaskId, fileId);
    if (!fileObject) {
      return res.status(404).json({ error: 'File not found in this subtask' });
    }

    const ext = path.extname(fileObject.Key).toLowerCase().replace('.', '');
    const conversion = PREVIEW_CONVERSIONS[ext];
    if (!conversion) {
      return res.status(400).json({ error: `No conversion pipeline for .${ext} files` });
    }

    // Serve the cached conversion if a previous preview already produced one
    const cacheKey = `${fileObject.Key}.preview.${conversion.target}`;
    try {
      await s3.headObject({ Bucket: WORKSPACE_UPLOADS_BUCKET, Key: cacheKey }).promise();
      return await streamS3Object(req, res, cacheKey);
    } catch { /* not cached yet — convert below */ }

    const soffice = findSoffice();
    if (!soffice) {
      return res.status(503).json({ error: 'LibreOffice (soffice) is not installed on this server — CAD preview conversion is unavailable' });
    }

    // Download source, convert, upload the result to the cache key
    const inputPath = path.join(workDir, `input.${ext}`);
    const input = await s3.getObject({ Bucket: WORKSPACE_UPLOADS_BUCKET, Key: fileObject.Key }).promise();
    fs.writeFileSync(inputPath, input.Body);

    console.log(`🔄 CAD preview: converting ${fileObject.Key} (${ext} -> ${conversion.target})`);
    await execFileAsync(
      soffice,
      ['--headless', '--norestore', '--convert-to', conversion.target, '--outdir', workDir, inputPath],
      { timeout: 120000 }
    );

    const outputPath = path.join(workDir, `input.${conversion.target}`);
    if (!fs.existsSync(outputPath)) {
      throw new Error(`LibreOffice produced no ${conversion.target} output`);
    }
    const output = fs.readFileSync(outputPath);

    await s3.putObject({
      Bucket: WORKSPACE_UPLOADS_BUCKET,
      Key: cacheKey,
      Body: output,
      ContentType: conversion.contentType
    }).promise();

    res.setHeader('Content-Type', conversion.contentType);
    res.setHeader('Content-Length', output.length);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(output);
  } catch (error) {
    console.error('❌ WorkspaceFileController: Preview conversion failed:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to convert file for preview', details: error.message });
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
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
