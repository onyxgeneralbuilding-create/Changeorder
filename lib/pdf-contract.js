// Builds the 5-page California Home Improvement Contract (legal size),
// laid out like the standard paper form, with the Onyx contractor block
// printed in, the job details filled in, and initials/signatures applied.
const path = require('path');
const PDFDocument = require('pdfkit');
const f = require('./format');
const TXT = require('./contract-text');

const LOGO = path.join(__dirname, '..', 'public', 'logo.png');
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const T = 'Lato';
const TB = 'Lato-Bold';
const TI = 'Lato-Italic';
const INK = '#000000';
const RED = '#c8102e';

const PW = 612;
const PH = 1008;
const L = 36;
const R = 576;
const W = R - L;
const BOTTOM = 978;

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  return m ? Buffer.from(m[1], 'base64') : null;
}

const longDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};
const sigDay = (sig) => (sig && sig.at ? new Date(sig.at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) : '');
const amount = (v) => {
  const n = f.parseMoney(v);
  return n === null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const moneyOrNone = (v) => {
  const s = String(v ?? '').trim();
  if (!s || /^none$/i.test(s)) return 'none';
  return amount(s) || s;
};

// ---------- business days (for the right-to-cancel deadline) ----------
function nthWeekday(year, month, weekday, n) { // n=-1 for last
  if (n > 0) {
    const d = new Date(year, month, 1);
    const shift = (weekday - d.getDay() + 7) % 7;
    return new Date(year, month, 1 + shift + 7 * (n - 1));
  }
  const d = new Date(year, month + 1, 0);
  const shift = (d.getDay() - weekday + 7) % 7;
  return new Date(year, month + 1, -shift);
}
function isHoliday(d) {
  const y = d.getFullYear();
  const key = (x) => `${x.getMonth()}-${x.getDate()}`;
  const list = [
    new Date(y, 0, 1), nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), nthWeekday(y, 4, 1, -1),
    new Date(y, 6, 4), nthWeekday(y, 8, 1, 1), new Date(y, 10, 11), nthWeekday(y, 10, 4, 4), new Date(y, 11, 25),
  ];
  return list.some((h) => key(h) === key(d));
}
// California "business day": any calendar day except Sundays and holidays.
function addBusinessDays(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && !isHoliday(d)) left--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- drawing kit bound to one document ----------
function kit(doc) {
  const k = {};
  k.fit = (s, font, size, maxW, min = 6) => {
    doc.font(font);
    while (size > min && doc.fontSize(size).widthOfString(s) > maxW) size -= 0.25;
    return size;
  };
  k.text = (s, x, y, font, size, opts = {}) => {
    doc.font(font).fontSize(size).fillColor(opts.color || INK).text(s, x, y, { lineBreak: false, ...opts, color: undefined });
  };
  k.center = (s, y, font, size, opts = {}) => {
    const sz = k.fit(s, font, size, (opts.w || W));
    k.text(s, opts.x ?? L, y, font, sz, { width: opts.w || W, align: 'center', color: opts.color });
  };
  k.hline = (x1, x2, y, w = 0.6) => doc.lineWidth(w).strokeColor(INK).moveTo(x1, y).lineTo(x2, y).stroke();
  k.dashed = (y) => { doc.lineWidth(1.2).strokeColor(INK).dash(5, { space: 3 }).moveTo(L, y).lineTo(R, y).stroke().undash(); };
  k.caption = (s, x1, x2, y) => {
    doc.font(T).fontSize(5.6).fillColor(INK);
    const sz = k.fit(s, T, 5.6, x2 - x1, 4);
    doc.fontSize(sz).text(s, x1, y, { width: x2 - x1, align: 'center', lineBreak: false });
  };
  // ruled blank, optional caption below and value written on it
  k.field = (x1, x2, y, cap, val, opts = {}) => {
    k.hline(x1, x2, y);
    if (cap) k.caption(cap, x1, x2, y + 1.5);
    if (val !== undefined && val !== null && val !== '') {
      const font = opts.font || T;
      const size = k.fit(String(val), font, opts.size || 10, x2 - x1 - 6);
      doc.font(font).fontSize(size).fillColor(INK)
        .text(String(val), x1 + 3, y - size - 2.5, { width: x2 - x1 - 6, align: opts.align || 'left', lineBreak: false });
    }
  };
  k.box = (x, y, checked, size = 9) => {
    doc.lineWidth(0.8).strokeColor(INK).rect(x, y, size, size).stroke();
    if (checked) {
      doc.lineWidth(1.3).moveTo(x + 1.5, y + 1.5).lineTo(x + size - 1.5, y + size - 1.5)
        .moveTo(x + size - 1.5, y + 1.5).lineTo(x + 1.5, y + size - 1.5).stroke();
    }
  };
  // label then a blank that runs to x2; returns the blank's start x
  k.labelField = (label, x, y, font, size, x2, val, cap, opts = {}) => {
    k.text(label, x, y, font, size);
    doc.font(font).fontSize(size);
    const start = x + doc.widthOfString(label) + 3;
    k.field(start, x2, y + size - 0.5, cap, val, opts);
    return start;
  };
  k.initials = (s, x1, x2, lineY) => {
    if (!s) return;
    const size = k.fit(s, TI, 11, x2 - x1 - 4);
    doc.font(TI).fontSize(size).fillColor(INK).text(s, x1, lineY - size - 2, { width: x2 - x1, align: 'center', lineBreak: false });
  };
  k.sig = (sig, x1, x2, lineY, h = 18) => {
    const img = dataUrlToBuffer(sig && sig.image);
    if (!img) return;
    try { doc.image(img, x1 + 4, lineY - h - 1, { fit: [x2 - x1 - 8, h], align: 'center', valign: 'bottom' }); } catch (_) { /* ignore */ }
  };
  k.x = (x, y) => k.text('x', x, y, TB, 12);
  // paragraph with an optional bold run-in, flowing at doc.y
  k.para = (runIn, body, x, width, size, opts = {}) => {
    doc.fillColor(INK);
    if (runIn) {
      doc.font(opts.runFont || TB).fontSize(size).text(runIn, x, doc.y, { width, continued: true, lineGap: opts.lineGap ?? 0.5, indent: opts.indent || 0, align: opts.align || 'left' });
      doc.font(opts.font || T).text(body, { lineGap: opts.lineGap ?? 0.5, align: opts.align || 'left' });
    } else {
      doc.font(opts.font || T).fontSize(size).text(body, x, doc.y, { width, lineGap: opts.lineGap ?? 0.5, indent: opts.indent || 0, align: opts.align || 'left' });
    }
    if (opts.after) doc.y += opts.after;
  };
  return k;
}

