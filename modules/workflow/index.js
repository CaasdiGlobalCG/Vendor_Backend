/**
 * Workflow Module Export
 * Exposes workflow services and schedulers for server initialization
 */

export { default as workflowRoutes } from './routes/workflowRoutes.js';
export * as WorkflowService from './services/workflowService.js';
export * as WorkflowScheduler from './services/workflowScheduler.js';
export * as WorkflowExecutor from './services/workflowExecutor.js';
export * as RuleMatcher from './services/ruleMatcher.js';
export * as WorkflowModel from './models/DynamoWorkflow.js';
export { sendWorkflowEmail } from './services/emailNotificationService.js';
