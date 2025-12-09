import { uploadFileToS3, deleteFileFromS3 } from '../utils/s3Utils.js';
import * as DynamoVendor from '../modules/vendor/models/DynamoVendor.js';

/**
 * Upload a file to S3 and store the URL in DynamoDB
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const uploadFile = async (req, res) => {
  console.log('Upload file request received:', {
    body: req.body,
    file: req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No file'
  });
  
  try {
    // Check if file exists in request
    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Get vendor email and document type from request
    const { email, documentType, section } = req.body;

    if (!email || !documentType || !section) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: email, documentType, and section'
      });
    }

    // Upload file to S3 first
    const file = req.file;
    console.log('Uploading file to S3 from fileController:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      folder: `${section}-${documentType}`,
      bufferLength: file.buffer.length
    });
    
    const s3Url = await uploadFileToS3(
      file.buffer,
      file.originalname,
      file.mimetype,
      `${section}-${documentType}`
    );
    
    console.log('S3 upload completed, URL:', s3Url);

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    // If vendor exists, update their record with the file URL
    if (vendor) {
      // Prepare update data for DynamoDB
      const updateData = {};
      
      // Create the section if it doesn't exist
      if (!vendor[section]) {
        updateData[section] = {};
      }
      
      // Add the document to the section
      updateData[section] = {
        ...vendor[section],
        [documentType]: {
          url: s3Url,
          originalName: file.originalname,
          contentType: file.mimetype,
          uploadedAt: new Date().toISOString()
        }
      };

      // Update the vendor in DynamoDB
      await DynamoVendor.updateVendor(vendor.id, updateData);
      console.log(`Updated vendor ${vendor.id} with file URL: ${s3Url}`);
    } else {
      console.log(`Vendor with email ${email} not found. File uploaded to S3 only.`);
      // We'll just continue without updating a vendor record
      // The vendor record will be created when the form is submitted
    }

    // Return success response with the S3 URL
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        url: s3Url,
        documentType,
        section,
        originalName: file.originalname
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message
    });
  }
};

/**
 * Delete a file from S3 and remove the URL from DynamoDB
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteFile = async (req, res) => {
  try {
    const { email, documentType, section } = req.body;

    if (!email || !documentType || !section) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: email, documentType, and section'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    // For delete operations, we need to know the file URL
    // If vendor doesn't exist or doesn't have the file, return an error
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check if the document exists
    if (!vendor[section] || !vendor[section][documentType] || !vendor[section][documentType].url) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Delete the file from S3
    const fileUrl = vendor[section][documentType].url;
    await deleteFileFromS3(fileUrl);

    // Prepare update data for DynamoDB
    const updateData = {};
    updateData[section] = {
      ...vendor[section]
    };
    
    // Remove the document from the section
    delete updateData[section][documentType];

    // Update the vendor in DynamoDB
    await DynamoVendor.updateVendor(vendor.id, updateData);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting file',
      error: error.message
    });
  }
};