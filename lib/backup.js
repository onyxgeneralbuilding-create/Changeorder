// Data backups: one .zip of db.json + signed PDFs. Downloaded from Settings,
// and emailed to the owner every Sunday morning (Pacific time).
const fs = require('fs');
const path = require('path');
const store = require('./store');
const notify = require('./notify');
const f = require('./format');
const { zip } = require('./zip');

const EMAIL_LIMIT = 20 * 1024 * 1024; // Gmail rejects attachments over ~25 MB

function buildBackup(company, { withPdfs = true } = {}) {
  const dir = store.DATA_DIR;
  const files = [];
  const add = (rel) => { const full = path.join(dir, rel); files.push({ name: rel, data: fs.readFileSync(full), date: fs.statSync(full).mtime }); };
  if (fs.existsSync(path.join(dir, 'db.json'))) add('db.json');
  const pdfDir = path.join(dir, 'pdfs');
  const pdfs = fs.existsSync(pdfDir) ? fs.readdirSync(pdfDir).filter((n) => n.endsWith('.pdf')) : [];
  if (withPdfs) pdfs.forEach((n) => add(`pdfs/${n}`));
  files.push({ name: 'README.txt', data: Buffer.from([
    `${company.appName || company.name} backup — ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT`,
    '', 'db.json   All customers, contracts, change orders, invoices, payments, team and settings.',
    withPdfs ? 'pdfs/     Signed copies exactly as customers signed them.' : 'pdfs/     Not included (too large to email). Download the full backup from Settings.',
    '', 'Keep this file somewhere safe. It contains customer information and signatures.',
  ].join('\r\n')) });
  return { buffer: zip(files), filename: `Onyx-CRM-backup-${f.todayISO()}.zip`, pdfCount: pdfs.length, withPdfs };
}

async function emailBackup(company, to) {
  let b = buildBackup(company);
  if (b.buffer.length > EMAIL_LIMIT) b = buildBackup(company, { withPdfs: false });
  const d = JSON.parse(fs.readFileSync(path.join(store.DATA_DIR, 'db.json'), 'utf8'));
  const n = (k) => (d[k] || []).length;
  await notify.sendEmail({
    to,
    subject: `Weekly backup – ${company.appName || company.name} – ${f.date(f.todayISO())}`,
    text: [
      'Your weekly backup is attached. Save it somewhere safe (your computer or iCloud Drive).', '',
      `Customers: ${n('customers')}  ·  Contracts & change orders: ${n('orders')}  ·  Invoices: ${n('invoices')}  ·  Team members: ${n('users')}`,
      b.withPdfs ? `Signed PDFs included: ${b.pdfCount}` : `Signed PDFs were left out to keep the email small (${b.pdfCount} on file). Download the full backup in Settings → Backup.`,
      '', 'This file contains customer information and signatures. Don’t forward it.',
    ].join('\n'),
    attachments: [{ filename: b.filename, content: b.buffer }],
  });
  store.updateSettings({ lastEmailBackupAt: new Date().toISOString() });
  return b;
}

// Hourly check: send on Sunday from 7 AM Pacific if none was sent in the last 6 days.
function startWeeklyBackup(company) {
  const tick = async () => {
    const s = store.getSettings();
    if (s.weeklyBackup === false || !notify.emailConfigured()) return;
    const now = new Date();
    const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    if (pt.getDay() !== 0 || pt.getHours() < 7) return;
    if (s.lastEmailBackupAt && now - new Date(s.lastEmailBackupAt) < 6 * 86400000) return;
    try {
      await emailBackup(company, process.env.NOTIFY_EMAIL || company.email);
      console.log('Weekly backup emailed.');
    } catch (e) {
      console.error(`Weekly backup email failed: ${e.message}`);
    }
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { buildBackup, emailBackup, startWeeklyBackup };
