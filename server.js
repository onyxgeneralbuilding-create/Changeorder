require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');

const store = require('./lib/store');
const views = require('./lib/views');
const notify = require('./lib/notify');
const f = require('./lib/format');
const { buildPdf } = require('./lib/pdf');

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
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/fonts', express.static(path.join(__dirname, 'assets', 'fonts'), { maxAge: '7d' }));

// ---------- helpers ----------
const html = (res, body, status = 200) => res.status(status).type('html').send(body);
const signLink = (o) => `${APP_URL}/s/${o.token}`;
const takeFlash = (req) => { const fl = req.session.flash; req.session.flash = null; return fl; };
const setFlash = (req, text, type = 'ok') => { req.session.flash = { text, type }; };

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/login');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const ORDER_FIELDS = [
  'number', 'date', 'contractDate', 'projectName',
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

function pastCustomers() {
  const seen = new Set();
  const out = [];
  store.listOrders().forEach((o) => {
    const key = `${o.ownerName}|${o.projectName}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      projectName: o.projectName, contractDate: o.contractDate,
      ownerName: o.ownerName, owner2Name: o.owner2Name, ownerAddress: o.ownerAddress,
      ownerCityStateZip: o.ownerCityStateZip, ownerPhone: o.ownerPhone, ownerFax: o.ownerFax, ownerEmail: o.ownerEmail,
    });
  });
  return out.slice(0, 50);
}

async function pdfFor(order) {
  // Once the owner has signed, serve the frozen signed copy.
  if (order.signedPdf && fs.existsSync(store.pdfPath(order.signedPdf))) {
    return fs.readFileSync(store.pdfPath(order.signedPdf));
  }
  return buildPdf(order, company);
}

function pdfName(order) {
  const proj = (order.projectName || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  return `Change-Order-${order.number}${proj ? `-${proj}` : ''}${order.signatures?.owner ? '-SIGNED' : ''}.pdf`;
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
  const buf = await buildPdf(order, company);
  const name = `${order.id}-signed-${Date.now()}.pdf`;
  fs.writeFileSync(store.pdfPath(name), buf);
  store.updateOrder(order.id, { signedPdf: name });
  return buf;
}

app.get('/healthz', (req, res) => res.type('text').send('ok'));

// ---------- auth ----------
app.get('/login', (req, res) => html(res, views.login({ company })));
app.post('/login', (req, res) => {
  if (ADMIN_PASSWORD && safeEqual(req.body.password || '', ADMIN_PASSWORD)) {
    req.session.admin = true;
    return res.redirect('/');
  }
  return html(res, views.login({ company, error: ADMIN_PASSWORD ? 'Wrong password.' : 'Set ADMIN_PASSWORD in the .env file first.' }), 401);
});
app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

// ---------- admin ----------
app.get('/', requireAdmin, (req, res) => {
  html(res, views.dashboard({ company, orders: store.listOrders(), flash: takeFlash(req), filter: req.query.status || '' }));
});

app.get('/orders/new', requireAdmin, (req, res) => {
  const order = {
    number: store.peekNextNumber(), date: f.todayISO(), priceDirection: 'increase', timeDirection: 'none', subcontractors: 'no',
  };
  html(res, views.orderForm({ company, order, isNew: true, pastCustomers: pastCustomers() }));
});

app.post('/orders', requireAdmin, (req, res) => {
  const fields = readOrderForm(req.body);
  const err = validate(fields);
  if (err) { console.log(`New change order not saved: ${err}`); return html(res, views.orderForm({ company, order: fields, isNew: true, pastCustomers: pastCustomers(), error: err }), 400); }
  const order = store.createOrder(fields);
  setFlash(req, `Change order #${order.number} saved. Review it, then send it to the customer.`);
  res.redirect(`/orders/${order.id}`);
});

function loadOrder(req, res, next) {
  const order = store.getOrder(req.params.id);
  if (!order) return html(res, views.notFound({ company }), 404);
  req.order = order;
  next();
}

app.get('/orders/:id', requireAdmin, loadOrder, (req, res) => {
  html(res, views.orderDetail({
    company, order: req.order, settings: store.getSettings(),
    emailReady: notify.emailConfigured(), smsReady: notify.smsConfigured(),
    signLink: signLink(req.order), flash: takeFlash(req),
  }));
});

app.get('/orders/:id/edit', requireAdmin, loadOrder, (req, res) => {
  if (req.order.signatures?.owner) return res.redirect(`/orders/${req.order.id}`);
  html(res, views.orderForm({ company, order: req.order, isNew: false, pastCustomers: pastCustomers() }));
});

app.post('/orders/:id', requireAdmin, loadOrder, (req, res) => {
  if (req.order.signatures?.owner) { setFlash(req, 'Signed change orders can’t be edited.', 'error'); return res.redirect(`/orders/${req.order.id}`); }
  const fields = readOrderForm(req.body);
  const err = validate(fields);
  if (err) return html(res, views.orderForm({ company, order: { ...req.order, ...fields }, isNew: false, pastCustomers: pastCustomers(), error: err }), 400);
  // Editing invalidates a contractor signature made on the old version.
  const signatures = { ...(req.order.signatures || {}) };
  delete signatures.contractor;
  store.updateOrder(req.order.id, { ...fields, signatures });
  store.addEvent(req.order.id, 'edited', 'Change order edited');
  setFlash(req, 'Changes saved.');
  res.redirect(`/orders/${req.order.id}`);
});

app.get('/orders/:id/pdf', requireAdmin, loadOrder, async (req, res, next) => {
  try {
    const buf = await pdfFor(req.order);
    res.type('pdf').set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pdfName(req.order)}"`).send(buf);
  } catch (e) { next(e); }
});

