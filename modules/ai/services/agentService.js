// ============================================================
// FILE: modules/ai/services/agentService.js
// PURPOSE: LangChain ReAct agent wired to Ollama (local LLM)
//          with DynamoDB tools and conversation memory.
//
// Uses @langchain/langgraph prebuilt createReactAgent which
// returns a compiled LangGraph (no legacy AgentExecutor).
// ============================================================

import { ChatOllama } from '@langchain/ollama';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages';

import aiConfig from '../config/aiConfig.js';

// Tool factories
import { createWorkspaceTools } from '../tools/workspaceTool.js';
import { createLeadsTools } from '../tools/leadsTool.js';
import { createFinanceTools } from '../tools/financeTool.js';
import { createProjectTools } from '../tools/projectTool.js';
import { createVendorProfileTools } from '../tools/vendorProfileTool.js';
import { createScheduleTools } from '../tools/scheduleTool.js';
import { createNLFilterTools } from '../tools/nlFilterTool.js';
import { createMemorySearchTools } from '../tools/memorySearchTool.js';
import { createEmailTools } from '../tools/emailTool.js';

// Memory
import {
  getConversation,
  createConversation,
  addMessage,
  updateTitle,
  storeSummaryAndTrim,
  buildChatHistory,
  getVendorFeedback,
} from './memoryService.js';

// Continuous learning engine
import {
  getLearningProfile,
  isCorrection,
  recordCorrection,
  recordFact,
  trackQueryPattern,
  updatePreferredStyle,
  extractFactsFromResponse,
  detectStylePreference,
  buildLearningContext,
  clearLearningCache,
} from './learningService.js';

// Cache compiled agents per vendorId to avoid re-init on every request
// Keyed as `${vendorId}:${space}` to maintain separate agents per space
const agentCache = new Map();

/**
 * Build all tools scoped to a specific vendorId.
 * In 'personal' space, no CaaS tools are provided.
 */
// Cache vendorEmail / vendorName for schedule + email tools
const vendorEmailCache = new Map();
const vendorNameCache = new Map();

function buildToolsForVendor(vendorId, space = 'project') {
  // Personal space = no tools (pure LLM conversation)
  if (space === 'personal') return [];

  const vendorEmail = vendorEmailCache.get(vendorId) || null;
  const vendorName = vendorNameCache.get(vendorId) || null;
  return [
    ...createWorkspaceTools(vendorId),
    ...createLeadsTools(vendorId),
    ...createFinanceTools(vendorId),
    ...createProjectTools(vendorId),
    ...createVendorProfileTools(vendorId),
    ...createScheduleTools(vendorId, vendorEmail),
    ...createNLFilterTools(vendorId),
    ...createMemorySearchTools(vendorId),
    ...createEmailTools(vendorId, vendorEmail, vendorName),
  ];
}

/**
 * Get or create a compiled LangGraph agent for a given vendorId.
 * The langgraph createReactAgent returns a compiled graph directly.
 * Incorporates user feedback as reinforcement learning context.
 */
async function getAgent(vendorId, space = 'project') {
  const cacheKey = `${vendorId}:${space}`;
  if (agentCache.has(cacheKey)) {
    return agentCache.get(cacheKey);
  }

  const llm = new ChatOllama({
    baseUrl: aiConfig.ollama.baseUrl,
    model: aiConfig.ollama.chatModel,
    temperature: space === 'personal' ? 0.6 : aiConfig.ollama.temperature,
    numCtx: aiConfig.ollama.numCtx,
  });

  const tools = buildToolsForVendor(vendorId, space);

  // Use different system prompt per space
  let systemPrompt = space === 'personal'
    ? aiConfig.personalSpaceSystemPrompt
    : aiConfig.systemPrompt;

  // Add feedback reinforcement only for project space
  if (space === 'project') {
    try {
      const feedback = await getVendorFeedback(vendorId, 30);
      const feedbackContext = buildFeedbackContext(feedback);
      if (feedbackContext) {
        systemPrompt += `\n\n${feedbackContext}`;
      }
    } catch (err) {
      console.warn('[AI][AgentService] Failed to load feedback for prompt (non-fatal):', err.message);
    }
  }

  // Load continuous learning context (corrections, preferences, facts)
  try {
    const profile = await getLearningProfile(vendorId);
    const learningCtx = buildLearningContext(profile);
    if (learningCtx) {
      systemPrompt += `\n\n${learningCtx}`;
    }
    console.log(`[AI][AgentService] Learning profile loaded — ${profile.totalInteractions || 0} past interactions, ${(profile.corrections || []).length} corrections stored`);
  } catch (err) {
    console.warn('[AI][AgentService] Failed to load learning context (non-fatal):', err.message);
  }

  // Personal space: no tools — falls through to simple LLM wrapper
  // For project space: full ReAct agent with CaaS tools
  let agent;
  if (tools.length === 0) {
    // Wrap LLM as a simple callable that matches agent.invoke() shape
    const sysMsg = new SystemMessage(systemPrompt);
    agent = {
      invoke: async ({ messages }, opts) => {
        const fullMessages = [sysMsg, ...messages];
        const result = await llm.invoke(fullMessages);
        return { messages: [...messages, result] };
      },
    };
  } else {
    agent = createReactAgent({
      llm,
      tools,
      messageModifier: new SystemMessage(systemPrompt),
    });
  }

  agentCache.set(cacheKey, agent);
  return agent;
}

