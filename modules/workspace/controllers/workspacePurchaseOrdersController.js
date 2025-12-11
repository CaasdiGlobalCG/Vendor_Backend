import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Table name
const WORKSPACE_PURCHASE_ORDERS_TABLE = 'workspace_purchase_orders';

/**
 * Get all purchase orders for a specific vendor from the workspace_purchase_orders table
 * @route GET /api/workspace/purchase-orders
 * @access Private
 */
const getWorkspacePurchaseOrders = async (req, res) => {
  try {
    const { vendorId, status } = req.query;

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }

    console.log('📋 Fetching workspace purchase orders for vendor:', vendorId, 'status filter:', status);

    // Base filter: all POs for this vendor
    let filterExpression = 'vendorId = :vendorId';
    const expressionAttributeValues = {
      ':vendorId': { S: vendorId }
    };
    const expressionAttributeNames = {};

    // Optional status filter (e.g. "requested for invoice")
    if (status) {
      filterExpression += ' AND #status = :status';
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = { S: status };
    }

    const params = {
      TableName: WORKSPACE_PURCHASE_ORDERS_TABLE,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(Object.keys(expressionAttributeNames).length > 0 && {
        ExpressionAttributeNames: expressionAttributeNames
      })
    };

    const command = new ScanCommand(params);
    const { Items } = await dbClient.send(command);

    if (!Items || Items.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No purchase orders found for this vendor'
      });
    }

    // Transform the data to match the frontend expectations
    const purchaseOrders = Items.map((item) => {
      const po = unmarshall(item);

      const displayPoId = po.customPoId || po.purchaseOrderNumber || po.purchaseOrderId;
      const rawTotal =
        po.total ??
        (typeof po.totalAmount === 'string'
          ? parseFloat(po.totalAmount.replace(/,/g, ''))
          : po.totalAmount) ??
        0;

      return {
        id: displayPoId,
        purchaseOrderId: po.purchaseOrderId,
        customPoId: po.customPoId || null,
        referenceQuoteNumber: po.referenceQuoteNumber || null,
        date: po.purchaseOrderDate
          ? new Date(po.purchaseOrderDate).toLocaleDateString('en-GB')
          : po.createdAt
          ? new Date(po.createdAt).toLocaleDateString('en-GB')
          : 'N/A',
        project: po.projectName || po.workspaceName || 'Project',
        vendor: po.vendorName || 'You',
        email: po.vendorEmail || '',
        // Count for summary display
        items: Array.isArray(po.items) ? po.items.length : 0,
        // Full items list for conversions (e.g. PO -> Invoice)
        itemsList: Array.isArray(po.items) ? po.items : [],
        customerDetails: po.customerDetails || null,
        customerName: po.customerName || '',
        amount: `₹${Number(rawTotal).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`,
        statusType: po.statusType || 'pending',
        status: po.status || 'Pending',
        purchaseReturns: po.purchaseReturns || 'None',
        vendorId: po.vendorId,
        clientId: po.clientId || null,
        workspaceId: po.workspaceId || null,
        workspaceName: po.workspaceName || '',
        taskId: po.taskId || null,
        taskName: po.taskName || '',
        subtaskId: po.subtaskId || null,
        subtaskName: po.subtaskName || '',
        quotationId: po.quotationId || null
      };
    });

    console.log(`✅ Found ${purchaseOrders.length} purchase orders for vendor ${vendorId}`);

    res.status(200).json({
      success: true,
      data: purchaseOrders,
      count: purchaseOrders.length,
      message: `Successfully fetched ${purchaseOrders.length} purchase orders`
    });
  } catch (error) {
    console.error('❌ Error fetching workspace purchase orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workspace purchase orders',
      error: error.message
    });
  }
};

export { getWorkspacePurchaseOrders };