function newDoc(company, order) {
  const doc = new PDFDocument({
    size: [PW, PH],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: false,
    info: { Title: `Home Improvement Contract ${order.number || ''} - ${order.projectName || ''}`, Author: company.name },
  });
  doc.registerFont(T, path.join(FONT_DIR, 'Lato-Regular.ttf'));
  doc.registerFont(TB, path.join(FONT_DIR, 'Lato-Bold.ttf'));
  doc.registerFont(TI, path.join(FONT_DIR, 'Lato-Italic.ttf'));
  return doc;
}

function frame(doc, company) {
  doc.lineWidth(4).strokeColor(company.brandColor || '#082A56').rect(20, 16, PW - 40, PH - 44).stroke();
}
function footer(doc, k, company, order, page) {
  k.text(`${company.name}  ·  ${company.licenseLabel || 'Lic. #'}${company.license}  ·  Home Improvement Contract ${order.number || ''}  ·  Page ${page}`,
    20, PH - 22, T, 7, { width: PW - 40, align: 'center' });
}

// Render a text-heavy page at the largest scale that fits.
const scaleCache = new Map();
function fitScale(company, order, ctx, draw) {
  const key = [draw.name, ctx.fee, ctx.settings.cglOption, ctx.settings.wcOption].join('|');
  if (scaleCache.has(key)) return scaleCache.get(key);
  let lo = 0.7, hi = 1.05, best = 0.7;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const scratch = newDoc(company, order);
    scratch.addPage();
    const endY = draw(scratch, kit(scratch), mid, ctx);
    scratch.end();
    if (endY <= BOTTOM) { best = mid; lo = mid; } else { hi = mid; }
  }
  scaleCache.set(key, best);
  return best;
}

