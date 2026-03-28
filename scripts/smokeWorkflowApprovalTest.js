const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:5001';
const TARGET_EMAIL = 'dhanush@caasdiglobal.in';

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

async function run() {
  const stamp = Date.now();

  const workspace = await api('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({
      vendorId: 'SMOKE-VENDOR',
      leadId: `SMOKE-LEAD-${stamp}`,
      title: `Approval Smoke Workspace ${stamp}`,
      description: 'Workflow multi-level approval smoke test'
    })
  });

  const workspaceId = workspace.workspaceId || workspace.id || workspace._id;
  if (!workspaceId) {
    throw new Error('Workspace creation did not return workspaceId');
  }

  const workflowPayload = {
    workspaceId,
    name: `Approval Multi-Level Smoke ${stamp}`,
    description: 'Triggers on PM or Client approval and sends email',
    logicOperator: 'OR',
    isEnabled: true,
    triggers: [
      {
        type: 'approval',
        rule: {
          approvalStatus: 'pm_approved'
        }
      },
      {
        type: 'approval',
        rule: {
          approvalStatus: 'client_approved'
        }
      }
    ],
    actions: [
      {
        id: `email-action-${stamp}`,
        type: 'send-email',
        params: {
          templateType: 'custom',
          recipient: TARGET_EMAIL,
          subject: `Workflow Approval Smoke ${stamp} - {{approvalStatus}}`,
          body: 'Workflow {{workflowName}} fired for {{approvalStatus}}. Node {{taskId}} at {{timestamp}}.',
          variables: {
            workflowName: `Approval Multi-Level Smoke ${stamp}`,
            taskName: `Approval Node ${stamp}`,
            taskId: `approval-node-${stamp}`,
            timestamp: new Date().toISOString()
          }
        }
      }
    ]
  };

  const workflowResp = await api('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(workflowPayload)
  });

  const workflowId = workflowResp?.workflow?.workflowId;
  if (!workflowId) {
    throw new Error('Workflow creation did not return workflowId');
  }

  const triggerOnce = async (approvalStatus) => {
    await api(`/api/webhooks/workflows/${workflowId}/test`, {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        nodeId: `approval-node-${stamp}`,
        approvalStatus,
        status: 'Pending',
        source: 'smoke-approval-test',
        timestamp: new Date().toISOString()
      })
    });
  };

  // Fire both approval levels
  await triggerOnce('pm_approved');
  await triggerOnce('client_approved');

  const logResp = await api(`/api/workflows/${workflowId}/execution-log?limit=10`);
  const executionLog = Array.isArray(logResp.executionLog) ? logResp.executionLog : [];

  const emailActions = executionLog
    .flatMap((entry) => Array.isArray(entry.actions) ? entry.actions : [])
    .filter((a) => a.actionType === 'send-email');

  const messageIds = emailActions
    .map((a) => a?.output?.messageId)
    .filter(Boolean);

  const failedActions = emailActions.filter((a) => a.result !== 'success');

  const summary = {
    baseUrl: BASE_URL,
    targetEmail: TARGET_EMAIL,
    workspaceId,
    workflowId,
    executionsCaptured: executionLog.length,
    sendEmailActionsCaptured: emailActions.length,
    messageIds,
    failedSendEmailActions: failedActions.map((a) => ({
      result: a.result,
      error: a.error || null
    }))
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!messageIds.length) {
    throw new Error('No SES messageId found in execution logs. Email send did not complete successfully.');
  }
}

run().catch((error) => {
  console.error('SMOKE_TEST_FAILED', error.message);
  process.exit(1);
});
