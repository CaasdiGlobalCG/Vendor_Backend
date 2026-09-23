import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand
} from '@aws-sdk/client-dynamodb';
import { TextractClient, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import axios from 'axios';
import { extractPoDataFromBytes } from './poLocalExtract.js';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const textractClient = new TextractClient({ region: process.env.AWS_REGION || 'ap-south-1' });

const WORKSPACE_QUOTATIONS_TABLE = 'workspace_quotations';
const WORKSPACE_PURCHASE_ORDERS_TABLE = 'workspace_purchase_orders';

// Keep the check state on PO rows in sync with the quotation so the PM UI
// (which reads poAutoCheck off the PO row) never shows a stale result.
const syncPoAutoCheckToPurchaseOrders = async (quotationId, poAutoCheck) => {
  try {
    const scan = await dbClient.send(
      new ScanCommand({
        TableName: WORKSPACE_PURCHASE_ORDERS_TABLE,
        FilterExpression: 'quotationId = :qid OR referenceQuoteNumber = :qid',
        ExpressionAttributeValues: marshall({ ':qid': quotationId })
      })
    );
    for (const item of scan.Items || []) {
      const po = unmarshall(item);
      await dbClient.send(
        new PutItemCommand({
          TableName: WORKSPACE_PURCHASE_ORDERS_TABLE,
          Item: marshall({ ...po, poAutoCheck, updatedAt: new Date().toISOString() }, { removeUndefinedValues: true })
        })
      );
    }
  } catch (err) {
    console.warn('⚠️ Failed to sync poAutoCheck to purchase orders:', err.message);
  }
};

const AMOUNT_TOLERANCE_RATIO = 0.01; // ±1% for money fields
const QTY_TOLERANCE = 0.001;

const normText = (v) =>
  (v ?? '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseNumber = (v) => {
  if (v === null || v === undefined) return null;
  const cleaned = v
    .toString()
    .replace(/[₹$,%\s]/g, '')
    .replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
};

const approxEqual = (a, b, toleranceRatio = AMOUNT_TOLERANCE_RATIO) => {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return a === b;
  }
  const diff = Math.abs(a - b);
  return diff <= Math.max(1, Math.abs(b) * toleranceRatio);
};

const nameSimilarity = (a, b) => {
  const na = normText(a);
  const nb = normText(b);
  if (!na || !nb) return 0;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
};

// ---------- S3 helpers ----------

const parseS3Url = (url) => {
  try {
    const u = new URL(url);
    // https://bucket.s3.region.amazonaws.com/key
    const hostMatch = u.hostname.match(/^(.+)\.s3[.-][a-z0-9-]+\.amazonaws\.com$/);
    if (hostMatch) {
      return { bucket: hostMatch[1], key: decodeURIComponent(u.pathname.slice(1)) };
    }
    // https://s3.region.amazonaws.com/bucket/key
    const pathMatch = u.pathname.match(/^\/([^/]+)\/(.+)$/);
    if (u.hostname.startsWith('s3') && pathMatch) {
      return { bucket: pathMatch[1], key: decodeURIComponent(pathMatch[2]) };
    }
    return null;
  } catch {
    return null;
  }
};

// ---------- Textract helpers ----------

const analyzePoDocument = async (poUrl) => {
  const s3 = parseS3Url(poUrl);

  const buildParams = (document) => ({
    Document: document,
    FeatureTypes: ['TABLES']
  });

  if (s3) {
    try {
      return await textractClient.send(
        new AnalyzeDocumentCommand(buildParams({ S3Object: { Bucket: s3.bucket, Name: s3.key } }))
      );
    } catch (err) {
      console.warn('⚠️ Textract S3Object analysis failed, falling back to bytes:', err.message);
    }
  }

  const fileResp = await axios.get(poUrl, { responseType: 'arraybuffer' });
  const bytes = Buffer.from(fileResp.data);
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error('PO file exceeds Textract 5MB synchronous limit');
  }
  return textractClient.send(
    new AnalyzeDocumentCommand(buildParams({ Bytes: bytes }))
  );
};

const extractCellText = (cell, blockMap) => {
  const parts = [];
  for (const rel of cell.Relationships || []) {
    if (rel.Type !== 'CHILD') continue;
    for (const id of rel.Ids || []) {
      const b = blockMap[id];
      if (b && (b.BlockType === 'WORD' || b.BlockType === 'LINE')) {
        parts.push(b.Text);
      }
    }
  }
  return parts.join(' ').trim();
};

