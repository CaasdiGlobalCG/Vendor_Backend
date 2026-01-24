import { dynamoDB, USERS_TABLE } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

export const createUser = async (userData) => {
  const id = uuidv4();
  const now = new Date().toISOString();
  const normalizedEmail = String(userData.email || '').trim().toLowerCase();
  const item = {
    userId: id,
    id,
    email: normalizedEmail,
    displayName: userData.displayName || normalizedEmail?.split('@')[0] || '',
    lastSelectedRole: userData.lastSelectedRole || userData.role,
    lastSelectedRoleUpdatedAt: userData.lastSelectedRoleUpdatedAt || null,
    status: userData.status || 'pending',
    hasFilledForm: userData.hasFilledForm || false,
    roleSelected: userData.roleSelected === true,
    hasPasskey: userData.hasPasskey || false,
    passkeyRegisteredAt: userData.passkeyRegisteredAt || null,
    createdAt: now,
    updatedAt: now,
  };
  await dynamoDB.put({ TableName: USERS_TABLE, Item: item }).promise();
  return { ...item, _id: id };
};

export const getUserByEmail = async (email) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const res = await dynamoDB.scan({
    TableName: USERS_TABLE,
    FilterExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': normalizedEmail },
  }).promise();
  if ((res.Items || []).length > 0) return (res.Items || [])[0] || null;

  // Backward-compat: older records may have mixed-case emails stored.
  if (normalizedEmail !== String(email || '').trim()) {
    const res2 = await dynamoDB.scan({
      TableName: USERS_TABLE,
      FilterExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': String(email || '').trim() },
    }).promise();
    return (res2.Items || [])[0] || null;
  }

  return null;
};

export const getUserById = async (id) => {
  // Some environments use userId as PK, others use id.
  const res = await dynamoDB.get({
    TableName: USERS_TABLE,
    Key: { userId: id },
  }).promise();
  if (res.Item) return res.Item;

  const res2 = await dynamoDB.get({
    TableName: USERS_TABLE,
    Key: { id },
  }).promise();
  return res2.Item || null;
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

  const doUpdate = async (key) => {
    const res = await dynamoDB.update({
      TableName: USERS_TABLE,
      Key: key,
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }).promise();
    return res.Attributes || null;
  };

  try {
    return await doUpdate({ userId: id });
  } catch (e) {
    // If the table PK isn't userId, retry with id.
    if (e?.code === 'ValidationException') {
      return await doUpdate({ id });
    }
    throw e;
  }
};


