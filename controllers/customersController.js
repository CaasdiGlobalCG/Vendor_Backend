import { dynamoDB } from '../config/aws.js';
import AWS from 'aws-sdk';

const CUSTOMERS_TABLE = 'customers_for_quotations';

// Create raw DynamoDB client for scanning
const rawDynamoDB = new AWS.DynamoDB({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Helper function to convert DynamoDB format to regular JSON
const convertDynamoDBToJSON = (item) => {
  return AWS.DynamoDB.Converter.unmarshall(item);
};

// Get all customers
export const getCustomers = async (req, res) => {
  try {
    console.log('Fetching customers from table:', CUSTOMERS_TABLE);
    
    const params = {
      TableName: CUSTOMERS_TABLE
    };

    const result = await rawDynamoDB.scan(params).promise();
    
    console.log('Raw customers fetched:', result.Items?.length || 0, 'items');
    
    // Convert DynamoDB format to regular JSON and transform data
    const customers = result.Items?.map(item => {
      const customer = convertDynamoDBToJSON(item);
      
      // Extract meaningful data from the customer object
      const name = customer.displayName || customer.companyName || 
                  (customer.primaryContact ? 
                    `${customer.primaryContact.firstName || ''} ${customer.primaryContact.lastName || ''}`.trim() 
                    : 'Unknown');
      
      const company = customer.companyName || customer.displayName || 'Unknown Company';
      
      // Extract contact info
      const email = customer.email || 
                   (customer.contactPersons && customer.contactPersons.length > 0 ? 
                     customer.contactPersons[0].email : '') || '';
      
      const phone = customer.workPhone || customer.mobile || 
                   (customer.contactPersons && customer.contactPersons.length > 0 ? 
                     customer.contactPersons[0].workPhone || customer.contactPersons[0].mobile : '') || '';
      
      return {
        id: customer.customerId || customer.id || `customer-${Date.now()}`,
        name: name,
        company: company,
        companyName: company,
        email: email || '',
        phone: phone || '',
        workPhone: phone || '',
        receivables: '₹0.00', // Default values as these aren't in the source data
        unusedCredits: '₹0.00',
        status: 'Active',
        customerType: customer.customerType || 'business',
        gstin: customer.gstin || '',
        paymentTerms: customer.paymentTerms || '',
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt || customer.createdAt,
        // Include raw data for debugging
        _raw: customer
      };
    }) || [];
    
    console.log('Transformed customers:', customers.length, 'items');
    console.log('Sample customer:', customers[0]);
    
    res.json({
      success: true,
      customers: customers,
      count: customers.length
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customers',
      error: error.message
    });
  }
};

// Get customer by ID
export const getCustomerById = async (req, res) => {
  try {
    const { customerId } = req.params;
    
    console.log('Fetching customer by ID:', customerId);
    
    const params = {
      TableName: CUSTOMERS_TABLE,
      Key: {
        customerId: customerId
      }
    };

    const result = await dynamoDB.get(params).promise();
    
    if (!result.Item) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    console.log('Customer fetched successfully:', result.Item);
    
    res.json({
      success: true,
      customer: result.Item
    });
  } catch (error) {
    console.error('Error fetching customer by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer',
      error: error.message
    });
  }
};

// Create new customer
export const createCustomer = async (req, res) => {
  try {
    const customerData = req.body;
    
    // Generate a UUID for customerId (primary key)
    const customerId = customerData.customerId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Prepare customer data in the same format as existing customers
    const customer = {
      customerId: customerId,
      customerType: customerData.customerType || 'business',
      companyName: customerData.companyName || '',
      displayName: customerData.displayName || customerData.companyName || '',
      email: customerData.email || '',
      workPhone: customerData.workPhone || '',
      mobile: customerData.mobile || '',
      gstin: customerData.gstin || '',
      pan: customerData.pan || '',
      paymentTerms: customerData.paymentTerms || 'Due on Receipt',
      remarks: customerData.remarks || '',
      vendorId: customerData.vendorId || 'system-default-vendor',
      createdAt: new Date().toISOString(),
      
      // Address structure
      address: {
        billing: {
          attention: customerData.address?.billing?.attention || '',
          street1: customerData.address?.billing?.street1 || '',
          street2: customerData.address?.billing?.street2 || '',
          city: customerData.address?.billing?.city || '',
          state: customerData.address?.billing?.state || '',
          pinCode: customerData.address?.billing?.pinCode || '',
          country: customerData.address?.billing?.country || 'IN',
          phone: customerData.address?.billing?.phone || '',
          fax: customerData.address?.billing?.fax || ''
        },
        shipping: {
          attention: customerData.address?.shipping?.attention || '',
          street1: customerData.address?.shipping?.street1 || '',
          street2: customerData.address?.shipping?.street2 || '',
          city: customerData.address?.shipping?.city || '',
          state: customerData.address?.shipping?.state || '',
          pinCode: customerData.address?.shipping?.pinCode || '',
          country: customerData.address?.shipping?.country || 'IN',
          phone: customerData.address?.shipping?.phone || '',
          fax: customerData.address?.shipping?.fax || ''
        }
      },
      
      // Primary contact
      primaryContact: {
        salutation: customerData.primaryContact?.salutation || '',
        firstName: customerData.primaryContact?.firstName || '',
        lastName: customerData.primaryContact?.lastName || ''
      },
      
      // Contact persons array
      contactPersons: customerData.contactPersons || [{
        salutation: customerData.primaryContact?.salutation || '',
        firstName: customerData.primaryContact?.firstName || '',
        lastName: customerData.primaryContact?.lastName || '',
        email: customerData.email || '',
        workPhone: customerData.workPhone || '',
        mobile: customerData.mobile || ''
      }],
      
      // Events array for tracking
      events: [{
        eventId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'customer_created',
        title: 'Customer Created',
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        date: '0 minutes ago',
        time: '',
        data: {
          createdBy: 'Current User',
          customerName: customerData.displayName || customerData.companyName || 'Unknown'
        },
        id: `customer_created_${new Date().toISOString()}`,
        description: {},
        icon: {}
      }],
      
      // Documents array (empty by default)
      documents: []
    };
    
    console.log('Creating new customer:', customerId);
    console.log('Customer data:', JSON.stringify(customer, null, 2));
    
    // Use DocumentClient for putting data (it will handle the conversion)
    const params = {
      TableName: CUSTOMERS_TABLE,
      Item: customer
    };

    await dynamoDB.put(params).promise();
    
    console.log('Customer created successfully:', customerId);
    
    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      customer: customer
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create customer',
      error: error.message
    });
  }
};

