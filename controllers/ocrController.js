/**
 * OCR Controller
 * Handles cheque image processing with AWS Textract
 */

import {
  processChequeWithTextract,
  validateImageFile,
  extractTextBlocks,
  calculateDocumentConfidence,
  checkOCRServiceHealth
} from '../utils/ocrService.js';
import { logger } from '../utils/logger.js';

/**
 * Process cheque image for account details extraction
 * POST /api/ocr/process-cheque
 */
export const processCheque = async (req, res) => {
  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided',
        code: 'NO_FILE'
      });
    }

    const { userEmail } = req.body;
    const email = userEmail || 'unknown';

    // Validate image file
    const validation = validateImageFile(req.file);
    if (!validation.valid) {
      logger.warn(`Invalid file for user ${email}:`, validation.errors);
      return res.status(400).json({
        success: false,
        error: validation.errors.join('; '),
        code: 'INVALID_FILE'
      });
    }

    logger.info(`Processing cheque for user: ${email}, File: ${req.file.originalname}`);

    // Process with AWS Textract
    const textractResult = await processChequeWithTextract(
      req.file.buffer,
      req.file.originalname
    );

    if (!textractResult.success) {
      logger.error(`Textract failed for ${userEmail}:`, textractResult);
      return res.status(400).json({
        success: false,
        error: textractResult.message,
        code: textractResult.code,
        details: textractResult.details
      });
    }

    // Extract text blocks
    const blocks = extractTextBlocks(textractResult.data);
    const documentConfidence = calculateDocumentConfidence(textractResult.data);

    logger.info(
      `Successfully processed cheque for ${email}. Blocks: ${blocks.length}, Confidence: ${documentConfidence}%`
    );

    // Log for audit trail
    logOCRActivity({
      userEmail: email,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      blocksExtracted: blocks.length,
      confidence: documentConfidence,
      status: 'success',
      timestamp: new Date().toISOString()
    });

    // Return Textract response to frontend
    res.json({
      success: true,
      textractData: {
        Blocks: blocks,
        DocumentMetadata: textractResult.data.DocumentMetadata || {},
        DocumentConfidence: documentConfidence
      },
      metadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        blocksCount: blocks.length,
        confidence: documentConfidence,
        processedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('OCR processing error:', error);

    // Log failed attempt
    logOCRActivity({
      userEmail: req.body?.userEmail || 'unknown',
      fileName: req.file?.originalname || 'unknown',
      status: 'failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to process cheque image',
      code: error.code || 'PROCESSING_ERROR',
      details: error.details || null
    });
  }
};

/**
 * Check OCR service health
 * GET /api/ocr/health
 */
export const getOCRHealth = async (req, res) => {
  try {
    const isHealthy = await checkOCRServiceHealth();

    if (isHealthy) {
      return res.json({
        available: true,
        status: 'healthy',
        service: 'AWS Textract',
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(503).json({
        available: false,
        status: 'unhealthy',
        service: 'AWS Textract',
        message: 'OCR service is temporarily unavailable',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('OCR health check failed:', error);
    
    res.status(503).json({
      available: false,
      status: 'error',
      service: 'AWS Textract',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Log OCR activity for audit trail and analytics
 * @param {Object} activity - Activity data
 */
const logOCRActivity = (activity) => {
  try {
    // In production, this could be sent to CloudWatch, DataDog, or a logging service
    logger.info('OCR Activity:', JSON.stringify(activity));
    
    // Could also log to DynamoDB for persistence:
    // await dynamoService.putItem('OCR_ACTIVITY_TABLE', {
    //   userEmail: activity.userEmail,
    //   timestamp: activity.timestamp,
    //   ...activity
    // });
  } catch (error) {
    logger.error('Failed to log OCR activity:', error);
  }
};

/**
 * Get OCR statistics (optional)
 * GET /api/ocr/stats
 */
export const getOCRStats = async (req, res) => {
  try {
    // This endpoint could return stats like:
    // - Total cheques processed
    // - Success rate
    // - Average confidence
    // - Common errors
    
    // For now, return placeholder
    res.json({
      message: 'OCR statistics endpoint',
      note: 'Implement based on your logging/analytics system'
    });
  } catch (error) {
    logger.error('Error getting OCR stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics'
    });
  }
};

export default {
  processCheque,
  getOCRHealth,
  getOCRStats
};
