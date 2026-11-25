// Customers: saved people/companies to pick from on contracts and change orders.
const store = require('./store');
const f = require('./format');
const calc = require('./invoices');
const V = require('./views-customers');

module.exports = function customerRoutes(app, h) {
  const { company, html, setFlash, takeFlash, requireLogin, creator, canSeeCustomer, visibleOrders, CUSTOMER_KEYS, notFound } = h;

  // One time: build the customer list from existing documents so it doesn't start empty.
  if (!store.hasCustomerList()) {
    const byKey = new Map();
    store.listOrders().slice().reverse().forEach((o) => {
      if (!o.ownerName) return;
      const key = `${o.createdBy || 'owner'}|${o.ownerName.trim().toLowerCase()}`;
      let c = byKey.get(key);
      if (!c) {
        c = store.createCustomer({ ...Object.fromEntries(CUSTOMER_KEYS.map((k) => [k, o[k] || ''])), createdBy: o.createdBy, createdByName: o.createdByName });
        byKey.set(key, c);
      } else {
        // Same customer on another document: fill in any details still missing.
        const fill = Object.fromEntries(CUSTOMER_KEYS.filter((k) => !c[k] && o[k]).map((k) => [k, o[k]]));
        if (Object.keys(fill).length) store.updateCustomer(c.id, fill);
      }
      if (!o.customerId) store.linkOrderToCustomer(o.id, c.id);
    });
    store.ensureCustomerList(); // mark the import as done even if there was nothing to import
    console.log(`Customers: imported ${byKey.size} from existing documents.`);
  }

  const readForm = (body) => {
    const c = Object.fromEntries(CUSTOMER_KEYS.map((k) => [k, String(body[k] || '').trim()]));
    c.notes = String(body.notes || '').trim().slice(0, 2000);
    return c;
  };
  const validate = (c) => {
    if (!c.ownerName) return 'Enter the customer’s name.';
    if (c.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.ownerEmail)) return 'That email address doesn’t look right.';
    return null;
  };
  const load = (req, res, next) => {
    const c = store.getCustomer(req.params.id);
    if (!canSeeCustomer(req, c)) return notFound(res);
    req.customer = c;
    next();
  };
  const signedValue = (o) => (o.status !== 'signed' ? 0 : o.type === 'hic' ? Number(f.parseMoney(o.contractPrice)) || 0 : f.signedAmount(o));

  app.get('/customers', requireLogin, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const docs = visibleOrders(req);
    const rows = store.listCustomers().filter((c) => canSeeCustomer(req, c))
      .filter((c) => !q || [c.ownerName, c.owner2Name, c.ownerAddress, c.ownerCityStateZip, c.ownerPhone, c.ownerEmail, c.workAddress].join(' ').toLowerCase().includes(q))
      .map((c) => {
        const mine = docs.filter((o) => o.customerId === c.id);
        return { c, docs: mine.length, total: mine.reduce((a, o) => a + signedValue(o), 0) };
      });
    html(res, V.customersPage({ company, rows, q: req.query.q || '', flash: takeFlash(req) }));
  });

  app.get('/customers/new', requireLogin, (req, res) => html(res, V.customerForm({ company, isNew: true })));

  app.post('/customers', requireLogin, (req, res) => {
    const c = readForm(req.body);
    const err = validate(c);
    if (err) return html(res, V.customerForm({ company, customer: c, isNew: true, error: err }), 400);
    const saved = store.createCustomer({ ...c, ...creator(req) });
    setFlash(req, `${saved.ownerName} saved.`);
    res.redirect(`/customers/${saved.id}`);
  });

  app.get('/customers/:id', requireLogin, load, (req, res) => {
    const c = req.customer;
    const docs = visibleOrders(req).filter((o) => o.customerId === c.id);
    const contractIds = new Set(docs.filter((o) => o.type === 'hic').map((o) => o.id));
    const invoices = store.listInvoices().filter((i) => contractIds.has(i.contractId)).map((inv) => ({ inv, sm: calc.summary(inv) }));
    html(res, V.customerDetail({ company, customer: c, docs, invoices, flash: takeFlash(req) }));
  });

  app.get('/customers/:id/edit', requireLogin, load, (req, res) => html(res, V.customerForm({ company, customer: req.customer, isNew: false })));

  app.post('/customers/:id', requireLogin, load, (req, res) => {
    const c = readForm(req.body);
    const err = validate(c);
    if (err) return html(res, V.customerForm({ company, customer: { ...req.customer, ...c }, isNew: false, error: err }), 400);
    store.updateCustomer(req.customer.id, c);
    setFlash(req, 'Customer saved. New documents will use the updated details.');
    res.redirect(`/customers/${req.customer.id}`);
  });

  app.post('/customers/:id/delete', requireLogin, load, (req, res) => {
    store.deleteCustomer(req.customer.id);
    setFlash(req, `${req.customer.ownerName} removed from Customers.`);
    res.redirect('/customers');
  });
};
