// Invoice, payment receipt and lien release PDFs.
// These aren't fixed legal forms (except the release wording), so they use a
// clean, modern layout: white page, thin navy top band, Inter Tight, hairlines.
const path = require('path');
const PDFDocument = require('pdfkit');
const f = require('./format');
const LIEN = require('./lien-text');

const LOGO = path.join(__dirname, '..', 'public', 'logo.png');
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const LIGHT = 'InterTight-Light';
const REG = 'InterTight';
const MED = 'InterTight-Medium';
const SEMI = 'InterTight-SemiBold';

const INK = '#111111';
const MUTED = '#6b6b6b';
const RULE = '#d9d9d9';
const NAVY = '#082A56';
const STATUS = {
  paid: ['PAID', '#1f7a4a', '#e6f3eb'],
  partial: ['PARTIALLY PAID', '#9a6200', '#fbf1dc'],
  unpaid: ['UNPAID', '#082A56', '#e6ebf2'],
  draft: ['DRAFT', '#6b6b6b', '#ededed'],
  overdue: ['OVERDUE', '#b3261e', '#f8e4e2'],
};

const PW = 612;
const PH = 792;
const L = 54;
const R = PW - 54;
const W = R - L;

const money = (n) => f.money(n);
const dataUrlToBuffer = (d) => { const m = /^data:image\/png;base64,(.+)$/.exec(d || ''); return m ? Buffer.from(m[1], 'base64') : null; };

function newDoc(title, company) {
  const doc = new PDFDocument({ size: 'LETTER', autoFirstPage: false, margins: { top: 0, bottom: 0, left: 0, right: 0 }, info: { Title: title, Author: company.name } });
  doc.registerFont(LIGHT, path.join(FONT_DIR, 'InterTight-Light.ttf'));
  doc.registerFont(REG, path.join(FONT_DIR, 'InterTight-Regular.ttf'));
  doc.registerFont(MED, path.join(FONT_DIR, 'InterTight-Medium.ttf'));
  doc.registerFont(SEMI, path.join(FONT_DIR, 'InterTight-SemiBold.ttf'));
  return doc;
}

