import multer from 'multer';

// Configure multer for memory storage (we'll upload directly to S3)
const storage = multer.memoryStorage();

// File filter to allow only certain file types
const fileFilter = (req, file, cb) => {
  console.log('🔍 Multer file filter - processing file:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    fieldname: file.fieldname
  });

  // Allow images, documents, and common file types
  const allowedTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    console.log('✅ File type allowed:', file.mimetype);
    cb(null, true);
  } else {
    console.log('❌ File type not allowed:', file.mimetype);
    cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Maximum 5 files per request
  }
});

// Debugging middleware
const debugMiddleware = (req, res, next) => {
  console.log('🔍 Multer middleware called');
  console.log('📋 Content-Type:', req.headers['content-type']);
  console.log('📋 Content-Length:', req.headers['content-length']);
  next();
};

// Middleware for single file upload
export const uploadSingle = upload.single('attachment');

// Middleware for multiple file uploads
export const uploadMultiple = upload.array('attachments', 5);

// Export debug middleware
export { debugMiddleware };

// Error handling middleware
export const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: 'File too large. Maximum size is 10MB.',
        error: error.message
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        message: 'Too many files. Maximum is 5 files per request.',
        error: error.message
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        message: 'Unexpected file field.',
        error: error.message
      });
    }
  }
  
  if (error.message.includes('File type')) {
    return res.status(400).json({
      message: error.message,
      error: 'Invalid file type'
    });
  }

  next(error);
};