// ======================= PAGE 1 =======================
function page1(doc, k, company, order, ctx) {
  const o = order;
  const sigs = o.signatures || {};
  const acks = o.acks || {};
  const lic = `CSLB License #${company.license}`;

  k.center('HOME IMPROVEMENT CONTRACT', 24, TB, 18);
  k.center('NOT APPLICABLE TO SWIMMING POOLS OR SPAS', 44, TB, 9.5);
  k.center('(Complies with Section 7159 of California Business and Professions Code, and Civil Code Section 8170 as amended)', 56, TI, 8.5, { color: RED });
  k.center('AGREEMENT BETWEEN DIRECT CONTRACTOR AND PROPERTY OWNER', 67, TB, 12);
  k.center('The Notice of Cancellation may be mailed to the address of the direct contractor as shown below:', 80, TB, 11);

  // Direct contractor (printed) — left
  const CX1 = L, CX2 = 286, CW = CX2 - CX1;
  k.text('DIRECT CONTRACTOR', CX1, 96, TB, 7.5, { width: CW, align: 'center' });
  const logoH = 38, logoW = logoH * (998 / 639);
  doc.image(LOGO, CX1 + (CW - logoW) / 2, 106, { width: logoW });
  k.text(company.name, CX1, 147, TB, 11, { width: CW, align: 'center' });
  [lic, `${company.address}, ${company.cityStateZip}`,
    [company.phone && `Phone ${company.phone}`, company.fax && `Fax ${company.fax}`].filter(Boolean).join('   '),
    company.email].filter(Boolean).forEach((s, i) => k.text(s, CX1, 161 + i * 11, T, k.fit(s, T, 9, CW), { width: CW, align: 'center' }));

  k.text('And', 290, 99, TB, 10);
  // Property owner — right
  const OX1 = 314, OX2 = R;
  const owners = [o.ownerName, o.owner2Name].filter(Boolean).join(' & ');
  k.field(OX1, OX2, 107, '(Property Owner’s Name)', owners);
  k.field(OX1, OX2, 126, '(Property Owner’s Mailing Address)', o.ownerAddress);
  k.field(OX1, OX2, 144, '(City, State & Zip)', o.ownerCityStateZip);
  k.field(OX1, OX2, 163, '(Property Owner’s Phone #)', o.ownerPhone);
  k.field(OX1, OX2, 181, '(Property Owner’s Fax #)', o.ownerFax);
  k.labelField('Email', OX1 - 2, 192, TB, 10, OX2, o.ownerEmail, '(Property Owner’s)');

  // Work location / lender
  const wx = k.labelField('WORK TO BE PERFORMED AT:', L, 214, TB, 12, 416, o.workAddress, '(Address)');
  k.field(422, R, 225.5, '(City, State & Zip)', o.workCityStateZip);
  k.labelField('CONSTRUCTION LENDER:', L, 234, TB, 12, R, o.lender || 'none', '(Name and Address of Construction Fund Holder; if not applicable, put “none”)');

  // Description
  k.center('DESCRIPTION OF THE PROJECT AND DESCRIPTION OF THE SIGNIFICANT MATERIALS', 255, TB, 12, { x: L, w: W });
  k.text('TO BE USED AND EQUIPMENT TO BE INSTALLED:', L, 268, TB, 12);
  doc.font(TB).fontSize(12);
  const afterHead = L + doc.widthOfString('TO BE USED AND EQUIPMENT TO BE INSTALLED: ');
  const s1 = 'Direct Contractor will furnish all labor and materials to';
  k.text(s1, afterHead, 269.5, T, k.fit(s1, T, 10, R - afterHead));
  const s2 = 'construct and complete in a good, workmanlike and substantial manner a:';
  k.text(s2, L, 282, T, 10);
  doc.font(T).fontSize(10);
  const firstX = L + doc.widthOfString(s2) + 4;
  const descLines = [[firstX, 292], [L, 308], [L, 324], [L, 340], [L, 356], [L, 372]];
  const lines = ctx.descLines;
  descLines.forEach(([x, y], i) => {
    k.hline(x, R, y);
    const t = lines.page1[i];
    if (t) k.text(t, x + 3, y - 12, T, 10);
  });
  k.caption('(Describe Labor, Significant Materials, and Equipment to be Furnished. Include Materials and Equipment to be used or installed under this Contract. If necessary, continue the description', L, R, 375);
  k.caption('of the work on an additional attachment page and describe the attachment in the section below entitled, “Documents to be Incorporated in the Contract.”)', L, R, 381);

  k.labelField('Substantial commencement of work under this contract is described as:', L, 393, T, 10, R, o.commencement);
  k.labelField('Approximate Start Date:', L, 409, TB, 10, 292, f.date(o.startDate) || o.startDate, '(Work will begin)');
  k.labelField('Approximate Completion Date:', 300, 409, TB, 10, R, f.date(o.completionDate) || o.completionDate, '(Work is to be completed)');
  k.labelField('CONTRACT PRICE: $', L, 426, TB, 10, 292, amount(o.contractPrice), '(Owner agrees to pay Contractor total cash price)', { font: TB });
  k.labelField('DOWN PAYMENT: $', 300, 426, TB, 10, R, moneyOrNone(o.downPayment), '(If any; if not applicable, put “none”)');

  k.center('THE DOWN PAYMENT MAY NOT EXCEED $1,000 OR 10 PERCENT OF THE CONTRACT PRICE,', 446, TB, 12, { x: L, w: W });
  k.labelField('WHICHEVER IS LESS.     FINANCE CHARGE $', L, 460, TB, 12, R, moneyOrNone(o.financeCharge),
    '(Must be stated separately from the contract amount in dollars and cents; if not applicable, put “none” )');

  // Progress payments
  doc.y = 480;
  k.para('', TXT.progressNote, L, W, 10.4, { font: TB, lineGap: 0.2, indent: 6 });
  const py = doc.y + 4;
  k.caption('(Work or Services to be Performed or Materials to be Supplied)', 132, 326, py);
  k.caption('(Date)', 332, 384, py);
  const rows = ctx.paymentRows;
  for (let i = 0; i < 5; i++) {
    const y = py + 19 + i * 16;
    const p = rows[i] || {};
    k.text(`${i + 1}. $`, L + 4, y - 11, T, 10);
    k.field(62, 126, y, null, p.more ? '' : amount(p.amount), { size: 9.5 });
    k.field(132, 326, y, null, p.description, { size: 9 });
    k.field(332, 384, y, null, p.more ? '' : (f.date(p.date) || p.date), { size: 8.5, align: 'center' });
  }
  const rowsEnd = py + 19 + 4 * 16;
  k.caption('(If necessary, continue the description of the work on an additional attachment page and describe the', 62, 384, rowsEnd + 3);
  k.caption('attachment in the section below entitled, “List of Documents to be Incorporated into the Contract.”)', 62, 384, rowsEnd + 9);
  // Release (right column)
  doc.y = py - 2;
  doc.font(TB).fontSize(9.2).fillColor(INK).text('Release.', 392, doc.y, { width: R - 392, continued: true, lineGap: 0 });
  doc.font(T).text(TXT.release[0][1], { continued: true });
  doc.font(TB).text(TXT.release[1][0], { continued: true });
  doc.font(T).text(TXT.release[2][1]);

  // Allowances / documents
  doc.y = Math.max(doc.y, rowsEnd + 15) + 1;
  const allowText = 'The following items or specific prices as indicated are included in the contract price as allowances. The contract price shall be adjusted upward or downward based on actual amounts rather than estimated amounts herein:';
  doc.font(TB).fontSize(9.4).text('Allowances: ', L + 4, doc.y, { width: W - 4, continued: true, lineGap: 0.3 });
  if (o.allowances) {
    doc.font(T).text(allowText + ' ', { continued: true });
    doc.font(TI).text(o.allowances);
  } else {
    doc.font(T).text(allowText);
  }
  doc.y += 3;
  const docsList = 'Notice of Cancellation; Arbitration of Disputes; Three or Five Day Right to Cancel; Mechanics Lien Warning; Note About Extra Work and Change Order; Information about CSLB' + (ctx.hasAttachment ? '; Attachment A (continued description of work and/or progress payments)' : '') + '.';
  doc.font(TB).fontSize(9.4).text('Documents to be Incorporated in the Contract: ', L + 4, doc.y, { width: W - 4, continued: true, lineGap: 0.3 });
  doc.font(T).text(docsList);
  doc.y += 3;
  const n1 = 'A notice concerning commercial general liability insurance and workers’ compensation insurance is attached to this contract.';
  k.text(n1, L, doc.y, TB, k.fit(n1, TB, 10, W));
  let y = doc.y + 13;
  const n2 = 'Owner acknowledges receipt of a fully completed copy of this agreement and all documents listed above.';
  k.text(n2, L, y, TB, k.fit(n2, TB, 10, 440));
  k.field(486, R, y + 10, '(Property Owner’s Initials)');
  k.initials(acks.initials, 486, R, y + 10);
  y += 17;
  k.labelField('Owner affirms their age(s) is/are:', L, y, TB, 10, 228, acks.ages);
  k.text(';', 230, y, TB, 10);
  k.field(238, 318, y + 9.5, '(Property Owner’s Initials)');
  k.initials(acks.initials, 238, 318, y + 9.5);
  k.text('Initial the appropriate box below:', 400, y + 6, TB, 10, { color: RED });

  // Three boxes
  const by = y + 20, bh = 60;
  const boxes = [
    { x: 38, w: 196, title: ['NOTICE OF RIGHT TO CANCEL', '3-DAY'], body: ['The law requires that the contractor give you', 'a notice explaining your right to cancel.', 'Initial this box if the contractor has given you', 'a “Notice of the Three-Day Right to Cancel.”'], on: acks.rightToCancel === 3 },
    { x: 239, w: 196, title: ['NOTICE OF RIGHT TO CANCEL', '5-DAY'], red: ' (owners 65 and over)', body: ['The law requires that the contractor give you', 'a notice explaining your right to cancel.', 'Initial this box if the contractor has given you', 'a “Notice of the Five-Day Right to Cancel.”'], on: acks.rightToCancel === 5 },
    { x: 441, w: 135, title: ['ARBITRATION OF', 'DISPUTES'], body: ['OWNER: Initial this box', 'if you agree to arbitration.', 'Review the “Arbitration of', 'Disputes” section attached.'], on: acks.arbitration === true },
  ];
  boxes.forEach((b) => {
    doc.lineWidth(0.9).strokeColor(INK).rect(b.x, by, b.w, bh).stroke();
    doc.lineWidth(0.7).rect(b.x + 3, by + 3, 30, 15).stroke();
    if (b.on) k.initials(acks.initials, b.x + 3, b.x + 33, by + 16);
    const tx = b.x + 36, tw = b.w - 38;
    k.text(b.title[0], tx, by + 4, TB, k.fit(b.title[0], TB, 9, tw), { width: tw, align: 'center' });
    if (b.red) {
      doc.font(TB).fontSize(9);
      const t2 = b.title[1], w2 = doc.widthOfString(t2 + b.red);
      const sx = tx + (tw - w2) / 2;
      k.text(t2, sx, by + 14, TB, 9);
      k.text(b.red, sx + doc.widthOfString(t2), by + 14, TB, 9, { color: RED });
    } else {
      k.text(b.title[1], tx, by + 14, TB, 9, { width: tw, align: 'center' });
    }
    b.body.forEach((line, i) => {
      const font = (b.x === 441 && i === 2) || (b.x === 441 && i === 3) ? T : TB;
      const color = (b.x === 441 && i === 1) || (b.x !== 441 && i === 2) ? RED : INK;
      k.text(line, b.x + 3, by + 24 + i * 8.6, font, k.fit(line, font, 7.6, b.w - 6), { width: b.w - 6, align: 'center', color });
    });
  });

  y = by + bh + 5;
  const e1 = 'You are entitled to a completely filled in copy of this agreement, signed by both you and the contractor, before any work may be started.';
  doc.y = y;
  k.para('', e1, L, W, 10.4, { font: TB, indent: 12, lineGap: 0 });
  const e2 = 'You (the owner or tenant) have the right to require the Contractor to have a performance and payment bond; however, the Contractor can charge you for the costs of procuring a bond.';
  doc.y += 2;
  k.para('', e2, L, W, 10.4, { font: TB, indent: 12, lineGap: 0 });

  // Signatures
  y = doc.y + 18;
  k.x(L, y - 12);
  k.field(L + 10, 222, y, '(Owner Sign Here — Read notice on Arbitration, Mechanics Lien Warning)');
  k.sig(sigs.owner, L + 10, 222, y, 13);
  k.field(228, 284, y, '(Date)', f.date(sigDay(sigs.owner)), { size: 8, align: 'center' });
  k.labelField('Firm Name:', 296, y - 10, T, 10, R, company.name, '(Direct Contractor’s Firm Name)', { font: TB });
  y += 21;
  k.x(L, y - 12);
  k.field(L + 10, 222, y, '(If more than one Owner, please Sign Here)');
  k.sig(sigs.owner2, L + 10, 222, y, 13);
  k.field(228, 284, y, '(Date)', f.date(sigDay(sigs.owner2)), { size: 8, align: 'center' });
  k.text('Contractor or Agent:', 296, y - 10, T, 10);
  k.x(394, y - 12);
  k.field(404, 518, y, '(Direct Contractor or Agent Sign Here)');
  k.sig(sigs.contractor, 404, 518, y, 13);
  k.field(524, R, y, '(Date)', f.date(sigDay(sigs.contractor)), { size: 8, align: 'center' });
  y += 11;
  k.text('Salesman who solicited or negotiated contract:', L, y, TB, 10);
  y += 12;
  k.labelField('Name:', L, y, T, 10, 292, o.salesmanName);
  k.labelField('State Registration Number:', 300, y, T, 10, R, o.salesmanReg);
}

