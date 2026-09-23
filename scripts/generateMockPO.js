/**
 * Generate a mock client PO PDF matching the seeded mock quotation
 * (mockFinanceApprovedQuotation.js) — for testing the auto-check flow.
 *
 * Output: ./mock-client-po.pdf
 *
 * Default: exact match (client-facing/commissioned rates, 10% commission).
 * Force a discrepancy to test the reason flow:
 *   node scripts/generateMockPO.js --qty 12          # chair qty 10 → 12
 *   node scripts/generateMockPO.js --rate 6000       # chair rate 5500 → 6000
 *   node scripts/generateMockPO.js --code CHR-X-99   # wrong item code
 *   node scripts/generateMockPO.js --total 99999     # wrong grand total line
 */
import fs from 'fs';
import PDFDocument from 'pdfkit';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
};

const OUT = arg('out') || './mock-client-po.pdf';

// Matches mockFinanceApprovedQuotation.js: base + 10% commission = client rates
const items = [
  { code: 'CHR-ERGO-01', name: 'Ergonomic Office Chair', qty: 10, rate: 5500 },
  { code: 'DSK-STD-02', name: 'Standing Desk 120x60cm', qty: 5, rate: 13200 },
];

if (arg('qty')) items[0].qty = Number(arg('qty'));
if (arg('rate')) items[0].rate = Number(arg('rate'));
if (arg('code')) items[0].code = arg('code');

const GST = 18;
const rows = items.map((i) => {
  const amount = i.qty * i.rate;
  return { ...i, gst: GST, amount };
});
const subtotal = rows.reduce((s, r) => s + r.amount, 0);
const total = arg('total') ? Number(arg('total')) : Math.round(subtotal * 1.18);

const doc = new PDFDocument({ margin: 50 });
doc.pipe(fs.createWriteStream(OUT));

doc.fontSize(18).text('PURCHASE ORDER', { align: 'center' });
doc.moveDown();
doc.fontSize(11)
  .text('PO No: PO-MOCK-0001')
  .text(`Date: ${new Date().toISOString().split('T')[0]}`)
  .text('From: Mock Client Industries')
  .text('To: Caasdi Global')
  .moveDown();

doc.fontSize(12).text('Items', { underline: true }).moveDown(0.5);
doc.fontSize(10);
doc.text('Item Code        Description                    Qty     Rate        GST     Amount');
doc.text('-'.repeat(95));
for (const r of rows) {
  doc.text(
    `${r.code.padEnd(17)}${r.name.padEnd(31)}${String(r.qty).padEnd(8)}${String(r.rate).padEnd(12)}${(r.gst + '%').padEnd(8)}${r.amount}`
  );
}
doc.moveDown();
doc.text(`Grand Total: INR ${total}`, { align: 'right' });

doc.end();

doc.on('finish', () => {
  console.log(`Wrote ${OUT}`);
  console.log('Items:', JSON.stringify(rows.map(({ code, name, qty, rate, amount }) => ({ code, name, qty, rate, amount })), null, 1));
  console.log(`Grand Total: ${total}`);
});
