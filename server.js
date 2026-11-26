require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');

const store = require('./lib/store');
const views = require('./lib/views');
const notify = require('./lib/notify');
const reminders = require('./lib/reminders');
const ctx = require('./lib/context');
const calc = require('./lib/invoices');
const reviews = require('./lib/reviews');
const f = require('./lib/format');
const { buildPdf } = require('./lib/pdf');
const { buildContractPdf } = require('./lib/pdf-contract');

const company = require('./config/company.json');
const PORT = Number(process.env.PORT || 3000);
// On Render, RENDER_EXTERNAL_URL is set automatically, so APP_URL is optional there.
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD is not set. Set it in .env before putting this online.');
}

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
// One log line per request (shows up in Render's Logs tab).
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    const p = req.path.replace(/^\/s\/[^/]+/, '/s/…'); // hide customers' private links
    console.log(`${req.method} ${p} ${res.statusCode} ${Date.now() - t}ms`);
  });
  next();
});
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieSession({
  name: 'onyx_session',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  maxAge: 30 * 24 * 60 * 60 * 1000,
  sameSite: 'lax',
  httpOnly: true,
}));
// Versioned links (?v=…) can be cached long; the version changes with every update.
// Who is logged in: the owner (ADMIN_PASSWORD) or a team member.
app.use((req, res, next) => {
  let user = null;
  if (req.session && req.session.admin) {
    user = { id: 'owner', role: 'owner', name: 'Owner', email: process.env.NOTIFY_EMAIL || company.email };
  } else if (req.session && req.session.userId) {
    const u = store.getUser(req.session.userId);
    if (u) user = { id: u.id, role: 'member', name: u.name, email: u.email };
    else req.session.userId = null;
  }
  req.user = user;
  ctx.run({ user }, next);
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => res.setHeader('Cache-Control', /\.(css|js)$/.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'),
}));
app.use('/fonts', express.static(path.join(__dirname, 'assets', 'fonts'), { maxAge: '7d' }));

// ---------- helpers ----------
const html = (res, body, status = 200) => res.status(status).type('html').send(body);
const signLink = (o) => `${APP_URL}/s/${o.token}`;
const takeFlash = (req) => { const fl = req.session.flash; req.session.flash = null; return fl; };
const setFlash = (req, text, type = 'ok') => { req.session.flash = { text, type }; };
const isContract = (o) => o && o.type === 'hic';
// "Change Order #1001" or "Home Improvement Contract HIC-1001"
const docTitle = (o) => (isContract(o) ? `Home Improvement Contract ${o.number}` : `Change Order #${o.number}`);
const docWord = (o) => (isContract(o) ? 'contract' : 'change order');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const initialsOf = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 4);

function contractSettings() {
  const s = store.getSettings();
  return {
    contractorInitials: s.contractorInitials || initialsOf(s.contractorSignerName),
    insuranceCompany: s.insuranceCompany || company.insurance?.cglCompany || '',
    insurancePhone: s.insurancePhone || company.insurance?.phone || '',
    cglOption: s.cglOption || 'B',
    wcOption: s.wcOption || 'B',
  };
}
// Certificate of insurance goes out with every contract email.
function insuranceAttachment(order) {
  const file = company.insurance?.certificateFile && path.join(__dirname, company.insurance.certificateFile);
  if (!isContract(order) || !file || !fs.existsSync(file)) return [];
  return [{ filename: 'Onyx-Certificate-of-Insurance.pdf', path: file }];
}
const buildDoc = (order) => (isContract(order) ? buildContractPdf(order, company, contractSettings()) : buildPdf(order, company));

function requireLogin(req, res, next) {
  if (req.user) return next();
  return res.redirect('/login');
}
function requireOwner(req, res, next) {
  if (req.user && req.user.role === 'owner') return next();
  if (req.user) return res.redirect('/');
  return res.redirect('/login');
}
const isOwner = (req) => Boolean(req.user && req.user.role === 'owner');
// Team members only see the documents they created.
const canSee = (req, o) => isOwner(req) || (o && o.createdBy === req.user.id);
const visibleOrders = (req) => store.listOrders().filter((o) => canSee(req, o));
const creator = (req) => (isOwner(req) ? {} : { createdBy: req.user.id, createdByName: req.user.name });

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const ORDER_FIELDS = [
  'number', 'date', 'contractDate', 'projectName', 'copyFor', 'contractId', 'customerId',
  'ownerName', 'owner2Name', 'ownerAddress', 'ownerCityStateZip', 'ownerPhone', 'ownerFax', 'ownerEmail',
  'subcontractors', 'description', 'priceDirection', 'amount', 'timeDirection', 'days',
];

function readOrderForm(body) {
  const o = {};
  ORDER_FIELDS.forEach((k) => { o[k] = String(body[k] ?? '').trim(); });
  o.description = String(body.description ?? '').replace(/\r\n/g, '\n').trim();
  const amt = f.parseMoney(o.amount);
  o.amount = amt === null ? '' : String(Math.abs(amt));
  o.days = o.days ? String(Math.abs(parseInt(o.days, 10) || 0)) : '';
  if (!['increase', 'decrease', 'none'].includes(o.priceDirection)) o.priceDirection = 'increase';
  if (!['extend', 'reduce', 'none'].includes(o.timeDirection)) o.timeDirection = 'none';
  if (!['yes', 'no'].includes(o.subcontractors)) o.subcontractors = '';
  if (!['owner', 'architect', 'contractor', 'field', 'other'].includes(o.copyFor)) o.copyFor = '';
  return o;
}

