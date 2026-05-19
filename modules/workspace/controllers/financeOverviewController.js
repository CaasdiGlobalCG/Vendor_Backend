import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Table names from env vars
const workspaceInvoicesTable = 'workspace_invoices';
const workspaceQuotesTable = 'workspace_quotations';
const salesQuotationsTable = process.env.QUOTATION_OF_VENDOR_TABLE || 'quotations_Of_Vendors';
const b2bOrdersTable = process.env.B2B_ORDERS_TABLE || 'Orders';
const vendorsTable = 'vendors';

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

    // console.log('📊 Fetching finance overview for Cognito sub:', cognitoSub);

    // Look up actual vendorId from vendors table
    const email = req.auth?.email || req.user?.email;
    const vendorId = await getVendorIdFromSub(cognitoSub, email);
    // console.log('📊 Resolved vendorId:', vendorId);

    // Parallel queries to all 4 tables
    const [workspaceInvoices, workspaceQuotes, salesQuotations, b2bOrders] = await Promise.all([
      scanTableByVendorId(workspaceInvoicesTable, 'vendorId', vendorId),
      scanTableByVendorId(workspaceQuotesTable, 'vendorId', vendorId),
      scanTableByVendorId(salesQuotationsTable, 'vendorId', vendorId),
      scanTableByVendorId(b2bOrdersTable, 'userId', vendorId), // B2B uses userId
    ]);

    // console.log('📊 Query results:');
    // console.log('  - workspaceInvoices:', workspaceInvoices.length, 'items');
    // console.log('  - workspaceQuotes:', workspaceQuotes.length, 'items');
    // console.log('  - salesQuotations:', salesQuotations.length, 'items');
    // console.log('  - b2bOrders:', b2bOrders.length, 'items');

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
          totalRevenue: summary.salesRevenue
        },
        b2b: {
          purchases: b2bOrders,
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
 * Scan DynamoDB table and filter by vendorId or userId
 */
const scanTableByVendorId = async (tableName, keyField, value) => {
  try {
    const params = {
      TableName: tableName,
      FilterExpression: `#${keyField} = :value`,
      ExpressionAttributeNames: {
        [`#${keyField}`]: keyField
      },
      ExpressionAttributeValues: {
        ':value': { S: value }
      }
    };

    const command = new ScanCommand(params);
    const { Items } = await dbClient.send(command);

    if (!Items || Items.length === 0) {
      return [];
    }

    return Items.map(item => unmarshall(item));
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
    const salesRevenue = sumAmountsForMonth(salesQuotations, monthStart, monthEnd, 'totalAmount') || 
                         sumAmountsForMonth(salesQuotations, monthStart, monthEnd, 'amount');
    const b2bSpend = sumAmountsForMonth(b2bOrders, monthStart, monthEnd, 'amount');

    monthlyData.push({
      month: monthLabel,
      workspaceRevenue,
      workspaceQuoteValue,
      salesRevenue,
      b2bSpend,
      totalRevenue: workspaceRevenue + salesRevenue,
      totalExpenses: b2bSpend,
      netProfit: workspaceRevenue + salesRevenue - b2bSpend
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
      const amount = typeof item[amountField] === 'string' 
        ? parseFloat(item[amountField].replace(/,/g, '')) 
        : item[amountField];
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
  const salesRevenue = sumAmounts(salesQuotations, 'totalAmount') || sumAmounts(salesQuotations, 'amount');
  const b2bSpend = sumAmounts(b2bOrders, 'amount');

  const totalRevenue = workspaceRevenue + salesRevenue;
  const totalExpenses = b2bSpend;
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0;

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
      workspaceRevenue > 0 ? 'workspace' : null,
      salesRevenue > 0 ? 'sales' : null,
      b2bSpend > 0 ? 'b2b' : null
    ].filter(Boolean).length
  };
};

/**
 * Sum all amounts in an array
 */
const sumAmounts = (items, amountField = 'total') => {
  return items.reduce((sum, item) => {
    const amount = typeof item[amountField] === 'string' 
      ? parseFloat(item[amountField].replace(/,/g, '')) 
      : item[amountField];
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
};

/**
 * Build revenue by source breakdown for doughnut chart
 */
const buildRevenueBySource = ({ workspaceRevenue, salesRevenue }) => {
  const total = workspaceRevenue + salesRevenue;
  
  if (total === 0) {
    return [
      { label: 'No revenue yet', value: 0, color: '#94a3b8' }
    ];
  }

  return [
    { label: 'Workspace Projects', value: workspaceRevenue, color: '#0f766e' },
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
    const amount = typeof quote.totalAmount === 'string' ? parseFloat(quote.totalAmount.replace(/,/g, '')) : quote.totalAmount || 
                  typeof quote.amount === 'string' ? parseFloat(quote.amount.replace(/,/g, '')) : quote.amount;
    transactions.push({
      id: quote.quotationId || 'N/A',
      description: `Sales Quote - ${quote.productName || quote.item || 'RFQ Response'}`,
      date: quote.createdAt,
      amount: amount || 0,
      type: 'income',
      status: quote.status || 'unknown',
      source: 'sales'
    });
  });

  // Process B2B purchases (expenses)
  b2bOrders.forEach(order => {
    const amount = typeof order.amount === 'string' ? parseFloat(order.amount.replace(/,/g, '')) : order.amount;
    transactions.push({
      id: order.orderId || 'N/A',
      description: `B2B Purchase - ${order.productName || 'Order'}`,
      date: order.createdAt || order.date,
      amount: -(amount || 0), // Negative for expenses
      type: 'expense',
      status: order.status || 'unknown',
      source: 'b2b'
    });
  });

  // Sort by date (descending) and take last 10
  return transactions
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);
};

export { getFinanceOverview };
