import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Table names from env vars
const workspaceInvoicesTable = 'workspace_invoices';
const workspaceQuotesTable = 'workspace_quotations';
const salesQuotationsTable = process.env.QUOTATION_OF_VENDOR_TABLE || 'quotations_Of_Vendors';
const b2bDebitNotesTable = 'b2b_debit_notes';
const b2bOrdersTable = process.env.B2B_ORDERS_TABLE || 'Orders';
const vendorsTable = 'vendors';
const clientsTable = 'clients';

/**
 * Get vendorId from Cognito sub by looking up the vendors table
 */
const getVendorIdFromSub = async (cognitoSub, email) => {
  try {
    // First try: scan by cognitoSub or sub field
    const scanParams = {
      TableName: vendorsTable,
      FilterExpression: '#cognitoSub = :cognitoSub OR #sub = :cognitoSub',
      ExpressionAttributeNames: {
        '#cognitoSub': 'cognitoSub',
        '#sub': 'sub'
      },
      ExpressionAttributeValues: {
        ':cognitoSub': { S: cognitoSub }
      }
    };

    const scanCommand = new ScanCommand(scanParams);
    const { Items } = await dbClient.send(scanCommand);

    if (Items && Items.length > 0) {
      const vendor = unmarshall(Items[0]);
      // console.log('📊 Found vendor by cognitoSub/sub:', vendor.vendorId);
      return vendor.vendorId;
    }

    // Second try: if email is provided, scan by email
    if (email) {
      const emailParams = {
        TableName: vendorsTable,
        FilterExpression: '#email = :email',
        ExpressionAttributeNames: {
          '#email': 'email'
        },
        ExpressionAttributeValues: {
          ':email': { S: email.toLowerCase() }
        }
      };

      const emailCommand = new ScanCommand(emailParams);
      const emailResult = await dbClient.send(emailCommand);

      if (emailResult.Items && emailResult.Items.length > 0) {
        const vendor = unmarshall(emailResult.Items[0]);
        // console.log('📊 Found vendor by email:', vendor.vendorId);
        return vendor.vendorId;
      }
    }

    // console.log('⚠️ Could not find vendor record, falling back to Cognito sub');
    return cognitoSub; // Fallback to Cognito sub if lookup fails
  } catch (error) {
    console.error('Error looking up vendorId from sub:', error);
    return cognitoSub; // Fallback to Cognito sub on error
  }
};

/**
 * Get clientId from email by looking up the clients table
 */
const getClientIdFromEmail = async (email) => {
  if (!email) {
    console.log('📊 getClientIdFromEmail: No email provided');
    return null;
  }
  try {
    console.log('📊 getClientIdFromEmail: Looking up clientId for email:', email.toLowerCase());
    const params = {
      TableName: clientsTable,
      FilterExpression: '#email = :email',
      ExpressionAttributeNames: {
        '#email': 'email'
      },
      ExpressionAttributeValues: {
        ':email': { S: email.toLowerCase() }
      }
    };

    console.log('📊 getClientIdFromEmail: Scanning clients table with params:', params);
    const command = new ScanCommand(params);
    const { Items } = await dbClient.send(command);

    if (Items && Items.length > 0) {
      const client = unmarshall(Items[0]);
      console.log('📊 getClientIdFromEmail: Found client record:', { clientId: client.clientId, email: client.email });
      return client.clientId;
    }

    console.log('⚠️ getClientIdFromEmail: Could not find client record for email:', email.toLowerCase());
    return null;
  } catch (error) {
    console.error('❌ getClientIdFromEmail: Error looking up clientId from email:', error);
    return null;
  }
};

/**
 * Get comprehensive financial overview for a vendor
 * Aggregates data from: workspace invoices/quotes, sales quotations, and B2B purchases
 * @route GET /api/finance/overview
 * @access Private (Vendor only)
 */