function validate(o) {
  if (!o.number) return 'Please enter a change order number.';
  if (!o.projectName) return 'Please enter the project name.';
  if (!o.ownerName) return 'Please enter the owner’s name.';
  if (!o.description) return 'Please describe the work.';
  if (o.priceDirection !== 'none' && !Number(o.amount)) return 'Please enter the amount, or choose “No change”.';
  if (o.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.ownerEmail)) return 'The owner’s email address doesn’t look right. Please check it.';
  if (o.timeDirection !== 'none' && !Number(o.days)) return 'Please enter the number of days, or choose “No change”.';
  return null;
}

// ---------- home improvement contracts ----------
const CONTRACT_FIELDS = [
  'number', 'date', 'projectName', 'customerId',
  'ownerName', 'owner2Name', 'ownerAddress', 'ownerCityStateZip', 'ownerPhone', 'ownerFax', 'ownerEmail',
  'workAddress', 'workCityStateZip', 'lender', 'description', 'commencement', 'startDate', 'completionDate',
  'contractPrice', 'downPayment', 'financeCharge', 'allowances', 'changeOrderFee', 'salesmanName', 'salesmanReg',
];
const asList = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

function readContractForm(body) {
  const o = { type: 'hic' };
  CONTRACT_FIELDS.forEach((k) => { o[k] = String(body[k] ?? '').trim(); });
  o.description = String(body.description ?? '').replace(/\r\n/g, '\n').trim();
  const money = (v) => { const n = f.parseMoney(v); return n === null ? '' : String(Math.abs(n)); };
  o.contractPrice = money(o.contractPrice);
  o.downPayment = /^none$/i.test(o.downPayment) || !o.downPayment ? 'none' : money(o.downPayment);
  o.financeCharge = /^none$/i.test(o.financeCharge) || !o.financeCharge ? 'none' : money(o.financeCharge);
  o.changeOrderFee = String(parseFloat(o.changeOrderFee) || 20);
  if (!o.lender) o.lender = 'none';
  const amts = asList(body.payAmount), descs = asList(body.payDesc), dates = asList(body.payDate);
  o.payments = amts.map((a, i) => ({ amount: money(a), description: String(descs[i] || '').trim(), date: String(dates[i] || '').trim() }))
    .filter((p) => p.amount || p.description || p.date);
  if (!o.projectName) o.projectName = o.workAddress || o.ownerName;
  return o;
}

function validateContract(o) {
  if (!o.ownerName) return 'Please enter the property owner’s name.';
  if (!o.workAddress) return 'Please enter the address where the work will be performed.';
  if (!o.description) return 'Please describe the project and significant materials.';
  if (!Number(o.contractPrice)) return 'Please enter the contract price.';
  if (o.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.ownerEmail)) return 'The owner’s email address doesn’t look right. Please check it.';
  const price = Number(o.contractPrice);
  const down = o.downPayment === 'none' ? 0 : Number(o.downPayment) || 0;
  const maxDown = Math.min(1000, price * 0.1);
  if (down > maxDown + 0.001) return `The down payment can’t be more than ${f.money(maxDown)} (the lesser of $1,000 or 10% of the contract price).`;
  if (o.payments.some((p) => !p.amount || !p.description)) return 'Each progress payment needs an amount and a description of the work.';
  return null;
}

// Warnings (not errors) shown on the contract page.
function contractWarnings(o) {
  if (!isContract(o)) return [];
  const w = [];
  const price = Number(o.contractPrice) || 0;
  const down = o.downPayment === 'none' ? 0 : Number(o.downPayment) || 0;
  const sum = (o.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0) + down;
  if (Math.abs(sum - price) > 0.009) w.push(`Down payment plus progress payments add up to ${f.money(sum)}, but the contract price is ${f.money(price)}.`);
  if (!(o.payments || []).length) w.push('No schedule of progress payments has been entered.');
  if (!o.startDate || !o.completionDate) w.push('The approximate start and completion dates are missing.');
  return w;
}

// Payment figures for the dashboard (collected uses the payment date's year).
function moneyStats(req, yearParam) {
  const year = String(yearParam || f.todayISO().slice(0, 4));
  const invs = store.listInvoices().filter((i) => isOwner(req) || i.createdBy === req.user.id);
  let collected = 0, outstanding = 0, overdue = 0, overdueCount = 0, releases = 0;
  invs.forEach((inv) => {
    const sm = calc.summary(inv);
    (inv.payments || []).forEach((p) => {
      if (String(p.date).slice(0, 4) === year) collected += Number(p.amount) || 0;
      if (!p.release || !p.release.signedAt) releases += 1;
    });
    if (['unpaid', 'partial', 'overdue'].includes(sm.status)) outstanding += sm.balance;
    if (sm.status === 'overdue') { overdue += sm.balance; overdueCount += 1; }
  });
  return { year, collected: calc.cents(collected), outstanding: calc.cents(outstanding), overdue: calc.cents(overdue), overdueCount, releases, count: invs.length };
}

