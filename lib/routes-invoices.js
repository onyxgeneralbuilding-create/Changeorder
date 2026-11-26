// Invoices: create from a contract, email, record payments, receipts and lien releases.
const store = require('./store');
const notify = require('./notify');
const f = require('./format');
const calc = require('./invoices');
const pdf = require('./pdf-invoice');
const V = require('./views-invoices');
const PAY = require('./pay-methods');

module.exports = function invoiceRoutes(app, h) {
  const { company, html, setFlash, takeFlash, requireLogin, requireOwner, isOwner, notFound, appUrl } = h;
  const canSeeInv = (req, inv) => isOwner(req) || (inv && inv.createdBy === req.user.id);
  // Invoices can be for a contract or for a signed change order (stand-alone, or billed through its contract).
  const canSeeContract = (req, c) => c && (c.type === 'hic' || c.status === 'signed') && (isOwner(req) || c.createdBy === req.user.id);
  const contractOf = (inv) => store.getOrder(inv.contractId);
  const visibleContracts = (req) => store.listOrders().filter((o) => o.type === 'hic' && canSeeContract(req, o));
  const visibleCOs = (req) => store.listOrders().filter((o) => o.type !== 'hic' && canSeeContract(req, o) && calc.unbilledLines(o).length > 0);

  function loadInvoice(req, res, next) {
    const inv = store.getInvoice(req.params.id);
    const c = inv && contractOf(inv);
    if (!inv || !c || !canSeeInv(req, inv)) return notFound(res);
    req.invoice = inv;
    req.contract = c;
    next();
  }

  const pdfName = (prefix, inv, c) => `${prefix}-${inv.number}-${(c.projectName || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')}.pdf`;
  const invoicePdf = (inv, c) => pdf.buildInvoicePdf({ invoice: inv, contract: c, company, ledger: calc.contractLedger(c), summary: calc.summary(inv), settings: store.getSettings() });
  const receiptPdf = (inv, p, c) => pdf.buildReceiptPdf({ invoice: inv, payment: p, contract: c, company, ledger: calc.contractLedger(c), summary: calc.summary(inv) });
  const releasePdf = (inv, p, c) => pdf.buildLienReleasePdf({
    kind: p.release.kind, contract: c, company, payment: p, throughDate: inv.date,
    signer: { name: p.release.signerName, title: p.release.title, image: p.release.image }, signedAt: p.release.signedAt,
  });
  const sendPdf = (res, buf, name, download) => res.type('pdf').set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name}"`).send(buf);

  // Sign the lien release with the owner's saved signature (owner only).
  function signRelease(inv, p, c) {
    const s = store.getSettings();
    const ledger = calc.contractLedger(c);
    p.release = {
      kind: ledger.balance <= 0.005 ? 'final' : 'progress',
      signedAt: f.todayISO(), signerName: s.contractorSignerName || '', title: s.contractorSignerTitle || 'Owner', image: s.contractorSignature,
    };
    store.updateInvoice(inv.id, { payments: inv.payments });
    store.addInvoiceEvent(inv.id, `${p.release.kind === 'final' ? 'Final' : 'Progress'} lien release signed for ${f.money(p.amount)}`);
  }

  // ---------- list ----------
  app.get('/invoices', requireLogin, (req, res) => {
    const rows = store.listInvoices().filter((i) => canSeeInv(req, i)).map((inv) => ({ inv, c: contractOf(inv), sm: calc.summary(inv) })).filter((r) => r.c);
    html(res, V.invoicesPage({ company, rows, filter: req.query.status || '', flash: takeFlash(req) }));
  });

  // ---------- new ----------
  app.get('/invoices/new', requireLogin, (req, res) => {
    const c = req.query.contract && store.getOrder(req.query.contract);
    if (!c) return html(res, V.pickContract({ company, contracts: visibleContracts(req), orders: visibleCOs(req) }));
    if (!canSeeContract(req, c)) return notFound(res);
    // A change order linked to a contract is billed on the contract's invoice (with that line pre-checked).
    const parent = calc.parentContract(c);
    if (parent && canSeeContract(req, parent)) return res.redirect(`/invoices/new?contract=${parent.id}&pre=co-${c.id}`);
    html(res, V.invoiceForm({ company, contract: c, pre: req.query.pre, ledger: calc.contractLedger(c), lines: calc.unbilledLines(c), number: store.peekInvoiceNumber(), methods: PAY.available(store.getSettings(), company), preset: PAY.defaults(store.getSettings(), company) }));
  });

  app.post('/invoices', requireLogin, (req, res) => {
    const c = store.getOrder(req.body.contractId);
    if (!canSeeContract(req, c)) return notFound(res);
    const srcs = [].concat(req.body.src || []);
    const available = calc.unbilledLines(c);
    const items = available.filter((l) => srcs.includes(l.source)).map((l) => ({ ...l }));
    const customAmt = f.parseMoney(req.body.customAmount);
    const customDesc = String(req.body.customDesc || '').trim();
    let error = null;
    if (customAmt || customDesc) {
      if (!customAmt || !customDesc) error = 'The extra line needs both an amount and a description.';
      else items.push({ description: customDesc, amount: calc.cents(customAmt) });
    }
    if (!error && !items.length) error = 'Choose at least one thing to bill for.';
    const offeredNow = PAY.available(store.getSettings(), company).map((m) => m.key);
    if (!error && offeredNow.length && ![].concat(req.body.payMethod || []).some((k) => offeredNow.includes(k))) error = 'Choose at least one way the customer can pay.';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : f.todayISO();
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate || '') ? req.body.dueDate : '';
    if (!error && items.reduce((a, i) => a + i.amount, 0) <= 0) error = 'The invoice total must be more than $0.';
    if (error) {
      return html(res, V.invoiceForm({ company, contract: c, ledger: calc.contractLedger(c), lines: available, number: store.peekInvoiceNumber(), error, form: req.body, methods: PAY.available(store.getSettings(), company), preset: [] }), 400);
    }
    const offered = PAY.available(store.getSettings(), company).map((m) => m.key);
    const payMethods = [].concat(req.body.payMethod || []).filter((k) => offered.includes(k));
    const inv = store.createInvoice({
      number: String(req.body.number || '').trim() || undefined, contractId: c.id, date, dueDate, items, payMethods,
      notes: String(req.body.notes || '').trim(), createdBy: c.createdBy, createdByName: c.createdByName,
    });
    setFlash(req, `Invoice ${inv.number} created. Review it, then email it to the customer.`);
    res.redirect(`/invoices/${inv.id}`);
  });

  // ---------- detail / pdf ----------
  app.get('/invoices/:id', requireLogin, loadInvoice, (req, res) => {
    html(res, V.invoiceDetail({
      company, invoice: req.invoice, contract: req.contract, ledger: calc.contractLedger(req.contract), sm: calc.summary(req.invoice),
      settings: store.getSettings(), flash: takeFlash(req), emailReady: notify.emailConfigured(),
      methods: PAY.available(store.getSettings(), company), chosen: PAY.forInvoice(req.invoice, store.getSettings(), company).map((m) => m.key),
    }));
  });

  app.get('/invoices/:id/pdf', requireLogin, loadInvoice, async (req, res, next) => {
    try { sendPdf(res, await invoicePdf(req.invoice, req.contract), pdfName('Invoice', req.invoice, req.contract), req.query.download); } catch (e) { next(e); }
  });

  // Change which payment methods an invoice shows.
  app.post('/invoices/:id/methods', requireLogin, loadInvoice, (req, res) => {
    const offered = PAY.available(store.getSettings(), company).map((m) => m.key);
    store.updateInvoice(req.invoice.id, { payMethods: [].concat(req.body.payMethod || []).filter((k) => offered.includes(k)) });
    store.addInvoiceEvent(req.invoice.id, 'Payment methods updated');
    setFlash(req, 'Payment methods updated on the invoice.');
    res.redirect(`/invoices/${req.invoice.id}`);
  });

  // ---------- send ----------
  app.post('/invoices/:id/send', requireLogin, loadInvoice, async (req, res) => {
    const { invoice: inv, contract: c } = req;
    const email = String(req.body.email || '').trim();
    const note = String(req.body.note || '').trim();
    try {
      if (!email) throw new Error('Enter the customer’s email address.');
      const sm = calc.summary(inv);
      const buf = await invoicePdf(inv, c);
      const first = (c.ownerName || '').split(' ')[0];
      const s = store.getSettings();
      await notify.sendEmail({
        to: email, replyTo: company.email,
        subject: `Invoice ${inv.number} – ${c.projectName} – ${f.money(sm.balance)} due`,
        text: [`Hi ${first},`, '', `Attached is invoice ${inv.number} for ${c.projectName}.`, '',
          `Amount due: ${f.money(sm.balance)}${inv.dueDate ? ` by ${f.date(inv.dueDate)}` : ''}`,
          note && `\n${note}`, (() => { const ms = PAY.forInvoice(inv, s, company); return ms.length ? `\nHow to pay:\n${ms.map((m) => `• ${m.label}: ${m.detail}`).join('\n')}` : ''; })(), '',
          'Thank you,', company.name, company.phone, company.email].filter((x) => x !== false && x !== undefined).join('\n'),
        attachments: [{ filename: pdfName('Invoice', inv, c), content: buf }],
      });
      store.updateInvoice(inv.id, { sentAt: inv.sentAt || new Date().toISOString() });
      store.addInvoiceEvent(inv.id, `Emailed to ${email}`);
      setFlash(req, `Invoice ${inv.number} emailed to ${email}.`);
    } catch (e) {
      setFlash(req, `Email: ${e.message}`, 'error');
    }
    res.redirect(`/invoices/${inv.id}`);
  });

  // ---------- payments ----------
  app.post('/invoices/:id/payments', requireLogin, loadInvoice, async (req, res) => {
    const { invoice: inv, contract: c } = req;
    const sm = calc.summary(inv);
    const amount = calc.cents(f.parseMoney(req.body.amount));
    const method = V.METHODS.includes(req.body.method) ? req.body.method : 'Other';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : f.todayISO();
    if (!amount || amount <= 0) { setFlash(req, 'Enter the amount received.', 'error'); return res.redirect(`/invoices/${inv.id}`); }
    if (amount > sm.balance + 0.005) { setFlash(req, `That’s more than the ${f.money(sm.balance)} still due on this invoice.`, 'error'); return res.redirect(`/invoices/${inv.id}`); }
    const p = store.addPayment(inv.id, {
      amount, date, method, reference: String(req.body.reference || '').trim().slice(0, 40), note: String(req.body.note || '').trim().slice(0, 300),
      by: req.user.id, byName: isOwner(req) ? 'Owner' : req.user.name,
    });
    store.addInvoiceEvent(inv.id, `Payment of ${f.money(amount)} recorded (${method}${p.reference ? ` #${p.reference}` : ''}) by ${p.byName}`);
    if (!inv.sentAt) store.updateInvoice(inv.id, { sentAt: new Date().toISOString() });

    const fresh = store.getInvoice(inv.id);
    const pay = fresh.payments.find((x) => x.id === p.id);
    const s = store.getSettings();
    // Lien release: owner + saved signature + funds already in hand → sign now.
    if (isOwner(req) && s.contractorSignature && method !== 'Check') signRelease(fresh, pay, c);

    const msgs = [`Payment of ${f.money(amount)} recorded. Receipt ${pay.receiptNumber}.`];
    if (req.body.emailReceipt === '1' && c.ownerEmail) {
      try {
        const attachments = [{ filename: `Receipt-${pay.receiptNumber}.pdf`, content: await receiptPdf(fresh, pay, c) }];
        if (pay.release && pay.release.signedAt) attachments.push({ filename: `Lien-Release-${pay.receiptNumber}.pdf`, content: await releasePdf(fresh, pay, c) });
        await notify.sendEmail({
          to: c.ownerEmail, replyTo: company.email,
          subject: `Payment received – ${f.money(amount)} – ${c.projectName}`,
          text: [`Hi ${(c.ownerName || '').split(' ')[0]},`, '', `Thank you. We received your payment of ${f.money(amount)} on ${f.date(date)} for invoice ${fresh.number}.`,
            `Remaining balance on this invoice: ${f.money(calc.summary(fresh).balance)}.`, '',
            pay.release && pay.release.signedAt ? 'Your receipt and an unconditional lien release for this payment are attached.' : 'Your receipt is attached.',
            '', company.name, company.phone, company.email].join('\n'),
          attachments,
        });
        store.addInvoiceEvent(inv.id, `Receipt ${pay.receiptNumber}${pay.release && pay.release.signedAt ? ' and lien release' : ''} emailed to ${c.ownerEmail}`);
        if (pay.release && pay.release.signedAt) { pay.release.sentAt = new Date().toISOString(); store.updateInvoice(inv.id, { payments: fresh.payments }); }
        msgs.push(`Receipt emailed to ${c.ownerEmail}.`);
      } catch (e) {
        msgs.push(`Couldn’t email the receipt: ${e.message}`);
      }
    }
    if (!pay.release || !pay.release.signedAt) {
      msgs.push(isOwner(req) ? (method === 'Check' ? 'Send the lien release once the check clears.' : 'Save your signature in Settings to send the lien release.') : 'The owner will sign and send the lien release.');
      if (!isOwner(req) && notify.emailConfigured()) {
        notify.sendEmail({
          to: process.env.NOTIFY_EMAIL || company.email,
          subject: `Lien release to sign – ${f.money(amount)} – ${c.projectName}`,
          text: `${req.user.name} recorded a ${method} payment of ${f.money(amount)} on invoice ${fresh.number} (${c.projectName}).\n\nSign and send the lien release here:\n${appUrl}/invoices/${inv.id}`,
        }).catch(() => {});
      }
    }
    setFlash(req, msgs.join(' '));
    res.redirect(`/invoices/${inv.id}`);
  });

  const loadPayment = (req, res, next) => {
    const p = (req.invoice.payments || []).find((x) => x.id === req.params.pid);
    if (!p) return notFound(res);
    req.payment = p;
    next();
  };

  app.get('/invoices/:id/payments/:pid/receipt', requireLogin, loadInvoice, loadPayment, async (req, res, next) => {
    try { sendPdf(res, await receiptPdf(req.invoice, req.payment, req.contract), `Receipt-${req.payment.receiptNumber}.pdf`, req.query.download); } catch (e) { next(e); }
  });

  app.get('/invoices/:id/payments/:pid/release', requireLogin, loadInvoice, loadPayment, async (req, res, next) => {
    if (!req.payment.release || !req.payment.release.signedAt) return notFound(res);
    try { sendPdf(res, await releasePdf(req.invoice, req.payment, req.contract), `Lien-Release-${req.payment.receiptNumber}.pdf`, req.query.download); } catch (e) { next(e); }
  });

  // Owner signs and sends a waiting lien release (e.g. after a check clears).
  app.post('/invoices/:id/payments/:pid/release', requireOwner, loadInvoice, loadPayment, async (req, res) => {
    const { invoice: inv, contract: c, payment: p } = req;
    if (!store.getSettings().contractorSignature) { setFlash(req, 'Save your signature in Settings first.', 'error'); return res.redirect(`/invoices/${inv.id}`); }
    if (!p.release || !p.release.signedAt) signRelease(inv, p, c);
    const fresh = store.getInvoice(inv.id);
    const pay = fresh.payments.find((x) => x.id === p.id);
    if (c.ownerEmail) {
      try {
        await notify.sendEmail({
          to: c.ownerEmail, replyTo: company.email,
          subject: `Lien release – ${f.money(pay.amount)} payment – ${c.projectName}`,
          text: [`Hi ${(c.ownerName || '').split(' ')[0]},`, '', `Attached is an unconditional lien release for your ${f.money(pay.amount)} payment received ${f.date(pay.date)}.`, '', company.name, company.phone].join('\n'),
          attachments: [{ filename: `Lien-Release-${pay.receiptNumber}.pdf`, content: await releasePdf(fresh, pay, c) }],
        });
        pay.release.sentAt = new Date().toISOString();
        store.updateInvoice(inv.id, { payments: fresh.payments });
        store.addInvoiceEvent(inv.id, `Lien release emailed to ${c.ownerEmail}`);
        setFlash(req, `Lien release signed and emailed to ${c.ownerEmail}.`);
      } catch (e) {
        setFlash(req, `Lien release signed, but the email failed: ${e.message}`, 'error');
      }
    } else {
      setFlash(req, 'Lien release signed. Add the customer’s email to the contract to send it.');
    }
    res.redirect(`/invoices/${inv.id}`);
  });

  app.post('/invoices/:id/payments/:pid/delete', requireLogin, loadInvoice, loadPayment, (req, res) => {
    if (!isOwner(req) && req.payment.by !== req.user.id) { setFlash(req, 'Only the owner can remove this payment.', 'error'); return res.redirect(`/invoices/${req.invoice.id}`); }
    store.removePayment(req.invoice.id, req.payment.id);
    store.addInvoiceEvent(req.invoice.id, `Payment of ${f.money(req.payment.amount)} (${req.payment.receiptNumber}) removed`);
    setFlash(req, 'Payment removed.');
    res.redirect(`/invoices/${req.invoice.id}`);
  });

  app.post('/invoices/:id/delete', requireLogin, loadInvoice, (req, res) => {
    if ((req.invoice.payments || []).length) { setFlash(req, 'Invoices with payments can’t be deleted.', 'error'); return res.redirect(`/invoices/${req.invoice.id}`); }
    store.deleteInvoice(req.invoice.id);
    setFlash(req, `Invoice ${req.invoice.number} deleted.`);
    res.redirect('/invoices');
  });
};