// Reconstruct table rows from Textract blocks
const extractTables = (blocks) => {
  const blockMap = {};
  for (const b of blocks || []) blockMap[b.Id] = b;

  const tables = [];
  for (const b of blocks || []) {
    if (b.BlockType !== 'TABLE') continue;
    const cells = [];
    for (const rel of b.Relationships || []) {
      if (rel.Type !== 'CHILD') continue;
      for (const id of rel.Ids || []) {
        const cell = blockMap[id];
        if (cell && cell.BlockType === 'CELL') cells.push(cell);
      }
    }
    const maxRow = Math.max(0, ...cells.map((c) => c.RowIndex || 0));
    const rows = Array.from({ length: maxRow }, () => []);
    for (const c of cells) {
      const r = (c.RowIndex || 1) - 1;
      const col = (c.ColumnIndex || 1) - 1;
      if (!rows[r]) rows[r] = [];
      rows[r][col] = extractCellText(c, blockMap);
    }
    tables.push(rows.map((r) => r.map((x) => x || '')));
  }
  return tables;
};

const guessColumnMap = (headerRow) => {
  const map = { name: null, code: null, qty: null, rate: null, amount: null, gst: null };
  headerRow.forEach((cell, i) => {
    const c = normText(cell);
    if (!c) return;
    if (map.code === null && /(item\s*code|code|sku|part\s*no|model|hsn|sac)/.test(c) && !/(name|description)/.test(c)) map.code = i;
    else if (map.name === null && /(item|description|product|particular|service|name)/.test(c)) map.name = i;
    else if (map.qty === null && /(qty|quantity|units?)/.test(c)) map.qty = i;
    else if (map.rate === null && /(rate|price|unit)/.test(c) && !/total|amount/.test(c)) map.rate = i;
    else if (map.amount === null && /(amount|total|value|line total)/.test(c)) map.amount = i;
    else if (map.gst === null && /(gst|tax|vat)/.test(c)) map.gst = i;
  });
  return map;
};

const extractPoItems = (tables) => {
  for (const rows of tables) {
    if (!rows.length) continue;
    const colMap = guessColumnMap(rows[0]);
    if (colMap.name === null && colMap.code === null) continue;
    const items = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const code = colMap.code !== null ? (row[colMap.code] || '').trim() : null;
      const name = colMap.name !== null ? row[colMap.name] : code;
      if (!name || !normText(name)) continue;
      items.push({
        name,
        code,
        qty: colMap.qty !== null ? parseNumber(row[colMap.qty]) : null,
        rate: colMap.rate !== null ? parseNumber(row[colMap.rate]) : null,
        amount: colMap.amount !== null ? parseNumber(row[colMap.amount]) : null,
        gst: colMap.gst !== null ? parseNumber(row[colMap.gst]) : null
      });
    }
    if (items.length) return items;
  }
  return [];
};

const extractGrandTotal = (blocks) => {
  const candidates = [];
  for (const b of blocks || []) {
    if (b.BlockType !== 'LINE') continue;
    const t = normText(b.Text || '');
    if (!/(grand\s*total|total\s*amount|total\s*payable|net\s*total|^total\b|total\s*incl)/.test(t)) continue;
    const nums = (b.Text || '').match(/[\d,]+(?:\.\d+)?/g) || [];
    for (const n of nums) {
      const v = parseNumber(n);
      if (v !== null && v > 0) candidates.push(v);
    }
  }
  return candidates.length ? Math.max(...candidates) : null;
};

// ---------- Expected values from the quotation sent to the client ----------

const buildExpected = (quotation) => {
  // The client saw the commissioned quotation — prefer commissionData line items
  const commissionItems = Array.isArray(quotation.commissionData?.items)
    ? quotation.commissionData.items
    : null;

  const expectedItems = (quotation.items || []).map((item, idx) => {
    const baseRate = parseNumber(item.rate) ?? 0;
    const qty = parseNumber(item.quantity) ?? 1;
    const commissionLine = commissionItems?.find(
      (c) =>
        c.index === idx ||
        normText(c.name || c.description) === normText(item.description || item.name)
    );
    const pct = parseNumber(commissionLine?.commissionPercent ?? commissionLine?.percentage) ?? 0;
    const clientRate = baseRate * (1 + pct / 100);
    const gstPct =
      parseNumber(item.gst) ??
      (parseNumber(item.cgst || 0) + parseNumber(item.sgst || 0) + parseNumber(item.igst || 0)) ??
      0;
    return {
      name: item.description || item.name || `Item ${idx + 1}`,
      code: item.itemCode || item.sku || item.code || item.hsn || item.partNumber || null,
      qty,
      rate: clientRate,
      amount: clientRate * qty,
      gst: gstPct
    };
  });

  const expectedTotal =
    parseNumber(quotation.commissionData?.newTotal) ??
    parseNumber(quotation.total) ??
    parseNumber(quotation.totalAmount) ??
    expectedItems.reduce((s, i) => s + i.amount * (1 + (i.gst || 0) / 100), 0);

  return { expectedItems, expectedTotal };
};