// ======================= PAGE 2: TERMS =======================
// Word-wrap runs of [text, font] into lines that fit `width`.
function wrapRuns(doc, runs, width, size, indent) {
  const lines = [];
  let line = [], lw = indent;
  runs.forEach(([text, font]) => {
    doc.font(font).fontSize(size);
    const space = doc.widthOfString(' ');
    text.split(/\s+/).filter(Boolean).forEach((word) => {
      const ww = doc.widthOfString(word);
      if (lw + ww > width && line.length) { lines.push(line); line = []; lw = 0; }
      line.push({ word, font, x: lw });
      lw += ww + space;
    });
  });
  if (line.length) lines.push(line);
  return lines;
}

function page2(doc, k, s, ctx) {
  k.center('TERMS AND CONDITIONS', 24, TB, 15);
  const top = 46, colGap = 14, colW = (W - colGap) / 2;
  const size = 10 * s, lh = size * 1.18;
  const paras = TXT.terms.map((p) => ({ ...p, body: p.body.replace('fee of 20% or %', `fee of 20% or ${ctx.fee || '____'}%`) }));
  let col = 0, y = top, overflow = false;
  paras.forEach((p) => {
    const runs = p.title ? [[p.title, TB], [p.body, T]] : [[p.body, T]];
    wrapRuns(doc, runs, colW, size, 8).forEach((line) => {
      if (y + lh > BOTTOM) { if (col === 0) { col = 1; y = top; } else { overflow = true; } }
      const x0 = L + col * (colW + colGap);
      line.forEach((t) => { doc.font(t.font).fontSize(size).fillColor(INK).text(t.word, x0 + t.x, y, { lineBreak: false }); });
      y += lh;
    });
    y += 1.5 * s;
  });
  return overflow ? BOTTOM + 100 : (col === 0 ? top : y);
}