app.post('/orders/:id/duplicate', requireAdmin, loadOrder, (req, res) => {
  const src = req.order;
  const copy = {};
  ORDER_FIELDS.forEach((k) => { copy[k] = src[k]; });
  copy.number = store.peekNextNumber();
  copy.date = f.todayISO();
  const order = store.createOrder(copy);
  setFlash(req, `Copied into new change order #${order.number}. Edit the details before sending.`);
  res.redirect(`/orders/${order.id}/edit`);
});

app.post('/orders/:id/contractor-sign', requireAdmin, loadOrder, (req, res) => {
  if (applyContractorSignature(req.order)) setFlash(req, 'Signed as contractor.');
  else setFlash(req, 'Save your signature in Settings first.', 'error');
  res.redirect(`/orders/${req.order.id}`);
});

app.post('/orders/:id/send', requireAdmin, loadOrder, async (req, res) => {
  const order = req.order;
  const { viaEmail, viaSms } = req.body;
  const email = String(req.body.email || '').trim();
  const phone = String(req.body.phone || '').trim();
  const note = String(req.body.note || '').trim();
  if (!viaEmail && !viaSms) { setFlash(req, 'Choose email and/or text message.', 'error'); return res.redirect(`/orders/${order.id}`); }

  const settings = store.getSettings();
  if (settings.autoSign !== false) applyContractorSignature(order);

  const link = signLink(order);
  const results = [];
  const errors = [];

  if (viaEmail) {
    try {
      if (!email) throw new Error('Enter the customer’s email address.');
      const pdf = await buildPdf(store.getOrder(order.id), company);
      const greeting = `Hi ${order.ownerName.split(' ')[0] || ''},`.replace(' ,', ',');
      const intro = `${company.name} has sent you Change Order #${order.number} for ${order.projectName} to review and sign.`;
      const text = [greeting, '', intro, note && `\n${note}\n`, `Review and sign here: ${link}`, '',
        'A PDF copy is attached.', '', company.name, company.phone, company.email].filter((x) => x !== false && x !== undefined).join('\n');
      const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#16202e;max-width:560px">
        <p>${views.esc(greeting)}</p>
        <p>${views.esc(intro)}</p>
        ${note ? `<p style="white-space:pre-wrap">${views.esc(note)}</p>` : ''}
        <p style="margin:24px 0"><a href="${views.esc(link)}" style="background:#082a56;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Review &amp; sign</a></p>
        <p>A PDF copy is attached.</p>
        <p style="color:#5d6878">${views.esc(company.name)}<br>${views.esc(company.phone)}<br>${views.esc(company.email)}<br>CSLB Lic. #${views.esc(company.license)}</p></div>`;
      await notify.sendEmail({
        to: email,
        subject: `Change Order #${order.number} – ${order.projectName} – please review & sign`,
        text, html: htmlBody, replyTo: company.email,
        attachments: [{ filename: pdfName(order), content: pdf }],
      });
      store.addEvent(order.id, 'sent_email', `Emailed to ${email}`);
      results.push(`emailed to ${email}`);
    } catch (e) { errors.push(`Email: ${e.message}`); }
  }

  if (viaSms) {
    try {
      if (!phone) throw new Error('Enter the customer’s mobile number.');
      const body = `${company.name}: Change Order #${order.number} for ${order.projectName} is ready for your review and signature: ${link}${note ? `\n${note}` : ''}`;
      await notify.sendSms({ to: phone, body });
      store.addEvent(order.id, 'sent_sms', `Texted to ${phone}`);
      results.push(`texted to ${phone}`);
    } catch (e) { errors.push(`Text: ${e.message}`); }
  }

  const patch = {};
  if (results.length && ['draft'].includes(store.getOrder(order.id).status)) patch.status = 'sent';
  if (email) patch.ownerEmail = email;
  if (phone) patch.ownerPhone = phone;
  store.updateOrder(order.id, patch);

  if (errors.length) setFlash(req, (results.length ? `Sent: ${results.join(', ')}. ` : '') + errors.join(' '), 'error');
  else setFlash(req, `Change order ${results.join(' and ')}.`);
  res.redirect(`/orders/${order.id}`);
});

