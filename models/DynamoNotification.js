import { dynamoDB } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Define the table name for notifications
const NOTIFICATIONS_TABLE = 'notifications';

// Notification types
export const NOTIFICATION_TYPES = {
  NEW_LEAD: 'new_lead',
  PROJECT_UPDATE: 'project_update',
  LEAD_STATUS_CHANGE: 'lead_status_change',
  PROJECT_STATUS_CHANGE: 'project_status_change'
};

// Create a notification in DynamoDB
export const createNotification = async (notificationData) => {
  console.log('DynamoNotification.createNotification - Starting with data:', JSON.stringify(notificationData, null, 2));
  
  // Validate required fields
  if (!notificationData.userId) {
    console.error('DynamoNotification.createNotification - Missing required field: userId');
    throw new Error('userId is required for notification creation');
  }
  
  if (!notificationData.type) {
    console.error('DynamoNotification.createNotification - Missing required field: type');
    throw new Error('type is required for notification creation');
  }
  
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  
  console.log(`DynamoNotification.createNotification - Generated notification ID: ${id}`);
  
  const params = {
    TableName: NOTIFICATIONS_TABLE,
    Item: {
      notificationId: id, // Primary key
      userId: notificationData.userId, // User ID (vendorId, clientId, etc.)
      userType: notificationData.userType || 'vendor', // Type of user (vendor, client, pm)
      type: notificationData.type, // Type of notification
      title: notificationData.title, // Title of the notification
      message: notificationData.message, // Message content
      relatedId: notificationData.relatedId || null, // ID of related item (leadId, projectId)
      relatedType: notificationData.relatedType || null, // Type of related item (lead, project)
      isRead: false, // Whether the notification has been read
      createdAt: timestamp,
      updatedAt: timestamp
    }
  };

  console.log('DynamoNotification.createNotification - Params for DynamoDB:', JSON.stringify(params, null, 2));

  try {
    console.log('DynamoNotification.createNotification - Putting item in DynamoDB...');
    await dynamoDB.put(params).promise();
    console.log('DynamoNotification.createNotification - Successfully created notification in DynamoDB');
    
    const result = {
      ...params.Item,
      _id: id // Add _id field for frontend compatibility
    };
    
    console.log('DynamoNotification.createNotification - Returning result:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('DynamoNotification.createNotification - Error creating notification in DynamoDB:', error);
    console.error('DynamoNotification.createNotification - Error stack:', error.stack);
    throw error;
  }
};

// Get notifications for a user (now fetches from leads table)
export const getNotificationsForUser = async (userId, userType = 'vendor', options = {}) => {
  console.log(`DynamoNotification: Getting notifications (leads) for vendorId: ${userId}, options:`, options);
  
  const { limit = 50, lastEvaluatedKey = null, includeRead = false } = options;
  
  // For vendors, we'll fetch leads assigned to them
  if (userType === 'vendor') {
    let filterExpression = 'assignedVendorId = :vendorId AND #status <> :deletedStatus';
    let expressionAttributeValues = {
      ':vendorId': userId,
      ':deletedStatus': 'deleted'
    };
    
    let expressionAttributeNames = {
      '#status': 'status' // status is a reserved word in DynamoDB
    };
    
    // We'll use the status field to determine if it's "read" or not
    // Assuming "new" status means unread, and other statuses mean read
    if (!includeRead) {
      filterExpression += ' AND #status = :newStatus';
      expressionAttributeValues[':newStatus'] = 'new';
    }
    
    const params = {
      TableName: 'leads', // Use the leads table instead of notifications
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit
    };
    
    // Only add ExpressionAttributeNames if we have any
    if (Object.keys(expressionAttributeNames).length > 0) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }
    
    // Add pagination if lastEvaluatedKey is provided
    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
    }
    
    try {
      console.log(`DynamoNotification: Executing scan on leads table with params:`, params);
      const result = await dynamoDB.scan(params).promise();
      console.log(`DynamoNotification: Scan result count: ${result.Items.length}`);
      
      // Sort leads by createdAt in descending order (newest first)
      const leads = result.Items.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
      
      // Convert leads to notification format
      const notifications = leads.map(lead => ({
        notificationId: lead.leadId,
        userId: lead.assignedVendorId,
        userType: 'vendor',
        type: 'new_lead',
        title: 'New Lead Assigned',
        message: `You have been assigned a new lead: ${lead.name || 'Unnamed Lead'}`,
        relatedId: lead.leadId,
        relatedType: 'lead',
        isRead: lead.status !== 'new', // If status is not "new", consider it read
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        // Include additional lead data that might be useful
        leadData: {
          name: lead.name,
          description: lead.description,
          budget: lead.budget,
          duration: lead.duration,
          status: lead.status
        }
      }));
      
      // Format the response
      const response = {
        notifications: notifications.map(notification => ({
          ...notification,
          _id: notification.notificationId // Add _id field for frontend compatibility
        })),
        count: notifications.length
      };
      
      console.log(`DynamoNotification: Returning ${response.count} lead notifications`);
      
      // Add pagination token if there are more results
      if (result.LastEvaluatedKey) {
        response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
      }
      
      return response;
    } catch (error) {
      console.error('Error getting lead notifications for vendor:', error);
      throw error;
    }
  } else {
    // For other user types, return empty for now
    console.log(`DynamoNotification: User type ${userType} not supported for lead notifications`);
    return { notifications: [], count: 0 };
  }
};