// Contracts a change order can be linked to (with owner info to prefill the form).
function contractChoices(req) {
  return visibleOrders(req).filter((o) => o.type === 'hic').map((o) => ({
    id: o.id, number: o.number, projectName: o.projectName, ownerName: o.ownerName, owner2Name: o.owner2Name,
    ownerAddress: o.ownerAddress, ownerCityStateZip: o.ownerCityStateZip, ownerPhone: o.ownerPhone, ownerEmail: o.ownerEmail,
    contractDate: o.signatures && o.signatures.owner ? o.signatures.owner.at.slice(0, 10) : o.date,
  }));
}

const CUSTOMER_KEYS = ['ownerName', 'owner2Name', 'ownerAddress', 'ownerCityStateZip', 'ownerPhone', 'ownerEmail', 'workAddress', 'workCityStateZip'];
const canSeeCustomer = (req, c) => c && (isOwner(req) || c.createdBy === req.user.id);
// Saved customers this person can pick from (shape matches the form field names).
function pastCustomers(req) {
  return store.listCustomers().filter((c) => canSeeCustomer(req, c))
    .map((c) => ({ id: c.id, ...Object.fromEntries(CUSTOMER_KEYS.map((k) => [k, c[k] || ''])) }));
}
// After a contract/change order form: keep a valid chosen customer, or save a new one.
function attachCustomer(req, fields) {
  const chosen = store.getCustomer(fields.customerId);
  if (chosen && canSeeCustomer(req, chosen)) return fields;
  fields.customerId = '';
  if (req.body.saveCustomer === '1' && fields.ownerName) {
    const c = store.createCustomer({ ...Object.fromEntries(CUSTOMER_KEYS.map((k) => [k, fields[k] || ''])), ...creator(req) });
    fields.customerId = c.id;
  }
  return fields;
}
// Prefill a new document from ?customer=ID.
function customerPrefill(req) {
  const c = store.getCustomer(req.query.customer);
  if (!canSeeCustomer(req, c)) return {};
  return { customerId: c.id, ...Object.fromEntries(CUSTOMER_KEYS.map((k) => [k, c[k] || ''])) };
}

async function pdfFor(order) {
  // Once the owner has signed, serve the frozen signed copy.
  if (order.signedPdf && fs.existsSync(store.pdfPath(order.signedPdf))) {
    return fs.readFileSync(store.pdfPath(order.signedPdf));
  }
  return buildDoc(order);
}

