import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Table names
const creditNotesByVendorTable = 'workspace_credit_notes';

/**
 * Get all credit notes for a specific vendor from the workspace_credit_notes table
 * @route GET /api/workspace/credit-notes
 * @access Private
 */
const getWorkspaceCreditNotes = async (req, res) => {
  try {
    const { vendorId } = req.query;

    if (!vendorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Vendor ID is required' 
      });
    }

    console.log('📋 Fetching workspace credit notes for vendor:', vendorId);

    const params = {
      TableName: creditNotesByVendorTable,
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
        message: 'No credit notes found for this vendor'
      });
    }

    // Transform the data to match the frontend expectations
    const creditNotes = Items.map(item => {
      const creditNote = unmarshall(item);
      // Always prefer customCreditNoteId or creditNoteNumber for display
      const displayCreditNoteId = creditNote.customCreditNoteId || creditNote.creditNoteNumber || creditNote.creditNoteCode || creditNote.creditNoteNo || '';
      
      return {
        id: displayCreditNoteId || creditNote.creditNoteId,
        creditNoteId: creditNote.creditNoteId, // Keep system-generated ID
        customCreditNoteId: creditNote.customCreditNoteId || creditNote.creditNoteNumber || null,
        creditNoteNumber: creditNote.creditNoteNumber || creditNote.customCreditNoteId || null,
        displayCreditNoteId: displayCreditNoteId,
        date: creditNote.creditNoteDate ? new Date(creditNote.creditNoteDate).toLocaleDateString('en-GB') : 
              creditNote.createdAt ? new Date(creditNote.createdAt).toLocaleDateString('en-GB') : 'N/A',
        customer: creditNote.customerName || 'Unknown Customer',
        totalAmount: creditNote.total ? `₹${parseFloat(creditNote.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 
                     creditNote.totalAmount ? `₹${parseFloat(creditNote.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00',
        status: creditNote.status ? creditNote.status.charAt(0).toUpperCase() + creditNote.status.slice(1) : 'Draft',
        vendorId: creditNote.vendorId,
        createdAt: creditNote.createdAt,
        updatedAt: creditNote.updatedAt,
        // Additional fields from the actual structure
        items: creditNote.items || [],
        subTotal: creditNote.subtotal || creditNote.subTotal || 0,
        total: creditNote.total || creditNote.totalAmount || 0,
        cgst: creditNote.cgst || 0,
        sgst: creditNote.sgst || 0,
        igst: creditNote.igst || 0,
        totalTax: creditNote.totalTax,
        totalCgst: creditNote.totalCgst || creditNote.cgst || 0,
        totalSgst: creditNote.totalSgst || creditNote.sgst || 0,
        totalIgst: creditNote.totalIgst || creditNote.igst || 0,
        discount: creditNote.discount,
        customerNotes: creditNote.customerNotes,
        termsAndConditions: creditNote.termsAndConditions,
        projectName: creditNote.projectName,
        customerDetails: creditNote.customerDetails,
        invoiceId: creditNote.invoiceId // Reference to original invoice
      };
    });

    console.log(`✅ Found ${creditNotes.length} credit notes for vendor ${vendorId}`);

    res.status(200).json({
      success: true,
      data: creditNotes,
      count: creditNotes.length,
      message: `Successfully fetched ${creditNotes.length} credit notes`
    });

  } catch (error) {
    console.error('❌ Error fetching workspace credit notes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workspace credit notes',
      error: error.message
    });
  }
};

/**
 * Get a specific credit note by ID from the workspace_credit_notes table
 * @route GET /api/workspace/credit-notes/:creditNoteId
 * @access Private
 */
const getWorkspaceCreditNoteById = async (req, res) => {
  try {
    const { creditNoteId } = req.params;
    const { vendorId } = req.query;

    if (!creditNoteId || !vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Credit Note ID and Vendor ID are required'
      });
    }

    console.log('📋 Fetching workspace credit note:', creditNoteId, 'for vendor:', vendorId);

    const params = {
      TableName: creditNotesByVendorTable,
      Key: marshall({
        vendorId: vendorId,
        creditNoteId: creditNoteId
      })
    };

    const command = new GetItemCommand(params);
    const { Item } = await dbClient.send(command);

    if (!Item) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found'
      });
    }

    const creditNote = unmarshall(Item);

    // Get credit note number from multiple possible fields
    const displayCreditNoteId = creditNote.customCreditNoteId || creditNote.creditNoteNumber || creditNote.creditNoteCode || creditNote.creditNoteNo || creditNote.creditNoteId;

    // Add displayCreditNoteId for consistency
    const creditNoteWithDisplayId = {
      ...creditNote,
      customCreditNoteId: creditNote.customCreditNoteId || creditNote.creditNoteNumber || null,
      creditNoteNumber: creditNote.creditNoteNumber || creditNote.customCreditNoteId || null,
      displayCreditNoteId: displayCreditNoteId
    };

    res.status(200).json({
      success: true,
      data: creditNoteWithDisplayId,
      message: 'Credit note fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching workspace credit note by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit note',
      error: error.message
    });
  }
};

/**
 * Get credit notes statistics for a vendor
 * @route GET /api/workspace/credit-notes/stats
 * @access Private
 */
const getCreditNoteStats = async (req, res) => {
  try {
    const { vendorId } = req.query;

    if (!vendorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Vendor ID is required' 
      });
    }

    const params = {
      TableName: creditNotesByVendorTable,
      FilterExpression: 'vendorId = :vendorId',
      ExpressionAttributeValues: {
        ':vendorId': { S: vendorId }
      }
    };

    const command = new ScanCommand(params);
    const { Items } = await dbClient.send(command);

    const creditNotes = Items ? Items.map(item => unmarshall(item)) : [];

    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();

    const stats = {
      totalCreditNotes: creditNotes.length,
      totalAmount: creditNotes.reduce((sum, creditNote) => {
        const amount = typeof creditNote.total === 'string'
          ? parseFloat(creditNote.total.replace(/,/g, ''))
          : creditNote.total;
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0),
      approvedCreditNotes: creditNotes.filter(creditNote => creditNote.status?.toLowerCase() === 'approved').length,
      thisMonthCreditNotes: creditNotes.filter(creditNote => {
        const creditNoteDate = new Date(creditNote.creditNoteDate || creditNote.createdAt);
        return creditNoteDate.getMonth() === thisMonth && creditNoteDate.getFullYear() === thisYear;
      }).length,
      thisMonthAmount: creditNotes.filter(creditNote => {
        const creditNoteDate = new Date(creditNote.creditNoteDate || creditNote.createdAt);
        return creditNoteDate.getMonth() === thisMonth && creditNoteDate.getFullYear() === thisYear;
      }).reduce((sum, creditNote) => {
        const amount = typeof creditNote.total === 'string'
          ? parseFloat(creditNote.total.replace(/,/g, ''))
          : creditNote.total;
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0)
    };

    res.status(200).json({
      success: true,
      data: stats,
      message: 'Credit note statistics fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching credit note stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit note statistics',
      error: error.message
    });
  }
};

export { getWorkspaceCreditNotes, getWorkspaceCreditNoteById, getCreditNoteStats };