// Mark a notification as read (now updates lead status)
export const markNotificationAsRead = async (leadId) => {
  console.log(`DynamoNotification: Marking lead ${leadId} as read (updating status)`);
  
  // First, get the current lead to check its status
  const getParams = {
    TableName: 'leads',
    Key: {
      leadId: leadId
    }
  };
  
  try {
    const getResult = await dynamoDB.get(getParams).promise();
    const lead = getResult.Item;
    
    if (!lead) {
      console.error(`DynamoNotification: Lead ${leadId} not found`);
      throw new Error(`Lead ${leadId} not found`);
    }
    
    console.log(`DynamoNotification: Current lead status: ${lead.status}`);
    
    // Only update if status is "new"
    if (lead.status === 'new') {
      const updateParams = {
        TableName: 'leads',
        Key: {
          leadId: leadId
        },
        UpdateExpression: 'set #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':status': 'viewed', // Change status to "viewed" to mark as read
          ':updatedAt': new Date().toISOString()
        },
        ExpressionAttributeNames: {
          '#status': 'status' // status is a reserved word in DynamoDB
        },
        ReturnValues: 'ALL_NEW'
      };
      
      console.log(`DynamoNotification: Updating lead with params:`, updateParams);
      const result = await dynamoDB.update(updateParams).promise();
      console.log(`DynamoNotification: Lead status updated to "viewed"`);
      
      // Convert lead to notification format
      const notification = {
        notificationId: result.Attributes.leadId,
        userId: result.Attributes.assignedVendorId,
        userType: 'vendor',
        type: 'new_lead',
        title: 'New Lead Assigned',
        message: `You have been assigned a new lead: ${result.Attributes.name || 'Unnamed Lead'}`,
        relatedId: result.Attributes.leadId,
        relatedType: 'lead',
        isRead: true, // Now marked as read
        createdAt: result.Attributes.createdAt,
        updatedAt: result.Attributes.updatedAt,
        leadData: {
          name: result.Attributes.name,
          description: result.Attributes.description,
          budget: result.Attributes.budget,
          duration: result.Attributes.duration,
          status: result.Attributes.status
        },
        _id: result.Attributes.leadId
      };
      
      return notification;
    } else {
      console.log(`DynamoNotification: Lead ${leadId} already marked as read (status: ${lead.status})`);
      
      // Convert lead to notification format even if we didn't update it
      const notification = {
        notificationId: lead.leadId,
        userId: lead.assignedVendorId,
        userType: 'vendor',
        type: 'new_lead',
        title: 'New Lead Assigned',
        message: `You have been assigned a new lead: ${lead.name || 'Unnamed Lead'}`,
        relatedId: lead.leadId,
        relatedType: 'lead',
        isRead: true, // Already read
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        leadData: {
          name: lead.name,
          description: lead.description,
          budget: lead.budget,
          duration: lead.duration,
          status: lead.status
        },
        _id: lead.leadId
      };
      
      return notification;
    }
  } catch (error) {
    console.error(`DynamoNotification: Error marking lead ${leadId} as read:`, error);
    throw error;
  }
};

