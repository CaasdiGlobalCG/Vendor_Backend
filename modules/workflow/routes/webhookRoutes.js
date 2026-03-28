import express from 'express';
import * as WebhookController from '../controllers/webhookController.js';

const router = express.Router();

/**
 * GET /api/webhooks/workflows/:workflowId/config
 * Retrieve or create inbound webhook config for a workflow
 */
router.get('/workflows/:workflowId/config', WebhookController.getWorkflowWebhookConfig);

/**
 * POST /api/webhooks/workflows/:workflowId/rotate-secret
 * Rotate inbound webhook secret
 */
router.post('/workflows/:workflowId/rotate-secret', WebhookController.rotateWorkflowWebhookSecret);

/**
 * POST /api/webhooks/workflows/:workflowId/trigger
 * Inbound webhook endpoint for external systems
 */
router.post('/workflows/:workflowId/trigger', WebhookController.triggerWorkflowWebhook);

/**
 * POST /api/webhooks/workflows/:workflowId/test
 * Internal webhook test endpoint
 */
router.post('/workflows/:workflowId/test', WebhookController.testWorkflowWebhook);

/**
 * GET /api/webhooks/workspace/:workspaceId
 * List workspace inbound webhook metadata
 */
router.get('/workspace/:workspaceId', WebhookController.listWorkspaceWebhookConfigs);

/**
 * GET /api/webhooks/workspace/:workspaceId/outbound
 * List outbound webhook actions configured in workflows
 */
router.get('/workspace/:workspaceId/outbound', WebhookController.listWorkspaceOutboundWebhooks);

export default router;
