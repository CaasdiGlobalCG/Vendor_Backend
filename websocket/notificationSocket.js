import { WebSocketServer, WebSocket } from 'ws';
import url from 'url';

// Store active connections by user
const connectedUsers = {};

// Initialize WebSocket server
export const initWebSocketServer = (server) => {
    const wss = new WebSocketServer({ 
        noServer: true,
        path: '/api/notifications/ws'
    });
    
    // Handle upgrade
    server.on('upgrade', (request, socket, head) => {
        const pathname = url.parse(request.url).pathname;
        
        if (pathname.startsWith('/api/notifications/ws')) {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
    });
    
    // Connection handler
    wss.on('connection', (ws, request) => {
        const pathname = url.parse(request.url).pathname;
        const pathParts = pathname.split('/');
        
        // Extract user ID from URL path
        // Format: /api/notifications/ws/:userId
        const userId = pathParts[4];
        const userType = url.parse(request.url, true).query.userType || 'vendor';
        
        console.log(`WebSocket: New connection established for ${userType} ${userId}`);
        
        // Store the connection
        if (!connectedUsers[userId]) {
            connectedUsers[userId] = [];
        }
        
        connectedUsers[userId].push({
            ws,
            userType
        });
        
        // Connection established message
        ws.send(JSON.stringify({
            type: 'connection',
            message: 'WebSocket connection established',
            userId,
            userType
        }));
        
        // Handle incoming messages
        ws.on('message', (message) => {
            console.log(`WebSocket: Received message from ${userType} ${userId}: ${message}`);
            
            try {
                const data = JSON.parse(message);
                
                // Handle different message types
                if (data.type === 'ping') {
                    // Respond to ping with pong
                    ws.send(JSON.stringify({
                        type: 'pong',
                        timestamp: new Date().toISOString()
                    }));
                }
            } catch (error) {
                console.error('WebSocket: Error parsing message:', error);
            }
        });
        
        // Handle connection close
        ws.on('close', () => {
            console.log(`WebSocket: Connection closed for ${userType} ${userId}`);
            
            // Remove the connection
            if (connectedUsers[userId]) {
                const index = connectedUsers[userId].findIndex(conn => conn.ws === ws);
                if (index !== -1) {
                    connectedUsers[userId].splice(index, 1);
                }
                
                // Remove the user if no more connections
                if (connectedUsers[userId].length === 0) {
                    delete connectedUsers[userId];
                }
            }
        });
        
        // Handle errors
        ws.on('error', (error) => {
            console.error(`WebSocket: Error for ${userType} ${userId}:`, error);
        });
    });
    
    // Return the WebSocket server
    return wss;
};

// Send notification to a specific user
export const sendNotificationToUser = (userId, notification) => {
    console.log(`WebSocket: Sending notification to user ${userId}:`, notification);
    
    if (connectedUsers[userId]) {
        connectedUsers[userId].forEach(connection => {
            if (connection.ws.readyState === WebSocket.OPEN) {
                connection.ws.send(JSON.stringify({
                    type: 'notification',
                    notification
                }));
            }
        });
    } else {
        console.log(`WebSocket: No active connections for user ${userId}`);
    }
};

// Send lead to a specific vendor
export const sendLeadNotification = (vendorId, lead) => {
    console.log(`WebSocket: Sending lead notification to vendor ${vendorId}:`, lead);
    
    if (connectedUsers[vendorId]) {
        connectedUsers[vendorId].forEach(connection => {
            if (connection.ws.readyState === WebSocket.OPEN) {
                connection.ws.send(JSON.stringify({
                    type: 'lead',
                    lead
                }));
            }
        });
    } else {
        console.log(`WebSocket: No active connections for vendor ${vendorId}`);
    }
};

// Get active connection count
export const getActiveConnectionCount = () => {
    let count = 0;
    Object.values(connectedUsers).forEach(userConnections => {
        count += userConnections.length;
    });
    return count;
};

// Helper to send broadcast to all connections
export const broadcastMessage = (message) => {
    console.log(`WebSocket: Broadcasting message to all connections:`, message);
    
    Object.values(connectedUsers).forEach(userConnections => {
        userConnections.forEach(connection => {
            if (connection.ws.readyState === WebSocket.OPEN) {
                connection.ws.send(JSON.stringify(message));
            }
        });
    });
};

// ===== PM-VENDOR LEAD NOTIFICATION SYSTEM =====

// Send notification when vendor responds to a lead
export const notifyPMOfVendorResponse = (pmId, leadData) => {
    const notification = {
        id: `lead-response-${leadData.leadId}-${Date.now()}`,
        type: 'lead_response',
        title: '🔔 Vendor Response Received',
        message: `${leadData.vendorName} has ${leadData.accepted ? 'accepted' : 'declined'} your lead "${leadData.leadTitle}"`,
        data: {
            leadId: leadData.leadId,
            projectId: leadData.projectId,
            vendorId: leadData.vendorId,
            vendorName: leadData.vendorName,
            accepted: leadData.accepted,
            proposedBudget: leadData.proposedBudget,
            proposedTimeline: leadData.proposedTimeline,
            message: leadData.message
        },
        timestamp: new Date().toISOString(),
        priority: 'high',
        actionRequired: leadData.accepted,
        actions: leadData.accepted ? [
            {
                type: 'approve',
                label: 'Approve & Grant Workspace Access',
                url: `/projects/${leadData.projectId}/leads`
            },
            {
                type: 'view',
                label: 'View Details',
                url: `/projects/${leadData.projectId}/leads`
            }
        ] : [
            {
                type: 'view',
                label: 'View Details',
                url: `/projects/${leadData.projectId}/leads`
            }
        ]
    };

    console.log(`🔔 Notifying PM ${pmId} of vendor response:`, notification);
    sendNotificationToUser(pmId, notification);
};

// Send notification when PM approves/rejects vendor response
export const notifyVendorOfPMDecision = (vendorId, leadData) => {
    const approved = leadData.pmDecision?.approved;
    const workspaceAccess = leadData.pmDecision?.workspaceAccess;
    
    const notification = {
        id: `pm-decision-${leadData.leadId}-${Date.now()}`,
        type: 'pm_decision',
        title: approved ? '🎉 Lead Approved!' : '❌ Lead Declined',
        message: approved 
            ? `Great news! Your lead "${leadData.leadTitle}" has been approved${workspaceAccess ? ' with workspace access' : ''}`
            : `Your lead "${leadData.leadTitle}" has been declined`,
        data: {
            leadId: leadData.leadId,
            projectId: leadData.projectId,
            pmId: leadData.pmId,
            approved: approved,
            workspaceAccess: workspaceAccess,
            feedback: leadData.pmDecision?.feedback,
            workspaceId: leadData.workspaceId
        },
        timestamp: new Date().toISOString(),
        priority: approved ? 'high' : 'medium',
        actionRequired: approved && workspaceAccess,
        actions: approved ? [
            ...(workspaceAccess ? [{
                type: 'workspace',
                label: 'Open Collaborative Workspace',
                url: `/VendorDashboard/workspace/${leadData.workspaceId}`
            }] : []),
            {
                type: 'view',
                label: 'View Lead Details',
                url: '/VendorDashboard/leads'
            }
        ] : [
            {
                type: 'view',
                label: 'View Lead Details',
                url: '/VendorDashboard/leads'
            }
        ]
    };

    console.log(`🔔 Notifying vendor ${vendorId} of PM decision:`, notification);
    sendNotificationToUser(vendorId, notification);
};

// Send notification when new lead is sent to vendor
export const notifyVendorOfNewLead = (vendorId, leadData) => {
    const notification = {
        id: `new-lead-${leadData.leadId}-${Date.now()}`,
        type: 'new_lead',
        title: '📋 New Lead Received',
        message: `You have received a new lead "${leadData.leadTitle}" from ${leadData.pmName || 'Project Manager'}`,
        data: {
            leadId: leadData.leadId,
            projectId: leadData.projectId,
            pmId: leadData.pmId,
            pmName: leadData.pmName,
            leadTitle: leadData.leadTitle,
            specialization: leadData.specialization,
            estimatedBudget: leadData.estimatedBudget,
            estimatedTimeline: leadData.estimatedTimeline,
            priority: leadData.priority
        },
        timestamp: new Date().toISOString(),
        priority: leadData.priority === 'high' ? 'high' : 'medium',
        actionRequired: true,
        actions: [
            {
                type: 'respond',
                label: 'Respond to Lead',
                url: '/VendorDashboard/leads'
            },
            {
                type: 'view',
                label: 'View Details',
                url: '/VendorDashboard/leads'
            }
        ]
    };

    console.log(`🔔 Notifying vendor ${vendorId} of new lead:`, notification);
    sendNotificationToUser(vendorId, notification);
};

// Send notification when workspace access is granted
export const notifyWorkspaceAccessGranted = (userId, workspaceData) => {
    const notification = {
        id: `workspace-access-${workspaceData.workspaceId}-${Date.now()}`,
        type: 'workspace_access',
        title: '🏗️ Workspace Access Granted',
        message: `You now have access to the collaborative workspace for "${workspaceData.projectName}"`,
        data: {
            workspaceId: workspaceData.workspaceId,
            projectId: workspaceData.projectId,
            projectName: workspaceData.projectName,
            accessLevel: workspaceData.accessLevel
        },
        timestamp: new Date().toISOString(),
        priority: 'high',
        actionRequired: true,
        actions: [
            {
                type: 'workspace',
                label: 'Open Workspace',
                url: `/VendorDashboard/workspace/${workspaceData.workspaceId}`
            }
        ]
    };

    console.log(`🔔 Notifying user ${userId} of workspace access:`, notification);
    sendNotificationToUser(userId, notification);
};

// Send notification for general lead status updates
export const notifyLeadStatusUpdate = (userId, leadData, statusUpdate) => {
    const notification = {
        id: `lead-status-${leadData.leadId}-${Date.now()}`,
        type: 'lead_status_update',
        title: '📊 Lead Status Updated',
        message: `Lead "${leadData.leadTitle}" status: ${statusUpdate.message}`,
        data: {
            leadId: leadData.leadId,
            projectId: leadData.projectId,
            oldStatus: statusUpdate.oldStatus,
            newStatus: statusUpdate.newStatus,
            ...statusUpdate.additionalData
        },
        timestamp: new Date().toISOString(),
        priority: 'medium',
        actionRequired: false,
        actions: [
            {
                type: 'view',
                label: 'View Lead',
                url: statusUpdate.viewUrl || '/leads'
            }
        ]
    };

    console.log(`🔔 Notifying user ${userId} of lead status update:`, notification);
    sendNotificationToUser(userId, notification);
};

// Get connection info for debugging
export const getConnectionInfo = () => {
    const info = {};
    Object.keys(connectedUsers).forEach(userId => {
        info[userId] = {
            connectionCount: connectedUsers[userId].length,
            userTypes: connectedUsers[userId].map(conn => conn.userType)
        };
    });
    return info;
}; 