app.post('/orders/:id/delete', requireAdmin, loadOrder, (req, res) => {
  store.deleteOrder(req.order.id);
  setFlash(req, `Change order #${req.order.number} deleted.`);
  res.redirect('/');
});

app.get('/settings', requireAdmin, (req, res) => {
  html(res, views.settingsPage({
    company, settings: store.getSettings(), emailReady: notify.emailConfigured(), smsReady: notify.smsConfigured(),
    appUrl: APP_URL, flash: takeFlash(req),
  }));
});

app.post('/settings', requireAdmin, (req, res) => {
  const patch = {
    contractorSignerName: String(req.body.contractorSignerName || '').trim(),
    autoSign: req.body.autoSign === '1',
  };
  const sig = String(req.body.signature || '');
  if (sig.startsWith('data:image/png;base64,')) patch.contractorSignature = sig;
  store.updateSettings(patch);
  setFlash(req, 'Settings saved.');
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
  if (!req.session.admin && (o.status === 'sent' || o.status === 'draft')) {
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

    if (o.status === 'declined') return back('This change order was declined.');
    if (o.signatures?.[who]) return res.redirect(`/s/${req.params.token}`);
    if (who === 'owner2' && !o.signatures?.owner) return back('The first owner must sign first.');
    if (!name) return back('Please type your full name.');
    if (!image.startsWith('data:image/png;base64,') || image.length < 500) return back('Please sign in the box.');
    if (req.body.consent !== '1') return back('Please check the box to agree.');

    const sig = {
      name, image, at: new Date().toISOString(), method: 'electronic',
      ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300),
      email: who === 'owner' ? o.ownerEmail : '',
    };
    const signatures = { ...(o.signatures || {}), [who]: sig };
    store.updateOrder(o.id, { signatures, status: 'signed' });
    store.addEvent(o.id, 'signed', `Signed by ${name}${who === 'owner2' ? ' (second owner)' : ''}`);

    // Make sure the contractor signature is on the final copy if one is saved.
    const fresh = store.getOrder(o.id);
    if (store.getSettings().autoSign !== false) applyContractorSignature(fresh);
    const pdf = await freezeSignedPdf(store.getOrder(o.id));

    // Email copies (best effort — signing already succeeded).
    if (notify.emailConfigured()) {
      const attach = [{ filename: pdfName(store.getOrder(o.id)), content: pdf }];
      const notifyTo = process.env.NOTIFY_EMAIL || company.email;
      notify.sendEmail({
        to: notifyTo,
        subject: `SIGNED: Change Order #${o.number} – ${o.projectName}`,
        text: `${name} signed Change Order #${o.number} (${o.projectName}) on ${f.dateTime(sig.at)}.\n\n${APP_URL}/orders/${o.id}`,
        attachments: attach,
      }).then(() => store.addEvent(o.id, 'notified', `Signed copy emailed to ${notifyTo}`))
        .catch((e) => store.addEvent(o.id, 'error', `Could not email signed copy to contractor: ${e.message}`));
      if (o.ownerEmail) {
        notify.sendEmail({
          to: o.ownerEmail,
          replyTo: company.email,
          subject: `Your signed copy – Change Order #${o.number} – ${o.projectName}`,
          text: `Thank you, ${name}. Attached is your signed copy of Change Order #${o.number}.\n\n${company.name}\n${company.phone}\n${company.email}`,
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
        to: process.env.NOTIFY_EMAIL || company.email,
        subject: `DECLINED: Change Order #${o.number} – ${o.projectName}`,
        text: `The customer declined Change Order #${o.number}.${reason ? `\n\nReason: ${reason}` : ''}\n\n${APP_URL}/orders/${o.id}`,
      }).catch(() => {});
    }
  }
  res.redirect(`/s/${req.params.token}`);
});

app.use((req, res) => html(res, views.notFound({ company }), 404));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).type('text').send('Something went wrong. Please try again.');
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Change orders app running at ${APP_URL} (port ${PORT})`));
}

module.exports = app;
