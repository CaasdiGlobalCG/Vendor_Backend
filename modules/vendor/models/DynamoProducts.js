import { dynamoDB } from '../../../config/aws.js';

const PRODUCTS_TABLE = 'Products';

export async function listProductsByVendorId(vendorId) {
  const params = {
    TableName: PRODUCTS_TABLE,
    KeyConditionExpression: 'vendorId = :vendorId',
    ExpressionAttributeValues: {
      ':vendorId': vendorId,
    },
  };

  const result = await dynamoDB.query(params).promise();
  return result.Items || [];
}

export async function getProductById(vendorId, productId) {
  const params = {
    TableName: PRODUCTS_TABLE,
    Key: {
      vendorId,
      productId,
    },
  };

  const result = await dynamoDB.get(params).promise();
  return result.Item || null;
}

export async function putProduct(item) {
  const params = {
    TableName: PRODUCTS_TABLE,
    Item: item,
  };

  await dynamoDB.put(params).promise();
  return item;
}

export async function deleteProductById(vendorId, productId) {
  const params = {
    TableName: PRODUCTS_TABLE,
    Key: {
      vendorId,
      productId,
    },
  };

  await dynamoDB.delete(params).promise();
  return true;
}
