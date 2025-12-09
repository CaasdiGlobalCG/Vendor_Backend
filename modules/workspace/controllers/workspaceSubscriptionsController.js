import { DynamoDBClient, ScanCommand, QueryCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Table names
const WORKSPACE_SUBSCRIPTIONS_TABLE = process.env.WORKSPACE_SUBSCRIPTIONS_TABLE || 'workspace_subscriptions';
const WORKSPACE_INVOICES_TABLE = process.env.WORKSPACE_INVOICES_TABLE || 'workspace_invoices';

/**
 * Get all subscriptions for a vendor
 * @route GET /api/workspace/subscriptions
 * @access Private
 */
const getWorkspaceSubscriptions = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log(`📋 Fetching subscriptions - Role: ${userRole}, Vendor ID: ${vendorId}`);

    let subscriptions = [];

    if (userRole === 'pm') {
      // PM can see all subscriptions
      const params = {
        TableName: WORKSPACE_SUBSCRIPTIONS_TABLE
      };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        subscriptions = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      // Vendor can only see their own subscriptions
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own subscriptions'
        });
      }

      const params = {
        TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': { S: vendorId }
        }
      };
      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        subscriptions = Items.map(item => unmarshall(item));
      }
    }

    // Transform data for frontend
    const transformedSubscriptions = subscriptions.map(sub => ({
      id: sub.subscriptionId,
      subscriptionId: sub.subscriptionId,
      customSubscriptionId: sub.customSubscriptionId,
      customer: sub.customerName || 'Unknown Customer',
      billingCycle: sub.billingCycle || 'Monthly',
      amount: sub.amount ? `₹${parseFloat(sub.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00',
      status: sub.status || 'active',
      startDate: sub.startDate ? new Date(sub.startDate).toLocaleDateString('en-GB') : 'N/A',
      nextBillingDate: sub.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString('en-GB') : 'N/A',
      createdAt: sub.createdAt,
      ...sub
    }));

    res.status(200).json({
      success: true,
      data: transformedSubscriptions,
      message: 'Subscriptions fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions',
      error: error.message
    });
  }
};

/**
 * Get subscription statistics
 * @route GET /api/workspace/subscriptions/stats
 * @access Private
 */
const getSubscriptionStats = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

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
          message: 'Vendors can only access their own stats'
        });
      }

      const params = {
        TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': { S: vendorId }
        }
      };
      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        subscriptions = Items.map(item => unmarshall(item));
      }
    }

    const activeSubscriptions = subscriptions.filter(s => s.status === 'active').length;
    const totalMonthlyRevenue = subscriptions
      .filter(s => s.status === 'active' && s.billingCycle === 'Monthly')
      .reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
    const totalAnnualRevenue = subscriptions
      .filter(s => s.status === 'active' && s.billingCycle === 'Annual')
      .reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        totalSubscriptions: subscriptions.length,
        activeSubscriptions,
        totalMonthlyRevenue,
        totalAnnualRevenue
      }
    });

  } catch (error) {
    console.error('❌ Error fetching subscription stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription stats',
      error: error.message
    });
  }
};

/**
 * Create a new subscription
 * @route POST /api/workspace/subscriptions
 * @access Private (Vendor only)
 */
const createSubscription = async (req, res) => {
  try {
    console.log('📋 CREATE SUBSCRIPTION - Request body:', req.body);
    
    const {
      vendorId,
      customerId,
      customerName,
      billingCycle,
      amount,
      startDate,
      endDate,
      customSubscriptionId,
      items,
      notes,
      status
    } = req.body;

    const userRole = req.user?.role;

    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can create subscriptions'
      });
    }

    if (!vendorId || !customerId || !billingCycle || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID, customer ID, billing cycle, and amount are required'
      });
    }

    const subscriptionId = `SUB-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    
    // Calculate next billing date based on start date and billing cycle
    const start = new Date(startDate || createdAt);
    let nextBillingDate = new Date(start);
    
    if (billingCycle === 'Monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else if (billingCycle === 'Quarterly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
    } else if (billingCycle === 'Annual') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }

    const subscription = {
      subscriptionId,
      customSubscriptionId: customSubscriptionId || subscriptionId,
      vendorId,
      customerId,
      customerName,
      billingCycle,
      amount: parseFloat(amount),
      startDate: startDate || createdAt,
      endDate: endDate || null,
      nextBillingDate: nextBillingDate.toISOString(),
      items: items || [],
      notes: notes || '',
      status: status || 'active',
      createdAt,
      updatedAt: createdAt,
      invoicesGenerated: 0,
      lastInvoiceDate: null
    };

    const params = {
      TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
      Item: marshall(subscription, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(params));

    console.log(`✅ Created subscription ${subscriptionId} for vendor ${vendorId}`);

    res.status(201).json({
      success: true,
      data: subscription,
      message: 'Subscription created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create subscription',
      error: error.message
    });
  }
};

/**
 * Update a subscription
 * @route PUT /api/workspace/subscriptions/:subscriptionId
 * @access Private (Vendor only)
 */
const updateSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { vendorId, ...updateData } = req.body;
    const userRole = req.user?.role;

    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can update subscriptions'
      });
    }

    const updateExpression = Object.keys(updateData)
      .map((key, index) => `${key} = :val${index}`)
      .join(', ');

    const expressionAttributeValues = {};
    Object.values(updateData).forEach((value, index) => {
      expressionAttributeValues[`:val${index}`] = value;
    });

    const params = {
      TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
      Key: marshall({ subscriptionId }),
      UpdateExpression: `SET ${updateExpression}, updatedAt = :updatedAt`,
      ExpressionAttributeValues: marshall({
        ...expressionAttributeValues,
        ':updatedAt': new Date().toISOString()
      }),
      ReturnValues: 'ALL_NEW'
    };

    const { Attributes } = await dbClient.send(new UpdateItemCommand(params));

    res.status(200).json({
      success: true,
      data: unmarshall(Attributes),
      message: 'Subscription updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update subscription',
      error: error.message
    });
  }
};

