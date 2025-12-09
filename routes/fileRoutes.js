import express from 'express';
import multer from 'multer';
import { uploadFile, deleteFile } from '../controllers/fileController.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Test route to check if the file routes are working
router.get('/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'File routes are working!'
  });
});

// Route for uploading a single file
router.post('/upload', upload.single('file'), uploadFile);

// Route for deleting a file
router.delete('/delete', deleteFile);

export default router;