// ============================================================
// FILE: modules/ai/controllers/aiController.js
// PURPOSE: Express request handlers for the AI chat module.
//          Supports both regular JSON responses and SSE streaming.
// ============================================================

import {
  chat,
  chatStream,
  checkOllamaHealth,
  clearAgentCache,
} from '../services/agentService.js';
import {
  listConversations,
  getConversation,
  createConversation,
  deleteConversation,
  addFeedback,
} from '../services/memoryService.js';
import { getLearningProfile } from '../services/learningService.js';

/**
 * POST /api/ai/chat
 * Body: { conversationId?, message }
 * Requires: req.vendorId (from attachVendorId middleware)
 */
export async function handleChat(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const { conversationId, message, space } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const activeSpace = space === 'personal' ? 'personal' : 'project';
    console.log(`[AI] Chat request from vendor ${vendorId}, convo: ${conversationId || 'new'}, space: ${activeSpace}`);

    const vendorEmail = req.auth?.email || null;
    const vendorName = req.auth?.name || null;
    const result = await chat(vendorId, conversationId || null, message.trim(), vendorEmail, activeSpace, vendorName);

    return res.json({
      success: true,
      data: {
        conversationId: result.conversationId,
        response: result.response,
        intermediateSteps: result.intermediateSteps,
        generatedTitle: result.generatedTitle || null,
      },
    });
  } catch (err) {
    console.error('[AI] Chat error:', err);
    return res.status(500).json({
      success: false,
      message: 'AI service error',
      error: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
}

/**
 * POST /api/ai/chat/stream
 * SSE streaming version of chat.
 * Body: { conversationId?, message }
 */
export async function handleChatStream(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const { conversationId, message, space } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const activeSpace = space === 'personal' ? 'personal' : 'project';
    console.log(`[AI][Stream] Chat request — vendorId="${vendorId}", convo="${conversationId || 'new'}", space="${activeSpace}", message="${message.trim().slice(0, 80)}"`);

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send a thinking event
    res.write(`data: ${JSON.stringify({ type: 'thinking', content: 'Processing your request...' })}\n\n`);

    const vendorEmail = req.auth?.email || null;
    const vendorName = req.auth?.name || null;

    // Handle client disconnect
    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });

    // Use real-time streaming — events are emitted as they happen
    await chatStream(
      vendorId,
      conversationId || null,
      message.trim(),
      vendorEmail,
      activeSpace,
      vendorName,
      (event) => {
        if (clientDisconnected) return;
        try {
          if (event.type === 'tool_start') {
            res.write(`data: ${JSON.stringify({ type: 'tool_call', tool: event.tool, status: 'running' })}\n\n`);
          } else if (event.type === 'tool_end') {
            res.write(`data: ${JSON.stringify({ type: 'tool_call', tool: event.tool, status: 'completed' })}\n\n`);
          } else if (event.type === 'token') {
            res.write(`data: ${JSON.stringify({ type: 'token', content: event.content })}\n\n`);
          } else if (event.type === 'done') {
            res.write(`data: ${JSON.stringify({
              type: 'done',
              conversationId: event.conversationId,
              generatedTitle: event.generatedTitle || null,
              suggestions: event.suggestions || [],
              actions: event.actions || [],
            })}\n\n`);
          }
        } catch (writeErr) {
          console.warn('[AI][Stream] Write error (client may have disconnected):', writeErr.message);
        }
      }
    );

    if (!clientDisconnected) res.end();
  } catch (err) {
    console.error('[AI] Stream error:', err);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI service error' })}\n\n`);
      res.end();
    } catch {}
  }
}

/**
 * GET /api/ai/conversations
 * List all conversations for the authenticated vendor.
 */
export async function handleListConversations(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const limit = parseInt(req.query.limit) || 20;
    const conversations = await listConversations(vendorId, limit);

    return res.json({ success: true, data: conversations });
  } catch (err) {
    console.error('[AI] List conversations error:', err);
    return res.status(500).json({ success: false, message: 'Failed to list conversations' });
  }
}

/**
 * POST /api/ai/conversations
 * Create a new conversation.
 */
export async function handleCreateConversation(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const title = req.body.title || 'New conversation';
    const conversation = await createConversation(vendorId, title);

    return res.json({ success: true, data: conversation });
  } catch (err) {
    console.error('[AI] Create conversation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create conversation' });
  }
}

/**
 * GET /api/ai/conversations/:id
 * Get a full conversation with messages.
 */
export async function handleGetConversation(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const conversation = await getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (conversation.vendorId !== vendorId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    return res.json({ success: true, data: conversation });
  } catch (err) {
    console.error('[AI] Get conversation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to get conversation' });
  }
}

/**
 * DELETE /api/ai/conversations/:id
 * Delete a conversation.
 */
export async function handleDeleteConversation(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const conversation = await getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (conversation.vendorId !== vendorId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await deleteConversation(req.params.id);
    return res.json({ success: true, message: 'Conversation deleted' });
  } catch (err) {
    console.error('[AI] Delete conversation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete conversation' });
  }
}

/**
 * POST /api/ai/feedback
 * Store thumbs up/down feedback on an AI response.
 * Body: { conversationId, messageId, feedback: 'positive'|'negative', userQuery, aiResponse }
 */
export async function handleFeedback(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const { conversationId, messageId, feedback, userQuery, aiResponse } = req.body;
    if (!conversationId || !messageId || !feedback) {
      return res.status(400).json({ success: false, message: 'conversationId, messageId, and feedback are required' });
    }
    if (!['positive', 'negative'].includes(feedback)) {
      return res.status(400).json({ success: false, message: 'feedback must be "positive" or "negative"' });
    }

    // Verify the conversation belongs to this vendor
    const conversation = await getConversation(conversationId);
    if (!conversation || conversation.vendorId !== vendorId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const result = await addFeedback(conversationId, messageId, feedback, userQuery || '', aiResponse || '');
    console.log(`[AI] Feedback stored: ${feedback} on message ${messageId} in convo ${conversationId}`);

    // Clear agent cache so next request rebuilds with updated feedback context
    clearAgentCache(vendorId);

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[AI] Feedback error:', err);
    return res.status(500).json({ success: false, message: 'Failed to store feedback' });
  }
}

/**
 * GET /api/ai/health
 * Check if Ollama is running and has required models.
 */
export async function handleHealthCheck(req, res) {
  try {
    const health = await checkOllamaHealth();
    return res.json({ success: true, data: health });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * GET /api/ai/learning-stats
 * Returns the AI's learning progress for this vendor.
 */
export async function handleLearningStats(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const profile = await getLearningProfile(vendorId);

    return res.json({
      success: true,
      data: {
        totalInteractions: profile.totalInteractions || 0,
        correctionsStored: (profile.corrections || []).length,
        factsLearned: Object.keys(profile.learnedFacts || {}).length,
        preferredStyle: profile.preferredStyle || {},
        queryPatternsTracked: Object.keys(profile.queryPatterns || {}).length,
        lastUpdated: profile.metadata?.updatedAt || null,
      },
    });
  } catch (err) {
    console.error('[AI] Learning stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to get learning stats' });
  }
}
