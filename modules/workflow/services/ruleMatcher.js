/**
 * Rule Matcher: Evaluates trigger rules against node data
 * Supports: status changes, task completion, time-based, approval events, conditional logic
 */

/**
 * Check if a trigger rule matches current node state
 * @param {Object} rule - Trigger rule object
 * @param {Object} eventData - Data from the event (node change)
 * @returns {Boolean} - True if rule matches
 */
export const evaluateRule = (rule, eventData) => {
  if (!rule || !rule.type) return false;

  try {
    switch (rule.type) {
      case 'status-change':
        return evaluateStatusChange(rule, eventData);
      
      case 'task-completion':
        return evaluateTaskCompletion(rule, eventData);
      
      case 'approval':
        return evaluateApproval(rule, eventData);
      
      case 'conditional':
        return evaluateConditional(rule, eventData);
      
      case 'time-based':
        return evaluateTimeBased(rule); // Time-based evaluates against current time
      
      case 'webhook':
        return true; // Webhook triggers are validated externally
      
      default:
        return false;
    }
  } catch (error) {
    console.error(`❌ Error evaluating rule:`, error);
    return false;
  }
};

/**
 * Evaluate status-change rule
 * Rule structure: { type: 'status-change', rule: { nodeId?, status, fromStatus? } }
 */
const evaluateStatusChange = (rule, eventData) => {
  if (!rule.rule) return false;

  const { nodeId: ruleNodeId, status: targetStatus, fromStatus } = rule.rule;
  const { nodeId, status: currentStatus, previousStatus } = eventData;

  // If rule specifies nodeId, event must match that nodeId
  if (ruleNodeId && nodeId !== ruleNodeId) return false;

  // Check if current status matches target status
  if (currentStatus !== targetStatus) return false;

  // If fromStatus specified, check previous status
  if (fromStatus && previousStatus !== fromStatus) return false;

  return true;
};

/**
 * Evaluate task-completion rule
 * Rule structure: { type: 'task-completion', rule: { nodeId? } }
 */
const evaluateTaskCompletion = (rule, eventData) => {
  if (!rule.rule) return false;

  const { nodeId: ruleNodeId } = rule.rule;
  const { nodeId, status } = eventData;

  // If rule specifies nodeId, event must match
  if (ruleNodeId && nodeId !== ruleNodeId) return false;

  // Task is complete when status = 'Completed'
  return status === 'Completed';
};

/**
 * Evaluate approval rule
 * Rule structure: { type: 'approval', rule: { approvalStatus, nodeId? } }
 */
const evaluateApproval = (rule, eventData) => {
  if (!rule.rule) return false;

  const { approvalStatus: targetStatus, nodeId: ruleNodeId } = rule.rule;
  const { nodeId, approvalStatus } = eventData;

  // If rule specifies nodeId, event must match
  if (ruleNodeId && nodeId !== ruleNodeId) return false;

  // Check if approval status matches
  return approvalStatus === targetStatus;
};

/**
 * Evaluate conditional rule
 * Rule structure: { type: 'conditional', rule: { operator, operands: [{ field, operator, value }] } }
 * Example: { operator: 'AND', operands: [{ field: 'budget', operator: '>', value: 10000 }, { field: 'status', operator: '=', value: 'Approved' }] }
 */
const evaluateConditional = (rule, eventData) => {
  if (!rule.rule || !rule.rule.operands || rule.rule.operands.length === 0) return false;

  const { operator = 'AND', operands } = rule.rule;
  
  const results = operands.map((operand) => {
    const { field, operator: op, value } = operand;
    const fieldValue = getNestedValue(eventData, field);
    
    return evaluateCondition(fieldValue, op, value);
  });

  // Combine results based on operator
  if (operator === 'AND') {
    return results.every((r) => r === true);
  } else if (operator === 'OR') {
    return results.some((r) => r === true);
  }

  return false;
};

/**
 * Evaluate a single condition
 */
const evaluateCondition = (fieldValue, operator, compareValue) => {
  switch (operator.toLowerCase()) {
    case '=':
    case '==':
      return fieldValue === compareValue;
    case '!=':
    case '<>':
      return fieldValue !== compareValue;
    case '>':
      return Number(fieldValue) > Number(compareValue);
    case '>=':
      return Number(fieldValue) >= Number(compareValue);
    case '<':
      return Number(fieldValue) < Number(compareValue);
    case '<=':
      return Number(fieldValue) <= Number(compareValue);
    case 'includes':
    case 'contains':
      return String(fieldValue).includes(String(compareValue));
    case 'startsWith':
      return String(fieldValue).startsWith(String(compareValue));
    case 'endsWith':
      return String(fieldValue).endsWith(String(compareValue));
    case 'in':
      return Array.isArray(compareValue) && compareValue.includes(fieldValue);
    default:
      return false;
  }
};

/**
 * Evaluate time-based rule
 * Rule structure: { type: 'time-based', rule: { frequency, time?, cronExpression? } }
 */
export const evaluateTimeBased = (rule) => {
  if (!rule.rule) return false;

  const { frequency, time, cronExpression, lastExecutedAt } = rule.rule;
  const now = new Date();

  // If lastExecutedAt is within the current period, don't trigger again
  if (lastExecutedAt) {
    const lastExec = new Date(lastExecutedAt);
    
    switch (frequency) {
      case 'daily':
        if (now.toDateString() === lastExec.toDateString()) return false;
        break;
      case 'weekly':
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        if (lastExec > weekAgo) return false;
        break;
      case 'monthly':
        if (now.getMonth() === lastExec.getMonth() && now.getFullYear() === lastExec.getFullYear()) return false;
        break;
    }
  }

  // Simple time validation (for MVP)
  if (time) {
    const [targetHour, targetMin] = time.split(':').map(Number);
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    
    // Allow 5-minute window around target time
    const withinWindow = 
      (currentHour === targetHour && Math.abs(currentMin - targetMin) <= 5) ||
      (currentHour === targetHour - 1 && currentMin >= 55) ||
      (currentHour === targetHour + 1 && currentMin <= 5);
    
    if (!withinWindow) return false;
  }

  return true;
};

/**
 * Evaluate all triggers for a workflow
 * @param {Array} triggers - Array of trigger rules
 * @param {String} logicOperator - 'AND' or 'OR'
 * @param {Object} eventData - Event data to evaluate
 * @returns {Boolean} - True if workflow should be triggered
 */
export const evaluateAllTriggers = (triggers, logicOperator, eventData) => {
  if (!triggers || triggers.length === 0) return false;

  const results = triggers.map((trigger) => evaluateRule(trigger, eventData));

  if (logicOperator === 'AND') {
    return results.every((r) => r === true);
  } else {
    return results.some((r) => r === true);
  }
};

/**
 * Helper: Get nested value from object
 * Example: getNestedValue({ data: { budget: 10000 } }, 'data.budget') => 10000
 */
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((current, prop) => current?.[prop], obj);
};

/**
 * Parse and validate cron expression (basic validation)
 * Returns false if invalid
 */
export const validateCronExpression = (cron) => {
  // Basic cron format: minute hour dayOfMonth month dayOfWeek
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  // Very basic validation: each part is either * or a number or range
  return parts.every((part) => {
    if (part === '*') return true;
    if (/^\d+$/.test(part)) return true;
    if (/^\d+-\d+$/.test(part)) return true;
    if (/^\d+\/\d+$/.test(part)) return true;
    return false;
  });
};