// Mark all notifications as read for a user (now updates all new leads)
export const markAllNotificationsAsRead = async (userId, userType = 'vendor') => {
  console.log(`DynamoNotification: Marking all leads as read for vendor ${userId}`);
  
  if (userType !== 'vendor') {
    console.log(`DynamoNotification: User type ${userType} not supported for lead notifications`);
    return { count: 0 };
  }
  
  // First, get all unread leads (status = "new") for the vendor
  const params = {
    TableName: 'leads',
    FilterExpression: 'assignedVendorId = :vendorId AND #status = :status',
    ExpressionAttributeValues: {
      ':vendorId': userId,
      ':status': 'new'
    },
    ExpressionAttributeNames: {
      '#status': 'status' // status is a reserved word in DynamoDB
    }
  };
  
  try {
    console.log(`DynamoNotification: Scanning for unread leads with params:`, params);
    const result = await dynamoDB.scan(params).promise();
    const unreadLeads = result.Items;
    
    console.log(`DynamoNotification: Found ${unreadLeads.length} unread leads`);
    
    // If there are no unread leads, return early
    if (unreadLeads.length === 0) {
      return { count: 0 };
    }
    
    // Update each lead to mark it as read (status = "viewed")
    const updatePromises = unreadLeads.map(lead => {
      const updateParams = {
        TableName: 'leads',
        Key: {
          leadId: lead.leadId
        },
        UpdateExpression: 'set #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':status': 'viewed', // Change status to "viewed" to mark as read
          ':updatedAt': new Date().toISOString()
        },
        ExpressionAttributeNames: {
          '#status': 'status' // status is a reserved word in DynamoDB
        }
      };
      
      return dynamoDB.update(updateParams).promise();
    });
    
    console.log(`DynamoNotification: Updating ${updatePromises.length} leads to status "viewed"`);
    await Promise.all(updatePromises);
    
    return { count: unreadLeads.length };
  } catch (error) {
    console.error('Error marking all leads as read:', error);
    throw error;
  }
};

// Delete a notification (now just marks lead as "deleted" status)
export const deleteNotification = async (leadId) => {
  console.log(`DynamoNotification: "Deleting" lead notification ${leadId} (marking as deleted status)`);
  
  // We don't actually delete the lead, just update its status
  const params = {
    TableName: 'leads',
    Key: {
      leadId: leadId
    },
    UpdateExpression: 'set #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':status': 'deleted', // Change status to "deleted" instead of actually deleting
      ':updatedAt': new Date().toISOString()
    },
    ExpressionAttributeNames: {
      '#status': 'status' // status is a reserved word in DynamoDB
    },
    ReturnValues: 'ALL_NEW'
  };
  
  try {
    console.log(`DynamoNotification: Updating lead status to "deleted" with params:`, params);
    const result = await dynamoDB.update(params).promise();
    console.log(`DynamoNotification: Lead status updated to "deleted"`);
    return { success: true, leadId: leadId };
  } catch (error) {
    console.error(`DynamoNotification: Error marking lead ${leadId} as deleted:`, error);
    throw error;
  }
};

// Create a notification for a new lead assigned to a vendor
// This function is now a no-op since we're using the leads table directly
export const createNewLeadNotification = async (lead, vendorId) => {
  console.log(`DynamoNotification: createNewLeadNotification is now a no-op since we're using the leads table directly`);
  console.log(`DynamoNotification: Lead ${lead?.leadId} is already assigned to vendor ${vendorId} in the leads table`);
  
  // Return a mock notification object for compatibility
  return {
    notificationId: lead?.leadId,
    userId: vendorId,
    userType: 'vendor',
    type: NOTIFICATION_TYPES.NEW_LEAD,
    title: 'New Lead Assigned',
    message: `You have been assigned a new lead: ${lead?.name || 'Unnamed Lead'}`,
    relatedId: lead?.leadId,
    relatedType: 'lead',
    isRead: false,
    createdAt: lead?.createdAt || new Date().toISOString(),
    updatedAt: lead?.updatedAt || new Date().toISOString(),
    _id: lead?.leadId
  };
};

// Create a notification for a project update
export const createProjectUpdateNotification = async (project, vendorId, updateMessage) => {
  const notificationData = {
    userId: vendorId,
    userType: 'vendor',
    type: NOTIFICATION_TYPES.PROJECT_UPDATE,
    title: 'Project Update',
    message: updateMessage || `Project ${project.name} has been updated`,
    relatedId: project.projectId,
    relatedType: 'project'
  };
  
  return await createNotification(notificationData);
};

// Create a notification for a lead status change
export const createLeadStatusChangeNotification = async (lead, vendorId, oldStatus, newStatus) => {
  const notificationData = {
    userId: vendorId,
    userType: 'vendor',
    type: NOTIFICATION_TYPES.LEAD_STATUS_CHANGE,
    title: 'Lead Status Changed',
    message: `Lead "${lead.name}" status changed from ${oldStatus} to ${newStatus}`,
    relatedId: lead.leadId,
    relatedType: 'lead'
  };
  
  return await createNotification(notificationData);
};

// Create a notification for a project status change
export const createProjectStatusChangeNotification = async (project, vendorId, oldStatus, newStatus) => {
  const notificationData = {
    userId: vendorId,
    userType: 'vendor',
    type: NOTIFICATION_TYPES.PROJECT_STATUS_CHANGE,
    title: 'Project Status Changed',
    message: `Project "${project.name}" status changed from ${oldStatus} to ${newStatus}`,
    relatedId: project.projectId,
    relatedType: 'project'
  };
  
  return await createNotification(notificationData);
};