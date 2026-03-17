/**
 * Vendor Portal Support Controller
 *
 * Writes to the shared Employee CS DynamoDB tables:
 *   cs_tickets          — one item per ticket
 *   cs_ticket_messages  — messages keyed by ticketId (sort: messageId)
 *
 * Identity: uses req.vendorId (set by attachVendorId middleware) as the
 * primary raisedById so the CS team can correlate tickets to vendors.
 * Falls back to req.auth.sub / req.auth.email if vendorId not resolved.
 *
 * Routes (all guarded by authenticateCognitoJwt + attachVendorId):
 *   POST   /api/support/                           raise a new ticket
 *   GET    /api/support/                           list caller's own tickets
 *   GET    /api/support/:ticketId                  get one ticket + messages
 *   POST   /api/support/:ticketId/messages         add a user reply
 *   PUT    /api/support/:ticketId/rate             submit CSAT rating
 *   PUT    /api/support/:ticketId/reopen           reopen resolved/closed ticket
 */

import { dynamoDB, s3, S3_BUCKET_NAME } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

const TICKETS_TABLE  = 'cs_tickets';
const MESSAGES_TABLE = 'cs_ticket_messages';

// ─── Team routing ─────────────────────────────────────────────────────────────
// Vendor portal defaults to team-a (Vendor Support). Modules that cross portals
// still route to their respective teams so the right CS squad sees them.
const SOURCE_TEAM_MAP = {
  vendor:    'team-a', project:   'team-a', workspace: 'team-a',
  rfq:       'team-a', quotation: 'team-a', warranty:  'team-a',
  client:    'team-b',
  b2b:       'team-c', b2b_order: 'team-c', payment:   'team-c', cart: 'team-c',
  tender:    'team-d', bid:       'team-d',
  invoice:   'team-e', finance:   'team-e',
  auth:      'team-f', tech:      'team-f', system_error: 'team-f', upload_fail: 'team-f',
};
const TEAM_LABELS = {
  'team-a': 'Vendor Support',
  'team-b': 'Client Support',
  'team-c': 'B2B Commerce Support',
  'team-d': 'Tender Support',
  'team-e': 'Finance & Billing Support',
  'team-f': 'Tech Ops & Escalations',
};
const SLA_MINUTES = {
  urgent: { firstResponse: 60,   resolution: 240  },
  high:   { firstResponse: 240,  resolution: 720  },
  medium: { firstResponse: 480,  resolution: 2880 },
  low:    { firstResponse: 1440, resolution: 7200 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateTicketId() {
  const year = new Date().getFullYear();
  const rand = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `CS-${year}-${rand}`;
}

function resolveTeam(sourceModule) {
  if (!sourceModule) return 'team-a';
  const key = sourceModule.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return SOURCE_TEAM_MAP[key] || 'team-a';
}

function slaDeadlines(priority, fromDate = new Date()) {
  const mins = SLA_MINUTES[priority?.toLowerCase()] || SLA_MINUTES.medium;
  return {
    firstResponseDeadline: new Date(fromDate.getTime() + mins.firstResponse * 60000).toISOString(),
    resolutionDeadline:    new Date(fromDate.getTime() + mins.resolution    * 60000).toISOString(),
  };
}

/**
 * Resolve the caller's stable identity from the request.
 * Priority: req.vendorId (from attachVendorId) → req.auth.sub → req.auth.email
 */
function resolveUser(req) {
  const vendorId = req.vendorId || req.auth?.sub || req.auth?.email || 'unknown';
  const email    = req.auth?.email || '';
  const name     = req.auth?.name  || '';
  return { userId: vendorId, email, name };
}

/**
 * Upload a single multer file to S3; returns attachment metadata or null.
 */
async function uploadToS3(file, ticketId) {
  const bucket = process.env.S3_BUCKET_NAME || S3_BUCKET_NAME;
  if (!bucket) return null;
  const ext   = (file.originalname.split('.').pop() || 'bin').toLowerCase();
  const s3Key = `support_attachments/${ticketId}/${uuidv4()}.${ext}`;
  await s3.putObject({
    Bucket:      bucket,
    Key:         s3Key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }).promise();
  const region = process.env.AWS_REGION || 'us-east-1';
  return {
    name: file.originalname,
    url:  `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`,
    type: file.mimetype,
    size: file.size,
  };
}

// ─── POST / — create ticket ───────────────────────────────────────────────────
export const createTicket = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const {
      subject,
      description,
      priority       = 'medium',
      sourceModule,
      category,           // alias — frontend may send either field name
      sourceRecordId,
      raisedByName:  bodyName,
      raisedByEmail: bodyEmail,
    } = req.body;

    if (!subject?.trim() || !description?.trim()) {
      return res.status(400).json({ success: false, message: 'subject and description are required.' });
    }

    const now      = new Date();
    const ticketId = generateTicketId();
    const teamId   = resolveTeam(sourceModule || category || 'vendor');
    const sla      = slaDeadlines(priority, now);

    // Upload any attachments
    const files = req.files || [];
    const attachments = [];
    for (const file of files) {
      try {
        const att = await uploadToS3(file, ticketId);
        if (att) attachments.push(att);
      } catch (e) {
        console.warn('[Vendor-Support] createTicket S3 upload skipped:', e.message);
      }
    }

    const ticket = {
      ticketId,
      subject:        subject.trim(),
      description:    description.trim(),
      priority:       (priority || 'medium').toLowerCase(),
      status:         'open',
      portalType:     'vendor',
      sourceModule:   sourceModule   || category || 'vendor',
      sourceRecordId: sourceRecordId || null,
      teamId,
      teamLabel:      TEAM_LABELS[teamId] || teamId,
      raisedById:     caller.userId,
      raisedByEmail:  bodyEmail || caller.email,
      raisedByName:   bodyName  || caller.name,
      attachments,
      satisfactionRating: null,
      escalatedTo:    null,
      escalationNote: null,
      createdAt:      now.toISOString(),
      updatedAt:      now.toISOString(),
      firstResponseDeadline: sla.firstResponseDeadline,
      resolutionDeadline:    sla.resolutionDeadline,
      firstRespondedAt: null,
      resolvedAt:       null,
      closedAt:         null,
      history: [
        {
          action: 'created',
          by:     caller.userId,
          at:     now.toISOString(),
          detail: `Ticket raised via Vendor portal. Routed to ${TEAM_LABELS[teamId]}.`,
        },
      ],
    };

    await dynamoDB.put({ TableName: TICKETS_TABLE, Item: ticket }).promise();

    return res.status(201).json({ success: true, ticket });
  } catch (err) {
    console.error('[Vendor-Support] createTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create support ticket.' });
  }
};

