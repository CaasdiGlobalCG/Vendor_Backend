import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Table names
const invoicesByVendorTable = 'workspace_invoices';

/**
 * Get all invoices for a specific vendor from the workspace_invoices table
 * @route GET /api/workspace/invoices
 * @access Private
 */
const getWorkspaceInvoices = async (req, res) => {
  try {
    const { vendorId } = req.query;

    if (!vendorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Vendor ID is required' 
      });
    }

    console.log('📋 Fetching workspace invoices for vendor:', vendorId);

    const params = {
      TableName: invoicesByVendorTable,
      FilterExpression: 'vendorId = :vendorId',
      ExpressionAttributeValues: {
        ':vendorId': { S: vendorId }
      }
    };

    const command = new ScanCommand(params);
    const { Items } = await dbClient.send(command);

    if (!Items || Items.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No invoices found for this vendor'
      });
    }

    // Transform the data to match the frontend expectations
    const invoices = Items.map(item => {
      const invoice = unmarshall(item);
      // Always prefer customInvoiceId or invoiceNumber for display
      const displayInvoiceId = invoice.customInvoiceId || invoice.invoiceNumber || invoice.invoiceCode || invoice.invoiceNo || '';
      
      return {
        id: displayInvoiceId || invoice.invoiceId,
        invoiceId: invoice.invoiceId, // Keep system-generated ID
        customInvoiceId: invoice.customInvoiceId || invoice.invoiceNumber || null,
        invoiceNumber: invoice.invoiceNumber || invoice.customInvoiceId || null,
        displayInvoiceId: displayInvoiceId,
        date: invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('en-GB') : 
              invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('en-GB') : 'N/A',
        dueDate: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-GB') : 'N/A',
        customer: invoice.customerName || 'Unknown Customer',
        totalAmount: invoice.total ? `₹${parseFloat(invoice.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 
                     invoice.totalAmount ? `₹${parseFloat(invoice.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00',
        status: invoice.status ? invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1) : 'Draft',
        vendorId: invoice.vendorId,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
        // Additional fields from the actual structure
        items: invoice.items || [],
        subTotal: invoice.subtotal || invoice.subTotal || 0,
        total: invoice.total || invoice.totalAmount || 0,
        cgst: invoice.cgst || 0,
        sgst: invoice.sgst || 0,
        igst: invoice.igst || 0,
        totalTax: invoice.totalTax,
        totalCgst: invoice.totalCgst || invoice.cgst || 0,
        totalSgst: invoice.totalSgst || invoice.sgst || 0,
        totalIgst: invoice.totalIgst || invoice.igst || 0,
        discount: invoice.discount,
        customerNotes: invoice.customerNotes,
        termsAndConditions: invoice.termsAndConditions,
        projectName: invoice.projectName,
        expiryDate: invoice.expiryDate,
        customerDetails: invoice.customerDetails,
        quoteId: invoice.quoteId // Reference to original quote if converted from quote
      };
    });

    console.log(`✅ Found ${invoices.length} invoices for vendor ${vendorId}`);

    res.status(200).json({
      success: true,
      data: invoices,
      count: invoices.length,
      message: `Successfully fetched ${invoices.length} invoices`
    });

  } catch (error) {
    console.error('❌ Error fetching workspace invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workspace invoices',
      error: error.message
    });
  }
};

/**
 * Get invoice statistics for a vendor
 * @route GET /api/workspace/invoices/stats
 * @access Private
 */
const getInvoiceStats = async (req, res) => {
  try {
    const { vendorId } = req.query;

    if (!vendorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Vendor ID is required' 
      });
    }

    const params = {
      TableName: invoicesByVendorTable,
      FilterExpression: 'vendorId = :vendorId',
      ExpressionAttributeValues: {
        ':vendorId': { S: vendorId }
      }
    };

    const command = new ScanCommand(params);
    const { Items } = await dbClient.send(command);

    const invoices = Items ? Items.map(item => unmarshall(item)) : [];

    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();

    const stats = {
      totalInvoices: invoices.length,
      totalValue: invoices.reduce((sum, invoice) => {
        const amount = typeof invoice.totalAmount === 'string'
          ? parseFloat(invoice.totalAmount.replace(/,/g, ''))
          : invoice.totalAmount;
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0),
      approvedInvoices: invoices.filter(invoice => invoice.status?.toLowerCase() === 'approved by pm').length,
      thisMonthInvoices: invoices.filter(invoice => {
        const invoiceDate = new Date(invoice.invoiceDate || invoice.createdAt);
        return invoiceDate.getMonth() === thisMonth && invoiceDate.getFullYear() === thisYear;
      }).length,
      thisMonthValue: invoices.filter(invoice => {
        const invoiceDate = new Date(invoice.invoiceDate || invoice.createdAt);
        return invoiceDate.getMonth() === thisMonth && invoiceDate.getFullYear() === thisYear;
      }).reduce((sum, invoice) => {
        const amount = typeof invoice.totalAmount === 'string'
          ? parseFloat(invoice.totalAmount.replace(/,/g, ''))
          : invoice.totalAmount;
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0)
    };

    res.status(200).json({
      success: true,
      data: stats,
      message: 'Invoice statistics fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching invoice stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice statistics',
      error: error.message
    });
  }
};

export { getWorkspaceInvoices, getInvoiceStats };
