import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const quotationsByVendorTable = 'quotations_by_vendor';

/**
 * Get all quotes for a specific vendor from the quotations_by_vendor table
 * @route GET /api/workspace/quotes
 * @access Private
 */
const getWorkspaceQuotes = async (req, res) => {
  try {
    const { vendorId } = req.query;

    if (!vendorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Vendor ID is required' 
      });
    }

    console.log('📋 Fetching workspace quotes for vendor:', vendorId);

    const params = {
      TableName: quotationsByVendorTable,
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
        message: 'No quotes found for this vendor'
      });
    }

    // Transform the data to match the frontend expectations
    const quotes = Items.map(item => {
      const quote = unmarshall(item);
      // Always prefer customQuoteId or quoteNumber for display
      const displayQuoteId = quote.customQuoteId || quote.quoteNumber || quote.quoteCode || quote.quoteNo || '';
      
      return {
        id: displayQuoteId || quote.quotationId,
        quotationId: quote.quotationId, // Keep system-generated ID
        customQuoteId: quote.customQuoteId || quote.quoteNumber || null, // Return custom quote ID for display
        quoteNumber: quote.quoteNumber || quote.customQuoteId || null, // Also return as quoteNumber
        displayQuoteId: displayQuoteId, // Always use Quote# (customQuoteId/quoteNumber) for dashboard display
        date: quote.quoteDate ? new Date(quote.quoteDate).toLocaleDateString('en-GB') : 
              quote.createdAt ? new Date(quote.createdAt).toLocaleDateString('en-GB') : 'N/A',
        customer: quote.customerName || 'Unknown Customer',
        totalAmount: quote.total ? `₹${parseFloat(quote.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 
                     quote.totalAmount ? `₹${parseFloat(quote.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00',
        status: quote.status ? quote.status.charAt(0).toUpperCase() + quote.status.slice(1) : 'Draft',
        vendorId: quote.vendorId,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        // Additional fields from the actual structure
        items: quote.items || [],
        subTotal: quote.subtotal || quote.subTotal || 0,
        total: quote.total || quote.totalAmount || 0,
        cgst: quote.cgst || 0,
        sgst: quote.sgst || 0,
        igst: quote.igst || 0,
        totalTax: quote.totalTax,
        totalCgst: quote.totalCgst || quote.cgst || 0,
        totalSgst: quote.totalSgst || quote.sgst || 0,
        totalIgst: quote.totalIgst || quote.igst || 0,
        discount: quote.discount,
        customerNotes: quote.customerNotes,
        termsAndConditions: quote.termsAndConditions,
        projectName: quote.projectName,
        expiryDate: quote.expiryDate,
        customerDetails: quote.customerDetails
      };
    });

    console.log(`✅ Found ${quotes.length} quotes for vendor ${vendorId}`);

    res.status(200).json({
      success: true,
      data: quotes,
      count: quotes.length,
      message: `Successfully fetched ${quotes.length} quotes`
    });

  } catch (error) {
    console.error('❌ Error fetching workspace quotes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workspace quotes',
      error: error.message
    });
  }
};

/**
 * Get a specific quote by ID from the quotations_by_vendor table
 * @route GET /api/workspace/quotes/:quoteId
 * @access Private
 */
const getWorkspaceQuoteById = async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { vendorId } = req.query;

    if (!quoteId || !vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Quote ID and Vendor ID are required'
      });
    }

    console.log('📋 Fetching workspace quote:', quoteId, 'for vendor:', vendorId);

    const params = {
      TableName: quotationsByVendorTable,
      FilterExpression: 'vendorId = :vendorId AND quotationId = :quotationId',
      ExpressionAttributeValues: {
        ':vendorId': { S: vendorId },
        ':quotationId': { S: quoteId }
      }
    };

    const command = new ScanCommand(params);
    const { Items } = await dbClient.send(command);

    if (!Items || Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }

    const quote = unmarshall(Items[0]);

    // Get quote number from multiple possible fields (customQuoteId, quoteNumber, etc.)
    const displayQuoteId = quote.customQuoteId || quote.quoteNumber || quote.quoteCode || quote.quoteNo || quote.quotationId;

    // Add displayQuoteId and ensure pdfUrl is included
    const quoteWithDisplayId = {
      ...quote,
      customQuoteId: quote.customQuoteId || quote.quoteNumber || null,
      quoteNumber: quote.quoteNumber || quote.customQuoteId || null,
      displayQuoteId: displayQuoteId,
      pdfUrl: quote.pdfUrl || null  // Explicitly include pdfUrl
    };

    res.status(200).json({
      success: true,
      data: quoteWithDisplayId,
      message: 'Quote fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching workspace quote by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quote',
      error: error.message
    });
  }
};

/**
 * Get quotes statistics for a vendor
 * @route GET /api/workspace/quotes/stats/:vendorId
 * @access Private
 */
const getWorkspaceQuotesStats = async (req, res) => {
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }

    console.log('📊 Fetching workspace quotes stats for vendor:', vendorId);

    const params = {
      TableName: quotationsByVendorTable,
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
        data: {
          totalQuotes: 0,
          totalValue: 0,
          approvedQuotes: 0,
          draftQuotes: 0,
          thisMonthQuotes: 0,
          thisMonthValue: 0
        },
        message: 'No quotes found for this vendor'
      });
    }

    const quotes = Items.map(item => unmarshall(item));
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const stats = {
      totalQuotes: quotes.length,
      totalValue: quotes.reduce((sum, quote) => {
        const amount = typeof quote.totalAmount === 'string' 
          ? parseFloat(quote.totalAmount.replace(/,/g, '')) 
          : quote.totalAmount;
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0),
      approvedQuotes: quotes.filter(quote => quote.status === 'Approved').length,
      draftQuotes: quotes.filter(quote => quote.status === 'Draft').length,
      thisMonthQuotes: quotes.filter(quote => {
        const quoteDate = new Date(quote.createdAt || quote.updatedAt);
        return quoteDate.getMonth() === thisMonth && quoteDate.getFullYear() === thisYear;
      }).length,
      thisMonthValue: quotes.filter(quote => {
        const quoteDate = new Date(quote.createdAt || quote.updatedAt);
        return quoteDate.getMonth() === thisMonth && quoteDate.getFullYear() === thisYear;
      }).reduce((sum, quote) => {
        const amount = typeof quote.totalAmount === 'string' 
          ? parseFloat(quote.totalAmount.replace(/,/g, '')) 
          : quote.totalAmount;
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0)
    };

    console.log(`✅ Stats calculated for vendor ${vendorId}:`, stats);

    res.status(200).json({
      success: true,
      data: stats,
      message: 'Quotes statistics fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching workspace quotes stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quotes statistics',
      error: error.message
    });
  }
};

export {
  getWorkspaceQuotes,
  getWorkspaceQuoteById,
  getWorkspaceQuotesStats
};
