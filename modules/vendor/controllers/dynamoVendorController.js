import * as DynamoVendor from '../models/DynamoVendor.js';
import * as DynamoGoogleUser from '../../../models/DynamoGoogleUser.js';
import GoogleUser from '../../../models/GoogleUser.js'; // Keep for backward compatibility during migration
import multer from 'multer';
import nodemailer from 'nodemailer';
import { uploadFileToS3 } from '../../../utils/s3Utils.js';

// Email transport configuration
const transporter = nodemailer.createTransport({
  host: 'smtpout.secureserver.net', // GoDaddy SMTP server
  port: 465,
  secure: true,
  auth: {
    user: 'virtualspace@caasdiglobal.in',
    pass: 'virtualspace@2678'
  }
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

export const submitVendorForm = async (req, res) => {
  try {
    const formData = {
      vendorDetails: JSON.parse(req.body.vendorDetails || '{}'),
      companyDetails: JSON.parse(req.body.companyDetails || '{}'),
      serviceProductDetails: JSON.parse(req.body.serviceProductDetails || '{}'),
      bankDetails: JSON.parse(req.body.bankDetails || '{}'),
      complianceCertifications: JSON.parse(req.body.complianceCertifications || '{}'),
      additionalDetails: JSON.parse(req.body.additionalDetails || '{}')
    };

    // Handle file uploads to S3
    console.log("Processing form submission with files:", {
      hasFiles: !!req.files,
      uploadDocument: req.files?.uploadDocument ? "Present" : "Not present",
      isoCertificate: req.files?.isoCertificate ? "Present" : "Not present",
      additionalDocument: req.files?.additionalDocument ? "Present" : "Not present",
      additionalDocument: req.files?.additionalDocument ? "Present" : "Not present",
      blankCheque: req.files?.blankCheque ? "Present" : "Not present",
      gstCertificate: req.files?.gstCertificate ? "Present" : "Not present",
      panCertificate: req.files?.panCertificate ? "Present" : "Not present"
    });
    
    console.log("Form data before file processing:", {
      uploadDocumentUrl: formData.complianceCertifications.uploadDocument?.url || "Not present",
      isoCertificateUrl: formData.complianceCertifications.isoCertificate?.url || "Not present",
      additionalDocumentUrl: formData.additionalDetails.additionalDocument?.url || "Not present",
      additionalDocumentUrl: formData.additionalDetails.additionalDocument?.url || "Not present",
      blankChequeUrl: formData.bankDetails.blankCheque?.url || "Not present",
      gstCertificateUrl: formData.companyDetails.gstCertificate?.url || "Not present",
      panCertificateUrl: formData.companyDetails.panCertificate?.url || "Not present"
    });
    
    // Upload files to S3 and store URLs in formData
    if (req.files?.uploadDocument) {
      try {
        const file = req.files.uploadDocument[0];
        const s3Url = await uploadFileToS3(
          file.buffer,
          file.originalname,
          file.mimetype,
          'compliance-documents'
        );
        formData.complianceCertifications.uploadDocument = {
          url: s3Url,
          originalName: file.originalname,
          contentType: file.mimetype
        };
        console.log("Successfully uploaded uploadDocument to S3:", s3Url);
      } catch (error) {
        console.error('Error uploading compliance document to S3:', error);
      }
    } else if (formData.complianceCertifications.uploadDocument?.url) {
      // If no file was uploaded but we have a URL, keep the existing URL
      console.log("Using existing uploadDocument URL:", formData.complianceCertifications.uploadDocument.url);
    }
    if (req.files?.blankCheque) {
      try {
        const file = req.files.blankCheque[0];
        const s3Url = await uploadFileToS3(
          file.buffer,
          file.originalname,
          file.mimetype,
          'blank-cheques'
        );
        formData.bankDetails.blankCheque = {
          url: s3Url,
          originalName: file.originalname,
          contentType: file.mimetype
        };
        console.log("Successfully uploaded blankCheque to S3:", s3Url);
      } catch (error) {
        console.error('Error uploading blank cheque to S3:', error);
      }
    } else if (formData.bankDetails.blankCheque?.url) {
      console.log("Using existing blankCheque URL:", formData.bankDetails.blankCheque.url);
    }

    if (req.files?.gstCertificate) {
      try {
        const file = req.files.gstCertificate[0];
        const s3Url = await uploadFileToS3(
          file.buffer,
          file.originalname,
          file.mimetype,
          'gst-certificates'
        );
        formData.companyDetails.gstCertificate = {
          url: s3Url,
          originalName: file.originalname,
          contentType: file.mimetype
        };
        console.log("Successfully uploaded gstCertificate to S3:", s3Url);
      } catch (error) {
        console.error('Error uploading GST certificate to S3:', error);
      }
    } else if (formData.companyDetails.gstCertificate?.url) {
      console.log("Using existing gstCertificate URL:", formData.companyDetails.gstCertificate.url);
    }

    if (req.files?.panCertificate) {
      try {
        const file = req.files.panCertificate[0];
        const s3Url = await uploadFileToS3(
          file.buffer,
          file.originalname,
          file.mimetype,
          'pan-certificates'
        );
        formData.companyDetails.panCertificate = {
          url: s3Url,
          originalName: file.originalname,
          contentType: file.mimetype
        };
        console.log("Successfully uploaded panCertificate to S3:", s3Url);
      } catch (error) {
        console.error('Error uploading PAN certificate to S3:', error);
      }
    } else if (formData.companyDetails.panCertificate?.url) {
      console.log("Using existing panCertificate URL:", formData.companyDetails.panCertificate.url);
    }

    if (req.files?.isoCertificate) {
      try {
        const file = req.files.isoCertificate[0];
        const s3Url = await uploadFileToS3(
          file.buffer,
          file.originalname,
          file.mimetype,
          'iso-certificates'
        );
        formData.complianceCertifications.isoCertificate = {
          url: s3Url,
          originalName: file.originalname,
          contentType: file.mimetype
        };
        console.log("Successfully uploaded isoCertificate to S3:", s3Url);
      } catch (error) {
        console.error('Error uploading ISO certificate to S3:', error);
      }
    } else if (formData.complianceCertifications.isoCertificate?.url) {
      // If no file was uploaded but we have a URL, keep the existing URL
      console.log("Using existing isoCertificate URL:", formData.complianceCertifications.isoCertificate.url);
    }
    
    if (req.files?.additionalDocument) {
      try {
        const file = req.files.additionalDocument[0];
        const s3Url = await uploadFileToS3(
          file.buffer,
          file.originalname,
          file.mimetype,
          'additional-documents'
        );
        formData.additionalDetails.additionalDocument = {
          url: s3Url,
          originalName: file.originalname,
          contentType: file.mimetype
        };
        console.log("Successfully uploaded additionalDocument to S3:", s3Url);
      } catch (error) {
        console.error('Error uploading additional document to S3:', error);
      }
    } else if (formData.additionalDetails.additionalDocument?.url) {
      // If no file was uploaded but we have a URL, keep the existing URL
      console.log("Using existing additionalDocument URL:", formData.additionalDetails.additionalDocument.url);
    }
    
    // Final check of URLs after processing
    console.log("Form data after file processing:", {
      uploadDocumentUrl: formData.complianceCertifications.uploadDocument?.url || "Not present",
      isoCertificateUrl: formData.complianceCertifications.isoCertificate?.url || "Not present",
      additionalDocumentUrl: formData.additionalDetails.additionalDocument?.url || "Not present",
      additionalDocumentUrl: formData.additionalDetails.additionalDocument?.url || "Not present",
      blankChequeUrl: formData.bankDetails.blankCheque?.url || "Not present",
      gstCertificateUrl: formData.companyDetails.gstCertificate?.url || "Not present",
      panCertificateUrl: formData.companyDetails.panCertificate?.url || "Not present"
    });

    // Get the email from the request body or from vendorDetails
    const primaryEmail = req.body.email || formData.vendorDetails.primaryContactEmail;
    
    // Ensure the email is also in vendorDetails
    if (primaryEmail && (!formData.vendorDetails.primaryContactEmail || formData.vendorDetails.primaryContactEmail !== primaryEmail)) {
      formData.vendorDetails.primaryContactEmail = primaryEmail;
    }
    
    console.log(`Form submission for email: ${primaryEmail}`);
    
    // Check if all required form sections have data - ensure it's a boolean result
    // Define a function to check if an object has meaningful values (not just empty strings)
    const hasValidValues = (obj) => {
      if (!obj || typeof obj !== 'object') return false;
      
      // Check if at least some of the values are non-empty strings
      const values = Object.values(obj);
      if (values.length === 0) return false;
      
      // Count how many non-empty string values we have
      const nonEmptyValues = values.filter(val => {
        if (typeof val === 'string') return val.trim().length > 0;
        if (typeof val === 'object' && val !== null) return true; // Consider objects (like file uploads) as valid
        return Boolean(val); // Consider other truthy values as valid
      });
      
      // Consider the section complete if at least 70% of the fields have values
      // This allows for some optional fields to be empty
      return nonEmptyValues.length >= Math.ceil(values.length * 0.7);
    };
    
    // Log the form data for debugging
    console.log('Form submission check:');
    console.log('vendorDetails valid:', hasValidValues(formData.vendorDetails));
    console.log('companyDetails valid:', hasValidValues(formData.companyDetails));
    console.log('serviceProductDetails valid:', hasValidValues(formData.serviceProductDetails));
    console.log('bankDetails valid:', hasValidValues(formData.bankDetails));
    console.log('complianceCertifications valid:', hasValidValues(formData.complianceCertifications));
    console.log('additionalDetails valid:', hasValidValues(formData.additionalDetails));
    
    const isFormComplete = Boolean(
      hasValidValues(formData.vendorDetails) &&
      hasValidValues(formData.companyDetails) &&
      hasValidValues(formData.serviceProductDetails) &&
      hasValidValues(formData.bankDetails) &&
      hasValidValues(formData.complianceCertifications) &&
      hasValidValues(formData.additionalDetails) &&
      formData.additionalDetails.acknowledgment === true // Make sure they've acknowledged the terms
    );
    
    console.log('isFormComplete:', isFormComplete);

    let vendor = await DynamoVendor.getVendorByEmail(primaryEmail);

    if (vendor) {
      // Scenario 1: Vendor already exists. Update it with the new form data.
      console.log(`Updating existing vendor with ID: ${vendor.id}`);
      const updatedVendorData = {
        vendorDetails: formData.vendorDetails,
        companyDetails: formData.companyDetails,
        serviceProductDetails: formData.serviceProductDetails,
        bankDetails: formData.bankDetails,
        complianceCertifications: formData.complianceCertifications,
        additionalDetails: formData.additionalDetails,
        hasFilledForm: isFormComplete,
        status: vendor.status === 'approved' ? 'approved' : 'pending'
      };
      vendor = await DynamoVendor.updateVendor(vendor.id, updatedVendorData);

    } else {
      // Vendor does not exist, so check for a Google User.
      const googleUser = await DynamoGoogleUser.getGoogleUserByEmail(primaryEmail);
      let newVendorData;

      if (googleUser) {
        // Scenario 2: A Google User exists. "Upgrade" them to a full vendor.
        console.log(`Upgrading Google user to vendor: ${primaryEmail}`);
        newVendorData = {
          ...formData,
          email: primaryEmail,
          name: formData.vendorDetails.primaryContactName || googleUser.displayName,
          googleId: googleUser.googleId, // This links the vendor to the Google account
          hasFilledForm: isFormComplete,
          status: 'pending',
          role: googleUser.role || 'vendor'
        };
      } else {
        // Scenario 3: No vendor and no Google user. Create a brand-new vendor.
        console.log(`Creating new vendor from scratch: ${primaryEmail}`);
        newVendorData = {
          ...formData,
          email: primaryEmail,
          name: formData.vendorDetails.primaryContactName,
          hasFilledForm: isFormComplete,
          status: 'pending',
          role: 'vendor'
        };
      }
      vendor = await DynamoVendor.createVendor(newVendorData);
    }

    // Send notification email to auditor
    try {
      await transporter.sendMail({
        from: 'virtualspace@caasdiglobal.in',
        to: 'dhanush@caasdiglobal.in',
        subject: 'New Vendor Submission!',
        text: `New vendor form submitted by ${formData.vendorDetails.primaryContactName}`,
        html: `<p>A new vendor form has been submitted by ${formData.vendorDetails.primaryContactName}</p>
               <p>Email: ${primaryEmail}</p>
               <p>Company: ${formData.companyDetails.companyName || 'Not provided'}</p>`
      });
    } catch (emailError) {
      console.error('Failed to send notification email:', emailError);
    }

    // Send confirmation email to vendor
    try {
      await transporter.sendMail({
        from: 'virtualspace@caasdiglobal.in',
        to: primaryEmail,
        subject: 'Vendor Application Submitted',
        text: `Dear ${formData.vendorDetails.primaryContactName}, your vendor application has been submitted successfully and is pending review.`,
        html: `<p>Dear ${formData.vendorDetails.primaryContactName},</p>
               <p>Your vendor application has been submitted successfully and is pending review.</p>
               <p>You will be notified once your application has been reviewed.</p>`
      });
    } catch (emailError) {
      console.error('Failed to send confirmation email to vendor:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Vendor form submitted successfully',
      data: vendor
    });
  } catch (error) {
    console.error('Submit Vendor Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting vendor form',
      error: error.message
    });
  }
};

export const getVendors = async (req, res) => {
  try {
    const email = req.query.email;
    
    console.log(`getVendors API called with email: ${email || 'none'}`);
    
    // If email is provided, fetch a specific vendor
    if (email) {
      console.log(`Fetching vendor by email: ${email}`);
      let vendor = await DynamoVendor.getVendorByEmail(email);
      
      if (!vendor) { 
        console.log(`No vendor found with email: ${email}, checking Google users...`);
        const googleUser = await DynamoGoogleUser.getGoogleUserByEmail(email);
        if (googleUser) {
          // If a Google user is found, return them in a vendor-like format
          vendor = {
            id: googleUser.id,
            _id: googleUser._id,
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
        return res.status(404).json({ success: false, message: 'Vendor not found' });
      }
      
      console.log(`Found user with email ${email}:`, vendor.id);
      
      // Define a function to check if an object has meaningful values (not just empty strings)
      const hasValidValues = (obj) => {
        if (!obj || typeof obj !== 'object') return false;
        
        // Check if at least some of the values are non-empty strings
        const values = Object.values(obj);
        if (values.length === 0) return false;
        
        // Count how many non-empty string values we have
        const nonEmptyValues = values.filter(val => {
          if (typeof val === 'string') return val.trim().length > 0;
          if (typeof val === 'object' && val !== null) return true; // Consider objects (like file uploads) as valid
          return Boolean(val); // Consider other truthy values as valid
        });
        
        // Consider the section complete if at least 70% of the fields have values
        // This allows for some optional fields to be empty
        return nonEmptyValues.length >= Math.ceil(values.length * 0.7);
      };
      
      // Ensure hasFilledForm is properly set based on data completeness - ensure it's a boolean result
      const hasCompletedForm = Boolean(
        vendor.hasFilledForm || 
        (hasValidValues(vendor.vendorDetails) &&
         hasValidValues(vendor.companyDetails) &&
         hasValidValues(vendor.serviceProductDetails) &&
         hasValidValues(vendor.bankDetails) &&
         hasValidValues(vendor.complianceCertifications) &&
         hasValidValues(vendor.additionalDetails) &&
         vendor.additionalDetails?.acknowledgment === true)
      );
      
      // Update hasFilledForm if needed
      if (hasCompletedForm && !vendor.hasFilledForm) {
        const updatedVendorData = {
          hasFilledForm: true,
          // Ensure status is 'pending' unless explicitly approved by an auditor
          status: vendor.status === 'approved' ? 'approved' : 'pending'
        };
        
        await DynamoVendor.updateVendor(vendor.id, updatedVendorData);
        console.log(`Updated hasFilledForm to true for vendor: ${email}`);
        
        // Update the vendor object for the response
        vendor.hasFilledForm = true;
        if (vendor.status !== 'approved') {
          vendor.status = 'pending';
        }
      }
      
      res.status(200).json({
        success: true,
        data: [vendor] // Return as array for consistency with current frontend
      });
    } 
    // If no email is provided, fetch all vendors (for auditor dashboard)
    else {
      // Get all vendors from DynamoDB
      const vendors = await DynamoVendor.getAllVendors();
      
      // Get all emails from vendors to avoid duplicates
      const vendorEmails = vendors.map(v => 
        v.email || v.vendorDetails?.primaryContactEmail
      ).filter(Boolean);
      
      // Get all Google users from DynamoDB
      const dynamoGoogleUsers = await DynamoGoogleUser.getAllGoogleUsers();
      
      // Filter out Google users whose emails are already in vendors
      const filteredDynamoGoogleUsers = dynamoGoogleUsers.filter(user => 
        !vendorEmails.includes(user.email)
      );
      
      // Convert DynamoDB Google users to a format compatible with vendors
      const formattedDynamoGoogleUsers = filteredDynamoGoogleUsers.map(user => ({
        id: user.id,
        _id: user._id,
        email: user.email,
        name: user.displayName || user.email.split('@')[0],
        status: user.status || 'pending',
        hasFilledForm: user.hasFilledForm || false,
        role: user.role || 'vendor',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        // Add empty objects for the form sections
        vendorDetails: { primaryContactEmail: user.email, primaryContactName: user.displayName },
        companyDetails: {},
        serviceProductDetails: {},
        bankDetails: {},
        complianceCertifications: {},
        additionalDetails: {},
        // Flag to indicate this is from DynamoDB Google users
        isDynamoGoogleUser: true
      }));
      
      // For backward compatibility during migration, also check MongoDB
      // Get all emails from both vendors and DynamoDB Google users
      const allEmails = [...vendorEmails, ...filteredDynamoGoogleUsers.map(u => u.email)].filter(Boolean);
      
      // Find GoogleUsers in MongoDB that aren't in either collection
      const mongoGoogleUsers = await GoogleUser.find({
        email: { $nin: allEmails }
      }).sort({ createdAt: -1 });
      
      // Convert MongoDB GoogleUsers to a format compatible with vendors
      const formattedMongoGoogleUsers = mongoGoogleUsers.map(user => ({
        id: user._id.toString(),
        _id: user._id.toString(),
        email: user.email,
        name: user.displayName || user.email.split('@')[0],
        status: user.status || 'pending',
        hasFilledForm: user.hasFilledForm || false,
        role: user.role || 'vendor',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        // Add empty objects for the form sections
        vendorDetails: { primaryContactEmail: user.email, primaryContactName: user.displayName },
        companyDetails: {},
        serviceProductDetails: {},
        bankDetails: {},
        complianceCertifications: {},
        additionalDetails: {},
        // Flag to indicate this is from MongoDB GoogleUser collection
        isMongoGoogleUser: true
      }));
      
      // Combine all collections
      const allUsers = [...vendors, ...formattedDynamoGoogleUsers, ...formattedMongoGoogleUsers];
      
      // Auto-migrate MongoDB Google users to DynamoDB
      for (const mongoUser of mongoGoogleUsers) {
        try {
          // Check if this user already exists in DynamoDB
          const existingUser = await DynamoGoogleUser.getGoogleUserByGoogleId(mongoUser.googleId);
          
          if (!existingUser) {
            const userData = {
              googleId: mongoUser.googleId,
              cognitoId: mongoUser.cognitoId || null,
              displayName: mongoUser.displayName || '',
              email: mongoUser.email,
              role: mongoUser.role || 'vendor',
              status: mongoUser.status || 'pending',
              hasFilledForm: mongoUser.hasFilledForm || false
            };
            
            await DynamoGoogleUser.createGoogleUser(userData);
            console.log(`Auto-migrated Google user during getVendors: ${mongoUser.email}`);
          }
        } catch (migrationError) {
          console.error(`Error auto-migrating Google user ${mongoUser.email}:`, migrationError);
        }
      }
      
      console.log(`Fetched ${vendors.length} vendors, ${formattedDynamoGoogleUsers.length} DynamoDB Google users, and ${formattedMongoGoogleUsers.length} MongoDB Google users for auditor dashboard`);
      console.log(`Total users: ${allUsers.length}`);
      console.log(`Pending users: ${allUsers.filter(v => v.status === 'pending').length}`);
      console.log(`Approved users: ${allUsers.filter(v => v.status === 'approved').length}`);
      
      res.status(200).json({
        success: true,
        data: allUsers
      });
    }
  } catch (error) {
    console.error('Error in getVendors:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vendors',
      error: error.message
    });
  }
};

export const approveVendor = async (req, res) => {
  try {
    // Get the vendor ID from the request parameters
    let vendorId = req.params.id;
    
    // First get the vendor
    const existingVendor = await DynamoVendor.getVendorById(vendorId);
    
    if (!existingVendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
    // Update the vendor status
    const updatedVendorData = {
      status: 'approved'
    };
    
    const updatedVendor = await DynamoVendor.updateVendor(existingVendor.id, updatedVendorData);
    
    // Send approval email to vendor
    try {
      const vendorEmail = existingVendor.email || existingVendor.vendorDetails?.primaryContactEmail;
      const vendorName = existingVendor.name || existingVendor.vendorDetails?.primaryContactName || 'Vendor';
      
      if (vendorEmail) {
        await transporter.sendMail({
          from: 'virtualspace@caasdiglobal.in',
          to: vendorEmail,
          subject: 'Your Vendor Application Has Been Approved!',
          text: `Dear ${vendorName}, your vendor application has been approved.`,
          html: `<p>Dear ${vendorName},</p>
                 <p>Congratulations! Your vendor application has been approved.</p>
                 <p>You can now access all vendor features on our platform.</p>`
        });
      }
    } catch (emailError) {
      console.error('Failed to send approval email to vendor:', emailError);
    }
    
    res.status(200).json({
      success: true,
      message: 'Vendor approved successfully',
      data: updatedVendor
    });
  } catch (error) {
    console.error('Error approving vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving vendor',
      error: error.message
    });
  }
};

export const rejectVendor = async (req, res) => {
  try {
    // Get the vendor ID from the request parameters
    let vendorId = req.params.id;
    const { reason } = req.body;
    
    // First get the vendor
    const existingVendor = await DynamoVendor.getVendorById(vendorId);
    
    if (!existingVendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
    // Update the vendor status
    const updatedVendorData = {
      status: 'rejected',
      rejectionReason: reason || 'No reason provided'
    };
    
    const updatedVendor = await DynamoVendor.updateVendor(existingVendor.id, updatedVendorData);
    
    // Send rejection email to vendor
    try {
      const vendorEmail = existingVendor.email || existingVendor.vendorDetails?.primaryContactEmail;
      const vendorName = existingVendor.name || existingVendor.vendorDetails?.primaryContactName || 'Vendor';
      
      if (vendorEmail) {
        await transporter.sendMail({
          from: 'virtualspace@caasdiglobal.in',
          to: vendorEmail,
          subject: 'Update on Your Vendor Application',
          text: `Dear ${vendorName}, your vendor application has been reviewed and we regret to inform you that it has been rejected. Reason: ${reason || 'No reason provided'}`,
          html: `<p>Dear ${vendorName},</p>
                 <p>Your vendor application has been reviewed and we regret to inform you that it has been rejected.</p>
                 <p><strong>Reason:</strong> ${reason || 'No reason provided'}</p>
                 <p>If you believe this is an error or would like to provide additional information, please contact our support team.</p>`
        });
      }
    } catch (emailError) {
      console.error('Failed to send rejection email to vendor:', emailError);
    }
    
    res.status(200).json({
      success: true,
      message: 'Vendor rejected successfully',
      data: updatedVendor
    });
  } catch (error) {
    console.error('Error rejecting vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting vendor',
      error: error.message
    });
  }
};

export const deleteVendor = async (req, res) => {
  try {
    // Get the vendor ID from the request parameters
    let vendorId = req.params.id;
    
    // First get the vendor to ensure it exists
    const existingVendor = await DynamoVendor.getVendorById(vendorId);
    
    if (!existingVendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
    // Delete the vendor
    await DynamoVendor.deleteVendor(existingVendor.id);
    
    res.status(200).json({
      success: true,
      message: 'Vendor deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting vendor',
      error: error.message
    });
  }
};