function pdfName(order) {
  const proj = (order.projectName || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  const base = isContract(order) ? `Home-Improvement-Contract-${order.number}` : `Change-Order-${order.number}`;
  return `${base}${proj ? `-${proj}` : ''}${order.signatures?.owner ? '-SIGNED' : ''}.pdf`;
}

function applyContractorSignature(order, method = 'stored') {
  const s = store.getSettings();
  if (!s.contractorSignature || order.signatures?.contractor) return false;
  order.signatures = {
    ...(order.signatures || {}),
    contractor: { name: s.contractorSignerName || '', image: s.contractorSignature, at: new Date().toISOString(), method },
  };
  store.updateOrder(order.id, { signatures: order.signatures });
  store.addEvent(order.id, 'contractor_signed', `Signed by contractor (${s.contractorSignerName || 'contractor'})`);
  return true;
}

async function freezeSignedPdf(order) {
  const buf = await buildDoc(order);
  const name = `${order.id}-signed-${Date.now()}.pdf`;
  fs.writeFileSync(store.pdfPath(name), buf);
  store.updateOrder(order.id, { signedPdf: name });
  return buf;
}

app.get('/healthz', (req, res) => res.type('text').send('ok'));

// ---------- auth ----------
app.get('/login', (req, res) => html(res, views.login({ company })));
// Slow down password guessing: 10 failed tries per address per 15 minutes.
const failures = new Map();
app.post('/login', (req, res) => {
  const key = req.ip;
  const rec = failures.get(key) || { n: 0, at: Date.now() };
  if (Date.now() - rec.at > 15 * 60 * 1000) { rec.n = 0; rec.at = Date.now(); }
  if (rec.n >= 10) return html(res, views.login({ company, error: 'Too many tries. Wait 15 minutes and try again.' }), 429);
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const member = username ? store.getUserByUsername(username) : null;
  if (member && store.checkPassword(member, password)) {
    failures.delete(key);
    req.session.admin = false;
    req.session.userId = member.id;
    return res.redirect('/dashboard');
  }
  if (!member && ADMIN_PASSWORD && safeEqual(password, ADMIN_PASSWORD)) {
    failures.delete(key);
    req.session.userId = null;
    req.session.admin = true;
    return res.redirect('/dashboard');
  }
  rec.n += 1; failures.set(key, rec);
  return html(res, views.login({ company, username, error: ADMIN_PASSWORD ? 'Wrong username or password.' : 'Set ADMIN_PASSWORD in the .env file first.' }), 401);
});
app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

// ---------- admin ----------
app.get('/dashboard', requireLogin, async (req, res) => {
  const rv = await reviews.getReviews().catch(() => ({ configured: false }));
  const me = isOwner(req) ? null : store.getUser(req.user.id);
  html(res, views.dashboard({ company, orders: visibleOrders(req), money: moneyStats(req, req.query.year), team: isOwner(req) ? store.listUsers() : [me].filter(Boolean), flash: takeFlash(req), year: req.query.year, settings: store.getSettings(), reviews: rv }));
});

app.get('/', requireLogin, (req, res) => {
  html(res, views.documentsPage({ company, orders: visibleOrders(req), flash: takeFlash(req), filter: req.query.status || '' }));
});

app.get('/leads', requireLogin, (req, res) => res.redirect('/customers'));

app.get('/estimates', requireLogin, (req, res) => html(res, views.comingSoon({
  company, active: 'estimates', title: 'Estimates',
  lead: 'Build and send professional estimates, then convert approved ones into contracts.',
  items: ['Line items with materials and labor', 'Send for approval by email', 'Approved estimate → Home Improvement Contract'],
})));

app.get('/new', requireLogin, (req, res) => html(res, views.newChooser({ company })));

app.get('/contracts/new', requireLogin, (req, res) => {
  const s = store.getSettings();
  const order = {
    type: 'hic', number: store.peekNextNumber('hic'), date: f.todayISO(), lender: 'none', downPayment: '', financeCharge: 'none',
    changeOrderFee: '20', commencement: s.defaultCommencement || 'Delivery of materials or start of work at the job site',
    salesmanName: s.salesmanName || '', salesmanReg: s.salesmanReg || '', payments: [],
    ...customerPrefill(req),
    // A team member's own salesperson registration goes on their contracts.
    ...(!isOwner(req) && store.getUser(req.user.id)?.hisNumber ? { salesmanName: req.user.name, salesmanReg: store.getUser(req.user.id).hisNumber } : {}),
  };
  html(res, views.contractForm({ company, order, isNew: true, pastCustomers: pastCustomers(req) }));
});

app.post('/contracts', requireLogin, (req, res) => {
  const fields = readContractForm(req.body);
  const err = validateContract(fields);
  if (err) { console.log(`New contract not saved: ${err}`); return html(res, views.contractForm({ company, order: fields, isNew: true, pastCustomers: pastCustomers(req), error: err }), 400); }
  const order = store.createOrder({ ...attachCustomer(req, fields), ...creator(req) });
  setFlash(req, `Contract ${order.number} saved. Review it, then send it to the customer.`);
  res.redirect(`/orders/${order.id}`);
});

app.get('/orders/new', requireLogin, (req, res) => {
  const order = {
    number: store.peekNextNumber(), date: f.todayISO(), copyFor: 'owner', priceDirection: 'increase', timeDirection: 'none', subcontractors: 'no',
    ...customerPrefill(req),
  };
  html(res, views.orderForm({ company, contracts: contractChoices(req), order, isNew: true, pastCustomers: pastCustomers(req) }));
});

app.post('/orders', requireLogin, (req, res) => {
  const fields = readOrderForm(req.body);
  const err = validate(fields);
  if (err) { console.log(`New change order not saved: ${err}`); return html(res, views.orderForm({ company, contracts: contractChoices(req), order: fields, isNew: true, pastCustomers: pastCustomers(req), error: err }), 400); }
  const order = store.createOrder({ ...attachCustomer(req, fields), ...creator(req) });
  setFlash(req, `Change order #${order.number} saved. Review it, then send it to the customer.`);
  res.redirect(`/orders/${order.id}`);
});

function loadOrder(req, res, next) {
  const order = store.getOrder(req.params.id);
  if (!order || !canSee(req, order)) return html(res, views.notFound({ company }), 404);
  req.order = order;
  next();
}

app.get('/orders/:id', requireLogin, loadOrder, (req, res) => {
  html(res, views.orderDetail({
    company, order: req.order, settings: store.getSettings(),
    emailReady: notify.emailConfigured(),
    signLink: signLink(req.order), flash: takeFlash(req), warnings: contractWarnings(req.order),
    ledger: isContract(req.order) ? { ...calc.contractLedger(req.order), invoiceRows: calc.contractLedger(req.order).invoices.map((i) => ({ inv: i, sm: calc.summary(i) })) } : null,
  }));
});

app.get('/orders/:id/edit', requireLogin, loadOrder, (req, res) => {
  if (req.order.signatures?.owner) return res.redirect(`/orders/${req.order.id}`);
  const form = isContract(req.order) ? views.contractForm : views.orderForm;
  html(res, form({ company, contracts: contractChoices(req), order: req.order, isNew: false, pastCustomers: pastCustomers(req) }));
});

app.post('/orders/:id', requireLogin, loadOrder, (req, res) => {
  if (req.order.signatures?.owner) { setFlash(req, `Signed ${docWord(req.order)}s can’t be edited.`, 'error'); return res.redirect(`/orders/${req.order.id}`); }
  const contract = isContract(req.order);
  const fields = contract ? readContractForm(req.body) : readOrderForm(req.body);
  const err = contract ? validateContract(fields) : validate(fields);
  const form = contract ? views.contractForm : views.orderForm;
  if (err) return html(res, form({ company, contracts: contractChoices(req), order: { ...req.order, ...fields }, isNew: false, pastCustomers: pastCustomers(req), error: err }), 400);
  // Editing invalidates a contractor signature made on the old version.
  const signatures = { ...(req.order.signatures || {}) };
  delete signatures.contractor;
  attachCustomer(req, fields);
  store.updateOrder(req.order.id, { ...fields, signatures });
  store.addEvent(req.order.id, 'edited', `${cap(docWord(req.order))} edited`);
  setFlash(req, 'Changes saved.');
  res.redirect(`/orders/${req.order.id}`);
});

app.get('/orders/:id/pdf', requireLogin, loadOrder, async (req, res, next) => {
  try {
    const buf = await pdfFor(req.order);
    res.type('pdf').set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pdfName(req.order)}"`).send(buf);
  } catch (e) { next(e); }
});

