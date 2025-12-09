import { dynamoDB, USERS_TABLE } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

export const createUser = async (userData) => {
  const id = uuidv4();
  const now = new Date().toISOString();
  const item = {
    userId: id,
    id,
    email: userData.email,
    displayName: userData.displayName || userData.email?.split('@')[0] || '',
    lastSelectedRole: userData.lastSelectedRole || userData.role || 'vendor',
    status: userData.status || 'pending',
    hasFilledForm: userData.hasFilledForm || false,
    roleSelected: userData.roleSelected === true,
    createdAt: now,
    updatedAt: now,
  };
  await dynamoDB.put({ TableName: USERS_TABLE, Item: item }).promise();
  return { ...item, _id: id };
};

export const getUserByEmail = async (email) => {
  const res = await dynamoDB.scan({
    TableName: USERS_TABLE,
    FilterExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email },
  }).promise();
  return (res.Items || [])[0] || null;
};

export const updateUser = async (id, updates) => {
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
    TableName: USERS_TABLE,
    Key: { userId: id },
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  }).promise();
  return res.Attributes || null;
};


