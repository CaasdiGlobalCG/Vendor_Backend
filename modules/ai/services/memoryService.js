// ============================================================
// FILE: modules/ai/services/memoryService.js
// PURPOSE: DynamoDB-backed conversation memory with auto-summarisation.
//          Stores full messages + a running summary of older context.
// ============================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import aiConfig from '../config/aiConfig.js';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE = aiConfig.memory.tableName;

/**
 * Create a new conversation for a vendor.
 */
export async function createConversation(vendorId, title = 'New conversation') {
  const conversationId = uuidv4();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + aiConfig.memory.ttlDays * 86400;

  const item = {
    conversationId,
    vendorId,
    title,
    messages: [],
    summary: '',
    metadata: { createdAt: now, updatedAt: now },
    ttl,
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

/**
 * Get a conversation by ID.
 */
export async function getConversation(conversationId) {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { conversationId } })
  );
  return result.Item || null;
}

/**
 * List conversations for a vendor (most recent first).
 */
export async function listConversations(vendorId, limit = 20) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'vendorId-index',
      KeyConditionExpression: 'vendorId = :vid',
      ExpressionAttributeValues: { ':vid': vendorId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    })
  );
  return (result.Items || []).map((c) => ({
    conversationId: c.conversationId,
    title: c.title,
    metadata: c.metadata,
    messageCount: (c.messages || []).length,
  }));
}

/**
 * Append a message to a conversation (user or assistant).
 */
export async function addMessage(conversationId, role, content) {
  const msg = {
    id: uuidv4(),
    role,       // 'user' | 'assistant' | 'system' | 'tool'
    content,
    timestamp: new Date().toISOString(),
  };

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { conversationId },
      UpdateExpression:
        'SET messages = list_append(if_not_exists(messages, :empty), :msg), metadata.updatedAt = :now',
      ExpressionAttributeValues: {
        ':msg': [msg],
        ':empty': [],
        ':now': new Date().toISOString(),
      },
    })
  );
  return msg;
}

/**
 * Update the title of a conversation (e.g. auto-title from first message).
 */
export async function updateTitle(conversationId, title) {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { conversationId },
      UpdateExpression: 'SET title = :t, metadata.updatedAt = :now',
      ExpressionAttributeValues: {
        ':t': title,
        ':now': new Date().toISOString(),
      },
    })
  );
}

/**
 * Store a summary of older messages and trim the message list.
 */
export async function storeSummaryAndTrim(conversationId, summary, keepLastN) {
  const convo = await getConversation(conversationId);
  if (!convo) return;

  const messages = convo.messages || [];
  const trimmed = messages.slice(-keepLastN);

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { conversationId },
      UpdateExpression: 'SET summary = :s, messages = :m, metadata.updatedAt = :now',
      ExpressionAttributeValues: {
        ':s': summary,
        ':m': trimmed,
        ':now': new Date().toISOString(),
      },
    })
  );
}

/**
 * Delete a conversation.
 */
export async function deleteConversation(conversationId) {
  await docClient.send(
    new DeleteCommand({ TableName: TABLE, Key: { conversationId } })
  );
}

/**
 * Store feedback (thumbs up/down) on a specific message in a conversation.
 * Also stores the user query + AI response pair for reinforcement learning.
 */
export async function addFeedback(conversationId, messageId, feedback, userQuery, aiResponse) {
  const feedbackItem = {
    id: uuidv4(),
    messageId,
    feedback,        // 'positive' | 'negative'
    userQuery,
    aiResponse,
    timestamp: new Date().toISOString(),
  };

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { conversationId },
      UpdateExpression:
        'SET feedback = list_append(if_not_exists(feedback, :empty), :fb), metadata.updatedAt = :now',
      ExpressionAttributeValues: {
        ':fb': [feedbackItem],
        ':empty': [],
        ':now': new Date().toISOString(),
      },
    })
  );
  return feedbackItem;
}

/**
 * Get aggregated feedback for a vendor across all their conversations.
 * Returns patterns the model should learn from.
 */
export async function getVendorFeedback(vendorId, limit = 50) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'vendorId-index',
      KeyConditionExpression: 'vendorId = :vid',
      ExpressionAttributeValues: { ':vid': vendorId },
      ScanIndexForward: false,
      Limit: limit,
    })
  );

  const allFeedback = [];
  for (const convo of (result.Items || [])) {
    for (const fb of (convo.feedback || [])) {
      allFeedback.push(fb);
    }
  }

  // Sort by most recent first
  allFeedback.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  return allFeedback.slice(0, limit);
}

/**
 * Build the message history for the LLM — summary + recent messages.
 * Returns an array of { role, content } suitable for LangChain.
 */
export function buildChatHistory(conversation) {
  const history = [];

  // If there's a summary of older messages, prepend it as a system message
  if (conversation.summary) {
    history.push({
      role: 'system',
      content: `Summary of earlier conversation:\n${conversation.summary}`,
    });
  }

  // Add the recent messages (already in order)
  const messages = conversation.messages || [];
  const recent = messages.slice(-aiConfig.memory.maxFullMessages);
  for (const msg of recent) {
    history.push({ role: msg.role, content: msg.content });
  }

  return history;
}
