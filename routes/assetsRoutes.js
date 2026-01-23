import express from 'express';
import multer from 'multer';
import { uploadAsset, getSubtaskAssets, deleteAsset } from '../controllers/assetsController.js';

const router = express.Router();

// Configure multer for asset uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Upload asset
router.post('/upload', upload.single('file'), uploadAsset);

// Get subtask assets
router.get('/subtask/:workspaceId/:subtaskId', getSubtaskAssets);

// Delete asset
router.delete('/delete', deleteAsset);

export default router;