/**
 * Delete a subscription
 * @route DELETE /api/workspace/subscriptions/:subscriptionId
 * @access Private (Vendor only)
 */
const deleteSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const userRole = req.user?.role;

    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can delete subscriptions'
      });
    }

    const params = {
      TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
      Key: marshall({ subscriptionId })
    };

    await dbClient.send(new DeleteItemCommand(params));

    res.status(200).json({
      success: true,
      message: 'Subscription deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete subscription',
      error: error.message
    });
  }
};

/**
 * Pause a subscription
 * @route PUT /api/workspace/subscriptions/:subscriptionId/pause
 * @access Private (Vendor only)
 */
const pauseSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const userRole = req.user?.role;

    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can pause subscriptions'
      });
    }

    const params = {
      TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
      Key: marshall({ subscriptionId }),
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, pausedAt = :pausedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: marshall({
        ':status': 'paused',
        ':updatedAt': new Date().toISOString(),
        ':pausedAt': new Date().toISOString()
      }),
      ReturnValues: 'ALL_NEW'
    };

    const { Attributes } = await dbClient.send(new UpdateItemCommand(params));

    console.log(`✅ Paused subscription ${subscriptionId}`);

    res.status(200).json({
      success: true,
      data: unmarshall(Attributes),
      message: 'Subscription paused successfully'
    });

  } catch (error) {
    console.error('❌ Error pausing subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pause subscription',
      error: error.message
    });
  }
};

/**
 * Resume a subscription
 * @route PUT /api/workspace/subscriptions/:subscriptionId/resume
 * @access Private (Vendor only)
 */
const resumeSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const userRole = req.user?.role;

    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can resume subscriptions'
      });
    }

    // Get current subscription to recalculate next billing date
    const getParams = {
      TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
      Key: marshall({ subscriptionId })
    };

    const { Item } = await dbClient.send(new GetItemCommand(getParams));
    if (!Item) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    const subscription = unmarshall(Item);
    
    // Recalculate next billing date from today
    const today = new Date();
    let nextBillingDate = new Date(today);
    
    if (subscription.billingCycle === 'Monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else if (subscription.billingCycle === 'Quarterly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
    } else if (subscription.billingCycle === 'Annual') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }

    const updateParams = {
      TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
      Key: marshall({ subscriptionId }),
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, nextBillingDate = :nextBillingDate, resumedAt = :resumedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: marshall({
        ':status': 'active',
        ':updatedAt': new Date().toISOString(),
        ':nextBillingDate': nextBillingDate.toISOString(),
        ':resumedAt': new Date().toISOString()
      }),
      ReturnValues: 'ALL_NEW'
    };

    const { Attributes } = await dbClient.send(new UpdateItemCommand(updateParams));

    console.log(`✅ Resumed subscription ${subscriptionId}`);

    res.status(200).json({
      success: true,
      data: unmarshall(Attributes),
      message: 'Subscription resumed successfully'
    });

  } catch (error) {
    console.error('❌ Error resuming subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resume subscription',
      error: error.message
    });
  }
};

