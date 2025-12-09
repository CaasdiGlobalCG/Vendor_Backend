import AWS from 'aws-sdk';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

// Configure AWS (same as existing system)
import { dynamoDB } from '../../../config/aws.js';

const PM_USERS_TABLE = 'pm_users_table';
const JWT_SECRET = process.env.JWT_SECRET || 'pm_dashboard_secret_key_2024';
const JWT_EXPIRES_IN = '7d';

// PM Login
export const loginPM = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password are required' 
      });
    }

    console.log('🔐 PM Login attempt:', email);

    // Find PM by email using GSI
    const params = {
      TableName: PM_USERS_TABLE,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    };

    const result = await dynamoDB.query(params).promise();

    if (!result.Items || result.Items.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }

    const pmUser = result.Items[0];

    // Check if account is active
    if (pmUser.status !== 'active') {
      return res.status(401).json({ 
        success: false, 
        error: 'Account is not active' 
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, pmUser.hashedPassword);

    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }

    // Update last login
    await dynamoDB.update({
      TableName: PM_USERS_TABLE,
      Key: { pmId: pmUser.pmId },
      UpdateExpression: 'SET lastLogin = :lastLogin',
      ExpressionAttributeValues: {
        ':lastLogin': new Date().toISOString()
      }
    }).promise();

    // Generate JWT token
    const token = jwt.sign(
      { 
        pmId: pmUser.pmId, 
        email: pmUser.email,
        role: 'pm'
      }, 
      JWT_SECRET, 
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Return user data (without password)
    const userData = {
      pmId: pmUser.pmId,
      email: pmUser.email,
      name: pmUser.name,
      company: pmUser.company,
      specialization: pmUser.specialization,
      status: pmUser.status,
      projectsCount: pmUser.projectsCount || 0,
      totalBudgetManaged: pmUser.totalBudgetManaged || 0,
      createdAt: pmUser.createdAt,
      lastLogin: new Date().toISOString()
    };

    console.log('✅ PM Login successful:', pmUser.name);

    res.json({
      success: true,
      message: 'Login successful',
      user: userData,
      token,
      expiresIn: JWT_EXPIRES_IN
    });

  } catch (error) {
    console.error('❌ PM Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Login failed. Please try again.' 
    });
  }
};

// PM Register
export const registerPM = async (req, res) => {
  try {
    const { email, password, name, company, specialization } = req.body;

    // Validation
    if (!email || !password || !name || !company) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email, password, name, and company are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 6 characters long' 
      });
    }

    console.log('📝 PM Registration attempt:', email);

    // Check if email already exists
    const existingUser = await dynamoDB.query({
      TableName: PM_USERS_TABLE,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    }).promise();

    if (existingUser.Items && existingUser.Items.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: 'Email already registered' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new PM user
    const pmId = `PM-${Date.now()}`;
    const newPM = {
      pmId,
      email,
      name,
      company,
      specialization: specialization || 'General',
      hashedPassword,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLogin: null,
      projectsCount: 0,
      totalBudgetManaged: 0
    };

    await dynamoDB.put({
      TableName: PM_USERS_TABLE,
      Item: newPM,
      ConditionExpression: 'attribute_not_exists(pmId)'
    }).promise();

    // Generate JWT token
    const token = jwt.sign(
      { 
        pmId: newPM.pmId, 
        email: newPM.email,
        role: 'pm'
      }, 
      JWT_SECRET, 
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Return user data (without password)
    const userData = {
      pmId: newPM.pmId,
      email: newPM.email,
      name: newPM.name,
      company: newPM.company,
      specialization: newPM.specialization,
      status: newPM.status,
      projectsCount: 0,
      totalBudgetManaged: 0,
      createdAt: newPM.createdAt,
      lastLogin: null
    };

    console.log('✅ PM Registration successful:', newPM.name);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: userData,
      token,
      expiresIn: JWT_EXPIRES_IN
    });

  } catch (error) {
    console.error('❌ PM Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Registration failed. Please try again.' 
    });
  }
};

// Get PM Profile
export const getPMProfile = async (req, res) => {
  try {
    const { pmId } = req.params;

    const result = await dynamoDB.get({
      TableName: PM_USERS_TABLE,
      Key: { pmId }
    }).promise();

    if (!result.Item) {
      return res.status(404).json({ 
        success: false, 
        error: 'PM not found' 
      });
    }

    const pmUser = result.Item;

    // Return user data (without password)
    const userData = {
      pmId: pmUser.pmId,
      email: pmUser.email,
      name: pmUser.name,
      company: pmUser.company,
      specialization: pmUser.specialization,
      status: pmUser.status,
      projectsCount: pmUser.projectsCount || 0,
      totalBudgetManaged: pmUser.totalBudgetManaged || 0,
      createdAt: pmUser.createdAt,
      lastLogin: pmUser.lastLogin
    };

    res.json({
      success: true,
      user: userData
    });

  } catch (error) {
    console.error('❌ Get PM Profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get profile' 
    });
  }
};

// Update PM Profile
export const updatePMProfile = async (req, res) => {
  try {
    const { pmId } = req.params;
    const { name, company, specialization } = req.body;

    const updateExpression = [];
    const expressionAttributeValues = {};

    if (name) {
      updateExpression.push('name = :name');
      expressionAttributeValues[':name'] = name;
    }

    if (company) {
      updateExpression.push('company = :company');
      expressionAttributeValues[':company'] = company;
    }

    if (specialization) {
      updateExpression.push('specialization = :specialization');
      expressionAttributeValues[':specialization'] = specialization;
    }

    if (updateExpression.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No fields to update' 
      });
    }

    updateExpression.push('updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    await dynamoDB.update({
      TableName: PM_USERS_TABLE,
      Key: { pmId },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeValues: expressionAttributeValues
    }).promise();

    console.log('✅ PM Profile updated:', pmId);

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('❌ Update PM Profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update profile' 
    });
  }
};

// Verify JWT Token (Middleware)
export const verifyPMToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Access token required' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'pm') {
      return res.status(403).json({ 
        success: false, 
        error: 'PM access required' 
      });
    }

    req.pmUser = decoded;
    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expired' 
      });
    }
    
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid token' 
    });
  }
};
