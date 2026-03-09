// ============================================================
// FILE: modules/ai/services/learningService.js
// PURPOSE: Continuous learning engine for the AI assistant.
//
// This service implements "prompt-based continual learning":
// the model doesn't get retrained, but it builds up a growing
// knowledge base from every interaction that gets injected into
// its system prompt — making it progressively smarter.
//
// Learning signals:
//   1. Corrections  — user says "no, that's wrong" → stores correction
//   2. Preferences  — tracks format/style the user prefers
//   3. Fact memory  — extracts key facts from tool responses to reuse
//   4. Query patterns — frequently asked questions get cached answers
//   5. Thumbs feedback — already handled in agentService feedback loop
// ============================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE = process.env.AI_CONVERSATIONS_TABLE || 'ai_conversations';

// In-memory cache per vendor (rebuilt on server restart)
const learningCache = new Map();

// ── Correction detection patterns ──
const CORRECTION_PATTERNS = [
  /^no[,.]?\s*(that'?s?\s*(not|wrong|incorrect))/i,
  /^(wrong|incorrect|not\s*right|that'?s?\s*not)/i,
  /^actually[,.]?\s*(it'?s?|the)/i,
  /^(you'?re|you\s+are)\s+(wrong|incorrect|mistaken)/i,
  /^(nope|nah)[,.]?\s/i,
  /^correction:/i,
  /^not\s+\d+/i, // "not 5, it's 7"
];

/**
 * Detect if a user message is correcting the AI.
 */
export function isCorrection(userMessage) {
  const trimmed = userMessage.trim();
  return CORRECTION_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Get the learning profile for a vendor (from cache or DynamoDB).
 */
export async function getLearningProfile(vendorId) {
  if (learningCache.has(vendorId)) {
    return learningCache.get(vendorId);
  }

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { conversationId: `learning_${vendorId}` },
      })
    );

    if (result.Item) {
      learningCache.set(vendorId, result.Item);
      return result.Item;
    }
  } catch (err) {
    console.warn('[AI][Learning] Failed to load profile:', err.message);
  }

  // Create a fresh learning profile
  const profile = {
    conversationId: `learning_${vendorId}`, // PK (reuse conversations table)
    vendorId,
    type: 'learning_profile',
    corrections: [],          // { wrong, correct, topic, timestamp }
    factMemory: [],           // { fact, source, timestamp }
    preferredStyle: {
      format: null,           // 'bullets' | 'paragraphs' | 'tables' | null
      verbosity: 'balanced',  // 'concise' | 'balanced' | 'detailed'
      tone: 'friendly',       // 'formal' | 'friendly' | 'casual'
    },
    queryPatterns: {},        // { "normalized_query": { count, lastAnswer, lastAsked } }
    learnedFacts: {},         // { "topic_key": "fact_value" }
    totalInteractions: 0,
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  try {
    await docClient.send(new PutCommand({ TableName: TABLE, Item: profile }));
  } catch (err) {
    console.warn('[AI][Learning] Failed to create profile:', err.message);
  }

  learningCache.set(vendorId, profile);
  return profile;
}

/**
 * Record a correction from the user.
 * When user says "No, that's wrong, it's X not Y", we store that mapping.
 */
export async function recordCorrection(vendorId, wrongAnswer, correction, topic) {
  const entry = {
    wrong: wrongAnswer.slice(0, 200),
    correct: correction.slice(0, 200),
    topic: topic || 'general',
    timestamp: new Date().toISOString(),
  };

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { conversationId: `learning_${vendorId}` },
        UpdateExpression: `
          SET corrections = list_append(if_not_exists(corrections, :empty), :entry),
              metadata.updatedAt = :now
        `,
        ExpressionAttributeValues: {
          ':entry': [entry],
          ':empty': [],
          ':now': new Date().toISOString(),
        },
      })
    );

    // Update cache
    const cached = learningCache.get(vendorId);
    if (cached) {
      cached.corrections = [...(cached.corrections || []), entry];
    }

    console.log(`[AI][Learning] Correction recorded for vendor ${vendorId}: "${topic}"`);
  } catch (err) {
    console.error('[AI][Learning] Failed to record correction:', err.message);
  }
}

