import express from 'express';
import * as postServiceController from '../controllers/postServiceController.js';
import { authenticateUser } from '../../../middleware/authMiddleware.js';
import { uploadMultiple, handleUploadError, debugMiddleware } from '../middleware/uploadMiddleware.js';
import { testS3Connection } from '../utils/s3Test.js';

const router = express.Router();

// POST /api/post-services - Create a new post service
router.post('/post-services', debugMiddleware, uploadMultiple, handleUploadError, postServiceController.createPostService);

// POST /api/post-services/reply - Create a reply to a post
router.post('/post-services/reply', debugMiddleware, uploadMultiple, handleUploadError, postServiceController.createReply);

// GET /api/post-services/:workspaceId - Get all post services for a workspace
router.get('/post-services/:workspaceId', postServiceController.getPostServices);

// GET /api/post-services/:workspaceId/subtask/:subtaskId - Get post services for a specific subtask
router.get('/post-services/:workspaceId/subtask/:subtaskId', postServiceController.getPostServicesBySubtask);

// GET /api/post-services/test/s3 - Test S3 connection
router.get('/post-services/test/s3', async (req, res) => {
  try {
    const result = await testS3Connection();
    res.json({ success: result, message: result ? 'S3 connection successful' : 'S3 connection failed' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'S3 test failed', error: error.message });
  }
});

// POST /api/post-services/test/upload - Test file upload without processing
router.post('/post-services/test/upload', debugMiddleware, uploadMultiple, (req, res) => {
  console.log('🧪 Test upload endpoint called');
  console.log('📋 req.files:', req.files);
  console.log('📋 req.body:', req.body);
  res.json({ 
    success: true, 
    filesReceived: req.files ? req.files.length : 0,
    files: req.files ? req.files.map(f => ({ name: f.originalname, size: f.size, type: f.mimetype })) : []
  });
});

export default router;