app.post('/orders/:id/duplicate', requireLogin, loadOrder, (req, res) => {
  const src = req.order;
  const copy = {};
  if (isContract(src)) {
    CONTRACT_FIELDS.forEach((k) => { copy[k] = src[k]; });
    copy.type = 'hic';
    copy.payments = (src.payments || []).map((p) => ({ ...p }));
    copy.number = store.peekNextNumber('hic');
  } else {
    ORDER_FIELDS.forEach((k) => { copy[k] = src[k]; });
    copy.number = store.peekNextNumber();
  }
  copy.date = f.todayISO();
  const order = store.createOrder({ ...copy, ...creator(req) });
  setFlash(req, `Copied into new ${docWord(order)} ${isContract(order) ? '' : '#'}${order.number}. Edit the details before sending.`);
  res.redirect(`/orders/${order.id}/edit`);
});

app.post('/orders/:id/contractor-sign', requireOwner, loadOrder, (req, res) => {
  if (applyContractorSignature(req.order)) setFlash(req, 'Signed as contractor.');
  else setFlash(req, 'Save your signature in Settings first.', 'error');
  res.redirect(`/orders/${req.order.id}`);
});

app.post('/orders/:id/send', requireLogin, loadOrder, async (req, res) => {
  const order = req.order;
  const email = String(req.body.email || '').trim();
  const note = String(req.body.note || '').trim();
  if (!email) { setFlash(req, 'Enter the customer’s email address.', 'error'); return res.redirect(`/orders/${order.id}`); }

  const settings = store.getSettings();
  // The saved contractor signature is the owner's; team members' documents are signed by the owner.
  if (isOwner(req) && settings.autoSign !== false) applyContractorSignature(order);

  const link = signLink(order);
  const results = [];
  const errors = [];

  {
    try {
      const pdf = await buildDoc(store.getOrder(order.id));
      const greeting = `Hi ${order.ownerName.split(' ')[0] || ''},`.replace(' ,', ',');
      const intro = `${company.name} has sent you ${docTitle(order)} for ${order.projectName} to review and sign.`;
      const text = [greeting, '', intro, note && `\n${note}\n`, `Review and sign here: ${link}`, '',
        isContract(order) ? 'The contract and our certificate of insurance are attached.' : 'A PDF copy is attached.', '', company.name, company.phone, company.email].filter((x) => x !== false && x !== undefined).join('\n');
      const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#16202e;max-width:560px">
        <p>${views.esc(greeting)}</p>
        <p>${views.esc(intro)}</p>
        ${note ? `<p style="white-space:pre-wrap">${views.esc(note)}</p>` : ''}
        <p style="margin:24px 0"><a href="${views.esc(link)}" style="background:#082a56;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Review &amp; sign</a></p>
        <p>${isContract(order) ? 'The contract and our certificate of insurance are attached.' : 'A PDF copy is attached.'}</p>
        <p style="color:#5d6878">${views.esc(company.name)}<br>${views.esc(company.phone)}<br>${views.esc(company.email)}<br>CSLB Lic. #${views.esc(company.license)}</p></div>`;
      await notify.sendEmail({
        to: email,
        subject: `${docTitle(order)} – ${order.projectName} – please review & sign`,
        text, html: htmlBody, replyTo: company.email,
        attachments: [{ filename: pdfName(order), content: pdf }, ...insuranceAttachment(order)],
      });
      store.addEvent(order.id, 'sent_email', `Emailed to ${email}`);
      results.push(`emailed to ${email}`);
    } catch (e) { errors.push(`Email: ${e.message}`); }
  }

  const patch = {};
  if (results.length && ['draft'].includes(store.getOrder(order.id).status)) patch.status = 'sent';
  if (email) patch.ownerEmail = email;
  store.updateOrder(order.id, patch);

  if (errors.length) setFlash(req, (results.length ? `Sent: ${results.join(', ')}. ` : '') + errors.join(' '), 'error');
  else setFlash(req, `${cap(docWord(order))} ${results.join(' and ')}.`);
  res.redirect(`/orders/${order.id}`);
});

app.post('/orders/:id/delete', requireLogin, loadOrder, (req, res) => {
  store.deleteOrder(req.order.id);
  setFlash(req, `${docTitle(req.order)} deleted.`);
  res.redirect('/');
});

