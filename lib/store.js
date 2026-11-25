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