// ─── GET / — list my tickets ──────────────────────────────────────────────────
export const listMyTickets = async (req, res) => {
  try {
    const caller = resolveUser(req);

    const result = await dynamoDB.scan({
      TableName: TICKETS_TABLE,
      FilterExpression: 'raisedById = :uid OR raisedByEmail = :email',
      ExpressionAttributeValues: {
        ':uid':   caller.userId,
        ':email': caller.email,
      },
    }).promise();

    const tickets = (result.Items || []).sort(
      (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')
    );

    return res.json({ success: true, tickets });
  } catch (err) {
    console.error('[Vendor-Support] listMyTickets error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load tickets.' });
  }
};

// ─── GET /:ticketId — get single ticket + messages ────────────────────────────
export const getTicket = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const { ticketId } = req.params;

    const result = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!result.Item) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }
    const ticket = result.Item;

    if (ticket.raisedById !== caller.userId && ticket.raisedByEmail !== caller.email) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const msgResult = await dynamoDB.query({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: 'ticketId = :t',
      ExpressionAttributeValues: { ':t': ticketId },
      ScanIndexForward: true,
    }).promise();

    const messages = (msgResult.Items || []).filter(m => !m.isInternal);

    return res.json({ success: true, ticket, messages });
  } catch (err) {
    console.error('[Vendor-Support] getTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load ticket.' });
  }
};

