import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
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
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { listProductsByVendorId } from '../models/DynamoProducts.js';
import { getPMProjectsByVendorId } from '../../pm/models/DynamoPMProject.js';
import { getRevenueForecasting, getCohortAnalysis } from '../../workspace/controllers/subscriptionAnalyticsController.js';
import { generateSharedProfilePdf } from '../services/sharedProfilePdfService.js';

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

router.get('/vendors', authenticateCognitoJwt, getVendors);

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

// Get current vendor based on authenticated JWT (secure endpoint)
router.get('/me', authenticateCognitoJwt, async (req, res) => {
  try {
    const rawEmail = req.auth?.email;
    if (!rawEmail) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }
    // Cognito JWTs preserve the email case entered at registration, but vendor
    // records are stored with normalised (lowercase) email by set-role.
    // Use lowercase here so the DynamoDB scan's case-sensitive FilterExpression
    // matches the stored record instead of falling through to the RBAC removal check.
    const email = String(rawEmail).trim().toLowerCase();

    console.log(`Fetching current vendor for email: ${email}`);
    let vendor = await DynamoVendor.getVendorByEmail(email);

    // ── Team member check (runs BEFORE google_users fallback) ──
    // Team members don't have their own vendor record. They share the org's
    // vendorId/clientId. Resolve via rbac_members using their Cognito sub.
    // This MUST run before the google_users fallback so stale google_user
    // records from earlier /set-role flows don't shadow team member data.
    if (!vendor) {
      const userId = req.auth?.sub;
      if (userId) {
        try {
          const { DynamoDBDocumentClient, QueryCommand, GetCommand: GCmd } = await import('@aws-sdk/lib-dynamodb');
          const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
          const _ddb = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
          const _doc = DynamoDBDocumentClient.from(_ddb);
          const MEMBERS_TABLE = process.env.RBAC_MEMBERS_TABLE || 'rbac_members';
          const VENDORS_TABLE_NAME = process.env.VENDORS_TABLE || 'vendors';

          // Find the user's active membership
          const memberResult = await _doc.send(new QueryCommand({
            TableName: MEMBERS_TABLE,
            IndexName: 'UserOrgsIndex',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId },
            ProjectionExpression: 'orgId, #s, displayName, roleName',
            ExpressionAttributeNames: { '#s': 'status' },
            Limit: 5,
          }));

          const activeMembership = memberResult.Items?.find(m => m.status === 'active');
          if (activeMembership?.orgId) {
            // Fetch the org owner's vendor record by orgId (= vendorId PK)
            const orgVendorResult = await _doc.send(new GCmd({
              TableName: VENDORS_TABLE_NAME,
              Key: { vendorId: activeMembership.orgId },
            }));

            if (orgVendorResult.Item) {
              const orgVendor = orgVendorResult.Item;
              // Return org's vendor data but mark as team member
              return res.status(200).json({
                success: true,
                data: {
                  ...orgVendor,
                  vendorId: orgVendor.vendorId,
                  email: email, // Use the team member's own email
                  name: activeMembership.displayName || email.split('@')[0],
                  status: 'approved', // Team members are pre-approved
                  hasFilledForm: true, // Skip onboarding forms
                  isTeamMember: true,
                  memberRole: activeMembership.roleName,
                  parentOrgId: activeMembership.orgId,
                },
              });
            }
          }
        } catch (memberErr) {
          console.warn('[/me] Team member lookup failed:', memberErr?.message);
        }
      }
    }

    // If no vendor and not a team member, check for an existing Google user (fallback).
    // BUT first, check if the user was removed from RBAC — blocked users must NOT
    // get a valid response via google_users, otherwise VendorContext hydrates and
    // the removed user sees the dashboard during the RBAC loading window.
    if (!vendor) {
      const userId = req.auth?.sub;
      if (userId) {
        try {
          const { DynamoDBDocumentClient: DocC2, QueryCommand: QC2 } = await import('@aws-sdk/lib-dynamodb');
          const { DynamoDBClient: DC2 } = await import('@aws-sdk/client-dynamodb');
          const _ddb2 = new DC2({ region: process.env.AWS_REGION || 'us-east-1' });
          const _doc2 = DocC2.from(_ddb2);
          const MEM_TABLE = process.env.RBAC_MEMBERS_TABLE || 'rbac_members';
          const removedResult = await _doc2.send(new QC2({
            TableName: MEM_TABLE,
            IndexName: 'UserOrgsIndex',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId },
            ProjectionExpression: '#s, suspendedUntil, suspensionReason',
            ExpressionAttributeNames: { '#s': 'status' },
            Limit: 10,
          }));
          const hasRemovedRecord = removedResult.Items?.some(m => m.status === 'removed');
          const hasActiveRecord = removedResult.Items?.some(m => m.status === 'active');
          console.log(`[/me] RBAC removal check for userId=${userId} email=${email}: items=${removedResult.Items?.length}, hasRemoved=${hasRemovedRecord}, hasActive=${hasActiveRecord}`);
          const activeSuspensions = (removedResult.Items || []).filter((m) => {
            if (m.status !== 'suspended') return false;
            const untilMs = m.suspendedUntil ? Date.parse(m.suspendedUntil) : NaN;
            return !Number.isFinite(untilMs) || untilMs > Date.now();
          });

          if (activeSuspensions.length > 0 && !hasActiveRecord) {
            const blocked = activeSuspensions
              .slice()
              .sort((a, b) => {
                const aMs = a.suspendedUntil ? Date.parse(a.suspendedUntil) : Number.POSITIVE_INFINITY;
                const bMs = b.suspendedUntil ? Date.parse(b.suspendedUntil) : Number.POSITIVE_INFINITY;
                return aMs - bMs;
              })[0];

            const untilMs = blocked?.suspendedUntil ? Date.parse(blocked.suspendedUntil) : NaN;
            let periodText = 'until it is manually lifted';
            if (Number.isFinite(untilMs)) {
              const remainingMs = Math.max(0, untilMs - Date.now());
              const totalMinutes = Math.ceil(remainingMs / 60000);
              const days = Math.floor(totalMinutes / (24 * 60));
              const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
              const minutes = totalMinutes % 60;
              const pieces = [];
              if (days > 0) pieces.push(`${days}d`);
              if (hours > 0) pieces.push(`${hours}h`);
              if (minutes > 0 || pieces.length === 0) pieces.push(`${minutes}m`);
              periodText = `until ${new Date(untilMs).toLocaleString('en-IN')} (${pieces.join(' ')} remaining)`;
            }

            const reasonText = blocked?.suspensionReason
              ? ` Reason: ${String(blocked.suspensionReason).trim()}`
              : '';

            return res.status(403).json({
              success: false,
              code: 'RBAC_002',
              message: `Your account has been suspended ${periodText}.${reasonText} Contact the org administrator.`,
            });
          }

          if (hasRemovedRecord && !hasActiveRecord) {
            return res.status(403).json({
              success: false,
              code: 'RBAC_001',
              message: 'You have been removed from this organization.',
            });
          }
        } catch (checkErr) {
          console.warn('[/me] Removal status check failed:', checkErr?.message);
        }
      }

      const googleUser = await DynamoGoogleUser.getGoogleUserByEmail(email);
      if (googleUser) {
        vendor = {
          id: googleUser.id,
          _id: googleUser._id,
          vendorId: googleUser.id,
          email: googleUser.email,
          name: googleUser.displayName || googleUser.email.split('@')[0],
          status: googleUser.status || 'pending',
          hasFilledForm: googleUser.hasFilledForm || false,
          role: googleUser.role || 'vendor',
          isGoogleUser: true
        };
      }
    }

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Ensure hasFilledForm is accurate even if older records never had it set.
    // Previously this was often computed/updated via the /vendors?email flow.
    const hasValidValues = (obj) => {
      if (!obj || typeof obj !== 'object') return false;
      const values = Object.values(obj);
      if (values.length === 0) return false;
      const nonEmptyValues = values.filter((val) => {
        if (typeof val === 'string') return val.trim().length > 0;
        if (typeof val === 'object' && val !== null) return true;
        return Boolean(val);
      });
      return nonEmptyValues.length >= Math.ceil(values.length * 0.7);
    };

    const computedHasFilledForm = Boolean(
      vendor.hasFilledForm ||
        (hasValidValues(vendor.vendorDetails) &&
          hasValidValues(vendor.companyDetails) &&
          hasValidValues(vendor.serviceProductDetails) &&
          hasValidValues(vendor.bankDetails) &&
          hasValidValues(vendor.complianceCertifications) &&
          hasValidValues(vendor.additionalDetails) &&
          vendor.additionalDetails?.acknowledgment === true)
    );

    if (computedHasFilledForm && !vendor.hasFilledForm && !vendor.isGoogleUser) {
      try {
        const nextStatus = vendor.status === 'approved' ? 'approved' : 'pending';
        await DynamoVendor.updateVendor(vendor.id, {
          hasFilledForm: true,
          status: nextStatus,
        });
        vendor.hasFilledForm = true;
        vendor.status = nextStatus;
      } catch (e) {
        console.warn('Failed to persist hasFilledForm update for vendor:', e?.message || e);
        vendor.hasFilledForm = computedHasFilledForm;
      }
    } else {
      vendor.hasFilledForm = computedHasFilledForm;
    }

    // ─────────────────────────────────────────────
    // Include MFA status in vendor response
    // ─────────────────────────────────────────────
    const vendorResponse = {
      ...vendor,
      totpEnabled: vendor.totpEnabled === true,
      passkeyEnabled: vendor.passkeyEnabled === true,
      mfaEnabled: (vendor.totpEnabled === true) || (vendor.passkeyEnabled === true)
    };

    return res.status(200).json({
      success: true,
      data: vendorResponse
    });
  } catch (error) {
    console.error('Error fetching current vendor:', error);
    return res.status(500).json({
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

// Get vendor for shared/public profile (for /shared-profile/:vendorId page)
router.get('/shared/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }

    console.log(`Fetching shared profile for vendor ID: ${vendorId}`);
    const vendor = await DynamoVendor.getVendorById(vendorId);
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // DEBUG: Log services information
    console.log(`📦 Vendor returned from getVendorById - Services info:`);
    console.log(`   - vendor.services exists: ${!!vendor.services}`);
    console.log(`   - vendor.services is array: ${Array.isArray(vendor.services)}`);
    console.log(`   - vendor.services length: ${vendor.services ? vendor.services.length : 0}`);
    if (vendor.services && vendor.services.length > 0) {
      console.log(`   - First service: ${JSON.stringify(vendor.services[0], null, 2)}`);
      console.log(`   - All service IDs: ${vendor.services.map(s => s.id || s.name).join(', ')}`);
    }

    // Fetch products for this vendor
    const products = await listProductsByVendorId(vendorId);
    console.log(`Found ${products ? products.length : 0} products for vendor ${vendorId}`);

    // Fetch portfolio projects from vendor.projects (case studies)
    const portfolioProjects = vendor.projects || [];
    console.log(`Found ${portfolioProjects ? portfolioProjects.length : 0} portfolio projects for vendor ${vendorId}`);

    // Fetch ongoing PM projects for this vendor with error handling
    let ongoingProjects = [];
    try {
      ongoingProjects = await getPMProjectsByVendorId(vendorId);
      console.log(`✅ Found ${ongoingProjects ? ongoingProjects.length : 0} ongoing PM projects for vendor ${vendorId}`);
    } catch (pmError) {
      console.error(`❌ Error fetching PM projects for vendor ${vendorId}:`, pmError.message);
      // Continue with empty ongoing projects if fetch fails
      ongoingProjects = [];
    }

    // Combine both types of projects: portfolio (case studies) + ongoing PM projects
    const allProjects = [
      ...portfolioProjects.map(p => ({ ...p, type: 'portfolio' })),
      ...ongoingProjects.map(p => ({ ...p, type: 'ongoing' }))
    ];
    
    console.log(`📊 Project summary: ${portfolioProjects.length} portfolio + ${ongoingProjects.length} ongoing = ${allProjects.length} total`);

    // DEBUG: Log GST and PAN information
    console.log(`💼 Vendor GST/PAN info:`, {
      gstNumber: vendor.companyDetails?.gstNumber || 'NOT SET',
      panNumber: vendor.companyDetails?.panNumber || 'NOT SET'
    });

    // Add products and combined projects to the vendor data before returning
    const vendorWithData = {
      ...vendor,
      products: products || [],
      projects: allProjects,
      portfolioProjects: portfolioProjects,
      ongoingProjects: ongoingProjects
    };

    // DEBUG: Log final response services
    console.log(`📤 Final response - Services count: ${vendorWithData.services ? vendorWithData.services.length : 0}`);

    // Return vendor data in the expected format for SharedProfile component
    res.status(200).json({
      success: true,
      data: vendorWithData
    });
  } catch (error) {
    console.error('Error fetching shared profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching shared profile',
      error: error.message
    });
  }
});

