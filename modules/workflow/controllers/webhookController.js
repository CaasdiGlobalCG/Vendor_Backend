import * as WorkflowService from '../services/workflowService.js';
import * as WorkflowScheduler from '../services/workflowScheduler.js';
import crypto from 'crypto';

const getBackendBaseUrl = (req) => {
  const envBase = process.env.VENDOR_BACKEND_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
};

const isTimestampValid = (timestampHeader) => {
  if (!timestampHeader) return false;

  const parsed = Number(timestampHeader);
  if (!Number.isFinite(parsed)) return false;

  const nowMs = Date.now();
  const incomingMs = parsed > 10_000_000_000 ? parsed : parsed * 1000;
  const toleranceMs = 5 * 60 * 1000;

  return Math.abs(nowMs - incomingMs) <= toleranceMs;
};

const verifyHmacSignature = (secret, payloadRaw, timestampHeader, signatureHeader) => {
  if (!secret || !timestampHeader || !signatureHeader) return false;

  const base = `${timestampHeader}.${payloadRaw}`;
  const expected = crypto.createHmac('sha256', String(secret)).update(base).digest('hex');
  const incoming = String(signatureHeader).replace(/^sha256=/i, '');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const incomingBuffer = Buffer.from(incoming, 'hex');
  if (expectedBuffer.length !== incomingBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
};

/**
 * GET /api/webhooks/workflows/:workflowId/config
 */
export const getWorkflowWebhookConfig = async (req, res) => {
  try {
    const { workflowId } = req.params;
    const backendBaseUrl = getBackendBaseUrl(req);

    const config = await WorkflowService.getWebhookConfig(workflowId, backendBaseUrl);

    res.status(200).json({
      message: 'Webhook config retrieved successfully',
      config
    });
  } catch (error) {
    console.error('❌ Error retrieving webhook config:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to retrieve webhook config',
      error: error.message
    });
  }
};

/**
 * POST /api/webhooks/workflows/:workflowId/rotate-secret
 */
export const rotateWorkflowWebhookSecret = async (req, res) => {
  try {
    const { workflowId } = req.params;
    const backendBaseUrl = getBackendBaseUrl(req);

    const config = await WorkflowService.rotateWebhookConfigSecret(workflowId, backendBaseUrl);

    res.status(200).json({
      message: 'Webhook secret rotated successfully',
      config
    });
  } catch (error) {
    console.error('❌ Error rotating webhook secret:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to rotate webhook secret',
      error: error.message
    });
  }
};

/**
 * POST /api/webhooks/workflows/:workflowId/trigger
 * Header: x-webhook-secret (required)
 */
export const triggerWorkflowWebhook = async (req, res) => {
  try {
    const { workflowId } = req.params;
    const providedSecret = req.headers['x-webhook-secret'] || req.headers['x-workflow-secret'] || '';
    const timestampHeader = req.headers['x-webhook-timestamp'];
    const signatureHeader = req.headers['x-webhook-signature'];

    const workflow = await WorkflowService.getWorkflow(workflowId);
    const storedSecret = workflow?.webhookConfig?.secret;
    if (!storedSecret) {
      return res.status(401).json({ message: 'Webhook secret is not configured for this workflow' });
    }

    const rawPayload = JSON.stringify(req.body || {});
    const hasHmacHeaders = Boolean(timestampHeader && signatureHeader);
    let authorized = false;

    if (hasHmacHeaders) {
      if (!isTimestampValid(timestampHeader)) {
        return res.status(401).json({ message: 'Webhook timestamp is invalid or expired' });
      }
      authorized = verifyHmacSignature(storedSecret, rawPayload, timestampHeader, signatureHeader);
    } else {
      authorized = String(providedSecret) === String(storedSecret);
    }

    if (!authorized) {
      return res.status(401).json({
        message: hasHmacHeaders ? 'Invalid webhook signature' : 'Invalid webhook secret'
      });
    }

    const actionServices = req.app.locals.actionServices || {};
    const payload = req.body || {};

    const executionResult = await WorkflowScheduler.handleWebhookTrigger(workflowId, payload, actionServices);

    res.status(200).json({
      message: 'Webhook trigger processed',
      workflowId,
      executionResult: executionResult || null
    });
  } catch (error) {
    console.error('❌ Error processing webhook trigger:', error);
    const status = error.message.includes('not found') ? 404 : error.message.includes('disabled') ? 409 : 500;
    res.status(status).json({
      message: 'Failed to process webhook trigger',
      error: error.message
    });
  }
};

/**
 * POST /api/webhooks/workflows/:workflowId/test
 * Internal test endpoint without secret requirement
 */
export const testWorkflowWebhook = async (req, res) => {
  try {
    const { workflowId } = req.params;
    const payload = req.body || {};
    const actionServices = req.app.locals.actionServices || {};

    const executionResult = await WorkflowScheduler.handleWebhookTrigger(workflowId, {
      ...payload,
      __testMode: true
    }, actionServices);

    res.status(200).json({
      message: 'Webhook test completed',
      workflowId,
      executionResult: executionResult || null
    });
  } catch (error) {
    console.error('❌ Error testing webhook trigger:', error);
    const status = error.message.includes('not found') ? 404 : error.message.includes('disabled') ? 409 : 500;
    res.status(status).json({
      message: 'Failed to test webhook',
      error: error.message
    });
  }
};

/**
 * GET /api/webhooks/workspace/:workspaceId
 */
export const listWorkspaceWebhookConfigs = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const backendBaseUrl = getBackendBaseUrl(req);

    const webhooks = await WorkflowService.listWorkspaceWebhookConfigs(workspaceId, backendBaseUrl);

    res.status(200).json({
      message: 'Workspace webhook configs retrieved successfully',
      workspaceId,
      count: webhooks.length,
      webhooks
    });
  } catch (error) {
    console.error('❌ Error listing workspace webhooks:', error);
    res.status(500).json({
      message: 'Failed to list workspace webhooks',
      error: error.message
    });
  }
};

/**
 * GET /api/webhooks/workspace/:workspaceId/outbound
 */
export const listWorkspaceOutboundWebhooks = async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const outbound = await WorkflowService.listWorkspaceOutboundWebhooks(workspaceId);

    res.status(200).json({
      message: 'Workspace outbound webhooks retrieved successfully',
      workspaceId,
      count: outbound.length,
      outbound
    });
  } catch (error) {
    console.error('❌ Error listing outbound webhooks:', error);
    res.status(500).json({
      message: 'Failed to list outbound webhooks',
      error: error.message
    });
  }
};
