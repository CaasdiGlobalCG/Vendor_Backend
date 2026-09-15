// ============================================================
// FILE: modules/ai/services/canvasBuilderService.js
// PURPOSE: Turn a natural-language description into a validated
//          { nodes, edges } canvas spec via Groq (JSON mode).
// ============================================================

import axios from 'axios';
import getGroqConfig from '../config/groqConfig.js';

// Whitelist of element types the frontend createElementNode() understands.
const ELEMENT_CATALOG = [
  { type: 'text', hint: 'Plain text block (data.content)' },
  { type: 'textbox', hint: 'Single-line input field' },
  { type: 'textarea', hint: 'Multi-line comment/notes area' },
  { type: 'dropdown', hint: 'Select from options (data.selectOptions)' },
  { type: 'form-template', hint: 'Structured form' },
  { type: 'table', hint: 'Data table' },
  { type: 'chart', hint: 'Chart/visualization' },
  { type: 'list', hint: 'Checklist/list' },
  { type: 'smart-note', hint: 'Sticky note (data.note)' },
  { type: 'calendar-event', hint: 'Calendar/deadline event (data.title, data.date)' },
  { type: 'approval-board', hint: 'Approval workflow tracker (data.title)' },
  { type: 'task-card', hint: 'Task card with assignee/status' },
  { type: 'info-card', hint: 'Information card (data.content)' },
  { type: 'form-card', hint: 'Form summary card' },
  { type: 'materials', hint: 'Materials/BOM list' },
  { type: 'boq-generator', hint: 'Bill of quantities generator' },
  { type: 'quotation', hint: 'Quotation document' },
  { type: 'invoice', hint: 'Invoice document' },
  { type: 'purchase-order', hint: 'Purchase order document' },
  { type: 'credit-note', hint: 'Credit note document' },
  { type: 'frame', hint: 'Container frame for grouping' },
  { type: 'rows', hint: 'Row layout container' },
  { type: 'columns', hint: 'Column layout container' },
  { type: 'grid', hint: 'Grid layout container' },
  { type: 'turnkey-workflow', hint: 'End-to-end workflow diagram' },
];

const VALID_TYPES = new Set(ELEMENT_CATALOG.map((e) => e.type));

const MAX_NODES = 12;
const MAX_EDGES = 16;

const buildSystemPrompt = () => `You are an AI canvas architect for a vendor collaboration workspace.

The user describes what they are working on, and you design a small set of canvas elements (nodes) and the connections between them (edges).

VALID ELEMENT TYPES (use only these):
${ELEMENT_CATALOG.map((e) => `- "${e.type}": ${e.hint}`).join('\n')}

RULES:
- Return ONLY valid JSON — no markdown, no explanation.
- Shape: { "nodes": [...], "edges": [...] }
- Each node: { "key": "n1", "type": "<valid type>", "name": "<short human name>", "data": {} }
- "key" is a local identifier used only inside this response (n1, n2, ...).
- "data" may carry type-appropriate fields (e.g. smart-note -> {"note": "..."}, dropdown -> {"selectOptions": [...]}, calendar-event -> {"title": "...", "date": "..."}).
- Each edge: { "source": "n1", "target": "n2", "label": "<optional short label>" }
- At most ${MAX_NODES} nodes and ${MAX_EDGES} edges.
- Design a sensible left-to-right flow when the description implies a sequence.
- Keep names short (<= 60 chars).
- If the description is vague, still produce a reasonable minimal canvas.

Return JSON only.`;

const buildUserPrompt = (prompt, context) => {
  const parts = [`User description:\n${prompt}`];

  const existingNodes = Array.isArray(context?.nodeNames) ? context.nodeNames : [];
  const meta = [];
  if (context?.taskName) meta.push(`task: ${context.taskName}`);
  if (context?.subtaskName) meta.push(`subtask: ${context.subtaskName}`);
  if (meta.length) parts.push(`Canvas location — ${meta.join(', ')}`);
  if (existingNodes.length) {
    parts.push(`Existing canvas elements (do not duplicate): ${existingNodes.slice(0, 30).join(', ')}`);
  }

  parts.push('Return JSON only.');
  return parts.join('\n\n');
};

const parseJsonContent = (content) => {
  const match = String(content || '').match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : content);
};

// Validate + sanitize raw LLM output into a safe spec
const normalizeSpec = (raw) => {
  const warnings = [];
  const safe = raw && typeof raw === 'object' ? raw : {};

  const rawNodes = Array.isArray(safe.nodes) ? safe.nodes : [];
  const seenKeys = new Set();
  const nodes = [];

  for (const n of rawNodes) {
    if (nodes.length >= MAX_NODES) {
      warnings.push(`Node cap reached — dropped ${rawNodes.length - MAX_NODES} extra node(s)`);
      break;
    }
    let type = String(n?.type || '').trim().toLowerCase();
    if (!VALID_TYPES.has(type)) {
      warnings.push(`Unknown element type "${type || '?'}" replaced with "textbox"`);
      type = 'textbox';
    }
    let key = String(n?.key || `n${nodes.length + 1}`).trim();
    if (seenKeys.has(key)) key = `${key}_${nodes.length + 1}`;
    seenKeys.add(key);

    const name = String(n?.name || n?.type || 'Element').slice(0, 80);
    const data = n?.data && typeof n.data === 'object' ? n.data : {};

    nodes.push({ key, type, name, data });
  }

  const rawEdges = Array.isArray(safe.edges) ? safe.edges : [];
  const edges = [];
  for (const e of rawEdges) {
    if (edges.length >= MAX_EDGES) break;
    const source = String(e?.source || '').trim();
    const target = String(e?.target || '').trim();
    if (!seenKeys.has(source) || !seenKeys.has(target)) {
      warnings.push(`Dropped edge "${source} → ${target}" — unknown node key`);
      continue;
    }
    if (source === target) continue;
    edges.push({ source, target, label: String(e?.label || '').slice(0, 60) });
  }

  return { spec: { nodes, edges }, warnings };
};

export async function buildCanvasSpec({ prompt, context = {} }) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    const err = new Error('Prompt is required');
    err.status = 400;
    throw err;
  }

  const { apiKey, apiUrl, canvasModel } = getGroqConfig();
  if (!apiKey) {
    const err = new Error('Groq API key is not configured on the server');
    err.status = 503;
    throw err;
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(cleanPrompt, context) },
  ];

  let lastError = null;
  // One retry — LLMs occasionally emit malformed JSON
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await axios.post(
        apiUrl,
        {
          model: canvasModel,
          messages,
          temperature: 0.2,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const content = response?.data?.choices?.[0]?.message?.content || '';
      const parsed = parseJsonContent(content);
      const { spec, warnings } = normalizeSpec(parsed);

      if (spec.nodes.length === 0) {
        throw new Error('Model returned no usable nodes');
      }

      return { spec, warnings, usedFallback: false };
    } catch (error) {
      lastError = error;
      // Do not retry provider/auth errors — only malformed output
      if (error?.response) break;
    }
  }

  const providerMessage =
    lastError?.response?.data?.error?.message ||
    lastError?.response?.data?.message ||
    lastError?.message ||
    'AI provider unavailable';
  const status = lastError?.response?.status;
  const err = new Error(
    status === 429
      ? 'AI is rate-limited right now — please try again in a moment'
      : `Could not generate canvas: ${providerMessage}`
  );
  err.status = status === 429 ? 429 : 502;
  throw err;
}
