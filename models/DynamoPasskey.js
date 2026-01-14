import { dynamoDB } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

const PASSKEYS_TABLE = process.env.PASSKEYS_TABLE_NAME || 'VendorPasskeys';

/**
 * Create a new passkey for a user
 */
export const createPasskey = async (userId, passkeyData) => {
  // Validate required parameters
  if (!userId) {
    throw new Error('userId is required to create a passkey');
  }
  if (!passkeyData.credentialId) {
    throw new Error('credentialId is required to create a passkey');
  }
  
  const id = uuidv4();
  const now = new Date().toISOString();
  
  const item = {
    passkeyId: id,
    userId,
    credentialId: passkeyData.credentialId,
    publicKey: passkeyData.publicKey, // Stored as string/JSON
    counter: passkeyData.counter || 0,
    passkeyName: passkeyData.passkeyName || 'My Passkey',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null
  };
  
  console.log('[DynamoPasskey] Creating passkey with item:', {
    passkeyId: item.passkeyId,
    userId: item.userId,
    credentialId: item.credentialId ? 'set' : 'missing',
    counter: item.counter,
    createdAt: item.createdAt
  });
  
  try {
    await dynamoDB.put({
      TableName: PASSKEYS_TABLE,
      Item: item
    }).promise();
  } catch (error) {
    console.error('[DynamoPasskey] Error creating passkey:', {
      error: error.message,
      code: error.code,
      item: JSON.stringify(item),
      table: PASSKEYS_TABLE
    });
    throw error;
  }
  
  return item;
};

/**
 * Get all passkeys for a user
 */
export const getPasskeysByUserId = async (userId) => {
  const res = await dynamoDB.query({
    TableName: PASSKEYS_TABLE,
    IndexName: 'userIdIndex', // Use Global Secondary Index
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId
    }
  }).promise();
  
  return res.Items || [];
};

/**
 * Get a specific passkey by credential ID
 */
export const getPasskeyByCredentialId = async (credentialId) => {
  const res = await dynamoDB.query({
    TableName: PASSKEYS_TABLE,
    IndexName: 'credentialIdIndex', // Use Global Secondary Index
    KeyConditionExpression: 'credentialId = :credentialId',
    ExpressionAttributeValues: {
      ':credentialId': credentialId
    }
  }).promise();
  
  return (res.Items || [])[0] || null;
};

/**
 * Update passkey (e.g., counter for replay attack prevention)
 */
export const updatePasskey = async (passkeyId, userId, updates) => {
  const now = new Date().toISOString();
  const keys = Object.keys(updates || {});
  
  let UpdateExpression = 'set updatedAt = :updatedAt';
  const ExpressionAttributeValues = { ':updatedAt': now };
  const ExpressionAttributeNames = {};
  
  keys.forEach((k, idx) => {
    const name = `#n${idx}`;
    const value = `:v${idx}`;
    UpdateExpression += `, ${name} = ${value}`;
    ExpressionAttributeNames[name] = k;
    ExpressionAttributeValues[value] = updates[k];
  });
  
  const res = await dynamoDB.update({
    TableName: PASSKEYS_TABLE,
    Key: { 
      passkeyId,
      userId
    },
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    ReturnValues: 'ALL_NEW'
  }).promise();
  
  return res.Attributes || null;
};

/**
 * Check if user has any passkeys registered
 */
export const userHasPasskey = async (userId) => {
  const passkeys = await getPasskeysByUserId(userId);
  return passkeys.length > 0;
};

/**
 * Delete a passkey
 */
export const deletePasskey = async (passkeyId) => {
  await dynamoDB.delete({
    TableName: PASSKEYS_TABLE,
    Key: { passkeyId }
  }).promise();
  
  return true;
};