app.get('/settings', requireOwner, (req, res) => {
  html(res, views.settingsPage({
    company, settings: store.getSettings(), emailReady: notify.emailConfigured(), users: store.listUsers(),
    appUrl: APP_URL, flash: takeFlash(req),
  }));
});

// ---------- team ----------
app.post('/settings/users', requireOwner, (req, res) => {
  const name = String(req.body.name || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  let err = null;
  if (!name) err = 'Enter the person’s name.';
  else if (!/^[a-z0-9._-]{3,30}$/.test(username)) err = 'Usernames are 3–30 letters or numbers, no spaces.';
  else if (store.getUserByUsername(username)) err = `The username “${username}” is taken.`;
  else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err = 'That email address doesn’t look right.';
  else if (password.length < 8) err = 'Passwords need at least 8 characters.';
  if (err) setFlash(req, err, 'error');
  else {
    const u = store.createUser({ name, username, email, password });
    store.updateUser(u.id, hisFields(req.body));
    setFlash(req, `${name} added. They log in with username “${username}”.`);
  }
  res.redirect('/settings#team');
});

const hisFields = (body) => ({
  hisNumber: String(body.hisNumber || '').trim().slice(0, 30),
  hisExpires: /^\d{4}-\d{2}-\d{2}$/.test(String(body.hisExpires || '')) ? String(body.hisExpires) : '',
});

app.post('/settings/users/:uid', requireOwner, (req, res) => {
  const u = store.getUser(req.params.uid);
  const email = String(req.body.email || '').trim();
  if (!u) setFlash(req, 'That person wasn’t found.', 'error');
  else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) setFlash(req, 'That email address doesn’t look right.', 'error');
  else {
    store.updateUser(u.id, { email, ...hisFields(req.body) });
    setFlash(req, `${u.name}’s details saved.`);
  }
  res.redirect('/settings#team');
});

app.post('/settings/users/:uid/password', requireOwner, (req, res) => {
  const u = store.getUser(req.params.uid);
  const password = String(req.body.password || '');
  if (!u) setFlash(req, 'That person wasn’t found.', 'error');
  else if (password.length < 8) setFlash(req, 'Passwords need at least 8 characters.', 'error');
  else { store.updateUser(u.id, { password }); setFlash(req, `Password changed for ${u.name}.`); }
  res.redirect('/settings#team');
});

app.post('/settings/users/:uid/delete', requireOwner, (req, res) => {
  const u = store.getUser(req.params.uid);
  if (u) { store.deleteUser(u.id); setFlash(req, `${u.name} removed. Their documents stay in your list.`); }
  res.redirect('/settings#team');
});

// Backup: everything on the data disk (records + signed PDFs) as one .zip.
app.get('/settings/backup', requireOwner, (req, res) => {
  const b = require('./lib/backup').buildBackup(company);
  store.updateSettings({ lastBackupAt: new Date().toISOString() });
  res.type('application/zip').set('Content-Disposition', `attachment; filename="${b.filename}"`).send(b.buffer);
});

app.post('/settings/backup/email', requireOwner, async (req, res) => {
  const to = process.env.NOTIFY_EMAIL || company.email;
  try {
    await require('./lib/backup').emailBackup(company, to);
    setFlash(req, `Backup emailed to ${to}.`);
  } catch (e) { setFlash(req, `Couldn’t email the backup: ${e.message}`, 'error'); }
  res.redirect('/settings#backup');
});

app.post('/settings/backup/weekly', requireOwner, (req, res) => {
  const on = req.body.weeklyBackup === '1';
  store.updateSettings({ weeklyBackup: on });
  setFlash(req, on ? 'Weekly backup email is on (Sundays, 7 AM).' : 'Weekly backup email is off.');
  res.redirect('/settings#backup');
});

app.post('/settings/refresh-reviews', requireOwner, async (req, res) => {
  const rv = await reviews.getReviews({ force: true });
  if (!rv.configured) setFlash(req, 'Add your Google Place ID in Settings and GOOGLE_PLACES_API_KEY in Render first.', 'error');
  else if (rv.error) setFlash(req, `Google reviews: ${rv.error}`, 'error');
  else setFlash(req, `Google reviews updated: ${rv.rating ?? '—'} stars, ${rv.count} reviews${rv.name ? ` (${rv.name})` : ''}.`);
  res.redirect('/settings#google');
});

app.post('/settings/test-reminder', requireOwner, async (req, res) => {
  const to = process.env.NOTIFY_EMAIL || company.email;
  try {
    const lines = reminders.renewalList(company, store.getSettings()).filter((r) => r.date)
      .map((r) => `• ${r.label}: ${f.date(r.date)} (${reminders.daysLeft(r.date)} days left)`);
    await notify.sendEmail({ to, subject: 'Test: Onyx CRM renewal reminders', text: `Renewal reminders are working. You'll get emails 60, 30, 7 and 1 days before each date, on the day, and if one lapses.\n\n${lines.join('\n')}` });
    setFlash(req, `Test reminder sent to ${to}.`);
  } catch (e) { setFlash(req, `Couldn’t send the test: ${e.message}`, 'error'); }
  res.redirect('/settings#renewals');
});

