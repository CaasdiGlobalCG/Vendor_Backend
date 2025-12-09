import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

const WORKSPACE_SUBSCRIPTIONS_TABLE = process.env.WORKSPACE_SUBSCRIPTIONS_TABLE || 'workspace_subscriptions';
const WORKSPACE_INVOICES_TABLE = process.env.WORKSPACE_INVOICES_TABLE || 'workspace_invoices';

/**
 * Get subscription analytics and revenue forecasting
 * @route GET /api/workspace/subscriptions/analytics/forecast
 * @access Private
 */
const getRevenueForecasting = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log(`📊 Fetching revenue forecast for vendor ${vendorId}`);

    let subscriptions = [];

    if (userRole === 'pm') {
      const params = { TableName: WORKSPACE_SUBSCRIPTIONS_TABLE };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        subscriptions = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own analytics'
        });
      }

      const params = {
        TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: marshall({
          ':vendorId': vendorId
        })
      };
      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        subscriptions = Items.map(item => unmarshall(item));
      }
    }

    // Filter only active subscriptions
    const activeSubscriptions = subscriptions.filter(s => s.status === 'active');

    // Calculate current monthly recurring revenue (MRR)
    const monthlySubscriptions = activeSubscriptions.filter(s => s.billingCycle === 'Monthly');
    const quarterlySubscriptions = activeSubscriptions.filter(s => s.billingCycle === 'Quarterly');
    const annualSubscriptions = activeSubscriptions.filter(s => s.billingCycle === 'Annual');

    const currentMRR = monthlySubscriptions.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0) +
                       (quarterlySubscriptions.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0) / 3) +
                       (annualSubscriptions.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0) / 12);

    // Calculate annual recurring revenue (ARR)
    const currentARR = currentMRR * 12;

    // Generate 12-month forecast
    const forecast = generateMonthlyForecast(activeSubscriptions, 12);

    // Calculate growth metrics
    const totalActiveSubscriptions = activeSubscriptions.length;
    const avgSubscriptionValue = activeSubscriptions.length > 0 
      ? activeSubscriptions.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0) / activeSubscriptions.length 
      : 0;

    // Calculate churn rate (paused/cancelled subscriptions)
    const pausedSubscriptions = subscriptions.filter(s => s.status === 'paused').length;
    const cancelledSubscriptions = subscriptions.filter(s => s.status === 'cancelled').length;
    const totalSubscriptions = subscriptions.length;
    const churnRate = totalSubscriptions > 0 ? ((pausedSubscriptions + cancelledSubscriptions) / totalSubscriptions) * 100 : 0;

    // Breakdown by billing cycle
    const billingCycleBreakdown = {
      monthly: {
        count: monthlySubscriptions.length,
        revenue: monthlySubscriptions.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0)
      },
      quarterly: {
        count: quarterlySubscriptions.length,
        revenue: quarterlySubscriptions.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0)
      },
      annual: {
        count: annualSubscriptions.length,
        revenue: annualSubscriptions.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0)
      }
    };

    res.status(200).json({
      success: true,
      data: {
        currentMetrics: {
          totalActiveSubscriptions,
          currentMRR,
          currentARR,
          avgSubscriptionValue,
          churnRate: churnRate.toFixed(2)
        },
        billingCycleBreakdown,
        forecast,
        subscriptionsByStatus: {
          active: activeSubscriptions.length,
          paused: pausedSubscriptions,
          cancelled: cancelledSubscriptions
        }
      },
      message: 'Revenue forecast generated successfully'
    });

  } catch (error) {
    console.error('❌ Error generating revenue forecast:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate revenue forecast',
      error: error.message
    });
  }
};

/**
 * Generate monthly forecast for next N months
 */
const generateMonthlyForecast = (subscriptions, months) => {
  const forecast = [];
  const today = new Date();

  for (let i = 0; i < months; i++) {
    const forecastDate = new Date(today);
    forecastDate.setMonth(forecastDate.getMonth() + i);

    let monthlyRevenue = 0;
    let billingCount = 0;

    subscriptions.forEach(sub => {
      const nextBillingDate = new Date(sub.nextBillingDate);
      
      // Check if subscription will bill in this month
      if (nextBillingDate.getMonth() === forecastDate.getMonth() &&
          nextBillingDate.getFullYear() === forecastDate.getFullYear()) {
        monthlyRevenue += parseFloat(sub.amount) || 0;
        billingCount++;
      }
    });

    // Add baseline MRR from monthly subscriptions
    const monthlyBaseline = subscriptions
      .filter(s => s.billingCycle === 'Monthly')
      .reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);

    forecast.push({
      month: forecastDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }),
      projectedRevenue: monthlyBaseline + monthlyRevenue,
      billingCount,
      date: forecastDate.toISOString()
    });
  }

  return forecast;
};

/**
 * Get subscription cohort analysis
 * @route GET /api/workspace/subscriptions/analytics/cohorts
 * @access Private
 */
const getCohortAnalysis = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log(`📊 Fetching cohort analysis for vendor ${vendorId}`);

    let subscriptions = [];

    if (userRole === 'pm') {
      const params = { TableName: WORKSPACE_SUBSCRIPTIONS_TABLE };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        subscriptions = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own analytics'
        });
      }

      const params = {
        TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: marshall({
          ':vendorId': vendorId
        })
      };
      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        subscriptions = Items.map(item => unmarshall(item));
      }
    }

    // Group subscriptions by creation month
    const cohorts = {};

    subscriptions.forEach(sub => {
      const createdDate = new Date(sub.createdAt);
      const cohortMonth = createdDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });

      if (!cohorts[cohortMonth]) {
        cohorts[cohortMonth] = {
          created: 0,
          active: 0,
          paused: 0,
          cancelled: 0,
          totalRevenue: 0
        };
      }

      cohorts[cohortMonth].created++;
      cohorts[cohortMonth][sub.status]++;
      cohorts[cohortMonth].totalRevenue += parseFloat(sub.amount) || 0;
    });

    res.status(200).json({
      success: true,
      data: cohorts,
      message: 'Cohort analysis generated successfully'
    });

  } catch (error) {
    console.error('❌ Error generating cohort analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate cohort analysis',
      error: error.message
    });
  }
};

export {
  getRevenueForecasting,
  getCohortAnalysis
};