router.get('/shared/:vendorId/pdf', async (req, res) => {
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }

    const pdfBuffer = await generateSharedProfilePdf({
      vendorId,
      requestOrigin: req.get('origin'),
      requestReferer: req.get('referer'),
      query: req.query
    });

    const fileName = `${vendorId}_Portfolio.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error('Error generating shared profile PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating shared profile PDF',
      error: error.message
    });
  }
});

// Save visitor information when they submit the shared profile form
router.post('/save-visitor', async (req, res) => {
  try {
    const { vendorId, visitorName, visitorCompany, visitorPhone, visitorState, visitorCountry, visitedAt } = req.body;

    if (!vendorId || !visitorName || !visitorCompany || !visitorPhone) {
      return res.status(400).json({
        success: false,
        message: 'Missing required visitor information'
      });
    }

    console.log(`Saving visitor for vendor ${vendorId}:`, { visitorName, visitorCompany, visitorPhone });

    // Get the vendor
    const vendor = await DynamoVendor.getVendorById(vendorId);
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Initialize visitors array if it doesn't exist
    if (!vendor.visitors) {
      vendor.visitors = [];
    }

    // Add new visitor
    const visitorRecord = {
      id: `visitor_${Date.now()}`,
      visitorName,
      visitorCompany,
      visitorPhone,
      visitorState,
      visitorCountry,
      visitedAt: visitedAt || new Date().toISOString()
    };

    vendor.visitors.push(visitorRecord);

    // Update vendor with new visitor data
    const updatedVendor = await DynamoVendor.updateVendor(vendorId, {
      visitors: vendor.visitors
    });

    res.status(200).json({
      success: true,
      message: 'Visitor information saved successfully',
      visitor: visitorRecord
    });
  } catch (error) {
    console.error('Error saving visitor information:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving visitor information',
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
router.get('/user-status', authenticateCognitoJwt, checkUserStatus);

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
router.get('/projects', authenticateCognitoJwt, async (req, res) => {
  try {
    const email = req.auth?.email;
    if (!email) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
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
router.get('/services', authenticateCognitoJwt, getServices);

// Add a new service
router.post('/services', authenticateCognitoJwt, serviceUploadMiddleware, addService);

// Update a service
router.put('/services', authenticateCognitoJwt, serviceUploadMiddleware, updateService);

// Delete a service
router.delete('/services', authenticateCognitoJwt, deleteService);

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

// ─── GET /preferences ─── Fetch vendor email/notification preferences
router.get('/preferences', authenticateCognitoJwt, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const vendor = await DynamoVendor.getVendorByEmail(email);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    res.json({
      success: true,
      emailPreferences: vendor.emailPreferences || {},
    });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ success: false, message: 'Error fetching preferences' });
  }
});

// ─── PUT /preferences ─── Update vendor email/notification preferences
router.put('/preferences', authenticateCognitoJwt, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const vendor = await DynamoVendor.getVendorByEmail(email);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    const { emailPreferences } = req.body;
    if (!emailPreferences || typeof emailPreferences !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid preferences payload' });
    }

    // Only allow boolean values for known preference keys
    const allowedKeys = [
      'orderNotifications', 'promotions', 'newsletter', 'updates',
      'leadAlerts', 'quotationAlerts', 'systemAlerts',
    ];
    const sanitized = {};
    for (const key of allowedKeys) {
      if (key in emailPreferences) {
        sanitized[key] = Boolean(emailPreferences[key]);
      }
    }

    await DynamoVendor.updateVendor(vendor.id, { emailPreferences: sanitized });

    res.json({ success: true, message: 'Preferences updated', emailPreferences: sanitized });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ success: false, message: 'Error updating preferences' });
  }
});

/* ─── Change Password Endpoint ─────────────────────── */
router.post('/change-password', authenticateCognitoJwt, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const vendorId = req.auth?.sub;

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'All password fields are required'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New passwords do not match'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || 
        !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain uppercase, lowercase, number, and special character'
      });
    }

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - User not authenticated'
      });
    }

    // Get vendor
    const vendor = await DynamoVendor.getVendorById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Verify current password
    const storedHash = vendor.passwordHash;
    if (!storedHash) {
      return res.status(400).json({
        success: false,
        message: 'No password set for this account. Please use Google authentication or contact support.'
      });
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, storedHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // Update vendor with new password hash
    await DynamoVendor.updateVendor(vendorId, {
      passwordHash: newPasswordHash,
      passwordUpdatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password: ' + error.message
    });
  }
});

// Public Analytics Endpoints for Shared Profile (no authentication required)
// Get subscription statistics for a vendor (public endpoint)
router.get('/analytics/subscriptions/stats/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }

    // Call the analytics controller with vendor context
    const mockReq = {
      user: {
        vendorId: vendorId,
        userType: 'public'
      },
      query: { vendorId }
    };

    return getRevenueForecasting(mockReq, res);
  } catch (error) {
    console.error('Error fetching subscription stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscription stats',
      error: error.message
    });
  }
});

// Get revenue forecast for a vendor (public endpoint)
router.get('/analytics/forecast/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }

    // Call the analytics controller with vendor context
    const mockReq = {
      user: {
        vendorId: vendorId,
        userType: 'public'
      },
      query: { vendorId }
    };

    return getRevenueForecasting(mockReq, res);
  } catch (error) {
    console.error('Error fetching forecast:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching forecast',
      error: error.message
    });
  }
});

export default router;