/**
 * Build reinforcement learning context from user feedback.
 * Extracts patterns from positive/negative feedback to guide the model.
 */
function buildFeedbackContext(feedbackItems) {
  if (!feedbackItems || feedbackItems.length === 0) return null;

  const positive = feedbackItems.filter(f => f.feedback === 'positive');
  const negative = feedbackItems.filter(f => f.feedback === 'negative');

  if (positive.length === 0 && negative.length === 0) return null;

  let context = 'REINFORCEMENT LEARNING FROM USER FEEDBACK:\n';
  context += 'The user has provided feedback on your past responses. Learn from these patterns:\n\n';

  if (positive.length > 0) {
    context += 'GOOD RESPONSE PATTERNS (user liked these — do more of this):\n';
    for (const fb of positive.slice(0, 8)) {
      if (fb.userQuery && fb.aiResponse) {
        context += `- When asked "${fb.userQuery.slice(0, 100)}", the user liked: "${fb.aiResponse.slice(0, 150)}"\n`;
      }
    }
    context += '\n';
  }

  if (negative.length > 0) {
    context += 'BAD RESPONSE PATTERNS (user disliked these — avoid this style/approach):\n';
    for (const fb of negative.slice(0, 8)) {
      if (fb.userQuery && fb.aiResponse) {
        context += `- When asked "${fb.userQuery.slice(0, 100)}", the user disliked: "${fb.aiResponse.slice(0, 150)}"\n`;
      }
    }
    context += '\n';
  }

  context += `Summary: ${positive.length} positive and ${negative.length} negative ratings received. Adjust your response style accordingly.`;
  return context;
}

/**
 * Convert stored message history to LangChain message objects.
 */
function toMessages(history) {
  return history.map((msg) => {
    switch (msg.role) {
      case 'user':
        return new HumanMessage(msg.content);
      case 'assistant':
        return new AIMessage(msg.content);
      case 'system':
        return new SystemMessage(msg.content);
      default:
        return new HumanMessage(msg.content);
    }
  });
}

/**
 * Detect if a message is simple/conversational and doesn't need tools.
 * Returns a quick response string, or null if the agent should handle it.
 */
const CASUAL_PATTERNS = [
  { pattern: /^(hey|hi|hello|hola|hii+|yo)\b/i, responses: [
    "Hey there! 👋 How can I help you today?",
    "Hi! 👋 What can I do for you?",
    "Hello! How can I assist you today?",
  ]},
  { pattern: /^(good\s*(morning|afternoon|evening|night))/i, responses: [
    "Good {timeOfDay}! ☀️ How can I help you?",
    "{timeOfDay}! What would you like to know?",
  ]},
  { pattern: /^(thanks|thank\s*you|thx|ty)\b/i, responses: [
    "You're welcome! Let me know if you need anything else. 😊",
    "Happy to help! Anything else?",
  ]},
  { pattern: /^(bye|goodbye|see\s*you|cya)\b/i, responses: [
    "Goodbye! Have a great day! 👋",
    "See you later! 😊",
  ]},
  { pattern: /^(how\s*are\s*you|how('s| is)\s*it\s*going|what's\s*up|sup)\b/i, responses: [
    "I'm doing great, thanks for asking! 😊 How can I help you today?",
    "All good here! What can I do for you?",
  ]},
  { pattern: /^(what\s*can\s*you\s*do|how\s*can\s*you\s*help|what\s*are\s*your\s*capabilities|help)\b/i, responses: [
    "I can help you with:\n\n• **Workspaces & Tasks** — check pending tasks, task status across workspaces\n• **Leads** — view your lead invitations, stats, and status\n• **Finance** — invoices, quotations, purchase orders, credit notes, subscriptions\n• **Projects** — project status and details\n• **Profile & Team** — your vendor profile, products, customers, team members\n• **Notifications** — unread notifications\n\nJust ask me anything! For example: \"How many pending tasks do I have?\"",
  ]},
];

function getQuickResponse(message) {
  const trimmed = message.trim();
  if (trimmed.length > 60) return null; // Too long to be a casual message

  for (const { pattern, responses } of CASUAL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const response = responses[Math.floor(Math.random() * responses.length)];
      // Replace {timeOfDay} placeholder if present
      if (match[1]) {
        const tod = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        return response.replace('{timeOfDay}', tod).replace('{timeOfDay}', tod);
      }
      return response;
    }
  }
  return null;
}

