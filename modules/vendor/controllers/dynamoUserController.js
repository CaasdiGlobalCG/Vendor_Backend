import * as DynamoVendor from '../models/DynamoVendor.js';
import * as DynamoGoogleUser from '../../../models/DynamoGoogleUser.js';

// Check user status across collections
export const checkUserStatus = async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    
    // First try to find in DynamoDB vendors
    const vendor = await DynamoVendor.getVendorByEmail(email);
    
    if (vendor) {
      return res.status(200).json({
        success: true,
        data: {
          id: vendor.id,
          _id: vendor._id, // For frontend compatibility
          email: vendor.email || vendor.vendorDetails?.primaryContactEmail,
          name: vendor.name || vendor.vendorDetails?.primaryContactName,
          status: vendor.status || 'pending',
          hasFilledForm: vendor.hasFilledForm || false,
          role: vendor.role || 'vendor',
          source: 'dynamodb'
        }
      });
    }
    
    // If not found in vendors, try DynamoDB Google users
    const dynamoGoogleUser = await DynamoGoogleUser.getGoogleUserByEmail(email);
    
    if (dynamoGoogleUser) {
      return res.status(200).json({
        success: true,
        data: {
          id: dynamoGoogleUser.id,
          _id: dynamoGoogleUser._id,
          email: dynamoGoogleUser.email,
          name: dynamoGoogleUser.displayName || dynamoGoogleUser.email.split('@')[0],
          status: dynamoGoogleUser.status || 'pending',
          hasFilledForm: dynamoGoogleUser.hasFilledForm || false,
          role: dynamoGoogleUser.role || 'vendor',
          source: 'dynamodb_google'
        }
      });
    }
    
    // Create a new user if not found in either database
    try {
      // Create a basic user record with default values
      const newUserData = {
        googleId: null, // Will be updated when they sign in with Google
        displayName: email.split('@')[0],
        email,
        role: 'vendor',
        status: 'pending',
        hasFilledForm: false
      };
      
      const newUser = await DynamoGoogleUser.createGoogleUser(newUserData);
      console.log(`Created new user during checkUserStatus: ${email}`);
      
      return res.status(200).json({
        success: true,
        data: {
          id: newUser.id,
          _id: newUser.id,
          email: newUser.email,
          name: newUser.displayName || newUser.email.split('@')[0],
          status: newUser.status || 'pending',
          hasFilledForm: newUser.hasFilledForm || false,
          role: newUser.role || 'vendor',
          source: 'dynamodb_google'
        }
      });
    } catch (createError) {
      console.error(`Error creating new user ${email}:`, createError);
      
      // If we can't create a user, return not found
      return res.status(404).json({
        success: false,
        message: 'User not found and could not be created'
      });
    }
    
    // This code should never be reached because we either:
    // 1. Found a user in DynamoDB vendors
    // 2. Found a user in DynamoDB Google users
    // 3. Created a new user in DynamoDB Google users
    // 4. Failed to create a user and returned an error
    console.error('Unexpected code path in checkUserStatus for email:', email);
    return res.status(500).json({
      success: false,
      message: 'Unexpected error in user status check'
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

// Create a new user/vendor
export const createUser = async (req, res) => {
  try {
    const { email, name, status = 'pending', hasFilledForm = false, role = 'vendor', googleId = null } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    
    console.log(`createUser - Processing request for email: ${email}, name: ${name}`);
    
    // Check if user already exists in DynamoDB vendors
    const existingVendor = await DynamoVendor.getVendorByEmail(email);
    
    if (existingVendor) {
      console.log(`createUser - User already exists as vendor: ${email}`);
      return res.status(200).json({
        success: true,
        message: 'User already exists as vendor',
        data: {
          id: existingVendor.id,
          _id: existingVendor._id,
          email: existingVendor.email || existingVendor.vendorDetails?.primaryContactEmail,
          name: existingVendor.name || existingVendor.vendorDetails?.primaryContactName,
          status: existingVendor.status || 'pending',
          hasFilledForm: existingVendor.hasFilledForm || false,
          role: existingVendor.role || 'vendor',
          source: 'dynamodb'
        }
      });
    }
    
    // Check if user already exists in DynamoDB Google users
    const existingGoogleUser = await DynamoGoogleUser.getGoogleUserByEmail(email);
    
    if (existingGoogleUser) {
      console.log(`createUser - User already exists as Google user: ${email}`);
      
      // If user exists as Google user but not as vendor, create a vendor record
      try {
        console.log(`createUser - Creating vendor record for existing Google user: ${email}`);
        
        const newVendorData = {
          email,
          name: name || existingGoogleUser.displayName || email.split('@')[0],
          status: existingGoogleUser.status || status,
          hasFilledForm: existingGoogleUser.hasFilledForm || hasFilledForm,
          role: existingGoogleUser.role || role,
          vendorDetails: {
            primaryContactEmail: email,
            primaryContactName: name || existingGoogleUser.displayName || email.split('@')[0]
          },
          companyDetails: {},
          serviceProductDetails: {},
          bankDetails: {},
          complianceCertifications: {},
          additionalDetails: {}
        };
        
        const newVendor = await DynamoVendor.createVendor(newVendorData);
        console.log(`createUser - Created vendor record for Google user: ${email}`);
        
        return res.status(200).json({
          success: true,
          message: 'User exists as Google user, created vendor record',
          data: {
            id: newVendor.id,
            _id: newVendor._id,
            email: newVendor.email,
            name: newVendor.name,
            status: newVendor.status,
            hasFilledForm: newVendor.hasFilledForm,
            role: newVendor.role,
            source: 'dynamodb'
          }
        });
      } catch (vendorCreateError) {
        console.error(`createUser - Error creating vendor record for Google user: ${email}`, vendorCreateError);
        
        // Return the Google user data if we can't create a vendor record
        return res.status(200).json({
          success: true,
          message: 'User already exists as Google user',
          data: {
            id: existingGoogleUser.id,
            _id: existingGoogleUser._id,
            email: existingGoogleUser.email,
            name: existingGoogleUser.displayName || existingGoogleUser.email.split('@')[0],
            status: existingGoogleUser.status || 'pending',
            hasFilledForm: existingGoogleUser.hasFilledForm || false,
            role: existingGoogleUser.role || 'vendor',
            source: 'dynamodb_google'
          }
        });
      }
    }
    
    // If googleId is provided, create as Google user
    if (googleId) {
      console.log(`createUser - Creating new Google user with ID: ${googleId}, email: ${email}`);
      
      const newGoogleUserData = {
        googleId,
        displayName: name || email.split('@')[0],
        email,
        role,
        status,
        hasFilledForm
      };
      
      const newGoogleUser = await DynamoGoogleUser.createGoogleUser(newGoogleUserData);
      console.log(`createUser - Created new Google user: ${email}`);
      
      // Also create a vendor record for the Google user
      try {
        console.log(`createUser - Creating vendor record for new Google user: ${email}`);
        
        const newVendorData = {
          email,
          name: name || email.split('@')[0],
          status,
          hasFilledForm,
          role,
          vendorDetails: {
            primaryContactEmail: email,
            primaryContactName: name || email.split('@')[0]
          },
          companyDetails: {},
          serviceProductDetails: {},
          bankDetails: {},
          complianceCertifications: {},
          additionalDetails: {}
        };
        
        const newVendor = await DynamoVendor.createVendor(newVendorData);
        console.log(`createUser - Created vendor record for new Google user: ${email}`);
        
        return res.status(201).json({
          success: true,
          message: 'Google user and vendor record created successfully',
          data: {
            id: newVendor.id,
            _id: newVendor._id,
            email: newVendor.email,
            name: newVendor.name,
            status: newVendor.status,
            hasFilledForm: newVendor.hasFilledForm,
            role: newVendor.role,
            source: 'dynamodb'
          }
        });
      } catch (vendorCreateError) {
        console.error(`createUser - Error creating vendor record for new Google user: ${email}`, vendorCreateError);
        
        // Return the Google user data if we can't create a vendor record
        return res.status(201).json({
          success: true,
          message: 'Google user created successfully',
          data: {
            id: newGoogleUser.id,
            _id: newGoogleUser._id,
            email: newGoogleUser.email,
            name: newGoogleUser.displayName,
            status: newGoogleUser.status,
            hasFilledForm: newGoogleUser.hasFilledForm,
            role: newGoogleUser.role,
            source: 'dynamodb_google'
          }
        });
      }
    }
    
    // Otherwise, create as regular vendor
    console.log(`createUser - Creating new vendor: ${email}`);
    
    const newVendorData = {
      email,
      name: name || email.split('@')[0],
      status,
      hasFilledForm,
      role,
      vendorDetails: {
        primaryContactEmail: email,
        primaryContactName: name || email.split('@')[0]
      },
      companyDetails: {},
      serviceProductDetails: {},
      bankDetails: {},
      complianceCertifications: {},
      additionalDetails: {}
    };
    
    const newVendor = await DynamoVendor.createVendor(newVendorData);
    console.log(`createUser - Created new vendor: ${email}`);
    
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: newVendor.id,
        _id: newVendor._id,
        email: newVendor.email,
        name: newVendor.name,
        status: newVendor.status,
        hasFilledForm: newVendor.hasFilledForm,
        role: newVendor.role,
        source: 'dynamodb'
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message
    });
  }
};

