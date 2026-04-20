import { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

const CONVERSATIONS_TABLE =
  process.env.DYNAMODB_B2B_QUERIES_CONVERSATIONS_TABLE || 'b2b_procurement_query_conversations';
const MESSAGES_TABLE =
  process.env.DYNAMODB_B2B_QUERIES_ITEMS_TABLE || 'b2b_procurement_query_messages';

const EMPLOYEE_BACKEND_URL = process.env.EMPLOYEE_BACKEND_URL || 'http://localhost:5005';
const REALTIME_INTERNAL_SECRET = process.env.REALTIME_INTERNAL_SECRET || '';

const publishToEmployeeRealtime = async (conversationId, message) => {
  if (!REALTIME_INTERNAL_SECRET) return;

  try {
    await fetch(`${EMPLOYEE_BACKEND_URL}/api/procurement/internal/realtime/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-realtime-secret': REALTIME_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        conversationId,
        eventName: 'b2b-query:new',
        payload: { conversationId, message },
      }),
    });
  } catch (error) {
    console.warn('[Workspace Procurement Queries] Employee realtime publish skipped:', error.message);
  }
};

const buildVendorContext = (req) => {
  const user = req.user || {};
  const clientId = user.vendorId || user.id || user.email || null;

  return {
    clientId,
    clientName: user.name || user.email || 'Workspace Vendor',
    clientEmail: user.email || '',
  };
};

const normalizeSeedMessages = (seedMessages, fallbackClientName) => {
  if (!Array.isArray(seedMessages)) return [];

  const now = Date.now();
  const normalized = [];

  for (const [idx, raw] of seedMessages.slice(-20).entries()) {
    const text = String(raw?.message || raw?.content || '').trim();
    if (!text) continue;

    const senderTypeRaw = String(raw?.senderType || raw?.role || '').toLowerCase();
    const senderType = senderTypeRaw === 'assistant' || senderTypeRaw === 'ai'
      ? 'ai'
      : senderTypeRaw === 'procurement'
        ? 'procurement'
        : 'client';

    normalized.push({
      senderType,
      senderName:
        senderType === 'ai'
          ? 'AI Product Guide'
          : senderType === 'procurement'
            ? 'Procurement'
            : fallbackClientName,
      message: text,
      createdAt: new Date(now + idx).toISOString(),
    });
  }

  return normalized;
};

export const listWorkspaceQueryConversations = async (req, res) => {
  try {
    const { clientId } = buildVendorContext(req);
    const workspaceId = String(req.query?.workspaceId || '').trim();

    if (!clientId) {
      return res.status(401).json({ success: false, message: 'Unauthorized vendor context.' });
    }

    const scan = await dbClient.send(new ScanCommand({ TableName: CONVERSATIONS_TABLE }));

    let items = (scan.Items || []).map((item) => unmarshall(item));
    items = items.filter((item) => {
      if (item.clientId !== clientId) return false;
      if (String(item.source || '').toLowerCase() !== 'workspace-query') return false;
      if (workspaceId && item.workspaceId !== workspaceId) return false;
      return true;
    });

    const conversations = items.sort((a, b) =>
      String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
    );

    return res.json({ success: true, conversations });
  } catch (error) {
    console.error('[Workspace Procurement Queries] list error:', error);
    return res.status(500).json({ success: false, message: 'Failed to list workspace procurement queries.' });
  }
};

export const openWorkspaceQueryConversation = async (req, res) => {
  try {
    const { clientId, clientName, clientEmail } = buildVendorContext(req);

    if (!clientId) {
      return res.status(401).json({ success: false, message: 'Unauthorized vendor context.' });
    }

    const {
      queryTitle,
      initialMessage,
      aiTranscript = [],
      context = {},
      workspaceId,
      workspaceName,
      source = 'workspace-query',
    } = req.body || {};

    const resolvedWorkspaceId = String(workspaceId || context?.workspaceId || '').trim();
    if (!resolvedWorkspaceId) {
      return res.status(400).json({ success: false, message: 'workspaceId is required.' });
    }

    const title = String(queryTitle || '').trim() || `Workspace Query • ${workspaceName || resolvedWorkspaceId}`;

    const now = new Date().toISOString();
    const conversationId = `WSQ-${Date.now()}-${uuidv4().slice(0, 8)}`;

    const conversation = {
      conversationId,
      clientId,
      clientName,
      clientEmail,
      queryTitle: title,
      source,
      status: 'open',
      workspaceId: resolvedWorkspaceId,
      workspaceName: workspaceName || context?.workspaceName || null,
      context: {
        ...context,
        workspaceId: resolvedWorkspaceId,
        workspaceName: workspaceName || context?.workspaceName || null,
      },
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      lastMessagePreview: String(initialMessage || title).slice(0, 180),
      unreadByClient: 0,
      unreadByProcurement: 0,
    };

    await dbClient.send(
      new PutItemCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: marshall(conversation, { removeUndefinedValues: true }),
      })
    );

    const seedMessages = normalizeSeedMessages(aiTranscript, clientName);
    const initial = String(initialMessage || '').trim();

    const allSeed = [];
    if (initial) {
      allSeed.push({
        senderType: 'client',
        senderName: clientName,
        message: initial,
        createdAt: now,
      });
    }
    allSeed.push(...seedMessages);

    for (const msg of allSeed) {
      const item = {
        conversationId,
        messageId: `${Date.now()}-${uuidv4().slice(0, 10)}`,
        senderType: msg.senderType,
        senderId: msg.senderType === 'client' ? clientId : msg.senderType,
        senderName: msg.senderName,
        message: msg.message,
        createdAt: msg.createdAt || new Date().toISOString(),
        ...(msg.senderType === 'ai' ? { meta: { isAiContext: true } } : {}),
      };

      await dbClient.send(
        new PutItemCommand({
          TableName: MESSAGES_TABLE,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );
    }

    if (allSeed.length > 0) {
      const last = allSeed[allSeed.length - 1];
      await dbClient.send(
        new UpdateItemCommand({
          TableName: CONVERSATIONS_TABLE,
          Key: marshall({ conversationId }),
          UpdateExpression:
            'SET unreadByProcurement = :unreadByProcurement, lastMessagePreview = :preview, lastMessageAt = :lastMessageAt, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':unreadByProcurement': { N: String(allSeed.filter((m) => m.senderType !== 'procurement').length) },
            ':preview': { S: String(last.message || '').slice(0, 180) },
            ':lastMessageAt': { S: last.createdAt || now },
            ':updatedAt': { S: now },
          },
        })
      );
    }

    return res.status(201).json({ success: true, conversation });
  } catch (error) {
    console.error('[Workspace Procurement Queries] open error:', error);
    return res.status(500).json({ success: false, message: 'Failed to open workspace procurement query.' });
  }
};

export const getWorkspaceQueryConversation = async (req, res) => {
  try {
    const { clientId } = buildVendorContext(req);
    const { conversationId } = req.params;

    const convoResp = await dbClient.send(
      new GetItemCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: marshall({ conversationId }),
      })
    );

    const conversation = convoResp.Item ? unmarshall(convoResp.Item) : null;
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }

    if (conversation.clientId !== clientId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const msgResp = await dbClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'conversationId = :conversationId',
        ExpressionAttributeValues: {
          ':conversationId': { S: conversationId },
        },
        ScanIndexForward: true,
      })
    );

    await dbClient.send(
      new UpdateItemCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: marshall({ conversationId }),
        UpdateExpression: 'SET unreadByClient = :zero, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':zero': { N: '0' },
          ':updatedAt': { S: new Date().toISOString() },
        },
      })
    );

    const messages = (msgResp.Items || []).map((item) => unmarshall(item));

    return res.json({
      success: true,
      conversation: { ...conversation, unreadByClient: 0 },
      messages,
    });
  } catch (error) {
    console.error('[Workspace Procurement Queries] get error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load workspace procurement conversation.' });
  }
};

export const sendWorkspaceQueryMessage = async (req, res) => {
  try {
    const { clientId, clientName } = buildVendorContext(req);
    const { conversationId } = req.params;
    const text = String(req.body?.message || '').trim();

    if (!text) {
      return res.status(400).json({ success: false, message: 'message is required.' });
    }

    const convoResp = await dbClient.send(
      new GetItemCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: marshall({ conversationId }),
      })
    );

    const conversation = convoResp.Item ? unmarshall(convoResp.Item) : null;
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }

    if (conversation.clientId !== clientId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const now = new Date().toISOString();
    const message = {
      conversationId,
      messageId: `${Date.now()}-${uuidv4().slice(0, 10)}`,
      senderType: 'client',
      senderId: clientId,
      senderName: clientName,
      message: text,
      createdAt: now,
    };

    await dbClient.send(
      new PutItemCommand({
        TableName: MESSAGES_TABLE,
        Item: marshall(message, { removeUndefinedValues: true }),
      })
    );

    await dbClient.send(
      new UpdateItemCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: marshall({ conversationId }),
        UpdateExpression:
          'SET updatedAt = :updatedAt, lastMessageAt = :lastMessageAt, lastMessagePreview = :preview, unreadByProcurement = if_not_exists(unreadByProcurement, :zero) + :inc',
        ExpressionAttributeValues: {
          ':updatedAt': { S: now },
          ':lastMessageAt': { S: now },
          ':preview': { S: text.slice(0, 180) },
          ':inc': { N: '1' },
          ':zero': { N: '0' },
        },
      })
    );

    await publishToEmployeeRealtime(conversationId, message);

    return res.status(201).json({ success: true, message });
  } catch (error) {
    console.error('[Workspace Procurement Queries] send error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send workspace procurement message.' });
  }
};
