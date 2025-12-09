/**
 * DEPRECATED: This file is no longer used in the application.
 * It has been replaced by DynamoDB implementations.
 * Kept for reference only.
 */

import Vendor from '../models/Vendor.js';
import GoogleUser from '../../../models/GoogleUser.js';
import multer from 'multer';
import nodemailer from 'nodemailer';

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

    if (req.files) {
      if (req.files.uploadDocument) {
        formData.complianceCertifications.uploadDocument = {
          data: req.files.uploadDocument[0].buffer,
          contentType: req.files.uploadDocument[0].mimetype
        };
      }
      if (req.files.isoCertificate) {
        formData.complianceCertifications.isoCertificate = {
          data: req.files.isoCertificate[0].buffer,
          contentType: req.files.isoCertificate[0].mimetype
        };
      }
      if (req.files.additionalDocument) {
        formData.additionalDetails.additionalDocument = {
          data: req.files.additionalDocument[0].buffer,
          contentType: req.files.additionalDocument[0].mimetype
        };
      }
    }

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

    // First try to find by vendorDetails.primaryContactEmail
    let vendor = await Vendor.findOne({ 'vendorDetails.primaryContactEmail': primaryEmail });
    
    // If not found, try to find by email field directly
    if (!vendor) {
      vendor = await Vendor.findOne({ email: primaryEmail });
    }

    if (vendor) {
      // Update existing vendor
      vendor.vendorDetails = formData.vendorDetails;
      vendor.companyDetails = formData.companyDetails;
      vendor.serviceProductDetails = formData.serviceProductDetails;
      vendor.bankDetails = formData.bankDetails;
      vendor.complianceCertifications = formData.complianceCertifications;
      vendor.additionalDetails = formData.additionalDetails;
      vendor.hasFilledForm = isFormComplete;
      
      // Always set status to pending unless it was explicitly approved by an auditor
      // This ensures vendors don't get auto-approved
      if (vendor.status !== 'approved') {
        vendor.status = 'pending';
        console.log(`Setting vendor status to pending: ${primaryEmail}`);
      }
      
      await vendor.save();
    } else {
      // Create new vendor
      vendor = new Vendor({
        ...formData,
        email: primaryEmail,
        name: formData.vendorDetails.primaryContactName,
        uid: null,
        hasFilledForm: isFormComplete,
        status: 'pending',
        role: 'vendor'
      });
      await vendor.save();
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
    
    // If email is provided, fetch a specific vendor
    if (email) {
      // First try to find by vendorDetails.primaryContactEmail
      let vendor = await Vendor.findOne({ 'vendorDetails.primaryContactEmail': email });
      
      // If not found, try to find by email field directly
      if (!vendor) {
        vendor = await Vendor.findOne({ email: email });
      }
      
      if (!vendor) { 
        return res.status(404).json({ success: false, message: 'Vendor not found' });
      }
      
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
        vendor.hasFilledForm = true;
        
        // Ensure status is 'pending' unless explicitly approved by an auditor
        // This fixes the issue of automatic approval
        if (vendor.status !== 'approved') {
          vendor.status = 'pending';
          console.log(`Ensuring vendor status is pending: ${email}`);
        }
        
        await vendor.save();
        console.log(`Updated hasFilledForm to true for vendor: ${email}`);
      }
      
      res.status(200).json({
        success: true,
        data: [vendor] // Return as array for consistency with current frontend
      });
    } 
    // If no email is provided, fetch all vendors (for auditor dashboard)
    else {
      // Get all vendors from Vendor collection
      const vendors = await Vendor.find().sort({ createdAt: -1 });
      
      // Get all users from GoogleUser collection who aren't already in vendors
      // First, get all emails from vendors to avoid duplicates
      const vendorEmails = vendors.map(v => 
        v.email || v.vendorDetails?.primaryContactEmail
      ).filter(Boolean);
      
      // Find GoogleUsers that aren't in the vendors collection
      const googleUsers = await GoogleUser.find({
        email: { $nin: vendorEmails }
      }).sort({ createdAt: -1 });
      
      // Convert GoogleUsers to a format compatible with vendors
      const formattedGoogleUsers = googleUsers.map(user => ({
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
        // Flag to indicate this is from GoogleUser collection
        isGoogleUser: true
      }));
      
      // Combine both collections
      const allUsers = [...vendors, ...formattedGoogleUsers];
      
      console.log(`Fetched ${vendors.length} vendors and ${googleUsers.length} Google users for auditor dashboard`);
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
    const vendorId = req.params.id;
    
    // First get the vendor
    const existingVendor = await Vendor.findById(vendorId);
    
    if (!existingVendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
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
    
    // Check if vendor has filled the form - ensure it's a boolean result
    const hasCompletedForm = Boolean(
      existingVendor.hasFilledForm || 
      (hasValidValues(existingVendor.vendorDetails) &&
       hasValidValues(existingVendor.companyDetails) &&
       hasValidValues(existingVendor.serviceProductDetails) &&
       hasValidValues(existingVendor.bankDetails) &&
       hasValidValues(existingVendor.complianceCertifications) &&
       hasValidValues(existingVendor.additionalDetails) &&
       existingVendor.additionalDetails?.acknowledgment === true)
    );
    
    console.log(`Approving vendor ${vendorId} with hasFilledForm: ${hasCompletedForm}`);
    
    // Update vendor with approval status
    // Note: We're approving regardless of form completion status
    const vendor = await Vendor.findByIdAndUpdate(
      vendorId,
      { 
        status: 'approved', 
        hasFilledForm: hasCompletedForm
      },
      { new: true }
    );
    
    // Send approval email to vendor
    try {
      await transporter.sendMail({
        from: 'virtualspace@caasdiglobal.in',
        to: vendor.vendorDetails.primaryContactEmail || vendor.email,
        subject: 'Vendor Application Approved',
        text: `Dear ${vendor.vendorDetails.primaryContactName || 'Vendor'}, your vendor application has been approved.`,
        html: `<p>Dear ${vendor.vendorDetails.primaryContactName || 'Vendor'},</p><p>Your vendor application has been approved. You can now log in to access your vendor dashboard.</p>`
      });
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
    }
    
    res.status(200).json({ success: true, message: 'Vendor approved', data: vendor });
  } catch (error) {
    console.error('Error approving vendor:', error);
    res.status(500).json({ success: false, message: 'Error approving vendor', error: error.message });
  }
};

