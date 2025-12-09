import fetch from 'node-fetch';
import { dynamoDB } from '../../../config/aws.js';

// Get all employees from the employee system
export const getAllEmployees = async (req, res) => {
  try {
    console.log('📋 Fetching employees from employee system...');
    
    // Try to fetch directly from the employees DynamoDB table
    try {
      const params = {
        TableName: 'employees'
      };
      
      const result = await dynamoDB.scan(params).promise();
      
      if (result.Items && result.Items.length > 0) {
        // Filter and format employees from DynamoDB
        const employees = result.Items
          .filter(user => user.status === 'Active' || user.status === 'active')
          .map(user => ({
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            casUnit: user.casUnit || user.department,
            role: user.role,
            status: user.status
          }));

        console.log(`✅ Successfully fetched ${employees.length} employees from DynamoDB`);

        return res.status(200).json({
          success: true,
          employees: employees,
          count: employees.length
        });
      }
    } catch (dynamoError) {
      console.warn('⚠️ Could not fetch from DynamoDB employees table:', dynamoError.message);
      
      // If DynamoDB fails, return an error instead of mock data
      return res.status(500).json({
        success: false,
        message: 'Could not connect to employee database. Please ensure the employees table exists and is accessible.',
        error: dynamoError.message
      });
    }
    
    // If no employees found in DynamoDB
    return res.status(200).json({
      success: true,
      employees: [],
      count: 0,
      message: 'No employees found in the system'
    });

  } catch (error) {
    console.error('❌ Error fetching employees:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employees',
      error: error.message
    });
  }
};

// Get employee by ID
export const getEmployeeById = async (req, res) => {
  try {
    const { employeeId } = req.params;
    console.log(`📋 Fetching employee ${employeeId} from employee system...`);
    
    const response = await fetch(`http://localhost:5003/admin/users/${employeeId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Add any required auth headers for the employee system here
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({
          success: false,
          message: 'Employee not found'
        });
      }
      
      return res.status(response.status).json({
        success: false,
        message: `Employee system error: ${response.statusText}`
      });
    }

    const data = await response.json();
    
    if (!data.success) {
      return res.status(500).json({
        success: false,
        message: 'Employee system returned an error',
        error: data.message
      });
    }

    // Format employee data
    const employee = {
      userId: data.user.userId,
      firstName: data.user.firstName,
      lastName: data.user.lastName,
      email: data.user.email,
      casUnit: data.user.casUnit || data.user.department,
      role: data.user.role,
      status: data.user.status
    };

    console.log(`✅ Successfully fetched employee ${employeeId}`);

    res.status(200).json({
      success: true,
      employee: employee
    });

  } catch (error) {
    console.error('❌ Error fetching employee:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employee from employee system',
      error: error.message
    });
  }
};