app.post('/settings', requireOwner, async (req, res) => {
  const str = (k) => String(req.body[k] || '').trim();
  const patch = {
    contractorSignerName: str('contractorSignerName'),
    autoSign: req.body.autoSign === '1',
    contractorInitials: str('contractorInitials').toUpperCase().slice(0, 4),
    insuranceCompany: str('insuranceCompany'),
    insurancePhone: str('insurancePhone'),
    cglOption: ['A', 'B', 'C', 'D'].includes(str('cglOption')) ? str('cglOption') : 'B',
    wcOption: ['A', 'B'].includes(str('wcOption')) ? str('wcOption') : 'B',
    salesmanName: str('salesmanName'),
    salesmanReg: str('salesmanReg'),
    paymentInstructions: String(req.body.paymentInstructions || '').trim().slice(0, 600),
    payDefaults: [].concat(req.body.payDefault || []).filter((k) => require('./lib/pay-methods').METHODS.some((m) => m.key === k)),
    payMethods: Object.fromEntries(require('./lib/pay-methods').METHODS.map((m) => [m.key, String(req.body[`pm_${m.key}`] ?? '').trim().slice(0, 300)])),
    contractorSignerTitle: str('contractorSignerTitle') || 'Owner',
    cglExpires: /^\d{4}-\d{2}-\d{2}$/.test(str('cglExpires')) ? str('cglExpires') : '',
    wcExpires: /^\d{4}-\d{2}-\d{2}$/.test(str('wcExpires')) ? str('wcExpires') : '',
    licenseExpires: /^\d{4}-\d{2}-\d{2}$/.test(str('licenseExpires')) ? str('licenseExpires') : '',
  };
  const sig = String(req.body.signature || '');
  if (sig.startsWith('data:image/png;base64,')) patch.contractorSignature = sig;
  // Google listing: accept a Place ID or a Google Maps share link.
  const placeInput = str('googlePlaceId');
  let placeMsg = '';
  if (placeInput && placeInput !== store.getSettings().googlePlaceId) {
    try {
      const found = await reviews.resolvePlace(placeInput);
      patch.googlePlaceId = found.placeId;
      placeMsg = ` Google listing connected${found.name ? `: ${found.name}` : ''}.`;
    } catch (e) {
      placeMsg = ` Google listing not connected: ${e.message}`;
    }
  } else if (!placeInput) {
    patch.googlePlaceId = '';
  }
  store.updateSettings(patch);
  setFlash(req, `Settings saved.${placeMsg}`, placeMsg.includes('not connected') ? 'error' : 'ok');
  res.redirect('/settings');
});

// ---------- customer (public, via secret link) ----------
function loadByToken(req, res, next) {
  const order = store.getOrderByToken(req.params.token);
  if (!order) return html(res, views.notFound({ company }), 404);
  req.order = order;
  next();
}

app.get('/s/:token', loadByToken, (req, res) => {
  const o = req.order;
  if (!req.user && (o.status === 'sent' || o.status === 'draft')) {
    store.updateOrder(o.id, { status: 'viewed' });
    store.addEvent(o.id, 'viewed', 'Opened by customer');
  }
  res.set('Cache-Control', 'no-store');
  html(res, views.signPage({ company, order: store.getOrder(o.id), token: req.params.token }));
});

app.get('/s/:token/pdf', loadByToken, async (req, res, next) => {
  try {
    const buf = await pdfFor(req.order);
    res.type('pdf').set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pdfName(req.order)}"`).send(buf);
  } catch (e) { next(e); }
});

