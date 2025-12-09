import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

/**
 * Authentication middleware for workspace routes
 * Extracts user information from request headers or query parameters
 * and validates user permissions based on role
 */
export const authenticateUser = async (req, res, next) => {
  try {
    // Get user information from different sources
    let user = null;
    
    // Method 1: From Authorization header (JWT token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // TODO: Verify JWT token and extract user info
      // For now, we'll use a placeholder
      console.log('🔐 JWT token found:', token);
    }
    
    // Method 2: From x-user-info header (for now, since JWT is not fully implemented)
    let userInfo = {};
    if (req.headers['x-user-info']) {
      try {
        userInfo = JSON.parse(req.headers['x-user-info']);
        console.log('🔐 User info from header:', userInfo);
      } catch (e) {
        console.error('Error parsing x-user-info header:', e);
      }
    }
    
    // Method 3: From query parameters (for testing)
    const { vendorId, pmId, userRole } = req.query;
    
    if (vendorId && userRole === 'vendor') {
      // Get vendor information from database
      try {
        const params = {
          TableName: 'vendors',
          Key: marshall({
            vendorId: vendorId
          })
        };
        
        const result = await dbClient.send(new GetItemCommand(params));
        if (result.Item) {
          const vendor = unmarshall(result.Item);
          user = {
            id: vendor.vendorId,
            email: vendor.email,
            role: 'vendor',
            name: vendor.vendorDetails?.name || vendor.email
          };
        }
      } catch (error) {
        console.error('Error fetching vendor:', error);
      }
    } else if (pmId && userRole === 'pm') {
      // Get PM information from database
      try {
        const params = {
          TableName: 'pm_users_table',
          Key: marshall({
            pmId: pmId
          })
        };
        
        const result = await dbClient.send(new GetItemCommand(params));
        if (result.Item) {
          const pm = unmarshall(result.Item);
          user = {
            id: pm.pmId,
            email: pm.email,
            role: 'pm',
            name: pm.name
          };
        }
      } catch (error) {
        console.error('Error fetching PM:', error);
      }
    }
    
    // Method 3: From request body (for POST requests)
    if (!user && req.body) {
      if (req.body.vendorId && req.body.userRole === 'vendor') {
        user = {
          id: req.body.vendorId,
          role: 'vendor',
          email: req.body.email || 'vendor@example.com'
        };
      } else if (req.body.pmId && req.body.userRole === 'pm') {
        user = {
          id: req.body.pmId,
          role: 'pm',
          email: req.body.email || 'pm@example.com'
        };
      }
    }
    
    // Method 4: From localStorage context (frontend sends user info)
    if (!user && req.headers['x-user-info']) {
      try {
        const userInfo = JSON.parse(req.headers['x-user-info']);
        user = {
          id: userInfo.vendorId || userInfo.pmId,
          email: userInfo.email,
          role: userInfo.role || (userInfo.vendorId ? 'vendor' : 'pm'),
          name: userInfo.name
        };
      } catch (error) {
        console.error('Error parsing user info header:', error);
      }
    }
    
    // If no user found in other methods, try to create from user info header
    if (!user && userInfo.vendorId) {
      user = {
        id: userInfo.vendorId,
        email: userInfo.email || `${userInfo.vendorId}@vendor.com`,
        role: 'vendor',
        name: userInfo.name || `Vendor ${userInfo.vendorId}`,
        vendorId: userInfo.vendorId,
        phone: userInfo.phone || ''
      };
      console.log('🔐 Created user from x-user-info:', user);
    }
    
    // If still no user, return 401
    if (!user) {
      console.error('❌ No user found in request');
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        details: 'No valid authentication method found'
      });
    }
    
    // Attach user to request with all available information
    req.user = {
      ...user,
      // Ensure we have vendorId for vendor users
      vendorId: user.vendorId || (user.role === 'vendor' ? user.id : null),
      // Add any missing fields with defaults
      name: user.name || user.email || 'Unknown User',
      email: user.email || `${user.id}@${user.role || 'user'}.com`,
      phone: user.phone || ''
    };
    
    console.log('🔐 Authenticated user:', JSON.stringify(req.user, null, 2));
    next();
  } catch (error) {
    console.error('❌ Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: error.message
    });
  }
};

/**
 * Middleware to check if user is a vendor
 */
export const requireVendor = (req, res, next) => {
  if (req.user?.role !== 'vendor') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Vendor role required.'
    });
  }
  next();
};

/**
 * Middleware to check if user is a PM
 */
export const requirePM = (req, res, next) => {
  if (req.user?.role !== 'pm') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. PM role required.'
    });
  }
  next();
};

/**
 * Middleware to check if user can access vendor data
 * Vendors can only access their own data, PMs can access all data
 */
export const checkVendorAccess = (req, res, next) => {
  const { vendorId } = req.query || req.body || {};
  const user = req.user;
  
  if (user.role === 'pm') {
    // PMs can access all vendor data
    next();
  } else if (user.role === 'vendor') {
    // Vendors can only access their own data
    if (!vendorId || vendorId !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only access your own data.'
      });
    }
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: 'Invalid user role.'
    });
  }
};