/**
 * Main chat function — sends a user message and gets an AI response.
 *
 * @param {string} vendorId - The authenticated vendor's ID
 * @param {string} conversationId - Existing conversation ID (or null for new)
 * @param {string} userMessage - The user's input
 * @returns {{ conversationId, response, intermediateSteps }}
 */
export async function chat(vendorId, conversationId, userMessage, vendorEmail, space = 'project', vendorName = null) {
  console.log(`[AI][AgentService] chat() called — vendorId="${vendorId}", conversationId="${conversationId}", space="${space}", message="${userMessage.slice(0, 100)}"`);

  // Store vendorEmail + vendorName for schedule & email tools
  if (vendorEmail) {
    const cached = vendorEmailCache.get(vendorId);
    if (cached !== vendorEmail) {
      vendorEmailCache.set(vendorId, vendorEmail);
      agentCache.delete(`${vendorId}:project`); // rebuild tools with new email
    }
  }
  if (vendorName) {
    vendorNameCache.set(vendorId, vendorName);
  }

  // ── FAST PATH: handle simple conversational messages instantly ──
  const quickResponse = getQuickResponse(userMessage);
  if (quickResponse) {
    console.log(`[AI][AgentService] Fast-path response for casual message`);

    // Still save to conversation for history
    let conversation;
    if (conversationId) {
      conversation = await getConversation(conversationId);
      if (!conversation || conversation.vendorId !== vendorId) {
        conversation = await createConversation(vendorId, userMessage.slice(0, 60));
      }
    } else {
      conversation = await createConversation(vendorId, userMessage.slice(0, 60));
    }

    await addMessage(conversation.conversationId, 'user', userMessage);
    await addMessage(conversation.conversationId, 'assistant', quickResponse);

    return {
      conversationId: conversation.conversationId,
      response: quickResponse,
      intermediateSteps: [],
      generatedTitle: null,
    };
  }

  // ── FULL PATH: agent with tools ──

  // 1. Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = await getConversation(conversationId);
    if (!conversation || conversation.vendorId !== vendorId) {
      conversation = await createConversation(vendorId, userMessage.slice(0, 80));
    }
  } else {
    conversation = await createConversation(vendorId, userMessage.slice(0, 80));
  }

  // 2. Save user message
  await addMessage(conversation.conversationId, 'user', userMessage);

  // 2b. ── CORRECTION DETECTION ──
  //     If the user is correcting the AI, extract and store the correction.
  if (isCorrection(userMessage)) {
    const existingMessages = conversation.messages || [];
    const lastAiMsg = [...existingMessages].reverse().find(m => m.role === 'assistant');
    if (lastAiMsg) {
      // Fire and forget — correction is stored for future context
      recordCorrection(
        vendorId,
        lastAiMsg.content.slice(0, 200),
        userMessage.slice(0, 200),
        'general'
      ).catch(() => {});
      // Also rebuild the agent to incorporate the new correction immediately
      agentCache.delete(`${vendorId}:${space}`);
      console.log(`[AI][Learning] Correction detected and stored. Agent cache cleared.`);
    }
  }

  // 2c. ── STYLE PREFERENCE DETECTION ──
  const stylePref = detectStylePreference(userMessage);
  if (stylePref) {
    updatePreferredStyle(vendorId, stylePref).catch(() => {});
    agentCache.delete(`${vendorId}:${space}`); // Rebuild agent with new preference
  }

  // 3. Mark as needing auto-title (will generate after AI responds)
  const needsAutoTitle = (conversation.messages || []).length === 0;
  if (needsAutoTitle) {
    // Temporary title until LLM generates a better one
    await updateTitle(conversation.conversationId, userMessage.slice(0, 60));
  }

  // 4. Refresh conversation to get updated messages
  conversation = await getConversation(conversation.conversationId);

  // 5. Build chat history as LangChain messages
  const historyArray = buildChatHistory(conversation);
  const langchainMessages = toMessages(historyArray);
  // The last message is the user message we just added — already included

  // 6. Get the langgraph agent (async — loads feedback for reinforcement learning)
  console.log(`[AI][AgentService] Built ${langchainMessages.length} messages for agent, vendorId="${vendorId}", space="${space}"`);
  const agent = await getAgent(vendorId, space);

  // 7. Run the agent — langgraph expects { messages: [...] }
  let result;
  let intermediateSteps = [];
  try {
    result = await agent.invoke(
      { messages: langchainMessages },
      { recursionLimit: 16 },
    );
  } catch (err) {
    console.error('[AgentService] Agent execution error:', err);
    const fallbackResponse =
      'I apologize, but I encountered an error while processing your request. Please try again or rephrase your question.';
    await addMessage(conversation.conversationId, 'assistant', fallbackResponse);
    return {
      conversationId: conversation.conversationId,
      response: fallbackResponse,
      intermediateSteps: [],
    };
  }

  // 8. Extract AI response from the result messages
  //    The result.messages array contains all messages including tool calls.
  const resultMessages = result.messages || [];

  // Collect tool call info for transparency
  let actions = []; // Collect __action markers from tool results
  for (const msg of resultMessages) {
    if (msg.additional_kwargs?.tool_calls) {
      for (const tc of msg.additional_kwargs.tool_calls) {
        intermediateSteps.push({
          tool: tc.function?.name,
          input: tc.function?.arguments,
        });
      }
    }
    // Extract __action from ToolMessage content (tool results)
    if (msg._getType?.() === 'tool' && typeof msg.content === 'string') {
      try {
        const parsed = JSON.parse(msg.content);
        if (parsed.__action) {
          actions.push(parsed.__action);
        }
      } catch { /* not JSON — skip */ }
    }
  }

  console.log(`[AI][AgentService] Agent returned ${resultMessages.length} messages, ${intermediateSteps.length} tool calls`);

  // The final AI text is the last AIMessage that has string content
  let aiResponse = 'I wasn\'t able to generate a response.';
  for (let i = resultMessages.length - 1; i >= 0; i--) {
    const msg = resultMessages[i];
    if (msg._getType?.() === 'ai' && typeof msg.content === 'string' && msg.content.trim()) {
      aiResponse = msg.content;
      break;
    }
  }

  // 9. Save assistant response
  await addMessage(conversation.conversationId, 'assistant', aiResponse);

  // 9b. ── CONTINUOUS LEARNING: post-response analysis (non-blocking) ──
  runPostResponseLearning(vendorId, userMessage, aiResponse).catch((err) => {
    console.warn('[AI][Learning] Post-response analysis failed (non-fatal):', err.message);
  });

  // 10. Auto-generate a smart title for new conversations (non-blocking)
  let generatedTitle = null;
  if (needsAutoTitle) {
    // Fire and forget — don't block the response
    generateSmartTitle(vendorId, userMessage, aiResponse)
      .then(async (title) => {
        if (title) {
          await updateTitle(conversation.conversationId, title);
          console.log(`[AI][AgentService] Auto-titled conversation: "${title}"`);
        }
      })
      .catch((err) => {
        console.warn('[AI][AgentService] Auto-title generation failed (non-fatal):', err.message);
      });
  }

  // 11. Check if we need to summarise older messages
  const updatedConvo = await getConversation(conversation.conversationId);
  const messageCount = (updatedConvo.messages || []).length;
  if (messageCount > aiConfig.memory.summaryThreshold) {
    try {
      await summariseOlderMessages(vendorId, updatedConvo);
    } catch (err) {
      console.error('[AgentService] Summarisation error (non-fatal):', err.message);
    }
  }

  // 12. Generate smart follow-up suggestions based on the response
  const suggestions = generateSmartSuggestions(userMessage, aiResponse, intermediateSteps, space);

  return {
    conversationId: conversation.conversationId,
    response: aiResponse,
    intermediateSteps,
    generatedTitle,
    suggestions,
    actions, // Workspace open actions, etc.
  };
}