// ======================= PAGE 3: RIGHT TO CANCEL =======================
function page3(doc, k, s, ctx) {
  const { order: o, company } = ctx;
  const acks = o.acks || {};
  const sigs = o.signatures || {};
  const signedDay = sigDay(sigs.owner);
  const body = 11 * s;
  const head = (main, red, y, size = 15) => {
    doc.font(TB).fontSize(size * s);
    const w = doc.widthOfString(main + (red || ''));
    const x = L + (W - w) / 2;
    k.text(main, x, y, TB, size * s);
    if (red) k.text(red, x + doc.widthOfString(main), y, TB, size * s, { color: RED });
    return y + size * s + 2;
  };
  const complies = (t, y) => { k.center(t, y, TI, 8.5 * s, { color: RED }); return y + 12 * s; };
  const paras = (list, y) => {
    doc.y = y;
    list.forEach((p) => k.para('', p, L, W, body, { indent: 12, lineGap: 0.4 * s, after: 2 * s }));
    return doc.y;
  };

  let y = 24;
  y = head('FIVE-DAY RIGHT TO CANCEL ', '(For owners 65 and over)', y);
  y = complies('(Complies with Section 7159 of California Business and Professions Code)', y);
  y = paras(TXT.rightToCancel5, y + 2);
  y = head('THREE-DAY RIGHT TO CANCEL', '', y + 6);
  y = complies('(Complies with Section 7163 of California Business and Professions Code)', y);
  y = paras(TXT.rightToCancel3, y + 2);

  // acknowledgment of receipt
  y += 14 * s;
  k.text('I,', L, y, T, body);
  k.field(L + 10, 250, y + body, '(Owner)', [o.ownerName, o.owner2Name].filter(Boolean).join(' & ') && signedDay ? sigs.owner.name : '');
  k.text('hereby acknowledge that on', 254, y, T, body);
  doc.font(T).fontSize(body);
  const dx = 254 + doc.widthOfString('hereby acknowledge that on ') + 2;
  k.field(dx, dx + 90, y + body, '(Date)', f.date(signedDay), { align: 'center' });
  k.text('I was provided this', dx + 96, y, T, k.fit('I was provided this', T, body, R - dx - 96));
  y += 24 * s;
  k.text('document entitled', L, y, T, body);
  let bx = L + doc.widthOfString('document entitled') + 10;
  k.box(bx, y + 1, acks.rightToCancel === 3, 9 * s);
  k.text('“Three Day Right to Cancel”', bx + 13 * s, y, T, body);
  bx += 13 * s + doc.font(T).fontSize(body).widthOfString('“Three Day Right to Cancel”') + 12;
  k.box(bx, y + 1, acks.rightToCancel === 5, 9 * s);
  k.text('“Five Day Right to Cancel”', bx + 13 * s, y, T, body);
  bx += 13 * s + doc.widthOfString('“Five Day Right to Cancel”') + 8;
  k.x(bx, y - 2);
  k.field(bx + 10, R, y + body, '(Owner’s Signature)');
  k.sig(sigs.owner, bx + 10, R, y + body, 16);
  y += body + 20 * s;
  k.dashed(y);

  const notice = (days, title, red, comp) => {
    y += 10 * s;
    y = head(title, red, y);
    const dateY = y;
    k.text('DATE', L, dateY, TB, 7.5 * s);
    const dateISO = acks.rightToCancel === days ? signedDay : '';
    k.field(L + 26 * s, L + 120 * s, dateY + 8 * s, null, f.date(dateISO), { size: 9 * s, align: 'center' });
    y = complies(comp, dateY - 1) + 4 * s;
    doc.y = y;
    TXT.noticeOfCancellation.forEach((p, i) => k.para('', p.replace('{N}', days === 5 ? 'five' : 'three'), L, W, body * 0.97, { indent: i ? 12 : 0, lineGap: 0.2 * s, after: 1.5 * s }));
    y = doc.y + 5 * s;
    doc.y = y;
    k.para('', TXT.cancelInstruction, L, W, body * 0.97, { indent: 6 });
    const ly = doc.y - 2;
    const deadline = dateISO ? f.date(addBusinessDays(dateISO, days)) : '';
    k.field(R - 175, R - 20, ly, '(Date)', deadline, { align: 'center' });
    k.text('to', R - 14, ly - body + 1, T, body);
    y = ly + 26 * s;
    k.field(L, 296, y, '(Name of Seller)', dateISO ? company.name : '', { align: 'center' });
    k.text('at', 300, y - body, T, body);
    k.field(314, R, y, '(Address of Seller’s Place of Business)', dateISO ? `${company.address}, ${company.cityStateZip}` : '', { align: 'center' });
    y += 22 * s;
    k.text('I hereby cancel this transaction', L, y - body, T, body);
    doc.font(T).fontSize(body);
    const cx = L + doc.widthOfString('I hereby cancel this transaction') + 4;
    k.x(cx, y - 13);
    k.field(cx + 10, 410, y, '(Buyer’s Signature)');
    k.field(420, R, y, '(Date)');
    y += 12;
  };
  notice(5, 'FIVE-DAY NOTICE OF CANCELLATION ', '(For owners 65 and over)', '(Complies with Section 7159 of California Business and Professions Code)');
  k.dashed(y + 2);
  notice(3, 'THREE-DAY NOTICE OF CANCELLATION', '', '(Complies with Section 7163 of California Business and Professions Code)');
  return y;
}

