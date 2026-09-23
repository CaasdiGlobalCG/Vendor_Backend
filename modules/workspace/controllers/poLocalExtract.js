/**
 * Local PO extraction — free alternative to AWS Textract (which needs a paid
 * subscription on the AWS account).
 *
 * 1. pdf-parse for PDFs that already contain text
 * 2. pdf-to-img + tesseract.js OCR for scanned/image PDFs
 *
 * Returns { poItems, poGrandTotal } in the same shape the Textract-based
 * pipeline produces, so the comparison logic is unchanged.
 */
import { PDFParse } from 'pdf-parse';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MIN_TEXT_LEN = 60;

const parseNumberLocal = (v) => {
  if (v === null || v === undefined) return null;
  const cleaned = v.toString().replace(/[₹$,%\s]/g, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
};

const extractTextFast = async (fileBytes) => {
  try {
    const parser = new PDFParse({ data: fileBytes });
    const result = await parser.getText();
    return (result.text || '').trim();
  } catch {
    return '';
  }
};

const extractTextOcr = async (fileBytes) => {
  const { pdf } = await import('pdf-to-img');
  const { createWorker } = await import('tesseract.js');

  const tmpPath = path.join(os.tmpdir(), `po-ocr-${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, fileBytes);

  const worker = await createWorker('eng');
  try {
    const doc = await pdf(tmpPath, { scale: 2 });
    const texts = [];
    let pages = 0;
    for await (const page of doc) {
      const { data } = await worker.recognize(page);
      texts.push(data.text || '');
      if (++pages >= 5) break;
    }
    return texts.join('\n').trim();
  } finally {
    await worker.terminate();
    fs.unlink(tmpPath, () => {});
  }
};

const extractLines = async (fileBytes) => {
  let text = await extractTextFast(fileBytes);

  if (text.replace(/\s/g, '').length < MIN_TEXT_LEN) {
    console.log('📝 [PO-EXTRACT] No text layer — using local OCR');
    try {
      const ocrText = await extractTextOcr(fileBytes);
      if (ocrText.length > text.length) text = ocrText;
    } catch (err) {
      console.warn('⚠️ [PO-EXTRACT] OCR fallback failed:', err.message);
    }
  }

  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
};

const NUMBER_RE = /[₹$]?\s*[\d,]+(?:\.\d+)?\s*%?/g;
const SKIP_LINE_RE = /^(sl|s\.?\s*no|item|description|qty|quantity|rate|price|amount|hsn|sac|gst|cgst|sgst|igst|total|sub\s*total|grand|tax|invoice|purchase\s*order|po\s*no|date|bill|ship|address|terms|signature|page|note|thank)/i;

// Trailing numeric run — gaps with letters (item name, "120x60cm") break it,
// so digits inside codes/names don't pollute qty/rate.
const trailingNumbers = (line) => {
  const matches = [];
  for (const m of line.matchAll(NUMBER_RE)) {
    const val = parseNumberLocal(m[0]);
    if (val === null) continue;
    matches.push({ val, start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  if (matches.length < 2) return null;

  const tail = [matches[matches.length - 1]];
  for (let i = matches.length - 2; i >= 0; i--) {
    const gap = line.slice(matches[i].end, tail[0].start);
    if (/[a-zA-Z]/.test(gap)) break;
    tail.unshift(matches[i]);
  }
  if (tail.length < 2) return null;

  return { tail, nameEnd: tail[0].start };
};

const extractItemsFromLines = (lines) => {
  const items = [];

  for (const line of lines) {
    if (SKIP_LINE_RE.test(line)) continue;

    const t = trailingNumbers(line);
    if (!t) continue;

    const { tail } = t;
    const amount = tail[tail.length - 1].val;

    let gstIdx = -1;
    for (let i = 0; i < tail.length; i++) {
      if (tail[i].raw.includes('%') && tail[i].val <= 28) { gstIdx = i; break; }
    }
    if (gstIdx === -1) {
      for (let i = 1; i < tail.length - 1; i++) {
        if (tail[i].val <= 28) { gstIdx = i; break; }
      }
    }
    const gst = gstIdx !== -1 ? tail[gstIdx].val : null;

    const rest = tail.slice(0, -1).filter((_, i) => i !== gstIdx);
    const qty = rest.length ? rest[0].val : null;
    let rate = rest.length >= 2 ? rest[1].val : null;
    if (rate === null && qty && amount && qty > 0) rate = amount / qty;

    const namePart = line.slice(0, t.nameEnd).replace(/[₹$|]/g, ' ').trim();
    if (!namePart || namePart.length < 3 || /^[\d\W]+$/.test(namePart)) continue;

    const codeMatch = namePart.match(/\b([A-Z0-9]{3,}(?:-[A-Z0-9]+)+)\b/i);
    const code = codeMatch ? codeMatch[1] : null;
    const name = (code ? namePart.replace(codeMatch[0], ' ') : namePart)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (!name) continue;

    items.push({ name, code, qty, rate, amount, gst });
  }

  return items;
};

const extractGrandTotalFromLines = (lines) => {
  const candidates = [];
  for (const line of lines) {
    const l = line.toLowerCase();
    if (!/(total|grand\s*total|amount\s*payable|net\s*payable)/.test(l)) continue;
    const nums = (line.match(/[\d,]+(?:\.\d+)?/g) || [])
      .map((n) => parseNumberLocal(n))
      .filter((n) => n !== null && n > 0);
    if (nums.length) candidates.push(Math.max(...nums));
  }
  return candidates.length ? Math.max(...candidates) : null;
};

/**
 * @param {Buffer} fileBytes
 * @returns {Promise<{poItems: Array, poGrandTotal: number|null}>}
 */
export const extractPoDataFromBytes = async (fileBytes) => {
  const lines = await extractLines(fileBytes);
  return {
    poItems: extractItemsFromLines(lines),
    poGrandTotal: extractGrandTotalFromLines(lines),
  };
};