export const rejectVendor = async (req, res) => {
  try {
    const vendorId = req.params.id;
    
    // First get the vendor
    const existingVendor = await Vendor.findById(vendorId);
    
    if (!existingVendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
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
    
    // Check if vendor has filled the form - ensure it's a boolean result
    const hasCompletedForm = Boolean(
      existingVendor.hasFilledForm || 
      (hasValidValues(existingVendor.vendorDetails) &&
       hasValidValues(existingVendor.companyDetails) &&
       hasValidValues(existingVendor.serviceProductDetails) &&
       hasValidValues(existingVendor.bankDetails) &&
       hasValidValues(existingVendor.complianceCertifications) &&
       hasValidValues(existingVendor.additionalDetails) &&
       existingVendor.additionalDetails?.acknowledgment === true)
    );
    
    console.log(`Rejecting vendor ${vendorId} with hasFilledForm: ${hasCompletedForm}`);
    
    // Update vendor with rejection status
    // Note: We're rejecting regardless of form completion status
    const vendor = await Vendor.findByIdAndUpdate(
      vendorId,
      { 
        status: 'rejected', 
        hasFilledForm: hasCompletedForm,
        isApproved: false // Sync isApproved
      },
      { new: true }
    );
    
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    try {
      await transporter.sendMail({
        from: 'virtualspace@caasdiglobal.in',
        to: vendor.vendorDetails?.primaryContactEmail || vendor.email,
        subject: 'Vendor Application Rejected',
        text: `Dear ${vendor.vendorDetails?.primaryContactName || vendor.name || 'Vendor'}, your vendor application has been rejected.`,
        html: `<p>Dear ${vendor.vendorDetails?.primaryContactName || vendor.name || 'Vendor'},</p><p>Your vendor application has been rejected.</p>`
      });
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
    }

    res.status(200).json({ success: true, message: 'Vendor rejected and email sent', data: vendor });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error rejecting vendor', error: error.message });
  }
};

export const uploadMiddleware = upload.fields([
  { name: 'uploadDocument', maxCount: 1 },
  { name: 'isoCertificate', maxCount: 1 },
  { name: 'additionalDocument', maxCount: 1 }
]);

// Create a new user/vendor
export const createUser = async (req, res) => {
  try {
    const { email, name, status, hasFilledForm, role } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }
    
    // Check if user already exists in Vendor collection
    let existingVendor = await Vendor.findOne({ 
      $or: [
        { email: email },
        { 'vendorDetails.primaryContactEmail': email }
      ]
    });
    
    if (existingVendor) {
      // Ensure the status is 'pending' unless explicitly approved by an auditor
      // This fixes the issue of automatic approval
      if (existingVendor.status !== 'approved' && status !== 'approved') {
        existingVendor.status = 'pending';
        await existingVendor.save();
        console.log(`Updated existing vendor status to pending: ${email}`);
      }
      
      return res.status(200).json({
        success: true,
        message: 'User already exists',
        data: existingVendor
      });
    }
    
    // Create new vendor
    const newVendor = new Vendor({
      email: email,
      name: name || email.split('@')[0],
      status: status || 'pending',
      hasFilledForm: hasFilledForm || false,
      role: role || 'vendor',
      vendorDetails: {
        primaryContactEmail: email,
        primaryContactName: name || email.split('@')[0]
      },
      companyDetails: {},
      serviceProductDetails: {},
      bankDetails: {},
      complianceCertifications: {},
      additionalDetails: {}
    });
    
    await newVendor.save();
    
    console.log(`Created new vendor: ${email}`);
    
    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: newVendor
    });
  } catch (error) {
    console.error('Error creating user:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message
    });
  }
};

