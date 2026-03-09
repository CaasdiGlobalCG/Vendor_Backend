// ============================================================
// FILE: modules/ai/tools/memorySearchTool.js
// PURPOSE: LangChain tool for searching across conversation
//          history to answer "What did we discuss about X?"
//          queries — AI Memory Highlights.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import aiConfig from '../config/aiConfig.js';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE = aiConfig.memory.tableName;

/**
 * Search across all conversations for a vendor, matching messages
 * that contain the query keywords. Returns ranked snippets with
 * conversation titles and timestamps.
 */
async function searchConversations(vendorId, query, options = {}) {
  const { daysBack = 90, maxConversations = 30, maxSnippets = 10 } = options;

  // 1. Fetch recent conversations for this vendor
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'vendorId-index',
      KeyConditionExpression: 'vendorId = :vid',
      ExpressionAttributeValues: { ':vid': vendorId },
      ScanIndexForward: false, // newest first
      Limit: maxConversations,
    })
  );

  const conversations = result.Items || [];
  console.log(`[AI][MemorySearch] Loaded ${conversations.length} conversations for vendor="${vendorId}"`);

  // 2. Extract keywords from the query (lowercase, deduped, exclude stop words)
  const STOP_WORDS = new Set([
    'what', 'did', 'we', 'i', 'you', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
    'about', 'discuss', 'discussed', 'talk', 'talked', 'say', 'said', 'mention',
    'mentioned', 'tell', 'told', 'know', 'last', 'this', 'that', 'how', 'when',
    'where', 'which', 'who', 'do', 'does', 'can', 'could', 'will', 'would',
    'should', 'have', 'has', 'had', 'been', 'being', 'from', 'with', 'for',
    'and', 'or', 'but', 'not', 'in', 'on', 'at', 'to', 'of', 'by', 'it',
    'me', 'my', 'our', 'they', 'them', 'their', 'its', 'any', 'all', 'some',
    'week', 'month', 'day', 'ago', 'recently', 'before', 'after', 'during',
    'show', 'find', 'search', 'get', 'give', 'remember', 'recall',
  ]);

  const keywords = query
    .toLowerCase()
    .replace(/[?!.,;:'"()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (keywords.length === 0) {
    // Fall back to the original query as a single phrase
    keywords.push(query.toLowerCase().trim());
  }

  console.log(`[AI][MemorySearch] Keywords: [${keywords.join(', ')}]`);

  // 3. Calculate date cutoff
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffISO = cutoffDate.toISOString();

  // 4. Score and collect matching snippets
  const snippets = [];

  for (const convo of conversations) {
    const messages = convo.messages || [];
    const convoTitle = convo.title || 'Untitled';
    const convoId = convo.conversationId;

    for (const msg of messages) {
      // Skip old messages
      if (msg.timestamp && msg.timestamp < cutoffISO) continue;
      // Skip empty/short messages
      if (!msg.content || msg.content.length < 10) continue;

      const contentLower = msg.content.toLowerCase();

      // Score: count how many keywords appear in this message
      let score = 0;
      const matchedKeywords = [];
      for (const kw of keywords) {
        if (contentLower.includes(kw)) {
          score += 1;
          // Boost for exact phrase match
          if (contentLower.includes(query.toLowerCase())) {
            score += 2;
          }
          matchedKeywords.push(kw);
        }
      }

      if (score === 0) continue;

      // Boost recent messages
      if (msg.timestamp) {
        const msgAge = Date.now() - new Date(msg.timestamp).getTime();
        const daysOld = msgAge / (1000 * 60 * 60 * 24);
        if (daysOld < 1) score += 3;
        else if (daysOld < 7) score += 2;
        else if (daysOld < 30) score += 1;
      }

      // Boost assistant messages (more likely to have useful info)
      if (msg.role === 'assistant') score += 1;

      // Extract a relevant snippet (up to 300 chars around the first keyword match)
      let snippet = msg.content;
      if (snippet.length > 300) {
        const firstIdx = contentLower.indexOf(matchedKeywords[0] || '');
        const start = Math.max(0, firstIdx - 100);
        const end = Math.min(snippet.length, start + 300);
        snippet = (start > 0 ? '...' : '') + snippet.slice(start, end) + (end < msg.content.length ? '...' : '');
      }

      snippets.push({
        conversationId: convoId,
        conversationTitle: convoTitle,
        role: msg.role,
        snippet,
        timestamp: msg.timestamp,
        score,
        matchedKeywords,
      });
    }

    // Also search in conversation summary
    if (convo.summary) {
      const summaryLower = convo.summary.toLowerCase();
      let summaryScore = 0;
      const matchedKw = [];
      for (const kw of keywords) {
        if (summaryLower.includes(kw)) {
          summaryScore += 1;
          matchedKw.push(kw);
        }
      }
      if (summaryScore > 0) {
        let snippet = convo.summary;
        if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...';
        snippets.push({
          conversationId: convoId,
          conversationTitle: convoTitle,
          role: 'summary',
          snippet,
          timestamp: convo.metadata?.updatedAt,
          score: summaryScore,
          matchedKeywords: matchedKw,
        });
      }
    }
  }

  // 5. Sort by score descending, then by recency
  snippets.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });

  return snippets.slice(0, maxSnippets);
}


export function createMemorySearchTools(vendorId) {
  const searchConversationHistory = new DynamicStructuredTool({
    name: 'searchConversationHistory',
    description: `Search across the vendor's past AI conversation history for specific topics, entities, or discussions.
Use this when the user asks:
- "What did we discuss about [topic]?"
- "What was said about Project Alpha last week?"
- "Remember when we talked about invoices for Acme Corp?"
- "Find our conversation about the billing issue"
- "What did you tell me about my pending tasks?"
This tool searches through all past conversation messages and summaries, returning the most relevant snippets ranked by relevance and recency.`,
    schema: z.object({
      query: z.string().describe('The search query — the topic, entity name, or keywords to search for in past conversations'),
      daysBack: z.number().optional().describe('How many days back to search (default: 90, max: 365)'),
      maxResults: z.number().optional().describe('Maximum snippets to return (default: 10, max: 20)'),
    }),
    func: async ({ query, daysBack, maxResults }) => {
      try {
        console.log(`[AI][MemorySearch] Searching conversations for vendor="${vendorId}", query="${query}", daysBack=${daysBack || 90}`);

        const snippets = await searchConversations(vendorId, query, {
          daysBack: Math.min(daysBack || 90, 365),
          maxSnippets: Math.min(maxResults || 10, 20),
        });

        if (snippets.length === 0) {
          return JSON.stringify({
            found: false,
            message: `No past conversations found matching "${query}". This could mean the topic hasn't been discussed yet, or it was discussed more than ${daysBack || 90} days ago.`,
          });
        }

        // Group by conversation for a cleaner output
        const grouped = {};
        for (const s of snippets) {
          if (!grouped[s.conversationId]) {
            grouped[s.conversationId] = {
              conversationTitle: s.conversationTitle,
              snippets: [],
            };
          }
          grouped[s.conversationId].snippets.push({
            role: s.role,
            text: s.snippet,
            when: s.timestamp,
            relevance: s.score,
            matchedKeywords: s.matchedKeywords,
          });
        }

        const conversations = Object.entries(grouped).map(([convoId, data]) => ({
          conversationId: convoId,
          title: data.conversationTitle,
          matches: data.snippets,
        }));

        return JSON.stringify({
          found: true,
          totalSnippets: snippets.length,
          searchQuery: query,
          conversations,
        });
      } catch (err) {
        console.error(`[AI][MemorySearch] Error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  return [searchConversationHistory];
}
