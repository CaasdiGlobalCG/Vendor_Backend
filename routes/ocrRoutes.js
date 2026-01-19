/**
 * OCR Routes
 * Endpoints for cheque image processing with AWS Textract
 */

import express from 'express';
import multer from 'multer';
import {
  processCheque,
  getOCRHealth,
  getOCRStats
} from '../controllers/ocrController.js';
import { authenticateUser } from '../middleware/authMiddleware.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    // Validate file type
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
    
    if (!validMimes.includes(file.mimetype)) {
      const error = new Error(
        `Invalid file type: ${file.mimetype}. Allowed: JPG, PNG, WEBP, TIFF`
      );
      error.code = 'INVALID_FILE_TYPE';
      return cb(error);
    }

    cb(null, true);
  }
});

/**
 * Process cheque image with AWS Textract
 * POST /api/ocr/process-cheque
 * 
 * Request:
 *   - Content-Type: multipart/form-data
 *   - file: image file (required)
 *   - userEmail: string (required)
 * 
 * Response:
 *   {
 *     success: boolean,
 *     textractData: {
 *       Blocks: Array,
 *       DocumentMetadata: Object,
 *       DocumentConfidence: number
 *     },
 *     metadata: {
 *       fileName: string,
 *       fileSize: number,
 *       blocksCount: number,
 *       confidence: number,
 *       processedAt: string
 *     }
 *   }
 */
router.post(
  '/process-cheque',
  upload.single('file'),
  processCheque
);

/**
 * Health check for OCR service
 * GET /api/ocr/health
 * 
 * Response:
 *   {
 *     available: boolean,
 *     status: 'healthy' | 'unhealthy' | 'error',
 *     service: 'AWS Textract',
 *     timestamp: string
 *   }
 */
router.get('/health', getOCRHealth);

/**
 * Get OCR statistics and analytics
 * GET /api/ocr/stats
 * 
 * Response:
 *   {
 *     totalProcessed: number,
 *     successRate: number,
 *     averageConfidence: number,
 *     commonErrors: Array
 *   }
 */
router.get(
  '/stats',
  authenticateUser,
  getOCRStats
);

// Error handling middleware for multer errors
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    logger.error('Multer error:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File size exceeds 5MB limit',
        code: 'FILE_TOO_LARGE'
      });
    }
    
    return res.status(400).json({
      success: false,
      error: error.message,
      code: 'UPLOAD_ERROR'
    });
  }

  if (error.code === 'INVALID_FILE_TYPE') {
    logger.warn('Invalid file type uploaded:', error.message);
    return res.status(400).json({
      success: false,
      error: error.message,
      code: 'INVALID_FILE_TYPE'
    });
  }

  next(error);
});

export default router;
