/**
 * DEPRECATED: This file is no longer used in the application.
 * It has been replaced by DynamoDB implementations.
 * Kept for reference only.
 */

import express from 'express';
import { 
  submitVendorForm, 
  uploadMiddleware, 
  getVendors, 
  approveVendor, 
  rejectVendor,
  checkUserStatus,
  createUser
} from '../controllers/vendorController.js';
import Vendor from '../models/Vendor.js';

const router = express.Router();

router.post(
  '/submit',
  uploadMiddleware,
  submitVendorForm
);

router.get('/vendors', getVendors);

router.post('/vendors/:id/approve', approveVendor);

router.post('/vendors/:id/reject', rejectVendor);

// New endpoint to check user status across collections
router.get('/user-status', checkUserStatus);

// Endpoint to create a new user/vendor
router.post('/create-user', createUser);

// Test route to check vendor status
router.get('/test-vendor/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    // First try to find by vendorDetails.primaryContactEmail
    let vendor = await Vendor.findOne({ 'vendorDetails.primaryContactEmail': email });
    
    // If not found, try to find by email field directly
    if (!vendor) {
      vendor = await Vendor.findOne({ email: email });
    }
    
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
    // Return vendor details
    res.status(200).json({
      success: true,
      data: {
        id: vendor._id,
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
    const vendors = await Vendor.find();
    
    const vendorSummary = vendors.map(vendor => ({
      id: vendor._id,
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
router.post('/test-update-vendor/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { status, hasFilledForm } = req.body;
    
    // First try to find by vendorDetails.primaryContactEmail
    let vendor = await Vendor.findOne({ 'vendorDetails.primaryContactEmail': email });
    
    // If not found, try to find by email field directly
    if (!vendor) {
      vendor = await Vendor.findOne({ email: email });
    }
    
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    
    // Update vendor status
    if (status) {
      vendor.status = status;
    }
    
    // Update hasFilledForm if provided
    if (hasFilledForm !== undefined) {
      vendor.hasFilledForm = Boolean(hasFilledForm);
    }
    
    await vendor.save();
    
    res.status(200).json({
      success: true,
      message: 'Vendor updated successfully',
      data: {
        id: vendor._id,
        email: vendor.email || vendor.vendorDetails?.primaryContactEmail,
        name: vendor.name || vendor.vendorDetails?.primaryContactName,
        status: vendor.status,
        hasFilledForm: vendor.hasFilledForm
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

export default router;
