import { dynamoDB } from '../../../config/aws.js';

const PRODUCTS_TABLE = 'Products';

// NOTE: the Products table's only key is productId (HASH). There is no
// vendorId GSI, so vendor-scoped listing must scan + filter.
export async function listProductsByVendorId(vendorId) {
  const items = [];
  let lastKey;

  do {
    const result = await dynamoDB
      .scan({
        TableName: PRODUCTS_TABLE,
        FilterExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': vendorId,
        },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      })
      .promise();

    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

export async function getProductById(vendorId, productId) {
  const params = {
    TableName: PRODUCTS_TABLE,
    Key: {
      productId,
    },
  };

  const result = await dynamoDB.get(params).promise();
  const item = result.Item || null;

  // Enforce the vendor scope — callers rely on this for ownership checks.
  if (item && vendorId && item.vendorId !== vendorId) {
    return null;
  }
  return item;
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
      productId,
    },
  };

  await dynamoDB.delete(params).promise();
  return true;
}
