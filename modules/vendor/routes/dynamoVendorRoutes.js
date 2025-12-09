import express from 'express';
import multer from 'multer';
import { 
  submitVendorForm, 
  getVendors, 
  approveVendor, 
  rejectVendor,
  deleteVendor
} from '../controllers/dynamoVendorController.js';
import {
  getServices,
  addService,
  updateService,
  deleteService
} from '../controllers/serviceController.js';
import { uploadFileToS3 } from '../../../utils/s3Utils.js';
import {
  checkUserStatus,
  createUser,
  createOrUpdateGoogleUser
} from '../controllers/dynamoUserController.js';
import * as DynamoVendor from '../models/DynamoVendor.js';
import * as DynamoGoogleUser from '../../../models/DynamoGoogleUser.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware for handling file uploads
const uploadMiddleware = upload.fields([
  { name: 'uploadDocument', maxCount: 1 },
  { name: 'isoCertificate', maxCount: 1 },
  { name: 'additionalDocument', maxCount: 1 }
]);

// Middleware for handling profile image uploads
const profileUploadMiddleware = upload.fields([
  { name: 'profileImage', maxCount: 1 }
]);

// Middleware for handling company certifications uploads
const companyUploadMiddleware = upload.fields([
  { name: 'certifications', maxCount: 10 } // Allow multiple certification files
]);

// Middleware for handling project uploads
const projectUploadMiddleware = upload.fields([
  { name: 'documents', maxCount: 5 }, // Allow up to 5 project documents
  { name: 'photos', maxCount: 5 }     // Allow up to 5 project photos
]);

// Middleware for handling service uploads
const serviceUploadMiddleware = upload.fields([
  { name: 'serviceImages', maxCount: 5 }, // Allow up to 5 service images
  { name: 'servicePdf', maxCount: 1 } // Allow 1 service PDF
]);

router.post(
  '/submit',
  uploadMiddleware,
  submitVendorForm
);

router.get('/vendors', getVendors);

// Get vendor by email (explicit endpoint)
router.get('/vendor-by-email', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }
    
    console.log(`Fetching vendor by email: ${email}`);
    let vendor = await DynamoVendor.getVendorByEmail(email);
    
    // If no vendor, check for an existing Google user
    if (!vendor) {
      console.log(`No vendor found with email ${email}, checking google_users table.`);
      const googleUser = await DynamoGoogleUser.getGoogleUserByEmail(email);
      if (googleUser) {
        // If a Google user is found, return them in a vendor-like format
        // This is crucial for the frontend to get a vendorId/id even for non-vendors
        vendor = {
          id: googleUser.id,
          _id: googleUser._id,
          vendorId: googleUser.id, // Use the google user ID as vendorId
          email: googleUser.email,
          name: googleUser.displayName || googleUser.email.split('@')[0],
          status: googleUser.status || 'pending',
          hasFilledForm: googleUser.hasFilledForm || false,
          role: googleUser.role || 'vendor',
          isGoogleUser: true // Flag to indicate this is a Google user
        };
      }
    }
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: vendor // Return the vendor object directly
    });
  } catch (error) {
    console.error('Error fetching vendor by email:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vendor',
      error: error.message
    });
  }
});

// Get vendor by ID (explicit endpoint)
router.get('/vendor/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }
    
    console.log(`Fetching vendor by ID: ${id}`);
    const vendor = await DynamoVendor.getVendorById(id);
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    res.status(200).json(vendor); // Return the vendor object directly
  } catch (error) {
    console.error('Error fetching vendor by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vendor',
      error: error.message
    });
  }
});

// Get all vendors (simplified endpoint for dropdowns)
router.get('/all', async (req, res) => {
  try {
    const vendors = await DynamoVendor.getAllVendors();
    
    // Map to a simplified format for dropdowns
    const simplifiedVendors = vendors.map(vendor => ({
      id: vendor.id || vendor.vendorId,
      _id: vendor._id,
      name: vendor.vendorDetails?.companyName || 
            vendor.companyDetails?.companyName || 
            vendor.vendorDetails?.primaryContactName || 
            vendor.name || 
            'Unknown Vendor',
      email: vendor.vendorDetails?.primaryContactEmail || vendor.email,
      status: vendor.status
    }));
    
    res.status(200).json(simplifiedVendors);
  } catch (error) {
    console.error('Error fetching all vendors:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vendors',
      error: error.message
    });
  }
});

