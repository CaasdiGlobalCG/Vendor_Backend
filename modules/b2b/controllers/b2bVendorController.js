/**
 * b2bVendorController.js  (Vendor Backend)
 *
 * Vendor-facing endpoints for the B2B return flow:
 *  - GET  /api/b2b/debit-notes          → see debit notes sent from logistics
 *  - PATCH /api/b2b/debit-notes/:id     → acknowledge a debit note
 *  - POST  /api/b2b/credit-notes        → issue a credit note in response
 *  - GET   /api/b2b/credit-notes        → list all credit notes issued
 */

import { DynamoDBClient, ScanCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

const DEBIT_NOTES_TABLE  = 'b2b_debit_notes';
const CREDIT_NOTES_TABLE = 'b2b_credit_notes';

// ─────────────────────────────────────────────────────────────────────────────
// DEBIT NOTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/b2b/debit-notes
 * Vendor sees debit notes addressed to them.
 */
export const getB2BDebitNotes = async (req, res) => {
  try {
    const vendorId = req.user?.vendorId || req.user?.id;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { Items } = await dbClient.send(new ScanCommand({
      TableName: DEBIT_NOTES_TABLE,
      FilterExpression: 'vendorId = :v',
      ExpressionAttributeValues: { ':v': { S: vendorId } },
    }));

    const notes = (Items || []).map(item => unmarshall(item));
    res.json({ success: true, data: notes });
  } catch (err) {
    console.error('[getB2BDebitNotes]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch debit notes' });
  }
};

/**
 * PATCH /api/b2b/debit-notes/:debitNoteId/acknowledge
 * Vendor acknowledges the debit note.
 */
export const acknowledgeDebitNote = async (req, res) => {
  try {
    const { debitNoteId } = req.params;
    const vendorId = req.user?.vendorId || req.user?.id;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const now = new Date().toISOString();

    await dbClient.send(new UpdateItemCommand({
      TableName: DEBIT_NOTES_TABLE,
      Key: marshall({ debitNoteId, vendorId }),
      UpdateExpression: 'SET #s = :s, acknowledgedAt = :a, updatedAt = :u',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({ ':s': 'vendor_acknowledged', ':a': now, ':u': now }),
    }));

    res.json({ success: true, message: 'Debit note acknowledged' });
  } catch (err) {
    console.error('[acknowledgeDebitNote]', err);
    res.status(500).json({ success: false, message: 'Failed to acknowledge debit note' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT NOTES  (vendor issues these in response to debit notes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/b2b/credit-notes
 * Vendor issues a B2B credit note against a debit note.
 */
export const issueB2BCreditNote = async (req, res) => {
  try {
    const vendorId = req.user?.vendorId || req.user?.id;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const {
      debitNoteId,
      orderId,
      clientId,
      items,
      subtotal,
      taxAmount,
      totalAmount,
      notes,
    } = req.body;

    if (!debitNoteId || !totalAmount) {
      return res.status(400).json({ success: false, message: 'debitNoteId and totalAmount are required' });
    }

    // Sequential BCN- number
    const year = new Date().getFullYear();
    const scanResult = await dbClient.send(new ScanCommand({ TableName: CREDIT_NOTES_TABLE, Select: 'COUNT' }));
    const seq = String((scanResult.Count || 0) + 1).padStart(3, '0');
    const creditNoteId = `BCN-${year}-${seq}-${uuidv4().slice(0, 6)}`;
    const now = new Date().toISOString();

    const item = {
      creditNoteId,
      vendorId,
      clientId: clientId || null,
      orderId: orderId || null,
      debitNoteId,
      creditNoteNumber: creditNoteId,
      issueDate: now.split('T')[0],
      items: items || [],
      subtotal: Number(subtotal) || 0,
      taxAmount: Number(taxAmount) || 0,
      totalAmount: Number(totalAmount) || 0,
      notes: notes || '',
      status: 'sent_to_logistics',
      issuedBy: vendorId,
      issuedAt: now,
      sentToLogisticsAt: now,
      forwardedToClientAt: null,
      updatedAt: now,
    };

    await dbClient.send(new PutItemCommand({
      TableName: CREDIT_NOTES_TABLE,
      Item: marshall(item, { removeUndefinedValues: true }),
    }));

    // Update debit note: mark credit_note_issued, link creditNoteId
    try {
      await dbClient.send(new UpdateItemCommand({
        TableName: DEBIT_NOTES_TABLE,
        Key: marshall({ debitNoteId, vendorId }),
        UpdateExpression: 'SET #s = :s, creditNoteId = :cn, updatedAt = :u',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: marshall({ ':s': 'credit_note_issued', ':cn': creditNoteId, ':u': now }),
      }));
    } catch (e) { console.warn('[issueB2BCreditNote] Could not update debit note:', e.message); }

    res.status(201).json({ success: true, data: item, message: 'Credit note issued and sent to logistics' });
  } catch (err) {
    console.error('[issueB2BCreditNote]', err);
    res.status(500).json({ success: false, message: 'Failed to issue credit note' });
  }
};

/**
 * GET /api/b2b/credit-notes
 * Vendor sees all B2B credit notes they have issued.
 */
export const getB2BCreditNotes = async (req, res) => {
  try {
    const vendorId = req.user?.vendorId || req.user?.id;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { Items } = await dbClient.send(new ScanCommand({
      TableName: CREDIT_NOTES_TABLE,
      FilterExpression: 'vendorId = :v',
      ExpressionAttributeValues: { ':v': { S: vendorId } },
    }));

    const notes = (Items || []).map(item => unmarshall(item));
    res.json({ success: true, data: notes });
  } catch (err) {
    console.error('[getB2BCreditNotes]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch credit notes' });
  }
};
