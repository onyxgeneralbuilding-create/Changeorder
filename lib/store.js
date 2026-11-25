// Tiny JSON-file data store. Good for a single small business;
// can be swapped for a real database later without touching the rest of the app.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCAL_DIR = path.join(__dirname, '..', 'data');
let DATA_DIR = process.env.DATA_DIR || LOCAL_DIR;
try {
  fs.mkdirSync(path.join(DATA_DIR, 'pdfs'), { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (e) {
  // e.g. DATA_DIR points at a disk that isn't attached (Render free plan).
  console.warn(`WARNING: can't write to ${DATA_DIR} (${e.code}). Using ${LOCAL_DIR} instead — data will be lost when the app restarts.`);
  DATA_DIR = LOCAL_DIR;
  fs.mkdirSync(path.join(DATA_DIR, 'pdfs'), { recursive: true });
}
const DB_FILE = path.join(DATA_DIR, 'db.json');

function load() {
  if (!fs.existsSync(DB_FILE)) return { nextNumber: 1001, orders: [], settings: {} };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

let db = load();

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

// scrypt password hashes: "salt:hash" in hex.
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = {
  DATA_DIR,
  pdfPath: (name) => path.join(DATA_DIR, 'pdfs', name),

  listOrders() {
    return [...db.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getOrder(id) {
    return db.orders.find((o) => o.id === id);
  },
  getOrderByToken(token) {
    return token ? db.orders.find((o) => o.token === token) : undefined;
  },
  // Change orders: 1001, 1002…  Contracts: HIC-1001, HIC-1002…
  peekNextNumber(type = 'co') {
    if (type === 'hic') return `HIC-${db.nextContractNumber || 1001}`;
    return String(db.nextNumber);
  },
  createOrder(fields) {
    const now = new Date().toISOString();
    const order = {
      id: newId(),
      token: newToken(),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      events: [{ at: now, type: 'created', text: fields.type === 'hic' ? 'Contract created' : 'Change order created' }],
      signatures: {},
      ...fields,
    };
    if (order.type === 'hic') {
      if (!order.number) order.number = `HIC-${db.nextContractNumber || 1001}`;
      const m = /^HIC-(\d+)$/.exec(order.number);
      if (m && Number(m[1]) >= (db.nextContractNumber || 1001)) db.nextContractNumber = Number(m[1]) + 1;
    } else {
      if (!order.number) order.number = String(db.nextNumber);
      if (/^\d+$/.test(order.number) && Number(order.number) >= db.nextNumber) {
        db.nextNumber = Number(order.number) + 1;
      }
    }
    db.orders.push(order);
    save();
    return order;
  },
  updateOrder(id, patch) {
    const order = this.getOrder(id);
    if (!order) return null;
    Object.assign(order, patch, { updatedAt: new Date().toISOString() });
    save();
    return order;
  },
  addEvent(id, type, text, extra = {}) {
    const order = this.getOrder(id);
    if (!order) return;
    order.events.push({ at: new Date().toISOString(), type, text, ...extra });
    order.updatedAt = new Date().toISOString();
    save();
  },
  deleteOrder(id) {
    db.orders = db.orders.filter((o) => o.id !== id);
    save();
  },
  // ---------- invoices (INV-1001…) with embedded payments; receipts RCT-1001… ----------
  listInvoices() {
    return [...(db.invoices || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getInvoice(id) {
    return (db.invoices || []).find((i) => i.id === id);
  },
  peekInvoiceNumber() {
    return `INV-${db.nextInvoiceNumber || 1001}`;
  },
  createInvoice(fields) {
    db.invoices = db.invoices || [];
    const now = new Date().toISOString();
    const inv = { id: newId(), token: newToken(), createdAt: now, updatedAt: now, payments: [], events: [{ at: now, text: 'Invoice created' }], ...fields };
    if (!inv.number) inv.number = `INV-${db.nextInvoiceNumber || 1001}`;
    const m = /^INV-(\d+)$/.exec(inv.number);
    if (m && Number(m[1]) >= (db.nextInvoiceNumber || 1001)) db.nextInvoiceNumber = Number(m[1]) + 1;
    db.invoices.push(inv);
    save();
    return inv;
  },
  updateInvoice(id, patch) {
    const inv = this.getInvoice(id);
    if (!inv) return null;
    Object.assign(inv, patch, { updatedAt: new Date().toISOString() });
    save();
    return inv;
  },
  addInvoiceEvent(id, text) {
    const inv = this.getInvoice(id);
    if (!inv) return;
    inv.events = inv.events || [];
    inv.events.push({ at: new Date().toISOString(), text });
    inv.updatedAt = new Date().toISOString();
    save();
  },
  deleteInvoice(id) {
    db.invoices = (db.invoices || []).filter((i) => i.id !== id);
    save();
  },
  addPayment(invoiceId, payment) {
    const inv = this.getInvoice(invoiceId);
    if (!inv) return null;
    const p = { id: newId(), receiptNumber: `RCT-${db.nextReceiptNumber || 1001}`, at: new Date().toISOString(), ...payment };
    db.nextReceiptNumber = (db.nextReceiptNumber || 1001) + 1;
    inv.payments = inv.payments || [];
    inv.payments.push(p);
    inv.updatedAt = new Date().toISOString();
    save();
    return p;
  },
  removePayment(invoiceId, paymentId) {
    const inv = this.getInvoice(invoiceId);
    if (!inv) return;
    inv.payments = (inv.payments || []).filter((p) => p.id !== paymentId);
    inv.updatedAt = new Date().toISOString();
    save();
  },

  // ---------- team members (the owner logs in with ADMIN_PASSWORD) ----------
  listUsers() {
    return [...(db.users || [])].sort((a, b) => a.name.localeCompare(b.name));
  },
  getUser(id) {
    return (db.users || []).find((u) => u.id === id);
  },
  getUserByUsername(username) {
    const u = String(username || '').trim().toLowerCase();
    return (db.users || []).find((x) => x.username === u);
  },
  createUser({ name, username, email, password }) {
    db.users = db.users || [];
    const user = { id: newId(), name, username: username.toLowerCase(), email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    db.users.push(user);
    save();
    return user;
  },
  updateUser(id, patch) {
    const u = this.getUser(id);
    if (!u) return null;
    if (patch.password) { u.passwordHash = hashPassword(patch.password); delete patch.password; }
    Object.assign(u, patch);
    save();
    return u;
  },
  deleteUser(id) {
    db.users = (db.users || []).filter((u) => u.id !== id);
    save();
  },
  checkPassword(user, password) {
    return verifyPassword(password, user && user.passwordHash);
  },

  getSettings() {
    return db.settings || {};
  },
  updateSettings(patch) {
    db.settings = { ...(db.settings || {}), ...patch };
    save();
    return db.settings;
  },
};