/**
 * Get subscription renewal history
 * @route GET /api/workspace/subscriptions/:subscriptionId/history
 * @access Private
 */
const getSubscriptionHistory = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const userRole = req.user?.role;

    console.log(`📋 Fetching history for subscription ${subscriptionId}`);

    // Query invoices table for invoices generated from this subscription
    const params = {
      TableName: WORKSPACE_INVOICES_TABLE,
      FilterExpression: 'subscriptionId = :subscriptionId',
      ExpressionAttributeValues: marshall({
        ':subscriptionId': subscriptionId
      })
    };

    const command = new ScanCommand(params);
    const { Items } = await dbClient.send(command);

    const history = Items ? Items.map(item => {
      const invoice = unmarshall(item);
      return {
        invoiceId: invoice.invoiceId,
        customInvoiceId: invoice.customInvoiceId,
        amount: invoice.total,
        date: invoice.createdAt,
        status: invoice.status,
        type: 'invoice_generated'
      };
    }) : [];

    res.status(200).json({
      success: true,
      data: history,
      message: 'Subscription history fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching subscription history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription history',
      error: error.message
    });
  }
};

/**
 * Generate invoice for subscription (called on billing date)
 * @route POST /api/workspace/subscriptions/:subscriptionId/generate-invoice
 * @access Private (Vendor only)
 */
