// Workspace Module - Workspace and collaboration functionality
export { default as workspaceRoutes } from './routes/workspaceRoutes.js';
export { default as workspaceAccessRoutes } from './routes/workspaceAccessRoutes.js';
export { default as workspaceFileRoutes } from './routes/workspaceFileRoutes.js';
export { default as workspaceQuotesRoutes } from './routes/workspaceQuotesRoutes.js';
export { default as dynamoWorkspaceRoutes } from './routes/dynamoWorkspaceRoutes.js';
export { default as dynamoWorkspaceMessageRoutes } from './routes/dynamoWorkspaceMessageRoutes.js';
export { default as purchaseRequisitionsRoutes } from './routes/purchaseRequisitionsRoutes.js';

// Export controllers for direct access if needed
export * as workspaceController from './controllers/workspaceController.js';
export * as workspaceAccessController from './controllers/workspaceAccessController.js';
export * as workspaceFileController from './controllers/workspaceFileController.js';
export * as workspaceQuotesController from './controllers/workspaceQuotesController.js';
export * as dynamoWorkspaceController from './controllers/dynamoWorkspaceController.js';
export * as dynamoWorkspaceMessageController from './controllers/dynamoWorkspaceMessageController.js';
export * as purchaseRequisitionsController from './controllers/purchaseRequisitionsController.js';

// Export models
export * as DynamoWorkspace from './models/DynamoWorkspace.js';
export * as DynamoWorkspaceMessage from './models/DynamoWorkspaceMessage.js';
