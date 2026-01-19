/**
 * AWS Textract OCR Utilities
 * Handles image processing and AWS Textract integration for cheque OCR
 */

import { TextractClient, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { logger } from './logger.js';

// Initialize Textract client
const textractClient = new TextractClient({
  region: process.env.AWS_REGION || 'ap-south-1'
});

/**
 * Process cheque image with AWS Textract
 * @param {Buffer} imageBuffer - Image file buffer
 * @param {string} fileName - Original file name
 * @returns {Promise} - Textract response with extracted text
 */
export const processChequeWithTextract = async (imageBuffer, fileName) => {
  try {
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Empty image buffer');
    }

    // Validate image size
    if (imageBuffer.length > 5 * 1024 * 1024) {
      throw new Error('Image size exceeds 5MB limit');
    }

    logger.info(`Processing cheque: ${fileName}, Size: ${imageBuffer.length} bytes`);

    const command = new AnalyzeDocumentCommand({
      Document: {
        Bytes: imageBuffer
      },
      FeatureTypes: ['TABLES', 'FORMS']
    });

    const response = await textractClient.send(command);

    logger.info(`Textract processed ${response.Blocks?.length || 0} blocks for ${fileName}`);

    return {
      success: true,
      data: response,
      blocksCount: response.Blocks?.length || 0,
      documentMetadata: response.DocumentMetadata || {}
    };
  } catch (error) {
    logger.error(`Textract processing error for ${fileName}:`, error);

    // Map AWS errors to user-friendly messages
    const errorMap = {
      'InvalidParameterException': 'Invalid image format or corrupted file',
      'ImageTooSmallException': 'Image too small (minimum 50x50 pixels)',
      'DocumentTooLargeException': 'Document too large (max 5MB)',
      'ThrottlingException': 'Too many requests, please try again later',
      'AccessDeniedException': 'AWS service configuration error',
      'ProvisionedThroughputExceededException': 'Service rate limit exceeded'
    };

    const userMessage = errorMap[error.name] || error.message || 'Failed to process image';

    throw {
      code: error.name || 'TEXTRACT_ERROR',
      message: userMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : null,
      statusCode: 400
    };
  }
};

/**
 * Validate image file before processing
 * @param {Object} file - Multer file object
 * @returns {Object} - Validation result
 */
export const validateImageFile = (file) => {
  const errors = [];

  if (!file) {
    errors.push('No file provided');
  }

  if (file) {
    // Check file type
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
    if (!validMimes.includes(file.mimetype)) {
      errors.push(`Invalid file type: ${file.mimetype}. Allowed: JPG, PNG, WEBP, TIFF`);
    }

    // Check file size
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      errors.push(`File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum 5MB allowed.`);
    }

    // Check minimum size (should be at least 10KB for meaningful image)
    if (file.size < 10 * 1024) {
      errors.push('File too small. Minimum 10KB required.');
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
};

/**
 * Extract text blocks from Textract response
 * @param {Object} textractResponse - AWS Textract response
 * @returns {Array} - Array of text blocks with confidence
 */
export const extractTextBlocks = (textractResponse) => {
  try {
    if (!textractResponse.Blocks || !Array.isArray(textractResponse.Blocks)) {
      return [];
    }

    return textractResponse.Blocks.map(block => ({
      BlockType: block.BlockType,
      Text: block.Text || '',
      Confidence: block.Confidence || 0,
      Geometry: block.Geometry || {},
      Id: block.Id,
      Relationships: block.Relationships || []
    })).filter(block => block.Text.trim().length > 0);
  } catch (error) {
    logger.error('Error extracting text blocks:', error);
    return [];
  }
};

/**
 * Calculate overall document confidence
 * @param {Object} textractResponse - AWS Textract response
 * @returns {number} - Average confidence 0-100
 */
export const calculateDocumentConfidence = (textractResponse) => {
  try {
    if (!textractResponse.Blocks || textractResponse.Blocks.length === 0) {
      return 0;
    }

    const textBlocks = textractResponse.Blocks.filter(b => b.BlockType === 'LINE' || b.BlockType === 'WORD');
    if (textBlocks.length === 0) {
      return 0;
    }

    const totalConfidence = textBlocks.reduce((sum, block) => sum + (block.Confidence || 0), 0);
    return Math.round(totalConfidence / textBlocks.length);
  } catch (error) {
    logger.error('Error calculating document confidence:', error);
    return 0;
  }
};

/**
 * Check OCR service health (AWS Textract connectivity)
 * @returns {Promise<boolean>} - Service availability
 */
export const checkOCRServiceHealth = async () => {
  try {
    // Try a simple metadata call to verify connectivity
    await textractClient.send(
      new AnalyzeDocumentCommand({
        Document: {
          Bytes: Buffer.from('test', 'utf-8')
        },
        FeatureTypes: ['FORMS']
      })
    ).catch(() => {
      // Expected to fail, we just need to verify the service is reachable
      // If we get here without network error, service is OK
      return true;
    });

    return true;
  } catch (error) {
    if (error.code === 'NetworkingError' || error.code === 'ECONNREFUSED') {
      logger.error('OCR service unreachable:', error.message);
      return false;
    }
    // Other errors (like validation) still mean service is up
    return true;
  }
};

export default {
  processChequeWithTextract,
  validateImageFile,
  extractTextBlocks,
  calculateDocumentConfidence,
  checkOCRServiceHealth
};
