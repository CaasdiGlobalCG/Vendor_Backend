import { dynamoDB, VENDORS_TABLE } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Generate a custom vendor ID based on name, date, and phone number
const generateCustomVendorId = (vendorData) => {
  try {
    // Get the first 3 letters of the name (uppercase)
    const name = vendorData.name || vendorData.vendorDetails?.primaryContactName || 'UNKNOWN';
    // Ensure we have at least 3 characters, pad with 'X' if needed
    const namePrefix = (name.substring(0, 3) + 'XXX').substring(0, 3).toUpperCase();
    
    // Get the current date in YYMMDD format
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // Get the last 3 digits of the phone number
    const phone = vendorData.phoneNumber || vendorData.vendorDetails?.phoneNumber || '0000000000';
    const phoneDigits = phone.replace(/\D/g, ''); // Remove non-digit characters
    // Ensure we have at least 3 digits, pad with zeros if needed
    const phoneSuffix = ('000' + phoneDigits).slice(-3);
    
    // Combine to create the custom ID with separators for better readability
    return `${namePrefix}-${dateStr}-${phoneSuffix}`;
  } catch (error) {
    console.error('Error generating custom vendor ID:', error);
    // Fallback to UUID if there's an error
    return uuidv4();
  }
};

// Check if a vendor ID already exists in the database
const checkVendorIdExists = async (id) => {
  const params = {
    TableName: VENDORS_TABLE,
    Key: {
      vendorId: id
    }
  };
  
  try {
    const result = await dynamoDB.get(params).promise();
    return !!result.Item; // Return true if the item exists
  } catch (error) {
    console.error('Error checking if vendor ID exists:', error);
    return false; // Assume it doesn't exist in case of error
  }
};

// Create a vendor in DynamoDB
export const createVendor = async (vendorData) => {
  // Generate a custom ID
  let id = generateCustomVendorId(vendorData);
  console.log(`Generated custom vendor ID: ${id}`);
  
  // Check if the ID already exists, if so, append a random number
  const idExists = await checkVendorIdExists(id);
  if (idExists) {
    const randomSuffix = Math.floor(Math.random() * 900) + 100; // Random 3-digit number
    const originalId = id;
    id = `${id}-${randomSuffix}`; // Add the random suffix with a separator
    console.log(`ID ${originalId} already exists, using ${id} instead`);
  }
  
  // Ensure email is properly set in the vendor data
  const email = vendorData.email || vendorData.vendorDetails?.primaryContactEmail;
  
  const params = {
    TableName: VENDORS_TABLE,
    Item: {
      vendorId: id, // Use custom vendorId as the primary key
      id: id, // Add vendorId field for DynamoDB schema
      googleId: vendorData.googleId || null, // Add googleId, default to null
      email: email, // Ensure email is always set at the top level
      ...vendorData,
      createdAt: new Date().toISOString()
    }
  };

  try {
    await dynamoDB.put(params).promise();
    return {
      ...params.Item,
      vendorId: id, // Add vendorId for frontend compatibility
      _id: id // Add _id field for frontend compatibility
    };
  } catch (error) {
    console.error('Error creating vendor in DynamoDB:', error);
    throw error;
  }
};