/**
 * Record a learned fact extracted from tool results.
 * e.g., "vendor has 7 workspaces", "3 pending invoices"
 */
export async function recordFact(vendorId, key, value) {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { conversationId: `learning_${vendorId}` },
        UpdateExpression: `
          SET learnedFacts.#key = :val,
              metadata.updatedAt = :now
        `,
        ExpressionAttributeNames: { '#key': key },
        ExpressionAttributeValues: {
          ':val': { value, updatedAt: new Date().toISOString() },
          ':now': new Date().toISOString(),
        },
      })
    );

    const cached = learningCache.get(vendorId);
    if (cached) {
      if (!cached.learnedFacts) cached.learnedFacts = {};
      cached.learnedFacts[key] = { value, updatedAt: new Date().toISOString() };
    }
  } catch (err) {
    console.warn('[AI][Learning] Failed to record fact:', err.message);
  }
}

/**
 * Track a query pattern — how often similar questions are asked.
 * Stores the last good answer so it can be reused.
 */
export async function trackQueryPattern(vendorId, normalizedQuery, answer) {
  const key = normalizedQuery.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 80);
  if (!key) return;

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { conversationId: `learning_${vendorId}` },
        UpdateExpression: `
          SET queryPatterns.#key = :pattern,
              totalInteractions = if_not_exists(totalInteractions, :zero) + :one,
              metadata.updatedAt = :now
        `,
        ExpressionAttributeNames: { '#key': key.replace(/\s+/g, '_').slice(0, 50) },
        ExpressionAttributeValues: {
          ':pattern': {
            count: 1, // Will be incremented client-side
            lastAnswer: answer.slice(0, 500),
            lastAsked: new Date().toISOString(),
          },
          ':zero': 0,
          ':one': 1,
          ':now': new Date().toISOString(),
        },
      })
    );

    // Update cache
    const cached = learningCache.get(vendorId);
    if (cached) {
      cached.totalInteractions = (cached.totalInteractions || 0) + 1;
    }
  } catch (err) {
    // Non-critical — don't block
    console.warn('[AI][Learning] trackQueryPattern failed:', err.message);
  }
}

/**
 * Update the user's preferred response style based on feedback signals.
 */
export async function updatePreferredStyle(vendorId, styleDelta) {
  try {
    const updates = [];
    const values = { ':now': new Date().toISOString() };

    if (styleDelta.format) {
      updates.push('preferredStyle.format = :fmt');
      values[':fmt'] = styleDelta.format;
    }
    if (styleDelta.verbosity) {
      updates.push('preferredStyle.verbosity = :verb');
      values[':verb'] = styleDelta.verbosity;
    }
    if (styleDelta.tone) {
      updates.push('preferredStyle.tone = :tone');
      values[':tone'] = styleDelta.tone;
    }

    if (updates.length === 0) return;

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { conversationId: `learning_${vendorId}` },
        UpdateExpression: `SET ${updates.join(', ')}, metadata.updatedAt = :now`,
        ExpressionAttributeValues: values,
      })
    );

    // Update cache
    const cached = learningCache.get(vendorId);
    if (cached && cached.preferredStyle) {
      Object.assign(cached.preferredStyle, styleDelta);
    }
  } catch (err) {
    console.warn('[AI][Learning] updatePreferredStyle failed:', err.message);
  }
}

/**
 * Analyze an AI response + user message to extract learnable facts.
 * Called after every successful agent response.
 */
export function extractFactsFromResponse(userMessage, aiResponse) {
  const facts = [];
  const lower = aiResponse.toLowerCase();

  // Extract workspace counts
  const wsMatch = aiResponse.match(/(\d+)\s+workspace/i);
  if (wsMatch) facts.push({ key: 'workspace_count', value: wsMatch[1] });

  // Extract project counts
  const projMatch = aiResponse.match(/(\d+)\s+project/i);
  if (projMatch) facts.push({ key: 'project_count', value: projMatch[1] });

  // Extract lead counts
  const leadMatch = aiResponse.match(/(\d+)\s+lead/i);
  if (leadMatch) facts.push({ key: 'lead_count', value: leadMatch[1] });

  // Extract invoice counts
  const invMatch = aiResponse.match(/(\d+)\s+invoice/i);
  if (invMatch) facts.push({ key: 'invoice_count', value: invMatch[1] });

  // Extract task counts
  const taskMatch = aiResponse.match(/(\d+)\s+(pending|total|completed|in.progress)\s+task/i);
  if (taskMatch) facts.push({ key: `${taskMatch[2].toLowerCase()}_task_count`, value: taskMatch[1] });

  // Extract quotation counts
  const quoteMatch = aiResponse.match(/(\d+)\s+quotation/i);
  if (quoteMatch) facts.push({ key: 'quotation_count', value: quoteMatch[1] });

  return facts;
}