/**
 * Real-time streaming version of chat().
 * Uses LangGraph agent.stream() to yield events as they happen:
 *   - { type: 'tool_start', tool: 'sendEmail' }
 *   - { type: 'tool_end', tool: 'sendEmail' }
 *   - { type: 'token', content: '...' }
 *   - { type: 'done', conversationId, suggestions, actions, generatedTitle }
 *
 * This eliminates the 30-60s wait before events are sent to the client.
 */
export async function chatStream(vendorId, conversationId, userMessage, vendorEmail, space = 'project', vendorName = null, onEvent) {
  console.log(`[AI][AgentService] chatStream() called — vendorId="${vendorId}", space="${space}", message="${userMessage.slice(0, 100)}"`);

  // Store vendorEmail + vendorName for schedule & email tools
  if (vendorEmail) {
    const cached = vendorEmailCache.get(vendorId);
    if (cached !== vendorEmail) {
      vendorEmailCache.set(vendorId, vendorEmail);
      agentCache.delete(`${vendorId}:project`);
    }
  }
  if (vendorName) {
    vendorNameCache.set(vendorId, vendorName);
  }

  // ── FAST PATH: handle simple conversational messages instantly ──
  const quickResponse = getQuickResponse(userMessage);
  if (quickResponse) {
    let conversation;
    if (conversationId) {
      conversation = await getConversation(conversationId);
      if (!conversation || conversation.vendorId !== vendorId) {
        conversation = await createConversation(vendorId, userMessage.slice(0, 60));
      }
    } else {
      conversation = await createConversation(vendorId, userMessage.slice(0, 60));
    }
    await addMessage(conversation.conversationId, 'user', userMessage);
    await addMessage(conversation.conversationId, 'assistant', quickResponse);
    // Emit tokens directly for quick responses
    const words = quickResponse.split(' ');
    for (let i = 0; i < words.length; i += 5) {
      onEvent({ type: 'token', content: words.slice(i, i + 5).join(' ') + ' ' });
    }
    onEvent({
      type: 'done',
      conversationId: conversation.conversationId,
      generatedTitle: null,
      suggestions: generateSmartSuggestions(userMessage, quickResponse, [], space),
      actions: [],
    });
    return;
  }

  // ── CONVERSATION MANAGEMENT (same as chat()) ──
  let conversation;
  if (conversationId) {
    conversation = await getConversation(conversationId);
    if (!conversation || conversation.vendorId !== vendorId) {
      conversation = await createConversation(vendorId, userMessage.slice(0, 60));
    }
  } else {
    conversation = await createConversation(vendorId, userMessage.slice(0, 60));
  }

  await addMessage(conversation.conversationId, 'user', userMessage);

  // Correction detection
  if (isCorrection(userMessage)) {
    const recentConvo = await getConversation(conversation.conversationId);
    const msgs = recentConvo.messages || [];
    if (msgs.length >= 2) {
      const lastAssistant = msgs.filter(m => m.role === 'assistant').pop();
      if (lastAssistant) {
        await recordCorrection(vendorId, lastAssistant.content, userMessage);
        agentCache.delete(`${vendorId}:${space}`);
      }
    }
  }

  // Style preference detection
  const stylePref = detectStylePreference(userMessage);
  if (stylePref) {
    updatePreferredStyle(vendorId, stylePref).catch(() => {});
    agentCache.delete(`${vendorId}:${space}`);
  }

  const needsAutoTitle = (conversation.messages || []).length === 0;
  if (needsAutoTitle) {
    await updateTitle(conversation.conversationId, userMessage.slice(0, 60));
  }

  conversation = await getConversation(conversation.conversationId);
  const historyArray = buildChatHistory(conversation);
  const langchainMessages = toMessages(historyArray);

  const agent = await getAgent(vendorId, space);

  // ── STREAM the agent execution ──
  let aiResponse = 'I wasn\'t able to generate a response.';
  let intermediateSteps = [];
  let actions = [];

  try {
    const stream = await agent.stream(
      { messages: langchainMessages },
      { recursionLimit: 16, streamMode: 'updates' },
    );

    for await (const event of stream) {
      // LangGraph stream events structure:
      // Each event is { [nodeName]: { messages: [...] } }
      for (const [nodeName, nodeData] of Object.entries(event)) {
        const msgs = nodeData?.messages || [];
        for (const msg of msgs) {
          const msgType = msg._getType?.() || msg.constructor?.name || '';

          // AI message with tool calls → emit tool_start for each
          if (msgType === 'ai' && msg.additional_kwargs?.tool_calls?.length > 0) {
            for (const tc of msg.additional_kwargs.tool_calls) {
              const toolName = tc.function?.name;
              if (toolName) {
                onEvent({ type: 'tool_start', tool: toolName });
                intermediateSteps.push({
                  tool: toolName,
                  input: tc.function?.arguments,
                });
              }
            }
          }

          // Tool result message → emit tool_end + extract actions
          if (msgType === 'tool') {
            const toolName = msg.name || '';
            onEvent({ type: 'tool_end', tool: toolName });

            // Extract __action from tool results
            if (typeof msg.content === 'string') {
              try {
                const parsed = JSON.parse(msg.content);
                if (parsed.__action) {
                  actions.push(parsed.__action);
                }
              } catch { /* not JSON */ }
            }
          }

          // Final AI response text (no tool calls — the actual answer)
          if (msgType === 'ai' && typeof msg.content === 'string' && msg.content.trim() && (!msg.additional_kwargs?.tool_calls || msg.additional_kwargs.tool_calls.length === 0)) {
            aiResponse = msg.content;
          }
        }
      }
    }
  } catch (err) {
    console.error('[AgentService] Agent stream error:', err);
    aiResponse = 'I apologize, but I encountered an error. Please try again.';
  }

  // ── POST-PROCESSING (same as chat()) ──
  await addMessage(conversation.conversationId, 'assistant', aiResponse);

  runPostResponseLearning(vendorId, userMessage, aiResponse).catch(() => {});

  if (needsAutoTitle) {
    generateSmartTitle(vendorId, userMessage, aiResponse)
      .then(async (title) => {
        if (title) await updateTitle(conversation.conversationId, title);
      })
      .catch(() => {});
  }

  const updatedConvo = await getConversation(conversation.conversationId);
  const messageCount = (updatedConvo.messages || []).length;
  if (messageCount > aiConfig.memory.summaryThreshold) {
    try { await summariseOlderMessages(vendorId, updatedConvo); } catch {}
  }

  const suggestions = generateSmartSuggestions(userMessage, aiResponse, intermediateSteps, space);

  // Stream the actual response text as tokens
  const words = aiResponse.split(' ');
  const chunkSize = 5;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    onEvent({ type: 'token', content: chunk + ' ' });
  }

  onEvent({
    type: 'done',
    conversationId: conversation.conversationId,
    generatedTitle: null,
    suggestions,
    actions,
  });
}