// ---------- Comparison ----------

const runChecks = (quotation, poItems, poGrandTotal) => {
  const { expectedItems, expectedTotal } = buildExpected(quotation);
  const checks = [];
  const discrepancies = [];

  if (!poItems.length) {
    discrepancies.push('No line items could be extracted from the client PO');
    return {
      passed: false,
      checks: [
        {
          check: 'items_extracted',
          status: 'fail',
          detail: 'No item table detected in the uploaded PO'
        }
      ],
      discrepancies
    };
  }

  for (const expected of expectedItems) {
    let best = null;
    let bestScore = 0;
    for (const poItem of poItems) {
      const score = nameSimilarity(expected.name, poItem.name);
      if (score > bestScore) {
        bestScore = score;
        best = poItem;
      }
    }

    const itemLabel = expected.name;
    if (!best || bestScore < 0.5) {
      checks.push({ check: 'item_present', item: itemLabel, status: 'fail', detail: 'Item not found in client PO' });
      discrepancies.push(`Missing item in PO: "${itemLabel}"`);
      continue;
    }
    checks.push({ check: 'item_present', item: itemLabel, status: 'pass', detail: `Matched PO line "${best.name}"` });

    if (expected.code && best.code) {
      const ok = normText(best.code) === normText(expected.code);
      checks.push({
        check: 'item_code',
        item: itemLabel,
        status: ok ? 'pass' : 'fail',
        expected: expected.code,
        found: best.code
      });
      if (!ok) discrepancies.push(`"${itemLabel}": item code "${best.code}" ≠ quotation "${expected.code}"`);
    }

    if (best.qty !== null) {
      const ok = Math.abs(best.qty - expected.qty) <= QTY_TOLERANCE;
      checks.push({
        check: 'quantity',
        item: itemLabel,
        status: ok ? 'pass' : 'fail',
        expected: expected.qty,
        found: best.qty
      });
      if (!ok) discrepancies.push(`"${itemLabel}": quantity ${best.qty} ≠ quotation ${expected.qty}`);
    }

    if (best.rate !== null) {
      const ok = approxEqual(best.rate, expected.rate);
      checks.push({
        check: 'rate',
        item: itemLabel,
        status: ok ? 'pass' : 'fail',
        expected: expected.rate,
        found: best.rate
      });
      if (!ok) discrepancies.push(`"${itemLabel}": rate ₹${best.rate} ≠ quotation ₹${expected.rate.toFixed(2)}`);
    }

    if (best.amount !== null) {
      const ok = approxEqual(best.amount, expected.amount);
      checks.push({
        check: 'amount',
        item: itemLabel,
        status: ok ? 'pass' : 'fail',
        expected: expected.amount,
        found: best.amount
      });
      if (!ok) discrepancies.push(`"${itemLabel}": amount ₹${best.amount} ≠ quotation ₹${expected.amount.toFixed(2)}`);
    }

    if (best.gst !== null) {
      const ok = Math.abs(best.gst - expected.gst) <= 0.5;
      checks.push({
        check: 'gst',
        item: itemLabel,
        status: ok ? 'pass' : 'fail',
        expected: expected.gst,
        found: best.gst
      });
      if (!ok) discrepancies.push(`"${itemLabel}": GST ${best.gst}% ≠ quotation ${expected.gst}%`);
    }
  }

  if (poGrandTotal !== null) {
    const ok = approxEqual(poGrandTotal, expectedTotal);
    checks.push({
      check: 'grand_total',
      item: 'PO total',
      status: ok ? 'pass' : 'fail',
      expected: expectedTotal,
      found: poGrandTotal
    });
    if (!ok) discrepancies.push(`PO grand total ₹${poGrandTotal} ≠ quotation total ₹${expectedTotal.toFixed(2)}`);
  } else {
    checks.push({
      check: 'grand_total',
      item: 'PO total',
      status: 'warn',
      detail: 'No grand total detected in the PO'
    });
  }

  const passed = checks.every((c) => c.status !== 'fail');
  return { passed, checks, discrepancies };
};