app.post('/s/:token/sign', loadByToken, async (req, res, next) => {
  try {
    const o = req.order;
    const who = req.body.who === 'owner2' ? 'owner2' : 'owner';
    const name = String(req.body.name || '').trim();
    const image = String(req.body.signature || '');
    const back = (error) => html(res, views.signPage({ company, order: o, token: req.params.token, error }), 400);

    if (o.status === 'declined') return back(`This ${docWord(o)} was declined.`);
    if (o.signatures?.[who]) return res.redirect(`/s/${req.params.token}`);
    if (who === 'owner2' && !o.signatures?.owner) return back('The first owner must sign first.');
    if (!name) return back('Please type your full name.');
    if (!image.startsWith('data:image/png;base64,') || image.length < 500) return back('Please sign in the box.');
    if (req.body.consent !== '1') return back('Please check the box to agree.');

    // Contract-only: initials, age(s), right to cancel, arbitration choice.
    let acks = null;
    if (isContract(o) && who === 'owner') {
      const initials = String(req.body.initials || '').trim().toUpperCase().replace(/[^A-Z.\- ]/g, '').slice(0, 5);
      const ages = String(req.body.ages || '').trim().slice(0, 40);
      const ageNums = (ages.match(/\d+/g) || []).map(Number);
      if (!initials) return back('Please type your initials.');
      if (!ageNums.length || ageNums.some((a) => a < 18 || a > 120)) return back('Please enter your age (and the other owner’s age, if any).');
      if (!['yes', 'no'].includes(req.body.arbitration)) return back('Please choose whether you agree to arbitration.');
      acks = { initials, ages, rightToCancel: ageNums.some((a) => a >= 65) ? 5 : 3, arbitration: req.body.arbitration === 'yes' };
    }

    // Optional second owner signing at the same time.
    const add2 = who === 'owner' && req.body.addOwner2 === '1';
    const name2 = String(req.body.name2 || '').trim();
    const image2 = String(req.body.signature2 || '');
    if (add2) {
      if (!name2) return back('Please type the second owner’s full name.');
      if (!image2.startsWith('data:image/png;base64,') || image2.length < 500) return back('Please have the second owner sign in their box.');
    }

    const meta = { at: new Date().toISOString(), method: 'electronic', ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300) };
    const sig = { name, image, ...meta, email: who === 'owner' ? o.ownerEmail : '' };
    const signatures = { ...(o.signatures || {}), [who]: sig };
    const patch = { signatures, status: 'signed' };
    if (acks) patch.acks = acks;
    if (who === 'owner2') patch.owner2Name = name;
    if (add2) {
      signatures.owner2 = { name: name2, image: image2, ...meta, email: '' };
      patch.owner2Name = name2;
    }
    store.updateOrder(o.id, patch);
    store.addEvent(o.id, 'signed', `Signed by ${name}${who === 'owner2' ? ' (second owner)' : ''}`);
    if (add2) store.addEvent(o.id, 'signed', `Signed by ${name2} (second owner)`);

    // Make sure the contractor signature is on the final copy if one is saved.
    const fresh = store.getOrder(o.id);
    if (store.getSettings().autoSign !== false && !fresh.createdBy) applyContractorSignature(fresh);
    const pdf = await freezeSignedPdf(store.getOrder(o.id));

    // Email copies (best effort — signing already succeeded).
    if (notify.emailConfigured()) {
      const attach = [{ filename: pdfName(store.getOrder(o.id)), content: pdf }];
      const creatorUser = o.createdBy && store.getUser(o.createdBy);
      const notifyTo = [process.env.NOTIFY_EMAIL || company.email, creatorUser && creatorUser.email].filter(Boolean).join(', ');
      notify.sendEmail({
        to: notifyTo,
        subject: `SIGNED: ${docTitle(o)} – ${o.projectName}`,
        text: `${name} signed ${docTitle(o)} (${o.projectName}) on ${f.dateTime(sig.at)}.${acks ? `\nRight to cancel: ${acks.rightToCancel}-day. Arbitration: ${acks.arbitration ? 'agreed' : 'not agreed'}.` : ''}\n\n${APP_URL}/orders/${o.id}`,
        attachments: attach,
      }).then(() => store.addEvent(o.id, 'notified', `Signed copy emailed to ${notifyTo}`))
        .catch((e) => store.addEvent(o.id, 'error', `Could not email signed copy to contractor: ${e.message}`));
      if (o.ownerEmail) {
        notify.sendEmail({
          to: o.ownerEmail,
          replyTo: company.email,
          subject: `Your signed copy – ${docTitle(o)} – ${o.projectName}`,
          text: `Thank you, ${name}. Attached is your signed copy of ${docTitle(o)}${isContract(o) ? ', including your Notice of Cancellation and the other required notices' : ''}.\n\n${company.name}\n${company.phone}\n${company.email}`,
          attachments: attach,
        }).then(() => store.addEvent(o.id, 'notified', `Signed copy emailed to ${o.ownerEmail}`))
          .catch((e) => store.addEvent(o.id, 'error', `Could not email signed copy to customer: ${e.message}`));
      }
    }
    res.redirect(`/s/${req.params.token}`);
  } catch (e) { next(e); }
});

app.post('/s/:token/decline', loadByToken, (req, res) => {
  const o = req.order;
  if (!o.signatures?.owner) {
    const reason = String(req.body.reason || '').trim().slice(0, 2000);
    store.updateOrder(o.id, { status: 'declined', declineReason: reason });
    store.addEvent(o.id, 'declined', `Declined by customer${reason ? `: “${reason}”` : ''}`);
    if (notify.emailConfigured()) {
      notify.sendEmail({
        to: [process.env.NOTIFY_EMAIL || company.email, o.createdBy && store.getUser(o.createdBy)?.email].filter(Boolean).join(', '),
        subject: `DECLINED: ${docTitle(o)} – ${o.projectName}`,
        text: `The customer declined ${docTitle(o)}.${reason ? `\n\nReason: ${reason}` : ''}\n\n${APP_URL}/orders/${o.id}`,
      }).catch(() => {});
    }
  }
  res.redirect(`/s/${req.params.token}`);
});

require('./lib/routes-places')(app, { requireLogin });

require('./lib/routes-customers')(app, {
  company, html, setFlash, takeFlash, requireLogin, isOwner, creator, canSeeCustomer, visibleOrders, CUSTOMER_KEYS,
  notFound: (res) => html(res, views.notFound({ company }), 404),
});

require('./lib/routes-invoices')(app, {
  company, html, setFlash, takeFlash, requireLogin, requireOwner, isOwner, appUrl: APP_URL,
  notFound: (res) => html(res, views.notFound({ company }), 404),
});

app.use((req, res) => html(res, views.notFound({ company }), 404));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).type('text').send('Something went wrong. Please try again.');
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Onyx CRM running at ${APP_URL} (port ${PORT})`));
  reminders.startReminders(company, APP_URL);
  require('./lib/backup').startWeeklyBackup(company);
}

module.exports = app;
