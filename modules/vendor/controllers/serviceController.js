import * as DynamoVendor from '../models/DynamoVendor.js';
import { uploadFileToS3, deleteFileFromS3 } from '../../../utils/s3Utils.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get all services for a vendor
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getServices = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check if the vendor has services
    if (!vendor.services || !Array.isArray(vendor.services) || vendor.services.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No services found',
        data: []
      });
    }

    // Return the services
    res.status(200).json({
      success: true,
      data: vendor.services
    });
  } catch (error) {
    console.error('Error getting services:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting services',
      error: error.message
    });
  }
};

/**
 * Add a new service for a vendor
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const addService = async (req, res) => {
  try {
    console.log('Add service request received:', {
      body: req.body,
      files: req.files ? Object.keys(req.files).map(key => `${key}: ${req.files[key].length} files`) : 'No files'
    });
    
    // Debug the request
    console.log('Request body:', JSON.stringify(req.body));
    console.log('Request files:', req.files ? JSON.stringify(Object.keys(req.files)) : 'No files');

    const { email } = req.body;
    const serviceData = JSON.parse(req.body.serviceData || '{}');

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Generate a unique ID for the service
    const serviceId = uuidv4();

    // Handle service image uploads
    const imageUrls = [];
    if (req.files && req.files.serviceImages) {
      try {
        for (const file of req.files.serviceImages) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            `services/${serviceId}`
          );
          
          imageUrls.push({
            url: s3Url,
            originalName: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
          console.log('Service image uploaded to S3:', s3Url);
        }
      } catch (error) {
        console.error('Error uploading service images to S3:', error);
        // Continue with the service creation even if image uploads fail
      }
    }

    // Handle service PDF upload
    let servicePdf = null;
    if (req.files && req.files.servicePdf && req.files.servicePdf[0]) {
      try {
        const pdfFile = req.files.servicePdf[0];
        const s3Url = await uploadFileToS3(
          pdfFile.buffer,
          pdfFile.originalname,
          pdfFile.mimetype,
          `services/${serviceId}/pdfs`
        );
        
        servicePdf = {
          url: s3Url,
          originalName: pdfFile.originalname,
          contentType: pdfFile.mimetype,
          uploadedAt: new Date().toISOString()
        };
        
        console.log('Service PDF uploaded to S3:', s3Url);
      } catch (error) {
        console.error('Error uploading service PDF to S3:', error);
        // Continue with the service creation even if PDF upload fails
      }
    }


    // Create the new service object
    const newService = {
      id: serviceId,
      ...serviceData,
      images: imageUrls,
      servicePdf: servicePdf,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Add the service to the vendor's services array
    const updatedServices = vendor.services ? [...vendor.services, newService] : [newService];
    
    // Update the vendor in DynamoDB
    await DynamoVendor.updateVendor(vendor.id, { services: updatedServices });

    res.status(201).json({
      success: true,
      message: 'Service added successfully',
      data: newService
    });
  } catch (error) {
    console.error('Error adding service:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding service',
      error: error.message
    });
  }
};

/**
 * Update an existing service
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateService = async (req, res) => {
  try {
    console.log('Update service request received:', {
      body: req.body,
      files: req.files ? Object.keys(req.files).map(key => `${key}: ${req.files[key].length} files`) : 'No files'
    });

    const { email, serviceId } = req.body;
    const serviceData = JSON.parse(req.body.serviceData || '{}');

    if (!email || !serviceId) {
      return res.status(400).json({
        success: false,
        message: 'Email and serviceId are required'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check if the vendor has services
    if (!vendor.services || !Array.isArray(vendor.services)) {
      return res.status(404).json({
        success: false,
        message: 'No services found for this vendor'
      });
    }

    // Find the service to update
    const serviceIndex = vendor.services.findIndex(s => s.id === serviceId);
    
    if (serviceIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Get the existing service
    const existingService = vendor.services[serviceIndex];

    // Handle service image uploads
    let imageUrls = existingService.images || [];
    
    // Handle image deletions if specified
    const deleteImages = req.body.deleteImages ? JSON.parse(req.body.deleteImages) : [];
    if (deleteImages.length > 0) {
      // Delete the specified images from S3
      for (const imageUrl of deleteImages) {
        try {
          await deleteFileFromS3(imageUrl);
          console.log('Deleted image from S3:', imageUrl);
        } catch (error) {
          console.error('Error deleting image from S3:', error);
          // Continue with the update even if image deletion fails
        }
      }
      
      // Filter out the deleted images from the imageUrls array
      imageUrls = imageUrls.filter(img => !deleteImages.includes(img.url));
    }
    
    // Add new images if provided
    if (req.files && req.files.serviceImages) {
      try {
        for (const file of req.files.serviceImages) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            `services/${serviceId}`
          );
          
          imageUrls.push({
            url: s3Url,
            originalName: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
          console.log('Service image uploaded to S3:', s3Url);
        }
      } catch (error) {
        console.error('Error uploading service images to S3:', error);
        // Continue with the service update even if image uploads fail
      }
    }

    // Update the service
    const updatedService = {
      ...existingService,
      ...serviceData,
      images: imageUrls,
      updatedAt: new Date().toISOString()
    };

    // Update the service in the vendor's services array
    const updatedServices = [...vendor.services];
    updatedServices[serviceIndex] = updatedService;
    
    // Update the vendor in DynamoDB
    await DynamoVendor.updateVendor(vendor.id, { services: updatedServices });

    res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      data: updatedService
    });
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating service',
      error: error.message
    });
  }
};

/**
 * Delete a service
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteService = async (req, res) => {
  try {
    const { email, serviceId } = req.body;

    if (!email || !serviceId) {
      return res.status(400).json({
        success: false,
        message: 'Email and serviceId are required'
      });
    }

    // Get the vendor from DynamoDB
    const vendor = await DynamoVendor.getVendorByEmail(email);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check if the vendor has services
    if (!vendor.services || !Array.isArray(vendor.services)) {
      return res.status(404).json({
        success: false,
        message: 'No services found for this vendor'
      });
    }

    // Find the service to delete
    const serviceIndex = vendor.services.findIndex(s => s.id === serviceId);
    
    if (serviceIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Get the service to delete
    const serviceToDelete = vendor.services[serviceIndex];

    // Delete service images from S3
    if (serviceToDelete.images && Array.isArray(serviceToDelete.images)) {
      for (const image of serviceToDelete.images) {
        try {
          if (image.url) {
            await deleteFileFromS3(image.url);
            console.log('Deleted image from S3:', image.url);
          }
        } catch (error) {
          console.error('Error deleting image from S3:', error);
          // Continue with the service deletion even if image deletion fails
        }
      }
    }

    // Remove the service from the vendor's services array
    const updatedServices = vendor.services.filter(s => s.id !== serviceId);
    
    // Update the vendor in DynamoDB
    await DynamoVendor.updateVendor(vendor.id, { services: updatedServices });

    res.status(200).json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting service',
      error: error.message
    });
  }
};