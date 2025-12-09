import express from 'express';
import multer from 'multer';
import { uploadMessageFile, getFileDownloadUrl, deleteMessageFile, listWorkspaceFiles, getFileViewUrl } from '../controllers/messageFileController.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      // Documents
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Spreadsheets
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Presentations
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Text files
      'text/plain', 'text/csv', 'application/json', 'application/xml',
      // Archives
      'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
      // Audio/Video
      'audio/mpeg', 'audio/wav', 'video/mp4', 'video/avi', 'video/quicktime',
      // Generic/Unknown (for files that don't have proper MIME detection)
      'application/octet-stream'
    ];

    // Additional check by file extension for better compatibility
    const allowedExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.txt', '.csv', '.json', '.xml',
      '.zip', '.rar', '.7z',
      '.mp3', '.wav', '.mp4', '.avi', '.mov'
    ];

    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} (${file.originalname}) is not allowed`), false);
    }
  }
});

// Upload file for message attachment
router.post('/upload', upload.single('file'), uploadMessageFile);

// Get file download URL
router.get('/download/:fileId', getFileDownloadUrl);

// Get signed URL for file viewing (for existing private files)
router.post('/view-url', getFileViewUrl);

// Delete file
router.delete('/:fileId', deleteMessageFile);

// List files for a workspace
router.get('/workspace/:workspaceId', listWorkspaceFiles);

export default router;
