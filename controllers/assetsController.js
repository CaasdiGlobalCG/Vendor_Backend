import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import { createAsset, getSubtaskAssets as getSubtaskAssetsFromDB, deleteAssetRecord } from '../models/DynamoAsset.js';

dotenv.config();

const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
});

// Upload asset to S3 and save metadata
export const uploadAsset = async (req, res) => {
  try {
    const { subtaskId, workspaceId, category } = req.body;
    const file = req.file;

    if (!file || !subtaskId || !workspaceId || !category) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: file, subtaskId, workspaceId, category' 
      });
    }

    // Validate file type by extension (more reliable than MIME type)
    const fileExtension = file.originalname.split('.').pop().toLowerCase();
    const validExtensions = {
      images: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      documents: ['pdf', 'doc', 'docx', 'docm', 'txt', 'xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx', 'pptm', 'odt', 'ods', 'odp', 'rtf', 'pages', 'numbers', 'key'],
      icons: ['svg'],
      fonts: ['ttf', 'otf', 'woff', 'woff2']
    };

    if (!validExtensions[category]?.includes(fileExtension)) {
      return res.status(400).json({ 
        success: false, 
        message: `Invalid file type for ${category}. Allowed: ${validExtensions[category].join(', ')}` 
      });
    }

    // Generate unique key for S3
    const timestamp = Date.now();
    const s3Key = `assets/${workspaceId}/subtasks/${subtaskId}/${category}/${timestamp}-${file.originalname}`;

    // Upload to S3
    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME || 'assets-crm-uploads-025775692918',
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'private',
    };

    const s3Response = await s3.upload(s3Params).promise();

    // Return asset metadata
    const assetData = {
      assetId: `${workspaceId}-${subtaskId}-${timestamp}`,
      workspaceId,
      subtaskId,
      id: `${timestamp}`,
      name: file.originalname,
      size: (file.size / 1024).toFixed(2),
      type: file.mimetype,
      category: category,
      s3Key: s3Key,
      s3Url: s3Response.Location,
      uploadedAt: new Date().toISOString()
    };

    // Save to DynamoDB for persistence
    try {
      await createAsset(assetData);
    } catch (dbError) {
      console.error('Warning: Failed to save asset to database:', dbError);
      // Continue anyway - file is still in S3
    }

    res.status(200).json({
      success: true,
      message: 'Asset uploaded successfully',
      asset: assetData
    });

  } catch (error) {
    console.error('❌ Error uploading asset:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error uploading asset',
      error: error.message 
    });
  }
};

// Get assets for a subtask
export const getSubtaskAssets = async (req, res) => {
  try {
    const { workspaceId, subtaskId } = req.params;

    if (!workspaceId || !subtaskId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing workspaceId or subtaskId' 
      });
    }

    // Fetch from database
    const assets = await getSubtaskAssetsFromDB(workspaceId, subtaskId);

    res.status(200).json({
      success: true,
      assets
    });

  } catch (error) {
    console.error('❌ Error fetching assets:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching assets',
      error: error.message 
    });
  }
};

// Delete asset from S3
export const deleteAsset = async (req, res) => {
  try {
    const { s3Key, workspaceId, assetId } = req.body;

    if (!s3Key) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing s3Key' 
      });
    }

    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME || 'assets-crm-uploads-025775692918',
      Key: s3Key,
    };

    await s3.deleteObject(s3Params).promise();

    // Delete from database
    if (workspaceId && assetId) {
      try {
        await deleteAssetRecord(workspaceId, assetId);
      } catch (dbError) {
        console.error('Warning: Failed to delete asset from database:', dbError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Asset deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting asset:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting asset',
      error: error.message 
    });
  }
};
