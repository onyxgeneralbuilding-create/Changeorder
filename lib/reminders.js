// Emails renewal reminders (insurance, license) before they expire.
// Runs inside the app: checks once an hour, sends each reminder only once.
const store = require('./store');
const notify = require('./notify');
const f = require('./format');

const STEPS = [60, 30, 7, 1, 0]; // days before expiration

function renewalList(company, settings = {}) {
  const ins = company.insurance || {};
  const agent = ins.agency ? `${ins.agency}${ins.phone ? `, ${ins.phone}` : ''}` : ins.phone || '';
  return [
    { key: 'cgl', label: 'General liability insurance', who: settings.insuranceCompany || ins.cglCompany, policy: ins.cglPolicy, date: settings.cglExpires || ins.cglExpires, contact: agent },
    { key: 'wc', label: 'Workers’ compensation insurance', who: settings.wcCompany || ins.wcCompany, policy: ins.wcPolicy, date: settings.wcExpires || ins.wcExpires, contact: agent },
    { key: 'license', label: 'Contractor license', who: `CSLB #${company.license}`, date: settings.licenseExpires || company.licenseExpires, contact: 'Renew online at www.cslb.ca.gov or call CSLB at 800-321-2752' },
    // Each team member's Home Improvement Salesperson (HIS) registration.
    ...store.listUsers().filter((u) => u.hisExpires).map((u) => ({
      key: `his-${u.id}`, label: `${u.name}’s salesperson card`, who: u.name, policy: u.hisNumber ? `HIS #${u.hisNumber}` : '',
      date: u.hisExpires, contact: 'Renew online at www.cslb.ca.gov or call CSLB at 800-321-2752', alsoTo: u.email, member: true,
    })),
  ];
}

function daysLeft(iso) {
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
  return Math.round((new Date(iso) - today) / 86400000);
}

async function checkRenewals(company, appUrl) {
  if (!notify.emailConfigured()) return [];
  const settings = store.getSettings();
  const sent = { ...(settings.remindersSent || {}) };
  const to = process.env.NOTIFY_EMAIL || company.email;
  const out = [];
  for (const r of renewalList(company, settings)) {
    if (!r.date) continue;
    const days = daysLeft(r.date);
    if (days > STEPS[0]) continue;
    // Which reminder is due now? (expired = its own one-time reminder)
    const step = days < 0 ? 'expired' : STEPS.filter((s) => days <= s).pop();
    const id = `${r.key}:${r.date}:${step}`;
    if (sent[id]) continue;
    const when = days < 0 ? `expired on ${f.date(r.date)}` : days === 0 ? `expires TODAY (${f.date(r.date)})` : `expires in ${days} day${days === 1 ? '' : 's'} (${f.date(r.date)})`;
    const subject = `${days <= 7 ? 'URGENT: ' : 'Reminder: '}${r.label} ${when}`;
    const text = [
      `Your ${r.label.toLowerCase()} ${when}.`,
      '',
      r.who && `${r.member ? 'Salesperson' : 'Provider'}: ${r.who}`,
      r.policy && `${r.member ? 'Registration' : 'Policy'}: ${r.policy}`,
      r.contact && `Contact: ${r.contact}`,
      '',
      r.member ? 'After it’s renewed, update the date in Onyx Contracts Hub → Settings → Team.' : 'After you renew, update the date in Onyx Contracts Hub → Settings → Renewal dates',
      ['cgl', 'wc'].includes(r.key) ? 'and send the new certificate of insurance so contract emails include the current one.' : '',
      '',
      `${appUrl}/settings#${r.member ? 'team' : 'renewals'}`,
    ].filter((x) => x !== undefined && x !== null && x !== false).join('\n');
    try {
      await notify.sendEmail({ to: [to, r.alsoTo].filter(Boolean).join(', '), subject, text });
      // Mark this and any earlier (larger) steps as done so they never send late.
      STEPS.filter((s) => step === 'expired' || s >= step).forEach((s) => { sent[`${r.key}:${r.date}:${s}`] = new Date().toISOString(); });
      sent[id] = new Date().toISOString();
      out.push(subject);
      console.log(`Renewal reminder sent: ${subject}`);
    } catch (e) {
      console.error(`Renewal reminder failed: ${e.message}`);
    }
  }
  store.updateSettings({ remindersSent: sent });
  return out;
}

function startReminders(company, appUrl) {
  const run = () => checkRenewals(company, appUrl).catch((e) => console.error('Renewal check failed', e));
  setTimeout(run, 30 * 1000); // shortly after start
  setInterval(run, 60 * 60 * 1000).unref(); // then hourly
}

module.exports = { renewalList, daysLeft, checkRenewals, startReminders };