// ======================= PAGE 4: STATUTORY NOTICES =======================
function page4(doc, k, s, ctx) {
  const { company, settings } = ctx;
  const b = 10.6 * s;
  let y = 24;
  k.center('STATUTORY NOTICES', y, TB, 16 * s); y += 18 * s;
  k.center('Information about the Contractors’ State License Board (CSLB)', y, TB, 10.5 * s); y += 15 * s;
  doc.y = y;
  TXT.cslb.forEach((p) => k.para('', p, L, W, b, { after: 3 * s, lineGap: 0.3 * s }));
  y = doc.y;
  k.center('For more information:', y, TB, b); y += b + 4;
  k.center('VISIT CSLB’s Website at www.cslb.ca.gov   CALL CSLB at 800-321-CSLB (2752)', y, TB, b); y += b + 3;
  k.center('WRITE CSLB at P.O. Box 26000, Sacramento, CA 95826.', y, TB, b); y += b + 10 * s;

  // CGL
  const cgl = settings.cglOption || 'B';
  k.text('Check the', L, y - 2, TB, 7 * s); k.text('applicable box', L - 4, y + 6 * s, TB, 7 * s);
  k.center('COMMERCIAL GENERAL LIABILITY INSURANCE (CGL)', y, TB, 13 * s, { x: L + 50, w: W - 50 }); y += 20 * s;
  const name = company.name;
  const opt = (letter, rest, rest2) => {
    k.box(L + 4, y, cgl === letter, 9 * s);
    k.text(`(${letter})`, L + 22, y - 1, TB, b);
    k.field(L + 48, 330, y + b - 1, '(Contractor’s Name)', cgl === letter ? name : '', { size: 9.5 * s });
    k.text(rest, 336, y - 1, TB, k.fit(rest, TB, b, R - 336));
    y += b + 9 * s;
    if (rest2) { k.text(rest2, L + 22, y - 1, TB, b); y += b + 6 * s; }
  };
  opt('A', 'does not carry Commercial General', 'Liability Insurance.');
  opt('B', 'carries Commercial General Liability', 'Insurance.');
  k.labelField('The insurance company is', L + 22, y - 1, TB, b, R - 8, cgl === 'B' ? settings.insuranceCompany : '', '(Insurance Company Name)');
  k.text('.', R - 6, y - 1, TB, b);
  y += b + 8 * s;
  k.text('You may call the insurance company at', L + 22, y - 1, TB, b);
  doc.font(TB).fontSize(b);
  const px = L + 22 + doc.widthOfString('You may call the insurance company at') + 4;
  k.field(px, px + 130, y + b - 1, '(Phone Number)', cgl === 'B' ? settings.insurancePhone : '', { align: 'center' });
  k.text('to check the contractor’s', px + 136, y - 1, TB, k.fit('to check the contractor’s', TB, b, R - px - 136));
  y += b + 6 * s;
  k.text('insurance coverage.', L + 22, y - 1, TB, b); y += b + 8 * s;
  opt('C', 'is self-insured.');
  y += 2 * s;
  opt('D', 'is a limited liability company that carries liability', 'insurance or maintains other security as required by law.');
  k.text('You may call', L + 22, y - 1, TB, b);
  k.field(L + 22 + 70 * s, 300, y + b - 1, '(Insurance Company/Trust Company/Bank)', cgl === 'D' ? settings.insuranceCompany : '');
  k.text('at', 306, y - 1, TB, b);
  k.field(322, 460, y + b - 1, '(Telephone Number)', cgl === 'D' ? settings.insurancePhone : '');
  k.text('to check on', 466, y - 1, TB, b);
  y += b + 6 * s;
  k.text('the contractor’s insurance coverage or security.', L + 22, y - 1, TB, b); y += b + 10 * s;

  // Workers' comp
  const wc = settings.wcOption || 'B';
  k.text('Check the', L, y - 2, TB, 7 * s); k.text('applicable box', L - 4, y + 6 * s, TB, 7 * s);
  k.center('WORKERS’ COMPENSATION INSURANCE', y, TB, 13 * s, { x: L + 50, w: W - 50 }); y += 15 * s;
  k.center('(Complies with Section 7125 of California Business and Professions Code)', y, TI, 8.5 * s, { color: RED, x: L + 50, w: W - 50 }); y += 14 * s;
  k.box(L + 4, y, wc === 'A', 9 * s);
  k.text('(A) This contractor has no employees and is exempt from workers’ compensation requirements.', L + 22, y - 1, TB, k.fit('(A) This contractor has no employees and is exempt from workers’ compensation requirements.', TB, 9.5 * s, W - 22));
  y += 15 * s;
  k.box(L + 4, y, wc === 'B', 9 * s);
  k.text('(B) This contractor carries workers’ compensation insurance for all employees.', L + 22, y - 1, TB, 9.5 * s);
  y += 16 * s;
  doc.y = y;
  doc.font(TB).fontSize(8.6 * s).fillColor(RED).text('PLEASE NOTE: ', L, y, { width: W, continued: true });
  doc.font(T).fillColor(INK).text(TXT.wcNote, { lineGap: 0.2 });
  y = doc.y + 4 * s;
  doc.lineWidth(0.8).strokeColor(INK).moveTo(20, y).lineTo(PW - 20, y).stroke();
  y += 8 * s;

  // Extra work
  k.center('NOTE ABOUT EXTRA WORK AND CHANGE ORDERS', y, TB, 13 * s); y += 15 * s;
  k.center('(Complies with Civil Code Section 1698 as amended)', y, TI, 8.5 * s, { color: RED }); y += 13 * s;
  doc.y = y;
  const sm = 8.8 * s;
  TXT.extraWork.forEach(([r, t]) => k.para(r, r ? t : t, L, W, sm, { indent: 8, lineGap: 0.2 * s, after: 2 * s }));
  let iy = doc.y;
  TXT.extraWorkItems.split('\n').forEach((line) => { k.center(line, iy, TB, sm, { x: L + 30, w: W - 60 }); iy += sm + 4; });
  doc.y = iy + 2;
  k.para('', TXT.extraWorkEnd, L, W, sm, { indent: 8, lineGap: 0.2 * s, after: 6 * s });

  // Mechanics lien
  y = doc.y;
  k.center('MECHANICS LIEN WARNING', y, TB, 13 * s); y += 15 * s;
  k.center('(Complies with Section 7159(e)(4) of California Business and Professions Code)', y, TI, 8.5 * s, { color: RED }); y += 13 * s;
  doc.y = y;
  TXT.lien.forEach(([r, t]) => k.para(r, t, L, W, sm, { indent: 8, lineGap: 0.2 * s, after: 2 * s }));
  k.para('', TXT.lienEnd, L, W, 9.6 * s, { font: TB, after: 4 * s });
  k.center(TXT.lienRemember, doc.y, TB, 9.4 * s); doc.y += 12 * s;
  k.center(TXT.lienRemember2, doc.y, T, 8.8 * s); doc.y += 10 * s;
  return doc.y;
}