// Handle both id and _id for backward compatibility
router.post('/vendors/:id/approve', approveVendor);

// Handle both id and _id for backward compatibility
router.post('/vendors/:id/reject', rejectVendor);

// Handle both id and _id for backward compatibility
router.delete('/vendors/:id', deleteVendor);

// New endpoint to check user status across collections
router.get('/user-status', checkUserStatus);

// Endpoint to create a new user/vendor
router.post('/create-user', createUser);

// Endpoint to create or update a Google user
router.post('/google-user', createOrUpdateGoogleUser);

// Endpoint to update company details
router.post('/update-company', companyUploadMiddleware, async (req, res) => {
  try {
    console.log('Update company request received:', {
      body: req.body,
      files: req.files ? Object.keys(req.files) : 'No files'
    });

    // Parse the JSON data from the request
    const companyDetails = JSON.parse(req.body.companyDetails || '{}');
    const vendorDetails = JSON.parse(req.body.vendorDetails || '{}');
    
    // Get the vendorId and email from vendorDetails to identify the vendor
    const vendorId = vendorDetails.vendorId;
    const email = vendorDetails.primaryContactEmail;
    
    if (!vendorId && !email) {
      return res.status(400).json({
        success: false,
        message: 'Either vendorId or email is required to update company details'
      });
    }
    
    // Find the vendor by vendorId first, then by email if vendorId is not provided
    let vendor;
    if (vendorId) {
      console.log(`Finding vendor by ID: ${vendorId}`);
      vendor = await DynamoVendor.getVendorById(vendorId);
    }
    
    // If vendor not found by ID or ID not provided, try email
    if (!vendor && email) {
      console.log(`Finding vendor by email: ${email}`);
      vendor = await DynamoVendor.getVendorByEmail(email);
    }
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    // Prepare the update data
    const updateData = {
      companyDetails: {
        ...vendor.companyDetails,
        ...companyDetails
      }
    };
    
    // Handle certification file uploads if provided
    if (req.files && req.files.certifications) {
      try {
        const certificationUrls = [];
        
        // Upload each certification file to S3
        for (const file of req.files.certifications) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            'company-certifications'
          );
          
          certificationUrls.push({
            url: s3Url,
            originalName: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
          console.log('Certification file uploaded to S3:', s3Url);
        }
        
        // Add the certification URLs to the update data
        // If there are existing certifications, append the new ones
        if (updateData.companyDetails.certifications) {
          updateData.companyDetails.certifications = [
            ...updateData.companyDetails.certifications,
            ...certificationUrls
          ];
        } else {
          updateData.companyDetails.certifications = certificationUrls;
        }
      } catch (error) {
        console.error('Error uploading certification files to S3:', error);
        // Continue with the update even if the file uploads fail
      }
    }
    
    // Use the vendor's ID from the database for the update
    const vendorIdToUse = vendor.id || vendor.vendorId;
    console.log(`Updating vendor with ID: ${vendorIdToUse}`);
    
    // Update the vendor in DynamoDB
    const updatedVendor = await DynamoVendor.updateVendor(vendorIdToUse, updateData);
    
    res.status(200).json({
      success: true,
      message: 'Company details updated successfully',
      data: updatedVendor
    });
  } catch (error) {
    console.error('Error updating company details:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating company details',
      error: error.message
    });
  }
});