// Get a vendor by email
export const getVendorByEmail = async (email) => {
  if (!email) {
    console.error('No email provided to getVendorByEmail');
    return null;
  }
  
  console.log(`Searching for vendor with email: ${email}`);
  
  try {
    // Use a single scan with multiple conditions to find the vendor by any email field
    const params = {
      TableName: VENDORS_TABLE,
      FilterExpression: 'email = :email OR vendorDetails.primaryContactEmail = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    };

    console.log('DynamoDB scan params:', JSON.stringify(params, null, 2));
    const result = await dynamoDB.scan(params).promise();
    console.log(`DynamoDB scan result for email ${email}:`, JSON.stringify(result, null, 2));
    
    if (result.Items && result.Items.length > 0) {
      const vendor = result.Items[0];
      
      // Ensure the email is set at the top level for consistency
      if (!vendor.email && vendor.vendorDetails?.primaryContactEmail) {
        // Update the vendor to include the email at the top level
        const updateParams = {
          TableName: VENDORS_TABLE,
          Key: {
            vendorId: vendor.vendorId
          },
          UpdateExpression: 'set email = :email',
          ExpressionAttributeValues: {
            ':email': vendor.vendorDetails.primaryContactEmail
          }
        };
        
        try {
          await dynamoDB.update(updateParams).promise();
          console.log(`Updated vendor ${vendor.vendorId} to include email at top level`);
          vendor.email = vendor.vendorDetails.primaryContactEmail;
        } catch (updateError) {
          console.error('Error updating vendor email:', updateError);
          // Continue even if update fails
        }
      }
      
      return {
        ...vendor,
        _id: vendor.vendorId // Add _id field for frontend compatibility
      };
    }

    console.log(`No vendor found with email: ${email}`);
    return null;
  } catch (error) {
    console.error('Error getting vendor by email from DynamoDB:', error);
    throw error;
  }
};

// Get a vendor by ID
export const getVendorById = async (id) => {
  if (!id) {
    console.error('No ID provided to getVendorById');
    return null;
  }
  
  console.log(`Searching for vendor with ID: ${id}`);
  
  // First try to get by vendorId (primary key - most efficient)
  const params = {
    TableName: VENDORS_TABLE,
    Key: {
      vendorId: id // Use vendorId as the key
    }
  };

  try {
    const result = await dynamoDB.get(params).promise();
    if (result.Item) {
      console.log(`Found vendor with ID: ${id}`);
      return {
        ...result.Item,
        _id: result.Item.vendorId // Add _id field for frontend compatibility
      };
    }
    
    // If not found by ID, it might be an email - try to find by email
    if (id.includes('@')) {
      console.log(`ID ${id} looks like an email, trying to find by email`);
      return await getVendorByEmail(id);
    }
    
    console.log(`No vendor found with ID: ${id}`);
    return null;
  } catch (error) {
    console.error('Error getting vendor by ID from DynamoDB:', error);
    throw error;
  }
};

// Update a vendor
export const updateVendor = async (id, vendorData) => {
  // First get the existing vendor to ensure it exists
  const existingVendor = await getVendorById(id);
  
  if (!existingVendor) {
    throw new Error('Vendor not found');
  }

  // Prepare update expression and attribute values
  let updateExpression = 'set ';
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};

  // Process each field in vendorData
  Object.entries(vendorData).forEach(([key, value], index) => {
    // Skip id as it's the primary key
    if (key === 'id') return;
    
    const attributeName = `#${key}`;
    const attributeValue = `:${key}`;
    
    expressionAttributeNames[attributeName] = key;
    expressionAttributeValues[attributeValue] = value;
    
    updateExpression += `${index !== 0 ? ', ' : ''}${attributeName} = ${attributeValue}`;
  });

  // Add updatedAt timestamp
  updateExpression += ', #updatedAt = :updatedAt';
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = new Date().toISOString();

  const params = {
    TableName: VENDORS_TABLE,
    Key: {
      vendorId: id // Use vendorId as the key here as well
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW'
  };

  try {
    const result = await dynamoDB.update(params).promise();
    if (result.Attributes) {
      return {
        ...result.Attributes,
        _id: result.Attributes.vendorId // Add _id field for frontend compatibility
      };
    }
    return null;
  } catch (error) {
    console.error('Error updating vendor in DynamoDB:', error);
    throw error;
  }
};

// Get all vendors
export const getAllVendors = async () => {
  const params = {
    TableName: VENDORS_TABLE
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    // Map the vendorId field to _id for frontend compatibility
    const vendors = (result.Items || []).map(vendor => {
      return {
        ...vendor,
        _id: vendor.vendorId // Add _id field for frontend compatibility
      };
    });
    return vendors;
  } catch (error) {
    console.error('Error getting all vendors from DynamoDB:', error);
    throw error;
  }
};

// Delete a vendor
export const deleteVendor = async (id) => {
  const params = {
    TableName: VENDORS_TABLE,
    Key: {
      vendorId: id // Use vendorId as the key here too
    }
  };

  try {
    await dynamoDB.delete(params).promise();
    return true;
  } catch (error) {
    console.error('Error deleting vendor from DynamoDB:', error);
    throw error;
  }
};