const generateSubscriptionInvoice = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const userRole = req.user?.role;

    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can generate invoices'
      });
    }

    // Get subscription details
    const getParams = {
      TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
      Key: marshall({ subscriptionId })
    };

    const { Item } = await dbClient.send(new GetItemCommand(getParams));
    if (!Item) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    const subscription = unmarshall(Item);

    // Only generate invoice if subscription is active
    if (subscription.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Can only generate invoices for active subscriptions'
      });
    }

    // Create invoice from subscription
    const invoiceId = `INV-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    const invoice = {
      invoiceId,
      customInvoiceId: `${subscription.customSubscriptionId}-INV-${Date.now()}`,
      vendorId: subscription.vendorId,
      customerId: subscription.customerId,
      customerName: subscription.customerName,
      subscriptionId: subscriptionId,
      amount: subscription.amount,
      total: subscription.amount,
      subtotal: subscription.amount,
      cgst: 0,
      sgst: 0,
      igst: 0,
      invoiceDate: createdAt,
      items: subscription.items || [],
      notes: `Auto-generated from subscription: ${subscription.customSubscriptionId}`,
      status: 'draft',
      createdAt,
      updatedAt: createdAt
    };

    const invoiceParams = {
      TableName: WORKSPACE_INVOICES_TABLE,
      Item: marshall(invoice, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(invoiceParams));

    // Update subscription with new next billing date and increment invoice count
    let nextBillingDate = new Date(subscription.nextBillingDate);
    
    if (subscription.billingCycle === 'Monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else if (subscription.billingCycle === 'Quarterly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
    } else if (subscription.billingCycle === 'Annual') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }

    const updateParams = {
      TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
      Key: marshall({ subscriptionId }),
      UpdateExpression: 'SET nextBillingDate = :nextBillingDate, invoicesGenerated = invoicesGenerated + :one, lastInvoiceDate = :lastInvoiceDate, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':nextBillingDate': nextBillingDate.toISOString(),
        ':one': 1,
        ':lastInvoiceDate': createdAt,
        ':updatedAt': createdAt
      }),
      ReturnValues: 'ALL_NEW'
    };

    await dbClient.send(new UpdateItemCommand(updateParams));

    console.log(`✅ Generated invoice ${invoiceId} for subscription ${subscriptionId}`);

    res.status(201).json({
      success: true,
      data: {
        invoice,
        nextBillingDate: nextBillingDate.toISOString()
      },
      message: 'Invoice generated successfully'
    });

  } catch (error) {
    console.error('❌ Error generating invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice',
      error: error.message
    });
  }
};

/**
 * Bulk pause subscriptions
 * @route PUT /api/workspace/subscriptions/bulk/pause
 * @access Private (Vendor only)
 */
const bulkPauseSubscriptions = async (req, res) => {
  try {
    const { subscriptionIds } = req.body;
    const userRole = req.user?.role;

    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can pause subscriptions'
      });
    }

    if (!subscriptionIds || !Array.isArray(subscriptionIds) || subscriptionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Subscription IDs array is required'
      });
    }

    const results = {
      succeeded: 0,
      failed: 0,
      errors: []
    };

    for (const subscriptionId of subscriptionIds) {
      try {
        const params = {
          TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
          Key: marshall({ subscriptionId }),
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, pausedAt = :pausedAt',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: marshall({
            ':status': 'paused',
            ':updatedAt': new Date().toISOString(),
            ':pausedAt': new Date().toISOString()
          })
        };

        await dbClient.send(new UpdateItemCommand(params));
        results.succeeded++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          subscriptionId,
          error: error.message
        });
      }
    }

    console.log(`✅ Bulk paused ${results.succeeded} subscriptions`);

    res.status(200).json({
      success: true,
      data: results,
      message: `Paused ${results.succeeded} subscriptions${results.failed > 0 ? `, ${results.failed} failed` : ''}`
    });

  } catch (error) {
    console.error('❌ Error bulk pausing subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk pause subscriptions',
      error: error.message
    });
  }
};

/**
 * Bulk resume subscriptions
 * @route PUT /api/workspace/subscriptions/bulk/resume
 * @access Private (Vendor only)
 */
const bulkResumeSubscriptions = async (req, res) => {
  try {
    const { subscriptionIds } = req.body;
    const userRole = req.user?.role;

    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can resume subscriptions'
      });
    }

    if (!subscriptionIds || !Array.isArray(subscriptionIds) || subscriptionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Subscription IDs array is required'
      });
    }

    const results = {
      succeeded: 0,
      failed: 0,
      errors: []
    };

    for (const subscriptionId of subscriptionIds) {
      try {
        // Get current subscription to recalculate next billing date
        const getParams = {
          TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
          Key: marshall({ subscriptionId })
        };

        const { Item } = await dbClient.send(new GetItemCommand(getParams));
        if (!Item) {
          results.failed++;
          results.errors.push({
            subscriptionId,
            error: 'Subscription not found'
          });
          continue;
        }

        const subscription = unmarshall(Item);
        
        // Recalculate next billing date from today
        const today = new Date();
        let nextBillingDate = new Date(today);
        
        if (subscription.billingCycle === 'Monthly') {
          nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
        } else if (subscription.billingCycle === 'Quarterly') {
          nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
        } else if (subscription.billingCycle === 'Annual') {
          nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
        }

        const updateParams = {
          TableName: WORKSPACE_SUBSCRIPTIONS_TABLE,
          Key: marshall({ subscriptionId }),
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, nextBillingDate = :nextBillingDate, resumedAt = :resumedAt',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: marshall({
            ':status': 'active',
            ':updatedAt': new Date().toISOString(),
            ':nextBillingDate': nextBillingDate.toISOString(),
            ':resumedAt': new Date().toISOString()
          })
        };

        await dbClient.send(new UpdateItemCommand(updateParams));
        results.succeeded++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          subscriptionId,
          error: error.message
        });
      }
    }

    console.log(`✅ Bulk resumed ${results.succeeded} subscriptions`);

    res.status(200).json({
      success: true,
      data: results,
      message: `Resumed ${results.succeeded} subscriptions${results.failed > 0 ? `, ${results.failed} failed` : ''}`
    });

  } catch (error) {
    console.error('❌ Error bulk resuming subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk resume subscriptions',
      error: error.message
    });
  }
};

export {
  getWorkspaceSubscriptions,
  getSubscriptionStats,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  pauseSubscription,
  resumeSubscription,
  getSubscriptionHistory,
  generateSubscriptionInvoice,
  bulkPauseSubscriptions,
  bulkResumeSubscriptions
};