// Endpoint to update vendor profile
router.post('/update-profile', profileUploadMiddleware, async (req, res) => {
  try {
    console.log('Update profile request received:', {
      body: req.body,
      files: req.files ? Object.keys(req.files) : 'No files'
    });

    // Parse the JSON data from the request
    const vendorDetails = JSON.parse(req.body.vendorDetails || '{}');
    const companyDetails = JSON.parse(req.body.companyDetails || '{}');
    
    // Get the vendorId and email from vendorDetails to identify the vendor
    const vendorId = vendorDetails.vendorId;
    const email = vendorDetails.primaryContactEmail;
    
    if (!vendorId && !email) {
      return res.status(400).json({
        success: false,
        message: 'Either vendorId or email is required to update profile'
      });
    }
    
    // Find the vendor by vendorId first, then by email if vendorId is not provided
    let vendor;
    if (vendorId) {
      console.log(`Finding vendor by ID: ${vendorId}`);
      vendor = await DynamoVendor.getVendorById(vendorId);
    }
    
    // If vendor not found by ID or ID not provided, try email
    if (!vendor && email) {
      console.log(`Finding vendor by email: ${email}`);
      vendor = await DynamoVendor.getVendorByEmail(email);
    }
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    // Prepare the update data
    const updateData = {
      vendorDetails: {
        ...vendor.vendorDetails,
        ...vendorDetails
      },
      companyDetails: {
        ...vendor.companyDetails,
        ...companyDetails
      }
    };
    
    // Handle profile image upload if provided
    if (req.files && req.files.profileImage) {
      try {
        const file = req.files.profileImage[0];
        const s3Url = await uploadFileToS3(
          file.buffer,
          file.originalname,
          file.mimetype,
          'profile-images'
        );
        
        // Add the profile image URL to the update data
        updateData.profileImage = {
          url: s3Url,
          originalName: file.originalname,
          contentType: file.mimetype,
          uploadedAt: new Date().toISOString()
        };
        
        console.log('Profile image uploaded to S3:', s3Url);
      } catch (error) {
        console.error('Error uploading profile image to S3:', error);
        // Continue with the update even if the image upload fails
      }
    }
    
    // Use the vendor's ID from the database for the update
    const vendorIdToUse = vendor.id || vendor.vendorId;
    console.log(`Updating vendor profile with ID: ${vendorIdToUse}`);
    
    // Update the vendor in DynamoDB
    const updatedVendor = await DynamoVendor.updateVendor(vendorIdToUse, updateData);
    
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedVendor
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message
    });
  }
});

// Test route to check vendor status
router.get('/test-vendor/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const vendor = await DynamoVendor.getVendorByEmail(email);
    
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
    // Return vendor details
    res.status(200).json({
      success: true,
      data: {
        id: vendor.id,
        email: vendor.email || vendor.vendorDetails?.primaryContactEmail,
        name: vendor.name || vendor.vendorDetails?.primaryContactName,
        status: vendor.status,
        hasFilledForm: vendor.hasFilledForm,
        vendorDetailsExists: Boolean(vendor.vendorDetails && Object.keys(vendor.vendorDetails).length > 0),
        companyDetailsExists: Boolean(vendor.companyDetails && Object.keys(vendor.companyDetails).length > 0),
        serviceProductDetailsExists: Boolean(vendor.serviceProductDetails && Object.keys(vendor.serviceProductDetails).length > 0),
        bankDetailsExists: Boolean(vendor.bankDetails && Object.keys(vendor.bankDetails).length > 0),
        complianceCertificationsExists: Boolean(vendor.complianceCertifications && Object.keys(vendor.complianceCertifications).length > 0),
        additionalDetailsExists: Boolean(vendor.additionalDetails && Object.keys(vendor.additionalDetails).length > 0)
      }
    });
  } catch (error) {
    console.error('Error in test-vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vendor',
      error: error.message
    });
  }
});

// Test route to check all vendors
router.get('/test-all-vendors', async (req, res) => {
  try {
    const vendors = await DynamoVendor.getAllVendors();
    
    const vendorSummary = vendors.map(vendor => ({
      id: vendor.id,
      email: vendor.email || vendor.vendorDetails?.primaryContactEmail,
      name: vendor.name || vendor.vendorDetails?.primaryContactName,
      status: vendor.status,
      hasFilledForm: vendor.hasFilledForm,
      createdAt: vendor.createdAt
    }));
    
    res.status(200).json({
      success: true,
      count: vendors.length,
      pendingCount: vendors.filter(v => v.status === 'pending').length,
      approvedCount: vendors.filter(v => v.status === 'approved').length,
      rejectedCount: vendors.filter(v => v.status === 'rejected').length,
      data: vendorSummary
    });
  } catch (error) {
    console.error('Error in test-all-vendors:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vendors',
      error: error.message
    });
  }
});