const getFinanceOverview = async (req, res) => {
  try {
    const cognitoSub = req.auth?.sub || req.user?.sub; // Cognito sub

    if (!cognitoSub) {
      return res.status(400).json({
        success: false,
        message: 'Cognito sub is required'
      });
    }

    console.log('📊 Fetching finance overview for Cognito sub:', cognitoSub);

    // Look up actual vendorId from vendors table
    const email = req.auth?.email || req.user?.email;
    const vendorId = await getVendorIdFromSub(cognitoSub, email);
    console.log('📊 Resolved vendorId:', vendorId);

    // Get clientId from clients table using email
    const clientId = await getClientIdFromEmail(email);
    console.log('📊 Resolved clientId from clients table:', clientId);

    // Parallel queries to all 5 tables
    const [workspaceInvoices, workspaceQuotes, allSalesQuotations, b2bDebitNotes, b2bVendorOrders] = await Promise.all([
      scanTableByVendorId(workspaceInvoicesTable, 'vendorId', vendorId),
      scanTableByVendorId(workspaceQuotesTable, 'vendorId', vendorId),
      scanTableByVendorId(salesQuotationsTable, 'vendorId', vendorId),
      scanTableByVendorId(b2bDebitNotesTable, 'vendorId', vendorId),
      clientId ? scanTableByVendorId(b2bOrdersTable, 'clientId', clientId) : [], // Vendor's own orders use clientId from clients table
    ]);

    console.log('📊 Query results:');
    console.log('  - workspaceInvoices:', workspaceInvoices.length, 'items');
    console.log('  - workspaceQuotes:', workspaceQuotes.length, 'items');
    console.log('  - allSalesQuotations:', allSalesQuotations.length, 'items');
    console.log('  - b2bDebitNotes:', b2bDebitNotes.length, 'items');
    console.log('  - b2bVendorOrders:', b2bVendorOrders.length, 'items');

    // Only count confirmed sales quotations (PO has been raised) as revenue
    const salesQuotations = allSalesQuotations.filter(
      q => String(q.status ?? '').trim().toLowerCase() === 'po raised for order'
    );
    console.log('  - confirmed salesQuotations (po raised for order):', salesQuotations.length, 'items');

    // Combine both B2B expense sources: debit notes from logistics + vendor's own orders
    const b2bOrders = [...b2bDebitNotes, ...b2bVendorOrders];
    console.log('  - combined b2bOrders:', b2bOrders.length, 'items');
    
    // Log B2B orders details
    console.log('  - B2B Debit Notes details:', b2bDebitNotes.map(note => ({
      id: note.debitNoteId || note.orderId,
      amount: note.totalAmount || note.amount || note.subtotal
    })));
    console.log('  - B2B Vendor Orders details:', b2bVendorOrders.map(order => ({
      id: order.orderId,
      amount: order.amount
    })));

    // Process and aggregate data
    const monthlyData = buildMonthlyData({
      workspaceInvoices,
      workspaceQuotes,
      salesQuotations,
      b2bOrders
    });

    const summary = buildSummary({
      workspaceInvoices,
      workspaceQuotes,
      salesQuotations,
      b2bOrders
    });

    const revenueBySource = buildRevenueBySource({
      workspaceRevenue: summary.workspaceRevenue,
      workspaceQuoteValue: summary.workspaceQuoteValue,
      salesRevenue: summary.salesRevenue
    });

    const recentTransactions = buildRecentTransactions({
      workspaceInvoices,
      workspaceQuotes,
      salesQuotations,
      b2bOrders
    });

    res.status(200).json({
      success: true,
      data: {
        workspace: {
          invoices: workspaceInvoices,
          quotes: workspaceQuotes,
          totalRevenue: summary.workspaceRevenue
        },
        sales: {
          quotations: salesQuotations,
          allQuotations: allSalesQuotations,
          totalRevenue: summary.salesRevenue
        },
        b2b: {
          debitNotes: b2bDebitNotes,
          orders: b2bVendorOrders,
          totalSpend: summary.b2bSpend
        },
        summary,
        monthlyData,
        revenueBySource,
        recentTransactions
      },
      message: 'Financial overview fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching finance overview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch financial overview',
      error: error.message
    });
  }
};

/**
 * Scan DynamoDB table and filter by a key field, with full pagination.
 */