// Update customer
export const updateCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    const updateData = req.body;
    
    console.log('Updating customer:', customerId);
    console.log('Update data keys:', Object.keys(updateData));
    
    // Build update expression
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    let attrIndex = 0;
    Object.keys(updateData).forEach((key) => {
      if (key !== 'id' && key !== 'customerId') { // Don't update the ID or customerId (primary key)
        console.log('Including key in update:', key);
        updateExpressions.push(`#attr${attrIndex} = :val${attrIndex}`);
        expressionAttributeNames[`#attr${attrIndex}`] = key;
        expressionAttributeValues[`:val${attrIndex}`] = updateData[key];
        attrIndex++;
      } else {
        console.log('Excluding key from update:', key);
      }
    });
    
    // Add updatedAt timestamp
    updateExpressions.push(`#updatedAt = :updatedAt`);
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();
    
    const params = {
      TableName: CUSTOMERS_TABLE,
      Key: {
        customerId: customerId
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();
    
    console.log('Customer updated successfully:', customerId);
    
    res.json({
      success: true,
      message: 'Customer updated successfully',
      customer: result.Attributes
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update customer',
      error: error.message
    });
  }
};

// Delete customer
export const deleteCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    
    console.log('Deleting customer:', customerId);
    
    const params = {
      TableName: CUSTOMERS_TABLE,
      Key: {
        customerId: customerId
      }
    };

    await dynamoDB.delete(params).promise();
    
    console.log('Customer deleted successfully:', customerId);
    
    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete customer',
      error: error.message
    });
  }
};

// Search customers
export const searchCustomers = async (req, res) => {
  try {
    const { query } = req.query;
    
    console.log('Searching customers with query:', query);
    
    if (!query) {
      return getCustomers(req, res);
    }
    
    const params = {
      TableName: CUSTOMERS_TABLE
    };

    const result = await rawDynamoDB.scan(params).promise();
    
    // Convert and transform all customers first
    const allCustomers = result.Items?.map(item => {
      const customer = convertDynamoDBToJSON(item);
      
      const name = customer.displayName || customer.companyName || 
                  (customer.primaryContact ? 
                    `${customer.primaryContact.firstName || ''} ${customer.primaryContact.lastName || ''}`.trim() 
                    : 'Unknown');
      
      const company = customer.companyName || customer.displayName || 'Unknown Company';
      
      const email = customer.email || 
                   (customer.contactPersons && customer.contactPersons.length > 0 ? 
                     customer.contactPersons[0].email : '') || '';
      
      const phone = customer.workPhone || customer.mobile || 
                   (customer.contactPersons && customer.contactPersons.length > 0 ? 
                     customer.contactPersons[0].workPhone || customer.contactPersons[0].mobile : '') || '';
      
      return {
        id: customer.customerId || customer.id || `customer-${Date.now()}`,
        name: name,
        company: company,
        companyName: company,
        email: email || '',
        phone: phone || '',
        workPhone: phone || '',
        receivables: '₹0.00',
        unusedCredits: '₹0.00',
        status: 'Active',
        customerType: customer.customerType || 'business',
        gstin: customer.gstin || '',
        paymentTerms: customer.paymentTerms || '',
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt || customer.createdAt
      };
    }) || [];
    
    // Filter results based on search query
    const filteredCustomers = allCustomers.filter(customer => {
      const searchFields = [
        customer.name,
        customer.company,
        customer.email,
        customer.phone
      ].filter(Boolean);
      
      return searchFields.some(field => 
        field.toLowerCase().includes(query.toLowerCase())
      );
    });
    
    console.log('Search completed:', filteredCustomers.length, 'customers found');
    
    res.json({
      success: true,
      customers: filteredCustomers,
      count: filteredCustomers.length,
      query: query
    });
  } catch (error) {
    console.error('Error searching customers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search customers',
      error: error.message
    });
  }
};
