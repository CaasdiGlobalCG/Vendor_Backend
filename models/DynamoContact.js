import { dynamoDB } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Table name
const CONTACTS_TABLE = 'contacts';

// Create a contact in DynamoDB
export const createContact = async (contactData) => {
  const params = {
    TableName: CONTACTS_TABLE,
    Item: {
      id: uuidv4(),
      ...contactData,
      createdAt: new Date().toISOString()
    }
  };

  try {
    await dynamoDB.put(params).promise();
    return params.Item;
  } catch (error) {
    console.error('Error creating contact in DynamoDB:', error);
    throw error;
  }
};

// Get all contacts
export const getAllContacts = async () => {
  const params = {
    TableName: CONTACTS_TABLE
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    return result.Items || [];
  } catch (error) {
    console.error('Error getting all contacts from DynamoDB:', error);
    throw error;
  }
};