// Test route to update vendor status
router.post('/test-update-vendor/:id', async (req, res) => {
  try {
    // Get the vendor ID from the request parameters
    let vendorId = req.params.id;
    const { status, hasFilledForm } = req.body;
    
    const vendor = await DynamoVendor.getVendorById(vendorId);
    
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
    // Prepare update data
    const updateData = {};
    
    // Update vendor status
    if (status) {
      updateData.status = status;
    }
    
    // Update hasFilledForm if provided
    if (hasFilledForm !== undefined) {
      updateData.hasFilledForm = Boolean(hasFilledForm);
    }
    
    const updatedVendor = await DynamoVendor.updateVendor(vendor.id, updateData);
    
    res.status(200).json({
      success: true,
      message: 'Vendor updated successfully',
      data: {
        id: updatedVendor.id,
        email: updatedVendor.email || updatedVendor.vendorDetails?.primaryContactEmail,
        name: updatedVendor.name || updatedVendor.vendorDetails?.primaryContactName,
        status: updatedVendor.status,
        hasFilledForm: updatedVendor.hasFilledForm
      }
    });
  } catch (error) {
    console.error('Error in test-update-vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating vendor',
      error: error.message
    });
  }
});

// Project endpoints

// Get all projects for a vendor by email
router.get('/projects', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required to fetch projects'
      });
    }
    
    // Find the vendor by email
    const vendor = await DynamoVendor.getVendorByEmail(email);
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    // Return the projects array or an empty array if it doesn't exist
    const projects = vendor.projects || [];
    
    res.status(200).json({
      success: true,
      message: 'Projects fetched successfully',
      data: projects
    });
  } catch (error) {
    console.error('Error fetching projects by email:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching projects',
      error: error.message
    });
  }
});

// Get all projects for a vendor by ID
router.get('/projects/vendor/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required to fetch projects'
      });
    }
    
    // Find the vendor by ID
    const vendor = await DynamoVendor.getVendorById(vendorId);
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    // Return the projects array or an empty array if it doesn't exist
    const projects = vendor.projects || [];
    
    // Return directly as array for consistency with other endpoints
    res.status(200).json(projects);
  } catch (error) {
    console.error('Error fetching projects by vendor ID:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching projects',
      error: error.message
    });
  }
});

// Service endpoints

// Get all services for a vendor
router.get('/services', getServices);

// Add a new service
router.post('/services', serviceUploadMiddleware, addService);

// Update a service
router.put('/services', serviceUploadMiddleware, updateService);

// Delete a service
router.delete('/services', deleteService);

// Add a new project
router.post('/projects', projectUploadMiddleware, async (req, res) => {
  try {
    console.log('Add project request received:', {
      body: req.body,
      files: req.files ? Object.keys(req.files) : 'No files'
    });
    
    // Parse the project data from the request
    const projectData = JSON.parse(req.body.projectData || '{}');
    
    // Get the vendor ID or email to identify the vendor
    const vendorId = projectData.vendorId;
    const email = projectData.vendorEmail;
    
    if (!vendorId && !email) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID or email is required to add a project'
      });
    }
    
    let vendor;
    
    // Prefer using vendor ID if available
    if (vendorId) {
      console.log(`Finding vendor by ID: ${vendorId}`);
      vendor = await DynamoVendor.getVendorById(vendorId);
    } else {
      console.log(`Finding vendor by email: ${email}`);
      vendor = await DynamoVendor.getVendorByEmail(email);
    }
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    // Create a new project object
    const newProject = {
      _id: Date.now().toString(), // Generate a unique ID
      ...projectData,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documents: [],
      photos: []
    };
    
    // Handle document uploads if provided
    if (req.files && req.files.documents) {
      try {
        const documentUrls = [];
        
        // Upload each document to S3
        for (const file of req.files.documents) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            'project-documents'
          );
          
          documentUrls.push({
            url: s3Url,
            name: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
          console.log('Project document uploaded to S3:', s3Url);
        }
        
        // Add the document URLs to the project
        newProject.documents = documentUrls;
      } catch (error) {
        console.error('Error uploading project documents to S3:', error);
        // Continue with the project creation even if the document uploads fail
      }
    }
    
    // Handle photo uploads if provided
    if (req.files && req.files.photos) {
      try {
        const photoUrls = [];
        
        // Upload each photo to S3
        for (const file of req.files.photos) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            'project-photos'
          );
          
          photoUrls.push({
            url: s3Url,
            name: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
          console.log('Project photo uploaded to S3:', s3Url);
        }
        
        // Add the photo URLs to the project
        newProject.photos = photoUrls;
      } catch (error) {
        console.error('Error uploading project photos to S3:', error);
        // Continue with the project creation even if the photo uploads fail
      }
    }
    
    // Add the new project to the vendor's projects array
    const projects = vendor.projects || [];
    projects.push(newProject);
    
    // Update the vendor in DynamoDB
    const updatedVendor = await DynamoVendor.updateVendor(vendor.id, { projects });
    
    res.status(201).json({
      success: true,
      message: 'Project added successfully',
      data: newProject
    });
  } catch (error) {
    console.error('Error adding project:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding project',
      error: error.message
    });
  }
});