const scanTableByVendorId = async (tableName, keyField, value) => {
  try {
    const baseParams = {
      TableName: tableName,
      FilterExpression: `#${keyField} = :value`,
      ExpressionAttributeNames: { [`#${keyField}`]: keyField },
      ExpressionAttributeValues: { ':value': { S: value } }
    };

    let allItems = [];
    let lastKey = undefined;

    do {
      const params = lastKey ? { ...baseParams, ExclusiveStartKey: lastKey } : baseParams;
      const result = await dbClient.send(new ScanCommand(params));
      if (result.Items) {
        allItems = allItems.concat(result.Items.map(item => unmarshall(item)));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allItems;
  } catch (error) {
    console.error(`Error scanning table ${tableName}:`, error);
    return [];
  }
};

/**
 * Build monthly breakdown data for charts
 * Returns array of 12 months with revenue/expense per stream
 */
const buildMonthlyData = ({ workspaceInvoices, workspaceQuotes, salesQuotations, b2bOrders }) => {
  const monthlyData = [];
  const now = new Date();
  
  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

    const workspaceRevenue = sumAmountsForMonth(workspaceInvoices, monthStart, monthEnd, 'total');
    const workspaceQuoteValue = sumAmountsForMonth(workspaceQuotes, monthStart, monthEnd, 'total');
    const salesRevenue = sumSalesQuotationAmountsForMonth(salesQuotations, monthStart, monthEnd);
    const b2bSpend = sumAmountsForMonth(b2bOrders, monthStart, monthEnd, 'totalAmount');

    monthlyData.push({
      month: monthLabel,
      workspaceRevenue,
      workspaceQuoteValue,
      salesRevenue,
      b2bSpend,
      totalRevenue: workspaceRevenue + workspaceQuoteValue + salesRevenue,
      totalExpenses: b2bSpend,
      netProfit: workspaceRevenue + workspaceQuoteValue + salesRevenue - b2bSpend
    });
  }

  return monthlyData;
};

/**
 * Sum amounts for items within a date range
 */
const sumAmountsForMonth = (items, monthStart, monthEnd, amountField = 'total') => {
  return items.reduce((sum, item) => {
    const itemDate = item.invoiceDate || item.quoteDate || item.createdAt || item.poDate;
    if (!itemDate) return sum;

    const date = new Date(itemDate);
    if (date >= monthStart && date <= monthEnd) {
      // Try multiple field names for B2B orders
      let amount = item[amountField];
      if (!amount || isNaN(amount)) {
        amount = item.amount || item.totalAmount || item.subtotal;
      }
      if (typeof amount === 'string') {
        amount = parseFloat(amount.replace(/,/g, ''));
      }
      return sum + (isNaN(amount) ? 0 : amount);
    }
    return sum;
  }, 0);
};

/**
 * Build summary KPIs
 */
const buildSummary = ({ workspaceInvoices, workspaceQuotes, salesQuotations, b2bOrders }) => {
  const workspaceRevenue = sumAmounts(workspaceInvoices, 'total');
  const workspaceQuoteValue = sumAmounts(workspaceQuotes, 'total');
  const salesRevenue = sumSalesQuotationAmounts(salesQuotations);
  const b2bSpend = sumAmounts(b2bOrders, 'totalAmount');
  
  console.log('📊 buildSummary: B2B spend calculation:');
  console.log('  - b2bOrders length:', b2bOrders.length);
  console.log('  - b2bSpend (using totalAmount field):', b2bSpend);
  
  // Also try with 'amount' field for vendor orders
  const b2bSpendAmountField = sumAmounts(b2bOrders, 'amount');
  console.log('  - b2bSpend (using amount field):', b2bSpendAmountField);

  const totalRevenue = workspaceRevenue + workspaceQuoteValue + salesRevenue;
  const totalExpenses = b2bSpend;
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0;

  console.log('📊 buildSummary: Summary:');
  console.log('  - totalRevenue:', totalRevenue);
  console.log('  - totalExpenses:', totalExpenses);
  console.log('  - netProfit:', netProfit);

  // Calculate growth (simple month-over-month comparison)
  const monthlyData = buildMonthlyData({ workspaceInvoices, workspaceQuotes, salesQuotations, b2bOrders });
  const lastMonth = monthlyData[monthlyData.length - 2] || { totalRevenue: 0, totalExpenses: 0 };
  const thisMonth = monthlyData[monthlyData.length - 1] || { totalRevenue: 0, totalExpenses: 0 };
  
  const revenueGrowth = lastMonth.totalRevenue > 0 
    ? (((thisMonth.totalRevenue - lastMonth.totalRevenue) / lastMonth.totalRevenue) * 100).toFixed(1)
    : 0;
  const expenseGrowth = lastMonth.totalExpenses > 0
    ? (((thisMonth.totalExpenses - lastMonth.totalExpenses) / lastMonth.totalExpenses) * 100).toFixed(1)
    : 0;

  return {
    totalRevenue,
    totalExpenses,
    netProfit,
    profitMargin: parseFloat(profitMargin),
    revenueGrowth: parseFloat(revenueGrowth),
    expenseGrowth: parseFloat(expenseGrowth),
    workspaceRevenue,
    workspaceQuoteValue,
    salesRevenue,
    b2bSpend,
    activeStreams: [
      workspaceRevenue > 0 ? 'workspace_invoices' : null,
      workspaceQuoteValue > 0 ? 'workspace_quotes' : null,
      salesRevenue > 0 ? 'sales' : null,
      b2bSpend > 0 ? 'b2b' : null
    ].filter(Boolean).length
  };
};

/**
 * Sum amounts from items
 */
const sumAmounts = (items, amountField = 'total') => {
  return items.reduce((sum, item) => {
    // Try multiple field names for B2B orders
    let amount = item[amountField];
    if (!amount || isNaN(amount)) {
      amount = item.amount || item.totalAmount || item.subtotal;
    }
    if (typeof amount === 'string') {
      amount = parseFloat(amount.replace(/,/g, ''));
    }
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
};

/**
 * Resolve the monetary value of a sales quotation.
 * The quotations_Of_Vendors table stores amounts as quantity × rate.
 * Falls back through totalAmount → amount → totalCost → quantity*rate.
 */
const getSalesQuotationAmount = (quote) => {
  const parse = (val) => {
    if (val === undefined || val === null) return NaN;
    const n = typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : Number(val);
    return isNaN(n) ? NaN : n;
  };

  for (const field of ['totalAmount', 'amount', 'totalCost', 'grandTotal']) {
    const val = parse(quote[field]);
    if (!isNaN(val) && val > 0) return val;
  }

  const qty = parse(quote.quantity);
  const rate = parse(quote.rate);
  if (!isNaN(qty) && !isNaN(rate)) return qty * rate;

  return 0;
};

/**
 * Sum sales quotation amounts using getSalesQuotationAmount
 */
const sumSalesQuotationAmounts = (items) =>
  items.reduce((sum, item) => sum + getSalesQuotationAmount(item), 0);

/**
 * Sum sales quotation amounts within a date range
 */
const sumSalesQuotationAmountsForMonth = (items, monthStart, monthEnd) =>
  items.reduce((sum, item) => {
    const itemDate = item.createdAt || item.invoiceDate || item.quoteDate;
    if (!itemDate) return sum;
    const date = new Date(itemDate);
    if (date >= monthStart && date <= monthEnd) {
      return sum + getSalesQuotationAmount(item);
    }
    return sum;
  }, 0);

/**
 * Build revenue by source breakdown for doughnut chart
 */
const buildRevenueBySource = ({ workspaceRevenue, workspaceQuoteValue, salesRevenue }) => {
  const total = workspaceRevenue + workspaceQuoteValue + salesRevenue;
  
  if (total === 0) {
    return [
      { label: 'No revenue yet', value: 0, color: '#94a3b8' }
    ];
  }

  return [
    { label: 'Workspace Invoices', value: workspaceRevenue, color: '#0f766e' },
    { label: 'Workspace Quotes', value: workspaceQuoteValue, color: '#0ea5e9' },
    { label: 'Sales (RFQ Responses)', value: salesRevenue, color: '#10b981' }
  ].filter(item => item.value > 0);
};

/**
 * Build recent transactions list (last 10 across all streams)
 */
const buildRecentTransactions = ({ workspaceInvoices, workspaceQuotes, salesQuotations, b2bOrders }) => {
  const transactions = [];

  // Process workspace invoices
  workspaceInvoices.forEach(inv => {
    const amount = typeof inv.total === 'string' ? parseFloat(inv.total.replace(/,/g, '')) : inv.total;
    transactions.push({
      id: inv.invoiceId || inv.customInvoiceId || 'N/A',
      description: inv.projectName || `Invoice - ${inv.customerName || 'Unknown'}`,
      date: inv.invoiceDate || inv.createdAt,
      amount: amount || 0,
      type: 'income',
      status: inv.status || 'unknown',
      source: 'workspace'
    });
  });

  // Process workspace quotes
  workspaceQuotes.forEach(quote => {
    const amount = typeof quote.total === 'string' ? parseFloat(quote.total.replace(/,/g, '')) : quote.total;
    transactions.push({
      id: quote.quotationId || quote.customQuoteId || 'N/A',
      description: `Quote - ${quote.customerName || quote.projectName || 'Unknown'}`,
      date: quote.quoteDate || quote.createdAt,
      amount: amount || 0,
      type: 'income',
      status: quote.status || 'unknown',
      source: 'workspace'
    });
  });

  // Process sales quotations
  salesQuotations.forEach(quote => {
    const amount = getSalesQuotationAmount(quote);
    transactions.push({
      id: quote.quotationId || 'N/A',
      description: `Sales Quote - ${quote.productName || quote.item || 'RFQ Response'}`,
      date: quote.createdAt,
      amount,
      type: 'income',
      status: quote.status || 'unknown',
      source: 'sales'
    });
  });

  // Process B2B debit notes (expenses from logistics)
  b2bOrders.forEach(item => {
    // Debit notes have totalAmount, Orders have amount
    const raw = item.totalAmount ?? item.amount ?? item.subtotal;
    const amount = typeof raw === 'string' ? parseFloat(raw.replace(/,/g, '')) : Number(raw);
    const id = item.debitNoteId || item.orderId || 'N/A';
    const isDebitNote = !!item.debitNoteId;
    transactions.push({
      id,
      description: isDebitNote ? `B2B Debit Note - ${item.orderId || id}` : `B2B Order - ${item.productName || item.orderId || 'Purchase'}`,
      date: item.createdAt || item.issueDate || item.date,
      amount: -(isNaN(amount) ? 0 : amount),
      type: 'expense',
      status: item.status || 'unknown',
      source: 'b2b'
    });
  });

  // Sort by date (descending) and take last 10
  return transactions
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);
};

export { getFinanceOverview };