function collect(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function kit(doc) {
  const k = {};
  k.text = (s, x, y, font, size, o = {}) => doc.font(font).fontSize(size).fillColor(o.color || INK)
    .text(String(s ?? ''), x, y, { lineBreak: false, characterSpacing: o.cs || 0, width: o.width, align: o.align || 'left' });
  k.label = (s, x, y, o = {}) => k.text(String(s).toUpperCase(), x, y, MED, 7, { color: MUTED, cs: 0.9, ...o });
  k.wrap = (s, x, y, w, font, size, o = {}) => { doc.font(font).fontSize(size).fillColor(o.color || INK).text(String(s ?? ''), x, y, { width: w, lineGap: o.lineGap ?? 2, align: o.align || 'left' }); return doc.y; };
  k.rule = (y, x1 = L, x2 = R, color = RULE, w = 0.6) => doc.lineWidth(w).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke();
  k.fit = (s, font, size, maxW) => { doc.font(font); while (size > 6 && doc.fontSize(size).widthOfString(String(s)) > maxW) size -= 0.25; return size; };
  k.pill = (status, x, y) => {
    const [txt, fg, bg] = STATUS[status] || STATUS.unpaid;
    doc.font(SEMI).fontSize(8);
    const w = doc.widthOfString(txt, { characterSpacing: 1 }) + 22;
    doc.roundedRect(x - w, y, w, 18, 9).fill(bg);
    doc.circle(x - w + 9, y + 9, 2.5).fill(fg);
    k.text(txt, x - w + 15, y + 5.2, SEMI, 8, { color: fg, cs: 1 });
  };
  return k;
}

// Shared header: navy band, logo, company block, document title.
function header(doc, k, company, title, sub) {
  doc.rect(0, 0, PW, 6).fill(NAVY);
  const lh = 40;
  doc.image(LOGO, L, 34, { height: lh });
  const cw = 230;
  k.text(company.name, R - cw, 34, MED, 10, { width: cw, align: 'right' });
  [company.address, company.cityStateZip, [company.phone, company.email].filter(Boolean).join('  ·  '), `CSLB License #${company.license}`]
    .forEach((s, i) => k.text(s, R - cw, 49 + i * 11.5, LIGHT, 8.5, { width: cw, align: 'right', color: '#333' }));
  k.text(title, L, 112, LIGHT, 34, { cs: -0.8 });
  if (sub) k.text(sub, L, 152, REG, 10, { color: MUTED });
}

function footer(doc, k, company, note, thanks = true) {
  k.rule(PH - 54);
  k.text(note || `${company.name}  ·  CSLB #${company.license}  ·  ${company.phone}`, L, PH - 44, LIGHT, 7.5, { color: MUTED });
  if (thanks) k.text('Thank you for your business.', L, PH - 44, LIGHT, 7.5, { color: MUTED, width: W, align: 'right' });
}

// Two-column "label / value" meta block.
function meta(k, x, y, rows, w = 140) {
  rows.forEach(([l, v], i) => {
    k.label(l, x, y + i * 28);
    k.text(v || '—', x, y + i * 28 + 11, REG, 10, { width: w });
  });
}

function partyBlock(doc, k, x, y, w, label, lines) {
  k.label(label, x, y);
  let yy = y + 12;
  lines.filter(Boolean).forEach((s, i) => {
    k.text(s, x, yy, i === 0 ? MED : LIGHT, i === 0 ? 10.5 : 9.5, { width: w });
    yy += i === 0 ? 14 : 12.5;
  });
  return yy;
}

// ============================ INVOICE ============================
function buildInvoicePdf({ invoice: inv, contract: c, company, ledger, summary: sm, settings = {} }) {
  const doc = newDoc(`Invoice ${inv.number}`, company);
  const out = collect(doc);
  const k = kit(doc);
  doc.addPage();
  header(doc, k, company, 'Invoice', `${inv.number}${c ? `  ·  ${c.projectName || ''}` : ''}`);
  k.pill(sm.status, R, 120);

  // meta + parties
  let y = 186;
  k.rule(y - 12);
  meta(k, L, y, [['Invoice number', inv.number], ['Invoice date', f.date(inv.date)], ['Due date', inv.dueDate ? f.date(inv.dueDate) : 'Upon receipt']], 150);
  const owners = c ? [c.ownerName, c.owner2Name].filter(Boolean).join(' & ') : inv.customerName;
  partyBlock(doc, k, L + 170, y, 160, 'Bill to', [owners, c && c.ownerAddress, c && c.ownerCityStateZip, c && c.ownerEmail]);
  partyBlock(doc, k, L + 345, y, W - 345, 'Project', [c && c.projectName, c && c.workAddress, c && c.workCityStateZip, c && `Contract ${c.number}`]);

  // line items
  y = 290;
  k.label('Description', L, y);
  k.label('Amount', L, y, { width: W, align: 'right' });
  k.rule(y + 13, L, R, INK, 0.8);
  y += 22;
  (inv.items || []).forEach((it) => {
    const h = doc.font(REG).fontSize(10).heightOfString(it.description || '', { width: W - 140 });
    k.wrap(it.description, L, y, W - 140, REG, 10);
    k.text(money(it.amount), L, y, REG, 10, { width: W, align: 'right' });
    y += Math.max(h, 12) + 9;
    k.rule(y - 4);
  });

  // totals
  y += 8;
  const tx = R - 230;
  const row = (l, v, o = {}) => {
    k.text(l, tx, y, o.font || LIGHT, o.size || 10, { color: o.color || INK });
    k.text(v, tx, y, o.font || REG, o.size || 10, { width: 230, align: 'right', color: o.color || INK });
    y += (o.size || 10) + 9;
  };
  row('Invoice total', money(sm.total));
  if (sm.paid > 0) row('Payments received', `– ${money(sm.paid)}`, { color: '#1f7a4a' });
  k.rule(y - 2, tx, R, INK, 0.8);
  y += 6;
  k.label('Balance due', tx, y + 6);
  k.text(money(sm.balance), tx, y - 2, LIGHT, 26, { width: 230, align: 'right', color: sm.balance > 0 ? INK : '#1f7a4a' });
  y += 40;

  // payments on this invoice
  if ((inv.payments || []).length) {
    k.label('Payments received', L, y);
    y += 14;
    inv.payments.forEach((p) => {
      k.text(`${f.date(p.date)}  ·  ${p.method}${p.reference ? ` #${p.reference}` : ''}  ·  Receipt ${p.receiptNumber}`, L, y, LIGHT, 9, { color: '#333' });
      k.text(money(p.amount), L, y, REG, 9, { width: W, align: 'right' });
      y += 13;
    });
    y += 6;
  }

  // contract summary
  if (ledger) {
    const boxY = Math.max(y + 6, 540);
    doc.roundedRect(L, boxY, W, 74, 6).fill('#f5f6f8');
    k.label(`Contract ${c.number} summary`, L + 16, boxY + 12);
    const cols = [
      ['Original contract', money(ledger.original)],
      ['Change orders', `${ledger.coTotal < 0 ? '– ' : '+ '}${money(Math.abs(ledger.coTotal))}`],
      ['Adjusted total', money(ledger.adjusted)],
      ['Paid to date', money(ledger.paid)],
      ['Remaining balance', money(ledger.balance)],
    ];
    const cw = (W - 32) / cols.length;
    cols.forEach(([l, v], i) => {
      k.text(l, L + 16 + i * cw, boxY + 32, LIGHT, 8.5, { color: MUTED });
      k.text(v, L + 16 + i * cw, boxY + 45, i === 4 ? MED : REG, 11);
    });
    y = boxY + 90;
  }

  // how to pay
  const how = (settings.paymentInstructions || '').trim() || `Please make checks payable to ${company.name}.`;
  k.label('How to pay', L, y);
  k.wrap(how, L, y + 12, W, LIGHT, 9.5, { color: '#333' });
  if (inv.notes) { k.label('Notes', L, doc.y + 10); k.wrap(inv.notes, L, doc.y + 4, W, LIGHT, 9.5, { color: '#333' }); }

  footer(doc, k, company);
  doc.end();
  return out;
}

// ============================ RECEIPT ============================
function buildReceiptPdf({ invoice: inv, payment: p, contract: c, company, ledger, summary: sm }) {
  const doc = newDoc(`Receipt ${p.receiptNumber}`, company);
  const out = collect(doc);
  const k = kit(doc);
  doc.addPage();
  header(doc, k, company, 'Payment receipt', `${p.receiptNumber}  ·  for invoice ${inv.number}`);
  k.pill(sm.status, R, 120);

  let y = 186;
  k.rule(y - 12);
  k.label('Amount received', L, y);
  k.text(money(p.amount), L, y + 12, LIGHT, 40, { cs: -0.8, color: '#1f7a4a' });
  y += 72;
  k.rule(y);
  y += 16;
  const owners = c ? [c.ownerName, c.owner2Name].filter(Boolean).join(' & ') : inv.customerName;
  meta(k, L, y, [['Received from', owners], ['Payment date', f.date(p.date)], ['Method', `${p.method}${p.reference ? ` #${p.reference}` : ''}`]], 200);
  meta(k, L + 250, y, [['Receipt number', p.receiptNumber], ['Invoice', inv.number], ['Project', c ? `${c.projectName} (${c.number})` : '']], 230);
  y += 90;

  k.rule(y);
  y += 16;
  const row = (l, v, o = {}) => {
    k.text(l, L, y, o.font || LIGHT, 10.5, { color: o.color || INK });
    k.text(v, L, y, o.font || REG, 10.5, { width: W, align: 'right', color: o.color || INK });
    y += 22;
    k.rule(y - 7);
  };
  row(`Invoice ${inv.number} total`, money(sm.total));
  row('Paid on this invoice (including this payment)', money(sm.paid));
  row('Invoice balance remaining', money(sm.balance), { font: MED });
  if (ledger) {
    y += 10;
    row(`Contract ${c.number} adjusted total`, money(ledger.adjusted));
    row('Paid to date on contract', money(ledger.paid));
    row('Contract balance remaining', money(ledger.balance), { font: MED });
  }
  if (p.note) { k.label('Note', L, y + 6); k.wrap(p.note, L, y + 18, W, LIGHT, 9.5); }

  footer(doc, k, company);
  doc.end();
  return out;
}

// ============================ LIEN RELEASE ============================
// Statutory unconditional waiver: progress (§8134) or final (§8138).
function buildLienReleasePdf({ kind, contract: c, company, payment: p, throughDate, signer, signedAt }) {
  const form = kind === 'final' ? LIEN.final : LIEN.progress;
  const doc = newDoc(form.title, company);
  const out = collect(doc);
  const k = kit(doc);
  doc.addPage();
  doc.rect(0, 0, PW, 6).fill(NAVY);
  doc.image(LOGO, L, 30, { height: 30 });
  k.text(`${company.name}  ·  CSLB #${company.license}`, L, 40, LIGHT, 8.5, { width: W, align: 'right', color: MUTED });

  let y = 84;
  k.wrap(form.title, L, y, W, SEMI, 15, { align: 'center' });
  k.text(form.statute, L, doc.y + 2, LIGHT, 8.5, { width: W, align: 'center', color: MUTED });
  y = doc.y + 18;

  // Notice box (statute requires it to be prominent)
  const nh = doc.font(SEMI).fontSize(9.5).heightOfString(form.notice, { width: W - 28, lineGap: 1.5 });
  doc.lineWidth(1).strokeColor(INK).rect(L, y, W, nh + 22).stroke();
  k.wrap(form.notice, L + 14, y + 11, W - 28, SEMI, 9.5, { lineGap: 1.5 });
  y += nh + 40;

  k.text('Identifying Information', L, y, SEMI, 11);
  y += 20;
  const owners = [c.ownerName, c.owner2Name].filter(Boolean).join(' & ');
  const fields = [
    ['Name of Claimant', company.name],
    ['Name of Customer', owners],
    ['Job Location', [c.workAddress, c.workCityStateZip].filter(Boolean).join(', ')],
    ['Owner', owners],
  ];
  if (kind !== 'final') fields.push(['Through Date', f.date(throughDate)]);
  fields.forEach(([l, v]) => {
    k.text(`${l}:`, L, y, REG, 10);
    k.text(v, L + 120, y, MED, 10, { width: W - 120 });
    k.rule(y + 13, L + 118, R);
    y += 22;
  });

  y += 10;
  k.text('Unconditional Waiver and Release', L, y, SEMI, 11);
  y = k.wrap(form.body, L, y + 18, W, REG, 10, { lineGap: 2.5 });
  if (kind !== 'final') {
    k.text(`$ ${Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, L + 4, y + 6, MED, 12);
    k.rule(y + 21, L, L + 180);
    y += 34;
  } else {
    y += 12;
  }

  k.text('Exceptions', L, y, SEMI, 11);
  y = k.wrap(LIEN.exceptions, L, y + 18, W, REG, 10);
  k.text(LIEN.disputed, L, y + 6, REG, 10);
  doc.font(REG).fontSize(10);
  const dx = L + doc.widthOfString(LIEN.disputed) + 4;
  k.text('0.00', dx, y + 6, MED, 10);
  k.rule(y + 19, dx - 2, dx + 110);
  y += 46;

  k.text('Signature', L, y, SEMI, 11);
  y += 26;
  const sigImg = dataUrlToBuffer(signer && signer.image);
  if (sigImg) { try { doc.image(sigImg, L + 125, y - 18, { fit: [200, 30], valign: 'bottom' }); } catch (_) { /* ignore */ } }
  const sigRows = [
    ['Claimant’s Signature', ''],
    ['Claimant’s Title', signer ? (signer.title || 'Owner') : ''],
    ['Date of Signature', signer ? f.date(signedAt) : ''],
  ];
  sigRows.forEach(([l, v], i) => {
    const yy = y + i * 28;
    k.text(`${l}:`, L, yy, REG, 10);
    if (v) k.text(v, L + 125, yy, MED, 10);
    k.rule(yy + 13, L + 122, L + 360);
  });
  if (signer && signer.name) k.text(`${signer.name}, for ${company.name}`, L + 125, y + 84, LIGHT, 8.5, { color: MUTED });

  footer(doc, k, company, `Release for payment received ${p ? f.date(p.date) : ''}${p && p.receiptNumber ? ` · Receipt ${p.receiptNumber}` : ''} · Contract ${c.number}`, false);
  doc.end();
  return out;
}

module.exports = { buildInvoicePdf, buildReceiptPdf, buildLienReleasePdf };
