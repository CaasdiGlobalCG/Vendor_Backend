import express from 'express';
import multer from 'multer';
import { 
  uploadWorkspaceFile, 
  getWorkspaceFileDownloadUrl, 
  getWorkspaceFileViewUrl,
  deleteWorkspaceFile, 
  listWorkspaceFiles,
  getWorkspaceFileMetadata
} from '../controllers/workspaceFileController.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for workspace files
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types for workspace uploads
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff',
      // Documents
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Spreadsheets
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Presentations
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Text files
      'text/plain', 'text/csv', 'application/json', 'application/xml', 'text/html', 'text/css', 'text/javascript',
      // Archives
      'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/gzip', 'application/x-tar',
      // Audio/Video
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'video/mp4', 'video/avi', 'video/quicktime', 'video/webm',
      // CAD and Design files
      'application/dwg', 'application/dxf', 'application/step', 'application/iges',
      // Code files
      'text/x-python', 'text/x-java-source', 'text/x-c', 'text/x-c++src',
      // Generic/Unknown (for files that don't have proper MIME detection)
      'application/octet-stream'
    ];

    // Additional check by file extension for better compatibility
    const allowedExtensions = [
      // Images
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif',
      // Documents
      '.pdf', '.doc', '.docx', '.rtf', '.odt',
      // Spreadsheets
      '.xls', '.xlsx', '.csv', '.ods',
      // Presentations
      '.ppt', '.pptx', '.odp',
      // Text files
      '.txt', '.json', '.xml', '.html', '.css', '.js', '.ts', '.md', '.yaml', '.yml',
      // Archives
      '.zip', '.rar', '.7z', '.gz', '.tar', '.bz2',
      // Audio/Video
      '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.avi', '.mov', '.webm', '.mkv',
      // CAD and Design
      '.dwg', '.dxf', '.step', '.stp', '.iges', '.igs', '.stl', '.obj',
      // Code files
      '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.php', '.rb', '.go', '.rs',
      // Other common formats
      '.log', '.conf', '.ini', '.cfg', '.properties'
    ];

    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} (${file.originalname}) is not allowed for workspace uploads`), false);
    }
  }
});

// Upload file to workspace
router.post('/upload', upload.single('file'), uploadWorkspaceFile);

// Get file download URL
router.get('/download/:fileId', getWorkspaceFileDownloadUrl);

// Get signed URL for file viewing
router.post('/view-url', getWorkspaceFileViewUrl);

// Delete workspace file
router.delete('/:fileId', deleteWorkspaceFile);

// List files for a workspace (with optional filtering)
router.get('/workspace/:workspaceId', listWorkspaceFiles);

// Get file metadata
router.get('/metadata/:fileId', getWorkspaceFileMetadata);

export default router;