/**
 * Generate 2-3 contextual follow-up suggestions based on the AI response.
 * Analyzes the response content and tools used to suggest relevant next queries.
 */
function generateSmartSuggestions(userMessage, aiResponse, intermediateSteps, space = 'project') {
  const suggestions = [];
  const lower = aiResponse.toLowerCase();
  const userLower = userMessage.toLowerCase();

  // ── Personal space suggestions ──
  if (space === 'personal') {
    if (/market|industry|trend/i.test(lower)) {
      suggestions.push('Dive deeper into this trend');
      suggestions.push('How does this affect small businesses?');
      suggestions.push('Compare with competitors');
    } else if (/draft|email|proposal|write/i.test(lower)) {
      suggestions.push('Make it more formal');
      suggestions.push('Shorten this draft');
      suggestions.push('Add a call to action');
    } else if (/idea|brainstorm|strategy/i.test(lower)) {
      suggestions.push('Expand on the best idea');
      suggestions.push('Create an action plan');
      suggestions.push('What are the risks?');
    } else if (/news|latest|update/i.test(lower)) {
      suggestions.push('How does this impact my business?');
      suggestions.push('Related developments');
      suggestions.push('Summarize key takeaways');
    } else {
      suggestions.push('Tell me more about this');
      suggestions.push('Help me research a topic');
      suggestions.push('Draft something for me');
    }
    return [...new Set(suggestions)]
      .filter(s => !userLower.includes(s.toLowerCase().slice(0, 20)))
      .slice(0, 3);
  }
  const toolsUsed = (intermediateSteps || []).map(s => s.tool).filter(Boolean);

  // ── Workspace / Task context ──
  if (toolsUsed.includes('list_workspaces') || /workspace/i.test(lower)) {
    if (!/task/i.test(userLower)) suggestions.push('Show pending tasks across workspaces');
    if (!/detail/i.test(userLower)) suggestions.push('Give me workspace details');
    suggestions.push('Which workspace has the most activity?');
  }

  // ── Leads context ──
  if (toolsUsed.includes('list_leads') || /lead/i.test(lower)) {
    if (!/pending/i.test(userLower)) suggestions.push('Show only pending leads');
    if (!/accepted|approved/i.test(userLower)) suggestions.push('How many leads were accepted?');
    suggestions.push('What is my lead conversion rate?');
  }

  // ── Finance context ──
  if (toolsUsed.includes('query_finance') || /invoice|quotation|purchase.order|credit.note|subscription/i.test(lower)) {
    if (/invoice/i.test(lower) && !/overdue|pending/i.test(userLower)) suggestions.push('Show overdue invoices');
    if (/quotation/i.test(lower)) suggestions.push('Which quotations are still pending?');
    if (!/total|sum/i.test(userLower)) suggestions.push('What is the total revenue this month?');
    suggestions.push('Give me a complete finance summary');
  }

  // ── Projects context ──
  if (toolsUsed.includes('list_projects') || /project/i.test(lower)) {
    if (!/completed/i.test(userLower)) suggestions.push('Show completed projects');
    if (!/progress|status/i.test(userLower)) suggestions.push('What is the overall project completion rate?');
    suggestions.push('Which project needs attention?');
  }

  // ── Profile / Team context ──
  if (toolsUsed.includes('get_vendor_profile') || /profile|team|member/i.test(lower)) {
    suggestions.push('Show my team members');
    suggestions.push('How many products do I have listed?');
  }

  // ── Notifications ──
  if (/notification/i.test(lower)) {
    suggestions.push('Mark all notifications as read');
    suggestions.push('Show only unread notifications');
  }

  // ── Schedules / Reminders context ──
  if (toolsUsed.includes('createScheduleFromText') || /schedule|reminder|created.*schedule/i.test(lower)) {
    suggestions.push('Show all my schedules');
    if (!/report/i.test(userLower)) suggestions.push('Set up a weekly finance report');
    if (!/reminder/i.test(userLower)) suggestions.push('Set a reminder for pending invoices');
  }

  if (toolsUsed.includes('listSchedules') || /schedule.*list|active.*schedule/i.test(lower)) {
    suggestions.push('Create a new scheduled report');
    suggestions.push('Pause all my schedules');
  }

  // ── Natural Language Filter context ──
  if (toolsUsed.includes('naturalLanguageFilter') || /filter|above|below|overdue|more than|less than/i.test(lower)) {
    if (!/export|pdf|excel/i.test(userLower)) suggestions.push('Export these results as PDF');
    suggestions.push('Show a broader filter (all statuses)');
    suggestions.push('Schedule this as a recurring report');
  }

  // ── Memory Search context ──
  if (toolsUsed.includes('searchConversationHistory') || /remember|discussed|talked about|past conversation/i.test(lower)) {
    suggestions.push('Search for a different topic');
    suggestions.push('Show my recent conversations');
    if (!/detail/i.test(userLower)) suggestions.push('Give me more details on this');
  }

  // ── Email context ──
  if (toolsUsed.includes('sendEmail') || /email.*sent|mail.*sent|message.*sent/i.test(lower)) {
    suggestions.push('Send another email');
    suggestions.push('Show my recent invoices');
    suggestions.push('Check pending tasks');
  }
  if (/send.*email|compose.*email|mail.*to/i.test(userLower) && !toolsUsed.includes('sendEmail')) {
    suggestions.push('Send a quick email');
    suggestions.push('Email my finance summary');
  }

  // ── Number-based responses → suggest scheduling ──
  const hasNumbers = /\d+/.test(aiResponse) && aiResponse.length > 50;
  if (hasNumbers && suggestions.length < 3) {
    suggestions.push('Schedule this as a recurring report');
  }

  // ── General fallback if no context-specific suggestions ──
  if (suggestions.length === 0) {
    suggestions.push('Show my dashboard summary');
    suggestions.push('Any pending tasks?');
    suggestions.push('Finance overview');
  }

  // Return max 3 unique suggestions, excluding anything similar to the user's message
  return [...new Set(suggestions)]
    .filter(s => !userLower.includes(s.toLowerCase().slice(0, 20)))
    .slice(0, 3);
}