// ======================= PAGE 5: ARBITRATION + ACKNOWLEDGMENT =======================
function page5(doc, k, s, ctx) {
  const { order: o, settings } = ctx;
  const acks = o.acks || {};
  const sigs = o.signatures || {};
  const owner = sigs.owner;
  const cInit = sigs.contractor ? (settings.contractorInitials || '') : '';
  const oInit = acks.arbitration === true ? acks.initials : '';
  let y = 24;
  const block = () => {
    k.center('ARBITRATION OF DISPUTES', y, TB, 16 * s); y += 18 * s;
    k.center('(Complies with CA Business and Professions Code 7191)', y, TI, 8.5 * s, { color: RED }); y += 14 * s;
    doc.y = y;
    TXT.arbitration.forEach((p) => k.para('', p, L, W, 9.1 * s, { font: TB, indent: 12, lineGap: 0.2 * s, after: 7 * s, align: 'justify' }));
    y = doc.y + 14 * s;
    k.text('I AGREE TO ARBITRATION.', L, y - 10 * s, TB, 9.5 * s);
    k.field(L + 135 * s, 290, y, '(Direct Contractor’s Initials)');
    k.initials(cInit, L + 135 * s, 290, y);
    k.text('I AGREE TO ARBITRATION.', 300, y - 10 * s, TB, 9.5 * s);
    k.field(300 + 135 * s, R, y, '(Owner’s Initials)');
    k.initials(oInit, 300 + 135 * s, R, y);
    y += 16 * s;
  };
  block();
  k.dashed(y); y += 10 * s;
  block();
  y += 8 * s;
  k.center('CUSTOMER ACKNOWLEDGMENT', y, TB, 16 * s); y += 19 * s;
  k.center('I hereby acknowledge receipt of the following documents or Notices:', y, TB, 10.5 * s); y += 18 * s;
  const items = TXT.ackItems;
  for (let i = 0; i < 5; i++) {
    [[items[i], 70], [items[i + 5], 300]].forEach(([t, x]) => {
      k.box(x, y + 1, Boolean(owner), 8.5 * s);
      k.text(t, x + 13 * s, y, T, k.fit(t, T, 10.5 * s, R - x - 16));
    });
    y += 13.5 * s;
  }
  y += 22 * s;
  k.text('Owner:', L, y - 11, T, 10.5);
  k.field(L + 36, 270, y, '(Print Name of Owner)', owner ? owner.name : '');
  k.text('Owner:', 278, y - 11, T, 10.5);
  k.x(316, y - 13);
  k.field(326, 480, y, '(Owner Sign Here)');
  k.sig(owner, 326, 480, y);
  k.field(488, R, y, '(Date)', f.date(sigDay(owner)), { size: 8.5, align: 'center' });
  return y + 12;
}

// ======================= ATTACHMENT =======================
function attachmentPage(doc, k, company, order, ctx) {
  const o = order;
  let y = 30;
  k.center('ATTACHMENT A', y, TB, 15); y += 18;
  k.center(`to Home Improvement Contract ${o.number || ''} between ${company.name} and ${[o.ownerName, o.owner2Name].filter(Boolean).join(' & ')}`, y, T, 10); y += 22;
  if (ctx.descLines.rest.length) {
    k.text('DESCRIPTION OF THE PROJECT (continued)', L, y, TB, 11); y += 32;
    ctx.descLines.rest.forEach((line) => {
      if (y > BOTTOM - 20) { footer(doc, k, company, o, 'A'); doc.addPage(); frame(doc, company); y = 40; }
      k.hline(L, R, y); if (line) k.text(line, L + 3, y - 12, T, 10); y += 17;
    });
    y += 14;
  }
  if (ctx.paymentRows.extra.length) {
    k.text('SCHEDULE OF PROGRESS PAYMENTS (continued)', L, y, TB, 11); y += 20;
    k.caption('(Work or Services to be Performed or Materials to be Supplied)', 130, 470, y); k.caption('(Date)', 476, R, y); y += 22;
    ctx.paymentRows.extra.forEach((p, i) => {
      if (y > BOTTOM - 20) { footer(doc, k, company, o, 'A'); doc.addPage(); frame(doc, company); y = 40; }
      k.text(`${i + 5}. $`, L + 4, y - 11, T, 10);
      k.field(62, 124, y, null, amount(p.amount), { size: 9.5 });
      k.field(130, 470, y, null, p.description, { size: 9.5 });
      k.field(476, R, y, null, f.date(p.date) || p.date, { size: 9, align: 'center' });
      y += 18;
    });
  }
  footer(doc, k, company, o, 'A');
}