// Update an existing project
router.put('/projects/:id', projectUploadMiddleware, async (req, res) => {
  try {
    console.log('Update project request received:', {
      body: req.body,
      files: req.files ? Object.keys(req.files) : 'No files',
      params: req.params
    });
    
    const projectId = req.params.id;
    
    // Parse the project data from the request
    const projectData = JSON.parse(req.body.projectData || '{}');
    
    // Get the email to identify the vendor
    const email = projectData.vendorEmail;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Vendor email is required to update a project'
      });
    }
    
    // Find the vendor by email
    const vendor = await DynamoVendor.getVendorByEmail(email);
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    // Find the project in the vendor's projects array
    const projects = vendor.projects || [];
    const projectIndex = projects.findIndex(p => p._id === projectId);
    
    if (projectIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }
    
    // Get the existing project
    const existingProject = projects[projectIndex];
    
    // Create an updated project object
    const updatedProject = {
      ...existingProject,
      ...projectData,
      updatedAt: new Date().toISOString()
    };
    
    // Handle document uploads if provided
    if (req.files && req.files.documents) {
      try {
        const documentUrls = [];
        
        // Upload each document to S3
        for (const file of req.files.documents) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            'project-documents'
          );
          
          documentUrls.push({
            url: s3Url,
            name: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
          console.log('Project document uploaded to S3:', s3Url);
        }
        
        // Add the new document URLs to the existing documents
        updatedProject.documents = [
          ...(existingProject.documents || []),
          ...documentUrls
        ];
      } catch (error) {
        console.error('Error uploading project documents to S3:', error);
        // Continue with the project update even if the document uploads fail
      }
    }
    
    // Handle photo uploads if provided
    if (req.files && req.files.photos) {
      try {
        const photoUrls = [];
        
        // Upload each photo to S3
        for (const file of req.files.photos) {
          const s3Url = await uploadFileToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            'project-photos'
          );
          
          photoUrls.push({
            url: s3Url,
            name: file.originalname,
            contentType: file.mimetype,
            uploadedAt: new Date().toISOString()
          });
          
          console.log('Project photo uploaded to S3:', s3Url);
        }
        
        // Add the new photo URLs to the existing photos
        updatedProject.photos = [
          ...(existingProject.photos || []),
          ...photoUrls
        ];
      } catch (error) {
        console.error('Error uploading project photos to S3:', error);
        // Continue with the project update even if the photo uploads fail
      }
    }
    
    // Update the project in the projects array
    projects[projectIndex] = updatedProject;
    
    // Update the vendor in DynamoDB
    const updatedVendor = await DynamoVendor.updateVendor(vendor.id, { projects });
    
    res.status(200).json({
      success: true,
      message: 'Project updated successfully',
      data: updatedProject
    });
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating project',
      error: error.message
    });
  }
});

// Delete a project
router.delete('/projects/:id', async (req, res) => {
  try {
    const projectId = req.params.id;
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Vendor email is required to delete a project'
      });
    }
    
    // Find the vendor by email
    const vendor = await DynamoVendor.getVendorByEmail(email);
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }
    
    // Find the project in the vendor's projects array
    const projects = vendor.projects || [];
    const projectIndex = projects.findIndex(p => p._id === projectId);
    
    if (projectIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }
    
    // Remove the project from the projects array
    projects.splice(projectIndex, 1);
    
    // Update the vendor in DynamoDB
    const updatedVendor = await DynamoVendor.updateVendor(vendor.id, { projects });
    
    res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting project',
      error: error.message
    });
  }
});

export default router;