/**
 * Auto-check a client-uploaded PO against the quotation that was sent to them.
 * Extracts the PO via Textract and compares item names, quantities, rates,
 * GST and the grand total. Result is persisted on the quotation as
 * `poAutoCheck` — PM may only send the PO to the vendor once it passes.
 *
 * @route POST /api/workspace/quotations/:quotationId/auto-check-po
 * @access Private (PM only)
 */
const autoCheckClientPO = async (req, res) => {
  try {
    const { quotationId } = req.params;
    if (!quotationId) {
      return res.status(400).json({ success: false, message: 'quotationId is required' });
    }

    const scanResult = await dbClient.send(
      new ScanCommand({
        TableName: WORKSPACE_QUOTATIONS_TABLE,
        FilterExpression: 'quotationId = :qid OR customQuoteId = :qid OR id = :qid',
        ExpressionAttributeValues: marshall({ ':qid': quotationId })
      })
    );

    if (!scanResult.Items || scanResult.Items.length === 0) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    const quotation = unmarshall(scanResult.Items[0]);

    if (quotation.poType === 'system' && !quotation.clientPOFile && !quotation.pendingPOFile) {
      return res.json({
        success: true,
        data: {
          quotationId,
          passed: true,
          skipped: true,
          checks: [],
          discrepancies: [],
          message: 'System-generated PO — no client file to verify'
        }
      });
    }

    // pendingPOFile = uploaded but held (check failed, reason not yet approved)
    const poFileUrl = quotation.clientPOFile || quotation.pendingPOFile;
    if (!poFileUrl) {
      return res.status(400).json({
        success: false,
        message: 'No client PO file uploaded for this quotation'
      });
    }

    let poItems = [];
    let poGrandTotal = null;
    let extractionMethod = 'textract';

    try {
      const analysis = await analyzePoDocument(poFileUrl);
      const tables = extractTables(analysis.Blocks);
      poItems = extractPoItems(tables);
      poGrandTotal = extractGrandTotal(analysis.Blocks);
    } catch (err) {
      // Textract needs a paid AWS subscription — fall back to local
      // extraction (pdf-parse → OCR for scanned PDFs) so the check still runs.
      console.warn('⚠️ Textract unavailable, using local extraction:', err.message);
      try {
        const fileResp = await axios.get(poFileUrl, { responseType: 'arraybuffer' });
        const local = await extractPoDataFromBytes(Buffer.from(fileResp.data));
        poItems = local.poItems;
        poGrandTotal = local.poGrandTotal;
        extractionMethod = 'local';
      } catch (localErr) {
        console.error('❌ Local extraction also failed:', localErr);
        return res.status(502).json({
          success: false,
          message: `Could not read the client PO file: ${localErr.message}`
        });
      }
    }

    const { passed, checks, discrepancies } = runChecks(quotation, poItems, poGrandTotal);

    const poAutoCheck = {
      passed,
      checks,
      discrepancies,
      extractedItemCount: poItems.length,
      extractionMethod,
      checkedAt: new Date().toISOString(),
      checkedBy: req.user?.id || req.user?.userId || 'pm'
    };

    await dbClient.send(
      new PutItemCommand({
        TableName: WORKSPACE_QUOTATIONS_TABLE,
        Item: marshall({ ...quotation, poAutoCheck }, { removeUndefinedValues: true })
      })
    );

    await syncPoAutoCheckToPurchaseOrders(quotation.quotationId || quotationId, poAutoCheck);

    console.log(
      `✅ Auto-check ${passed ? 'PASSED' : 'FAILED'} for quotation ${quotationId} (${discrepancies.length} discrepancies)`
    );

    return res.json({
      success: true,
      data: { quotationId, ...poAutoCheck }
    });
  } catch (error) {
    console.error('❌ Error auto-checking client PO:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to auto-check client PO',
      error: error.message
    });
  }
};

/**
 * PM submits a reason for auto-check discrepancies (e.g. changed quantity or
 * item code). The reason goes to Finance for approval — the PO may only be
 * sent to the vendor once the reason is approved.
 *
 * @route POST /api/workspace/quotations/:quotationId/po-check-reason
 * @access Private (PM only)
 */
