import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
        // Include PDF URL for preview (primary: pdfUrl, fallback: poPdfUrl, commissionedPurchaseOrderUrl)
        pdfUrl: po.pdfUrl || po.poPdfUrl || po.commissionedPurchaseOrderUrl || '',
        poPdfUrl: po.poPdfUrl || '',
        commissionedPurchaseOrderUrl: po.commissionedPurchaseOrderUrl || '',
        invoicePdfUrl: po.invoicePdfUrl || '',
        commissionedInvoicePdfUrl: po.commissionedInvoicePdfUrl || '',
        invoiceCommissionStatus: po.invoiceCommissionStatus || '',
        invoiceCommissionSummary: po.invoiceCommissionSummary || null,
        source: po.source || '',
        sourceType: po.sourceType || '',
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

/**
 * Vendor approves a Purchase Order and sends it to PM
 * @route POST /api/workspace/purchase-orders/:poId/vendor-approve
 * @access Private (Vendor)
 */
const vendorApprovePurchaseOrder = async (req, res) => {
  try {
    const { poId } = req.params;
    const { vendorId, vendorName, approvalDate } = req.body;

    console.log('🔍 [VENDOR APPROVE] Route handler called');
    console.log('📋 Parameters:', { poId, vendorId, vendorName, approvalDate });

    if (!poId || !vendorId) {
      console.warn('⚠️ [VENDOR APPROVE] Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: poId, vendorId'
      });
    }

    console.log('🔄 Vendor approving PO:', { poId, vendorId, vendorName });

    // First, scan to find the PO and get its actual key structure
    const scanParams = {
      TableName: WORKSPACE_PURCHASE_ORDERS_TABLE,
      FilterExpression: 'purchaseOrderId = :poId OR customPoId = :poId OR purchaseOrderNumber = :poId',
      ExpressionAttributeValues: {
        ':poId': { S: poId }
      }
    };

    const scanCommand = new ScanCommand(scanParams);
    const scanResult = await dbClient.send(scanCommand);
    
    if (!scanResult.Items || scanResult.Items.length === 0) {
      console.warn('⚠️ PO not found via scan:', poId);
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    const existingPO = unmarshall(scanResult.Items[0]);
    console.log('📦 Found PO via scan:', { 
      purchaseOrderId: existingPO.purchaseOrderId, 
      vendorId: existingPO.vendorId,
      status: existingPO.status 
    });

    // Verify vendor owns this PO
    if (existingPO.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'Vendor not authorized to approve this PO'
      });
    }

    // Build key candidates based on what's in the record
    const keyCandidates = [];
    
    // Try composite key: vendorId + purchaseOrderId
    if (existingPO.vendorId && existingPO.purchaseOrderId) {
      keyCandidates.push({
        vendorId: existingPO.vendorId,
        purchaseOrderId: existingPO.purchaseOrderId
      });
    }
    
    // Try single key: purchaseOrderId only
    if (existingPO.purchaseOrderId) {
      keyCandidates.push({
        purchaseOrderId: existingPO.purchaseOrderId
      });
    }

    const nowIso = new Date().toISOString();
    let updatedPO = null;
    let lastError = null;

    // Try each key candidate until one works
    for (const key of keyCandidates) {
      try {
        console.log('🔑 Trying key schema:', key);
        
        const updateParams = {
          TableName: WORKSPACE_PURCHASE_ORDERS_TABLE,
          Key: key,
          UpdateExpression: 'SET #status = :status, #statusType = :statusType, vendorApprovalDate = :approvalDate, vendorApprovedBy = :vendorName, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#statusType': 'statusType'
          },
          ExpressionAttributeValues: {
            ':status': 'vendor_approved',
            ':statusType': 'vendor_approved',
            ':approvalDate': approvalDate || nowIso,
            ':vendorName': vendorName || 'Vendor',
            ':updatedAt': nowIso
          },
          ReturnValues: 'ALL_NEW'
        };

        const updateCommand = new UpdateCommand(updateParams);
        const updateResult = await dbClient.send(updateCommand);
        updatedPO = updateResult.Attributes;
        console.log('✅ Update succeeded with key schema:', key);
        break; // Success - exit the loop
      } catch (err) {
        console.warn('⚠️ Key schema failed:', key, err.message);
        lastError = err;
        // Continue to next key candidate
      }
    }

    if (!updatedPO) {
      console.error('❌ All key schemas failed. Last error:', lastError);
      return res.status(500).json({
        success: false,
        message: 'Unable to update purchase order - key schema mismatch',
        error: lastError?.message
      });
    }

    console.log('✅ PO status updated to vendor_approved:', poId);

    // TODO: Create notification for PM about vendor approval
    // This should trigger a notification to the PM who created the PO
    // notificationService.notifyPM({
    //   pmId: existingPO.createdBy,
    //   message: `Vendor has approved PO ${poId}`,
    //   poId: poId,
    //   type: 'po_vendor_approved'
    // });

    res.status(200).json({
      success: true,
      message: 'Purchase order approved and sent to PM',
      data: updatedPO
    });
  } catch (error) {
    console.error('❌ Error vendor approving PO:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve purchase order',
      error: error.message
    });
  }
};

export { getWorkspacePurchaseOrders, vendorApprovePurchaseOrder };


