// Builds the change order PDF, laid out to match the company's standard
// paper "Contract Change Order" form, with the Onyx logo and company info
// added to the header and the job details filled in.
const path = require('path');
const PDFDocument = require('pdfkit');
const f = require('./format');

const LOGO = path.join(__dirname, '..', 'public', 'logo.png');

// Form fonts (printed text) vs. filled-in values
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const T = 'Lato';
const TB = 'Lato-Bold';
const TI = 'Lato-Italic';
const FILL = 'Lato';
const FILL_B = 'Lato-Bold';
const INK = '#000000';
const FILL_INK = '#000000'; // filled-in values

const L = 35; // left edge of content
const R = 577; // right edge of content
const DESC_LINES = 20;
const DESC_STEP = 17;

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  return m ? Buffer.from(m[1], 'base64') : null;
}

function longDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function sigDate(sig) {
  if (!sig || !sig.at) return '';
  return f.date(new Date(sig.at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
}

// Word-wrap text into lines that fit `width` (keeps blank lines from the input).
function wrap(doc, text, font, size, width) {
  doc.font(font).fontSize(size);
  const out = [];
  String(text || '').replace(/\r/g, '').split('\n').forEach((para) => {
    if (!para.trim()) { out.push(''); return; }
    let line = '';
    para.split(/\s+/).forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (doc.widthOfString(test) <= width) { line = test; return; }
      if (line) out.push(line);
      while (doc.widthOfString(word) > width) {
        let i = word.length;
        while (i > 1 && doc.widthOfString(word.slice(0, i)) > width) i--;
        out.push(word.slice(0, i));
        word = word.slice(i);
      }
      line = word;
    });
    out.push(line);
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function buildPdf(order, company) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: { Title: `Change Order #${order.number} - ${order.projectName || ''}`, Author: company.name },
    });
    doc.registerFont(T, path.join(FONT_DIR, 'Lato-Regular.ttf'));
    doc.registerFont(TB, path.join(FONT_DIR, 'Lato-Bold.ttf'));
    doc.registerFont(TI, path.join(FONT_DIR, 'Lato-Italic.ttf'));
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lic = `${company.licenseLabel || 'Lic. #'}${company.license}`;

    // ---------- drawing helpers ----------
    // Largest font size (<= size) at which `s` fits in maxW.
    const fit = (s, font, size, maxW) => {
      doc.font(font);
      while (size > 7 && doc.fontSize(size).widthOfString(s) > maxW) size -= 0.25;
      return size;
    };
    const text = (s, x, y, font, size, opts = {}) => {
      doc.font(font).fontSize(size).fillColor(opts.color || INK).text(s, x, y, { lineBreak: false, ...opts });
    };
    const hline = (x1, x2, y, w = 0.6) => {
      doc.lineWidth(w).strokeColor(INK).moveTo(x1, y).lineTo(x2, y).stroke();
    };
    const caption = (s, x1, x2, y) => {
      doc.font(T).fontSize(6).fillColor(INK).text(s, x1, y, { width: x2 - x1, align: 'center', lineBreak: false });
    };
    // A ruled blank with a centered caption under it and a value written on it.
    const field = (x1, x2, y, cap, val, opts = {}) => {
      hline(x1, x2, y);
      if (cap) caption(cap, x1, x2, y + 2);
      if (val) {
        doc.font(opts.bold ? FILL_B : FILL).fontSize(opts.size || 10).fillColor(FILL_INK)
          .text(String(val), x1 + 3, y - 13.5, { width: x2 - x1 - 6, align: opts.align || 'left', lineBreak: false, ellipsis: true });
      }
    };
    const box = (x, y, checked, size = 9) => {
      doc.lineWidth(0.8).strokeColor(INK).rect(x, y, size, size).stroke();
      if (checked) {
        doc.lineWidth(1.4).strokeColor(FILL_INK)
          .moveTo(x + 1.5, y + 1.5).lineTo(x + size - 1.5, y + size - 1.5)
          .moveTo(x + size - 1.5, y + 1.5).lineTo(x + 1.5, y + size - 1.5).stroke();
      }
    };
    // Write a run of words left to right; returns positions of keyed words.
    const run = (parts, x, y, font, size, maxW = R - x) => {
      size = fit(parts.map((p) => (typeof p === 'string' ? p : p.s)).join(''), font, size, maxW);
      doc.font(font).fontSize(size);
      const pos = {};
      parts.forEach((p) => {
        const s = typeof p === 'string' ? p : p.s;
        const w = doc.widthOfString(s);
        if (typeof p !== 'string' && p.key) pos[p.key] = { x, w };
        if (typeof p === 'string' || !p.blank) doc.fillColor(INK).text(s, x, y, { lineBreak: false });
        x += w;
      });
      pos.end = x;
      pos.size = size;
      return pos;
    };
    const circle = (x, w, y, h) => {
      doc.lineWidth(1).strokeColor(FILL_INK).ellipse(x + w / 2, y + h / 2 + 1.5, w / 2 + 2, h / 2 + 2).stroke();
    };
    const frame = () => doc.lineWidth(4).strokeColor(company.brandColor || '#082A56').rect(20, 18, 572, 752).stroke();

    // ---------- frame + header ----------
    frame();
    text('CONTRACT CHANGE ORDER', 20, 28, TB, 17, { width: 572, align: 'center', characterSpacing: 0.5 });

    const copies = [['OWNER', 'owner'], ['ARCHITECT', 'architect'], ['CONTRACTOR', 'contractor'], ['FIELD', 'field'], ['OTHER', 'other']];
    doc.font(T).fontSize(8.5);
    const copyW = copies.reduce((a, [s]) => a + 13 + doc.widthOfString(s), 0) + 12 * (copies.length - 1);
    let cx = 306 - copyW / 2;
    copies.forEach(([s, k]) => {
      box(cx, 55, order.copyFor === k);
      text(s, cx + 13, 56, T, 8.5);
      doc.font(T).fontSize(8.5);
      cx += 13 + doc.widthOfString(s) + 12;
    });


    // ---------- project / change order # / date ----------
    const D = 0;
    let y = 78 + D;
    text('PROJECT:', L, y - 3, TB, 10);
    field(L + 50, 295, y + 9, null, order.projectName);
    const co = run(['CHANGE ORDER # '], 309, y - 3, TB, 10);
    field(co.end, 468, y + 9, null, order.number, { bold: true, align: 'center' });
    text('DATE:', 476, y - 3, TB, 10);
    field(506, R, y + 9, null, f.date(order.date), { align: 'center' });

    // ---------- owner (left) and contractor (right) ----------
    const LX1 = L, LX2 = 295, RX1 = 309;
    const rows = [107, 127, 147, 167].map((v) => v + D);
    const ownerNames = [order.ownerName, order.owner2Name].filter(Boolean).join(' & ');
    field(LX1, LX2, rows[0], '(Name)', ownerNames);
    field(LX1, LX2, rows[1], '(Address)', order.ownerAddress);
    field(LX1, LX2, rows[2], '(City, State & Zip)', order.ownerCityStateZip);
    field(LX1, 200, rows[3], '(Phone)', order.ownerPhone);
    field(206, LX2, rows[3], '(FAX)', order.ownerFax);

    // Contractor info is printed permanently (not a fill-in section).
    const BW = R - RX1;
    const logoH = 42;
    const logoW = logoH * (998 / 639);
    doc.image(LOGO, RX1 + (BW - logoW) / 2, 93, { width: logoW });
    text(company.name, RX1, 138, TB, 12, { width: BW, align: 'center' });
    [
      `${company.address}, ${company.cityStateZip}`,
      [company.phone && `Phone ${company.phone}`, company.fax && `Fax ${company.fax}`, company.email].filter(Boolean).join('   \u00b7   '),
      `CSLB License #${company.license}`,
    ].forEach((line, n) => text(line, RX1, 154 + n * 12, T, fit(line, T, 9.5, BW), { width: BW, align: 'center' }));

    y = 178 + D;
    text('Email', LX1, y - 3, TB, 10);
    field(LX1 + 28, LX2, y + 9, null, order.ownerEmail);

    // ---------- subcontractor disclosure ----------
    y = 203 + D;
    const subQ = 'The following checkbox indicates whether or not a subcontractor will be used on the project:';
    text(subQ, L, y, TB, fit(subQ, TB, 11, 489 - L - 8));
    box(489, y - 1, order.subcontractors === 'yes', 11);
    text('Yes', 504, y, TB, 11);
    box(534, y - 1, order.subcontractors === 'no', 11);
    text('No', 549, y, TB, 11);
    doc.font(T).fontSize(10.5).fillColor(INK).text(
      'If yes is checked, one or more subcontractors will be used on this project, and the contractor is aware that a list ' +
      'of subcontractors is required to be provided, upon request, along with the names, contact information, license ' +
      'number, and classification of those subcontractors.',
      L, y + 17, { width: R - L, lineGap: 1.5 },
    );

    // ---------- contract date ----------
    y = 267 + D;
    const dated = run(['This contract change order modifies and amends the contract between the above named parties dated '], L, y, T, 10.5, R - L - 105);
    field(dated.end + 2, R, y + 10, null, longDate(order.contractDate), { size: 9, align: 'center' });

    // ---------- description of work (ruled lines) ----------
    const firstLine = 293 + D;
    let lines = wrap(doc, order.description, FILL, 10.5, R - L - 6);
    let overflow = [];
    if (lines.length > DESC_LINES) {
      overflow = lines.slice(DESC_LINES - 1);
      lines = lines.slice(0, DESC_LINES - 1).concat(['(continued on attached page)']);
    }
    for (let i = 0; i < DESC_LINES; i++) {
      const ly = firstLine + i * DESC_STEP;
      hline(L, R, ly);
      if (i === 0) caption('(Describe work requested)', L, R, ly + 2);
      if (lines[i]) doc.font(FILL).fontSize(10.5).fillColor(FILL_INK).text(lines[i], L + 3, ly - 14, { lineBreak: false });
    }

    // ---------- price ----------
    const B = 0;
    y = 630 + B;
    const priceParts = [
      'It is mutually agreed that the contract price is ',
      { s: 'increased', key: 'inc' }, '/', { s: 'decreased', key: 'dec' },
      ' by $ ', { s: '____________', key: 'amt', blank: true }, '  ',
      { s: 'payable', key: 'pay' }, '/', { s: 'deductible', key: 'ded' }, ' immediately',
    ];
    const pr = run(priceParts, L, y, TB, 11);
    const pSize = pr.size;
    hline(pr.amt.x, pr.amt.x + pr.amt.w, y + 10);
    const amt = Number(order.amount) || 0;
    const amtText = order.priceDirection === 'none' || !amt
      ? '0.00'
      : amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    doc.font(FILL_B).fontSize(10.5).fillColor(FILL_INK).text(amtText, pr.amt.x, y - 3, { width: pr.amt.w, align: 'center', lineBreak: false });
    if (order.priceDirection === 'increase') { circle(pr.inc.x, pr.inc.w, y, 11); circle(pr.pay.x, pr.pay.w, y, 11); }
    if (order.priceDirection === 'decrease') { circle(pr.dec.x, pr.dec.w, y, 11); circle(pr.ded.x, pr.ded.w, y, 11); }
    text(' upon completion of the work called for in this change order.', L + 6, y + 14, TB, pSize);

    // ---------- time ----------
    y = 663 + B;
    const tm = run([
      'As a result of this change order, the time for completion of the above-mentioned contract is hereby ',
      { s: 'extended', key: 'ext' }, '/', { s: 'reduced', key: 'red' }, ' by',
    ], L, y, T, 10.5);
    if (order.timeDirection === 'extend') circle(tm.ext.x, tm.ext.w, y, 10);
    if (order.timeDirection === 'reduce') circle(tm.red.x, tm.red.w, y, 10);
    const days = order.timeDirection === 'none' ? 0 : Number(order.days) || 0;
    field(L, L + 122, y + 24, null, String(days), { bold: true, align: 'center' });
    text('days.', L + 125, y + 14, T, 10.5);

    y = 696 + B;
    const inc = 'This change order is incorporated into and governed by the above-mentioned contract and is incorporated therein.';
    text(inc, L, y, TI, fit(inc, TI, 10, R - L), { width: R - L, align: 'center' });

    // ---------- signatures ----------
    const sigs = order.signatures || {};
    const placeSig = (sig, x1, x2, lineY) => {
      const img = dataUrlToBuffer(sig && sig.image);
      if (!img) return;
      try { doc.image(img, x1 + 6, lineY - 15, { fit: [x2 - x1 - 12, 14.5], align: 'center', valign: 'bottom' }); } catch (_) { /* bad image */ }
    };
    const dateOn = (sig, x1, x2, lineY) => {
      const s = sigDate(sig);
      if (s) doc.font(FILL).fontSize(7.5).fillColor(FILL_INK).text(s, x1, lineY - 11, { width: x2 - x1, align: 'center', lineBreak: false });
    };

    const r1 = 722 + B;
    field(43, 322, r1, '(Contractor’s Firm Name)');
    text(company.name, 43, r1 - 15, TB, 11, { width: 279, align: 'center' });
    text('x', 333, r1 - 11, TB, 12);
    field(345, 522, r1, '(Owner’s or Agent’s Signature)');
    placeSig(sigs.owner, 345, 522, r1);
    field(530, R, r1, '(Date)');
    dateOn(sigs.owner, 530, R, r1);

    const r2 = 744 + B;
    text('x', L, r2 - 11, TB, 12);
    field(45, 250, r2, '(Contractor’s or Agent’s Signature)');
    placeSig(sigs.contractor, 45, 250, r2);
    field(262, 322, r2, '(Date)');
    dateOn(sigs.contractor, 262, 322, r2);
    text('x', 333, r2 - 11, TB, 12);
    field(345, 522, r2, '(If More than One Owner, Please Sign Here)');
    placeSig(sigs.owner2, 345, 522, r2);
    field(530, R, r2, '(Date)');
    dateOn(sigs.owner2, 530, R, r2);

    const footer = `${company.name}  ·  ${lic}  ·  Change Order #${order.number}`;
    text(footer, 20, 776, T, 7, { width: 572, align: 'center' });

    // ---------- continuation page(s) for long descriptions ----------
    let page = 2;
    while (overflow.length) {
      doc.addPage();
      frame();
      doc.image(LOGO, 30, 26, { width: 70 });
      text('CONTRACT CHANGE ORDER', 140, 30, TB, 16, { width: 332, align: 'center' });
      text(`Change Order # ${order.number}  —  Describe work requested (continued)`, 140, 52, TB, 10, { width: 332, align: 'center' });
      const per = 38;
      const chunk = overflow.slice(0, per);
      overflow = overflow.slice(per);
      for (let i = 0; i < per; i++) {
        const ly = 100 + i * DESC_STEP;
        hline(L, R, ly);
        if (chunk[i]) doc.font(FILL).fontSize(10.5).fillColor(FILL_INK).text(chunk[i], L + 3, ly - 14, { lineBreak: false });
      }
      text(`${footer}  ·  Page ${page++}`, 20, 776, T, 7, { width: 572, align: 'center' });
    }

    // ---------- electronic signature certificate ----------
    const audit = [['Owner', sigs.owner], ['Second owner', sigs.owner2], ['Contractor', sigs.contractor]]
      .filter(([, s]) => s && s.method === 'electronic');
    if (audit.length) {
      doc.addPage();
      text('Electronic Signature Certificate', 50, 60, TB, 16);
      text(`Change Order # ${order.number}  —  ${order.projectName || ''}`, 50, 84, T, 11);
      text(`${company.name}  ·  ${lic}`, 50, 99, T, 10);
      let ay = 135;
      audit.forEach(([role, s]) => {
        text(role, 50, ay, TB, 11);
        [
          ['Name', s.name],
          ['Email / phone', [s.email, s.phone].filter(Boolean).join('  ') || '—'],
          ['Signed', f.dateTime(s.at)],
          ['IP address', s.ip || '—'],
          ['Device', (s.userAgent || '—').slice(0, 95)],
        ].forEach(([k, v], i) => {
          text(k, 60, ay + 16 + i * 14, T, 9.5, { color: '#444' });
          text(String(v), 150, ay + 16 + i * 14, T, 9.5);
        });
        const img = dataUrlToBuffer(s.image);
        if (img) { try { doc.image(img, 400, ay + 10, { fit: [160, 50] }); } catch (_) { /* ignore */ } }
        ay += 105;
      });
      doc.font(T).fontSize(9).fillColor('#444').text(
        'Each signer above reviewed this change order online and agreed to sign it electronically. ' +
        'Electronic signatures are legally binding under the federal ESIGN Act and the California Uniform Electronic Transactions Act.',
        50, ay + 5, { width: 512 },
      );
    }

    doc.end();
  });
}

module.exports = { buildPdf };