const submitPoCheckReason = async (req, res) => {
  try {
    const { quotationId } = req.params;
    const { reason } = req.body || {};

    if (!quotationId) {
      return res.status(400).json({ success: false, message: 'quotationId is required' });
    }
    if (!reason || !reason.toString().trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required' });
    }

    const scanResult = await dbClient.send(
      new ScanCommand({
        TableName: WORKSPACE_QUOTATIONS_TABLE,
        FilterExpression: 'quotationId = :qid OR customQuoteId = :qid OR id = :qid',
        ExpressionAttributeValues: marshall({ ':qid': quotationId })
      })
    );

    if (!scanResult.Items || scanResult.Items.length === 0) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    const quotation = unmarshall(scanResult.Items[0]);

    if (!quotation.poAutoCheck || quotation.poAutoCheck.passed) {
      return res.status(400).json({
        success: false,
        message: 'A reason is only needed when the auto-check has failed'
      });
    }

    const updatedQuotation = {
      ...quotation,
      poAutoCheck: {
        ...quotation.poAutoCheck,
        reason: {
          text: reason.toString().trim(),
          // PM-submitted reasons go straight to finance
          status: 'pending_finance',
          submittedBy: req.user?.id || req.user?.userId || 'pm',
          submittedAt: new Date().toISOString(),
          reviewedBy: null,
          reviewedAt: null,
          reviewRemarks: null
        }
      }
    };

    await dbClient.send(
      new PutItemCommand({
        TableName: WORKSPACE_QUOTATIONS_TABLE,
        Item: marshall(updatedQuotation, { removeUndefinedValues: true })
      })
    );

    await syncPoAutoCheckToPurchaseOrders(
      updatedQuotation.quotationId || quotationId,
      updatedQuotation.poAutoCheck
    );

    return res.json({
      success: true,
      message: 'Reason submitted for finance approval',
      data: updatedQuotation.poAutoCheck
    });
  } catch (error) {
    console.error('❌ Error submitting PO check reason:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit reason',
      error: error.message
    });
  }
};

/**
 * PM forwards a client-submitted PO-discrepancy reason to Finance.
 * Client reasons land as pending_pm; this promotes them to pending_finance.
 *
 * @route POST /api/workspace/quotations/:quotationId/po-check-reason/forward
 * @access Private (PM only)
 */
const forwardPoCheckReason = async (req, res) => {
  try {
    const { quotationId } = req.params;

    const scanResult = await dbClient.send(
      new ScanCommand({
        TableName: WORKSPACE_QUOTATIONS_TABLE,
        FilterExpression: 'quotationId = :qid OR customQuoteId = :qid OR id = :qid',
        ExpressionAttributeValues: marshall({ ':qid': quotationId })
      })
    );

    if (!scanResult.Items || scanResult.Items.length === 0) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    const quotation = unmarshall(scanResult.Items[0]);
    const reason = quotation.poAutoCheck?.reason;

    if (!reason || reason.status !== 'pending_pm') {
      return res.status(400).json({
        success: false,
        message: 'No client reason waiting for PM review'
      });
    }

    const updatedQuotation = {
      ...quotation,
      poAutoCheck: {
        ...quotation.poAutoCheck,
        reason: {
          ...reason,
          status: 'pending_finance',
          forwardedBy: req.user?.id || req.user?.userId || 'pm',
          forwardedAt: new Date().toISOString()
        }
      },
      poReviewStatus: 'reason_pending_finance'
    };

    await dbClient.send(
      new PutItemCommand({
        TableName: WORKSPACE_QUOTATIONS_TABLE,
        Item: marshall(updatedQuotation, { removeUndefinedValues: true })
      })
    );

    await syncPoAutoCheckToPurchaseOrders(
      updatedQuotation.quotationId || quotationId,
      updatedQuotation.poAutoCheck
    );

    return res.json({
      success: true,
      message: 'Reason forwarded to finance for approval',
      data: updatedQuotation.poAutoCheck
    });
  } catch (error) {
    console.error('❌ Error forwarding PO check reason:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to forward reason',
      error: error.message
    });
  }
};

export {
  autoCheckClientPO,
  submitPoCheckReason,
  forwardPoCheckReason,
  // shared helpers for the invoice↔PO match check
  normText,
  parseNumber,
  approxEqual,
  nameSimilarity
};