/**
 * Detect style preferences from the user's message patterns.
 */
export function detectStylePreference(userMessage) {
  const lower = userMessage.toLowerCase();

  // Verbosity signals
  if (/\b(brief|short|quickly|tldr|tl;dr|summarize|summary)\b/.test(lower)) {
    return { verbosity: 'concise' };
  }
  if (/\b(detail|explain|elaborate|in.depth|thorough|everything)\b/.test(lower)) {
    return { verbosity: 'detailed' };
  }

  // Format signals
  if (/\b(list|bullet|points)\b/.test(lower)) {
    return { format: 'bullets' };
  }
  if (/\b(table|tabular|columns)\b/.test(lower)) {
    return { format: 'tables' };
  }

  return null;
}

/**
 * Build the learning context string to inject into the system prompt.
 * This is the core of the "continuous learning" — it grows over time.
 */
export function buildLearningContext(profile) {
  if (!profile) return null;

  const sections = [];

  // 1. Corrections — highest priority, these are explicit user corrections
  const corrections = (profile.corrections || []).slice(-10);
  if (corrections.length > 0) {
    let s = 'USER CORRECTIONS (apply these — the user explicitly corrected you):\n';
    for (const c of corrections) {
      s += `- When you said "${c.wrong}", the correct answer was: "${c.correct}"`;
      if (c.topic !== 'general') s += ` (topic: ${c.topic})`;
      s += '\n';
    }
    sections.push(s);
  }

  // 2. Style preferences
  const style = profile.preferredStyle || {};
  if (style.format || style.verbosity !== 'balanced') {
    let s = 'USER STYLE PREFERENCES:\n';
    if (style.verbosity === 'concise') s += '- User prefers SHORT, concise answers. Be brief.\n';
    if (style.verbosity === 'detailed') s += '- User prefers DETAILED, thorough answers. Explain fully.\n';
    if (style.format === 'bullets') s += '- User prefers bullet-point format.\n';
    if (style.format === 'tables') s += '- User prefers tabular format when listing data.\n';
    sections.push(s);
  }

  // 3. Known facts — so the model can reference them without re-querying
  const facts = profile.learnedFacts || {};
  const factEntries = Object.entries(facts);
  if (factEntries.length > 0) {
    let s = 'KNOWN FACTS ABOUT THIS VENDOR (from previous interactions — may be outdated, verify with tools if asked directly):\n';
    for (const [key, val] of factEntries.slice(-15)) {
      const age = Date.now() - new Date(val.updatedAt).getTime();
      const ageMin = Math.floor(age / 60000);
      if (ageMin < 60) {
        s += `- ${key.replace(/_/g, ' ')}: ${val.value} (${ageMin}m ago — fresh)\n`;
      } else if (ageMin < 1440) {
        s += `- ${key.replace(/_/g, ' ')}: ${val.value} (${Math.floor(ageMin / 60)}h ago)\n`;
      }
      // Skip facts older than 24h — they're stale
    }
    sections.push(s);
  }

  // 4. Interaction count
  const total = profile.totalInteractions || 0;
  if (total > 5) {
    sections.push(`This vendor has had ${total} interactions with you. They are a returning user — be efficient and skip introductions.`);
  }

  if (sections.length === 0) return null;
  return 'CONTINUOUS LEARNING CONTEXT:\n' + sections.join('\n');
}

/**
 * Clear the in-memory learning cache for a vendor.
 */
export function clearLearningCache(vendorId) {
  learningCache.delete(vendorId);
}