export const checkUserStatus = async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }
    
    console.log(`Checking user status for email: ${email}`);
    
    // First check in vendors collection
    let vendor = await Vendor.findOne({ 'vendorDetails.primaryContactEmail': email });
    
    // If not found by vendorDetails.primaryContactEmail, try by email field
    if (!vendor) {
      vendor = await Vendor.findOne({ email: email });
    }
    
    // If found in vendors collection, return that data
    if (vendor) {
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
      
      // Check if form is complete based on data - ensure it's a boolean result
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
        vendor.hasFilledForm = true;
        
        // Ensure status is 'pending' unless explicitly approved by an auditor
        // This fixes the issue of automatic approval
        if (vendor.status !== 'approved') {
          vendor.status = 'pending';
          console.log(`Ensuring vendor status is pending: ${email}`);
        }
        
        await vendor.save();
        console.log(`Updated hasFilledForm to true for vendor: ${email}`);
      }
      
      console.log(`Found vendor in vendors collection: ${JSON.stringify({
        email: vendor.email || vendor.vendorDetails?.primaryContactEmail,
        status: vendor.status,
        hasFilledForm: vendor.hasFilledForm,
        role: vendor.role
      })}`);
      
      return res.status(200).json({
        success: true,
        source: 'vendors',
        data: {
          email: vendor.email || vendor.vendorDetails?.primaryContactEmail,
          name: vendor.name || vendor.vendorDetails?.primaryContactName,
          status: vendor.status || 'pending',
          hasFilledForm: vendor.hasFilledForm || false,
          role: vendor.role || 'vendor'
        }
      });
    }
    
    // If not found in vendors, check in googleusers collection
    const googleUser = await GoogleUser.findOne({ email: email });
    
    if (googleUser) {
      console.log(`Found user in googleusers collection: ${JSON.stringify({
        email: googleUser.email,
        role: googleUser.role
      })}`);
      
      return res.status(200).json({
        success: true,
        source: 'googleusers',
        data: {
          email: googleUser.email,
          name: googleUser.displayName,
          status: 'pending', // Default status for Google users
          hasFilledForm: false, // Default for Google users
          role: googleUser.role || 'vendor'
        }
      });
    }
    
    console.log(`User not found in any collection: ${email}`);
    
    // If not found in either collection
    return res.status(404).json({
      success: false,
      message: 'User not found in any collection'
    });
    
  } catch (error) {
    console.error('Error checking user status:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking user status',
      error: error.message
    });
  }
};