// ---------- signature certificate ----------
function certificatePage(doc, k, company, order) {
  const sigs = order.signatures || {};
  const acks = order.acks || {};
  const list = [['Owner', sigs.owner], ['Second owner', sigs.owner2], ['Contractor', sigs.contractor]].filter(([, x]) => x && x.method === 'electronic');
  if (!list.length) return;
  doc.addPage({ size: [PW, 792] });
  k.text('Electronic Signature Certificate', 50, 60, TB, 16);
  k.text(`Home Improvement Contract ${order.number || ''}  —  ${order.projectName || ''}`, 50, 84, T, 11);
  k.text(`${company.name}  ·  ${company.licenseLabel || 'Lic. #'}${company.license}`, 50, 99, T, 10);
  let y = 130;
  if (acks.initials) {
    k.text('Owner’s choices when signing', 50, y, TB, 11);
    [['Initials adopted', acks.initials], ['Age(s) affirmed', acks.ages],
      ['Right to cancel', acks.rightToCancel === 5 ? 'Five-Day (owner 65 or over)' : 'Three-Day'],
      ['Arbitration', acks.arbitration ? 'Agreed (initialed)' : 'Did not agree']].forEach(([a, b], i) => {
      k.text(a, 60, y + 16 + i * 14, T, 9.5, { color: '#444' });
      k.text(String(b || '—'), 170, y + 16 + i * 14, T, 9.5);
    });
    y += 85;
  }
  list.forEach(([role, s]) => {
    k.text(role, 50, y, TB, 11);
    [['Name', s.name], ['Email', s.email || '—'], ['Signed', f.dateTime(s.at)], ['IP address', s.ip || '—'], ['Device', (s.userAgent || '—').slice(0, 60)]]
      .forEach(([a, b], i) => {
        k.text(a, 60, y + 16 + i * 14, T, 9.5, { color: '#444' });
        k.text(String(b), 170, y + 16 + i * 14, T, 9.5);
      });
    const img = dataUrlToBuffer(s.image);
    if (img) { try { doc.image(img, 400, y + 10, { fit: [160, 50] }); } catch (_) { /* ignore */ } }
    y += 100;
  });
  doc.font(T).fontSize(9).fillColor('#444').text(
    'Each signer above reviewed this contract and its attached notices online and agreed to sign electronically. Electronic signatures are legally binding under the federal ESIGN Act and the California Uniform Electronic Transactions Act.',
    50, y + 5, { width: 512 },
  );
}

// ---------- main ----------
function buildContractPdf(order, company, settings = {}) {
  return new Promise((resolve, reject) => {
    const doc = newDoc(company, order);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Pre-compute description lines and payment rows.
    const k0 = kit(doc);
    doc.font(T).fontSize(10);
    const firstW = R - (L + doc.widthOfString('construct and complete in a good, workmanlike and substantial manner a:') + 4) - 6;
    const wrapAll = (text, width) => {
      const out = [];
      String(text || '').replace(/\r/g, '').split('\n').forEach((para) => {
        if (!para.trim()) { out.push(''); return; }
        let line = '';
        para.split(/\s+/).forEach((word) => {
          const test = line ? `${line} ${word}` : word;
          if (doc.widthOfString(test) <= width) line = test; else { if (line) out.push(line); line = word; }
        });
        out.push(line);
      });
      while (out.length && out[out.length - 1] === '') out.pop();
      return out;
    };
    // first line is shorter
    const words = wrapAll(order.description, W - 6);
    let first = [];
    const allText = String(order.description || '');
    const firstLine = wrapAll(allText.split('\n')[0], firstW)[0] || '';
    first = [firstLine];
    const remainingText = allText.slice(allText.indexOf(firstLine) + firstLine.length).replace(/^\s/, '');
    const restLines = wrapAll(remainingText, W - 6);
    let p1Lines = first.concat(restLines.slice(0, 5));
    let rest = restLines.slice(5);
    if (rest.length) { p1Lines = first.concat(restLines.slice(0, 4), ['(continued on Attachment A)']); rest = restLines.slice(4); }
    void words; void k0;

    const pays = (order.payments || []).filter((p) => p && (p.amount || p.description || p.date));
    let rows = pays.slice(0, 5);
    let extra = [];
    if (pays.length > 5) { rows = pays.slice(0, 4).concat([{ description: `(Payments 5–${pays.length} continued on Attachment A)`, more: true }]); extra = pays.slice(4); }
    rows.extra = extra;

    const fee = order.changeOrderFee && String(order.changeOrderFee) !== '20' ? String(order.changeOrderFee).replace(/%/g, '') : '';
    const ctx = {
      order, company, settings, fee,
      descLines: { page1: p1Lines, rest },
      paymentRows: rows,
      hasAttachment: rest.length > 0 || extra.length > 0,
    };

    // Page 1
    doc.addPage(); frame(doc, company);
    const k = kit(doc);
    page1(doc, k, company, order, ctx);
    footer(doc, k, company, order, 1);

    // Pages 2-5 (auto-fit)
    [page2, page3, page4, page5].forEach((fn, i) => {
      const s = fitScale(company, order, ctx, fn);
      doc.addPage(); frame(doc, company);
      fn(doc, kit(doc), s, ctx);
      footer(doc, k, company, order, i + 2);
    });

    if (ctx.hasAttachment) { doc.addPage(); frame(doc, company); attachmentPage(doc, kit(doc), company, order, ctx); }
    certificatePage(doc, kit(doc), company, order);
    doc.end();
  });
}

module.exports = { buildContractPdf, addBusinessDays };