/**
 * Post-response continuous learning analysis.
 * Runs asynchronously after every agent response (non-blocking).
 * Extracts facts, tracks query patterns, and records interaction data.
 */
async function runPostResponseLearning(vendorId, userMessage, aiResponse) {
  // 1. Track query pattern for frequently asked questions
  const normalizedQuery = userMessage.replace(/[?!.,]/g, '').trim();
  if (normalizedQuery.length > 5) {
    await trackQueryPattern(vendorId, normalizedQuery, aiResponse);
  }

  // 2. Extract and store any facts from the AI's response
  //    (e.g., "you have 7 workspaces" → workspace_count = 7)
  const facts = extractFactsFromResponse(userMessage, aiResponse);
  for (const { key, value } of facts) {
    await recordFact(vendorId, key, value);
  }

  // 3. Detect style preferences from user's phrasing
  const stylePref = detectStylePreference(userMessage);
  if (stylePref) {
    await updatePreferredStyle(vendorId, stylePref);
  }

  if (facts.length > 0) {
    console.log(`[AI][Learning] Extracted ${facts.length} fact(s) from response for vendor ${vendorId}`);
  }
}

/**
 * Generate a short, meaningful conversation title using the LLM.
 * Runs after the first user message + AI response exchange.
 */
async function generateSmartTitle(vendorId, userMessage, aiResponse) {
  const llm = new ChatOllama({
    baseUrl: aiConfig.ollama.baseUrl,
    model: aiConfig.ollama.chatModel,
    temperature: 0.3,
    numCtx: 1024,
  });

  const titlePrompt = `Generate a very short title (max 6 words) for a conversation that starts with this exchange. The title should capture the topic concisely.

User: ${userMessage.slice(0, 200)}
Assistant: ${aiResponse.slice(0, 300)}

Rules:
- Maximum 6 words
- No quotes or punctuation at the start/end
- Descriptive and specific (e.g., "Pending Tasks Overview", "Finance Summary", "Workspace Project Status")
- Just output the title, nothing else

Title:`;

  const result = await llm.invoke([new HumanMessage(titlePrompt)]);
  let title = (result.content || '').trim();

  // Clean up: remove quotes, limit length
  title = title.replace(/^["']|["']$/g, '').trim();
  // Take only the first line if multiple lines returned
  title = title.split('\n')[0].trim();
  // Truncate if too long
  if (title.length > 60) title = title.slice(0, 57) + '...';

  return title || null;
}

/**
 * Summarise older messages using the LLM itself.
 */
async function summariseOlderMessages(vendorId, conversation) {
  const messages = conversation.messages || [];
  const keepLastN = aiConfig.memory.maxFullMessages;
  const toSummarise = messages.slice(0, -keepLastN);

  if (toSummarise.length < 5) return; // not worth summarising

  const llm = new ChatOllama({
    baseUrl: aiConfig.ollama.baseUrl,
    model: aiConfig.ollama.chatModel,
    temperature: 0.2,
  });

  const existingSummary = conversation.summary || '';
  const messageText = toSummarise
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const summaryPrompt = existingSummary
    ? `Previous summary:\n${existingSummary}\n\nNew messages to incorporate:\n${messageText}\n\nProvide an updated concise summary of the entire conversation so far. Focus on key facts, decisions, and context that would be needed to continue the conversation.`
    : `Summarise the following conversation concisely. Focus on key facts, decisions, requests made, data discussed, and context that would be needed to continue the conversation:\n\n${messageText}`;

  const summaryResult = await llm.invoke([new HumanMessage(summaryPrompt)]);
  const summaryText = summaryResult.content || '';

  await storeSummaryAndTrim(conversation.conversationId, summaryText, keepLastN);
}

/**
 * Clear the cached agent for a vendor (e.g., on logout or feedback).
 * Also clears the learning profile cache to force a fresh reload.
 */
export function clearAgentCache(vendorId) {
  // Clear both space agents
  agentCache.delete(`${vendorId}:project`);
  agentCache.delete(`${vendorId}:personal`);
  clearLearningCache(vendorId);
}

/**
 * Check if Ollama is available.
 */
export async function checkOllamaHealth() {
  try {
    const response = await fetch(`${aiConfig.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { healthy: false, error: `HTTP ${response.status}` };
    const data = await response.json();
    const models = (data.models || []).map((m) => m.name);
    const hasRequiredModel = models.some((m) => m.includes(aiConfig.ollama.chatModel.split(':')[0]));
    return {
      healthy: true,
      models,
      hasRequiredModel,
      requiredModel: aiConfig.ollama.chatModel,
    };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}