// Create or update a Google user
export const createOrUpdateGoogleUser = async (req, res) => {
  try {
    const { googleId, email, displayName, role = 'vendor' } = req.body;
    
    if (!googleId || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'GoogleId and email are required' 
      });
    }
    
    // Check if Google user already exists in DynamoDB
    let googleUser = await DynamoGoogleUser.getGoogleUserByGoogleId(googleId);
    
    if (googleUser) {
      // Update existing user
      const updatedData = {
        displayName: displayName || googleUser.displayName,
        email: email || googleUser.email,
        role: role || googleUser.role
      };
      
      googleUser = await DynamoGoogleUser.updateGoogleUser(googleUser.id, updatedData);
      
      return res.status(200).json({
        success: true,
        message: 'Google user updated successfully',
        data: {
          id: googleUser.id,
          _id: googleUser._id,
          googleId: googleUser.googleId,
          email: googleUser.email,
          name: googleUser.displayName,
          role: googleUser.role,
          status: googleUser.status || 'pending',
          hasFilledForm: googleUser.hasFilledForm || false,
          source: 'dynamodb_google'
        }
      });
    }
    
    // Create new Google user
    const newGoogleUserData = {
      googleId,
      displayName: displayName || email.split('@')[0],
      email,
      role,
      status: 'pending',
      hasFilledForm: false
    };
    
    const newGoogleUser = await DynamoGoogleUser.createGoogleUser(newGoogleUserData);
    
    res.status(201).json({
      success: true,
      message: 'Google user created successfully',
      data: {
        id: newGoogleUser.id,
        _id: newGoogleUser._id,
        googleId: newGoogleUser.googleId,
        email: newGoogleUser.email,
        name: newGoogleUser.displayName,
        role: newGoogleUser.role,
        status: newGoogleUser.status,
        hasFilledForm: newGoogleUser.hasFilledForm,
        source: 'dynamodb_google'
      }
    });
  } catch (error) {
    console.error('Error creating/updating Google user:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating/updating Google user',
      error: error.message
    });
  }
};