// ─── POST /:ticketId/messages — add reply ─────────────────────────────────────
export const addMessage = async (req, res) => {
  try {
    const caller   = resolveUser(req);
    const { ticketId } = req.params;
    const content  = (req.body.content || req.body.body || '').trim();
    const files    = req.files || [];

    if (!content && files.length === 0) {
      return res.status(400).json({ success: false, message: 'Message content or an attachment is required.' });
    }

    const ticketResult = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!ticketResult.Item) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }
    const ticket = ticketResult.Item;

    if (ticket.raisedById !== caller.userId && ticket.raisedByEmail !== caller.email) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ success: false, message: 'Cannot reply to a closed ticket.' });
    }

    const attachments = [];
    for (const file of files) {
      try {
        const att = await uploadToS3(file, ticketId);
        if (att) attachments.push(att);
      } catch (e) {
        console.warn('[Vendor-Support] S3 upload skipped:', e.message);
      }
    }

    const now       = new Date();
    const messageId = uuidv4();
    const message   = {
      ticketId,
      messageId,
      content,
      body:        content,
      senderType:  'vendor_user',
      senderName:  caller.name || caller.email,
      senderId:    caller.userId,
      authorId:    caller.userId,
      authorName:  caller.name || caller.email,
      isInternal:  false,
      attachments,
      createdAt:   now.toISOString(),
    };

    await dynamoDB.put({ TableName: MESSAGES_TABLE, Item: message }).promise();

    await dynamoDB.update({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET updatedAt = :u, #hist = list_append(if_not_exists(#hist, :empty), :h)',
      ExpressionAttributeNames: { '#hist': 'history' },
      ExpressionAttributeValues: {
        ':u':     now.toISOString(),
        ':h':     [{ action: 'replied', by: caller.userId, at: now.toISOString(), detail: 'Vendor replied.' }],
        ':empty': [],
      },
    }).promise();

    return res.status(201).json({ success: true, message });
  } catch (err) {
    console.error('[Vendor-Support] addMessage error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
};

// ─── PUT /:ticketId/reopen ────────────────────────────────────────────────────
export const reopenTicket = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const { ticketId } = req.params;

    const result = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!result.Item) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const ticket = result.Item;

    if (ticket.raisedById !== caller.userId && ticket.raisedByEmail !== caller.email) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({ success: false, message: 'Only resolved or closed tickets can be reopened.' });
    }

    const now = new Date();
    await dynamoDB.update({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET #s = :open, updatedAt = :u, #hist = list_append(if_not_exists(#hist, :empty), :h)',
      ExpressionAttributeNames: { '#s': 'status', '#hist': 'history' },
      ExpressionAttributeValues: {
        ':open':  'open',
        ':u':     now.toISOString(),
        ':h':     [{ action: 'reopened', by: caller.userId, at: now.toISOString(), detail: 'Vendor reopened the ticket.' }],
        ':empty': [],
      },
    }).promise();

    return res.json({ success: true });
  } catch (err) {
    console.error('[Vendor-Support] reopenTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reopen ticket.' });
  }
};

// ─── PUT /:ticketId/rate — CSAT ───────────────────────────────────────────────
export const rateTicket = async (req, res) => {
  try {
    const caller = resolveUser(req);
    const { ticketId } = req.params;
    const { rating }   = req.body;

    const ratingNum = Number(rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: 'rating must be 1–5.' });
    }

    const ticketResult = await dynamoDB.get({ TableName: TICKETS_TABLE, Key: { ticketId } }).promise();
    if (!ticketResult.Item) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }
    const ticket = ticketResult.Item;

    if (ticket.raisedById !== caller.userId && ticket.raisedByEmail !== caller.email) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({ success: false, message: 'Can only rate resolved or closed tickets.' });
    }

    const now = new Date();
    await dynamoDB.update({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET satisfactionRating = :r, csatRating = :r, updatedAt = :u',
      ExpressionAttributeValues: { ':r': ratingNum, ':u': now.toISOString() },
    }).promise();

    return res.json({ success: true, satisfactionRating: ratingNum, csatRating: ratingNum });
  } catch (err) {
    console.error('[Vendor-Support] rateTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save rating.' });
  }
};
