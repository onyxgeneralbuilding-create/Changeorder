// Ways a customer can pay, shown on invoices. Details are set once in Settings;
// each invoice chooses which ones to show.
const METHODS = [
  { key: 'zelle', label: 'Zelle', hint: 'Email or phone number for Zelle', def: (c) => c.email },
  { key: 'check', label: 'Check', hint: 'Who checks are payable to and where to mail them', def: (c) => `Payable to ${c.name} · Mail to ${c.address}, ${c.cityStateZip}` },
  { key: 'card', label: 'Credit card', hint: 'A payment link (Square, Stripe, etc.) or how to pay by card', def: (c) => `Call ${c.phone} to pay by card` },
  { key: 'bank', label: 'Bank transfer', hint: 'Bank name, routing and account number', def: () => '' },
  { key: 'cash', label: 'Cash', hint: 'Note for cash payments', def: () => 'In person — you’ll receive a receipt' },
  { key: 'other', label: 'Other', hint: 'Any other way to pay', def: () => '' },
];

// Details for each method: saved settings, else a sensible default.
function details(settings, company) {
  const saved = settings.payMethods || {};
  return Object.fromEntries(METHODS.map((m) => [m.key, saved[m.key] !== undefined ? saved[m.key] : m.def(company)]));
}

// Methods that have details and so can be offered.
function available(settings, company) {
  const d = details(settings, company);
  return METHODS.filter((m) => (d[m.key] || '').trim()).map((m) => ({ ...m, detail: d[m.key].trim() }));
}

// The methods shown on one invoice (older invoices without a choice show all available).
function forInvoice(inv, settings, company) {
  const avail = available(settings, company);
  if (!Array.isArray(inv.payMethods)) return avail;
  return avail.filter((m) => inv.payMethods.includes(m.key));
}

// Methods pre-checked on a new invoice (set in Settings; none until chosen).
function defaults(settings, company) {
  const keys = Array.isArray(settings.payDefaults) ? settings.payDefaults : [];
  return available(settings, company).filter((m) => keys.includes(m.key)).map((m) => m.key);
}

module.exports = { METHODS, details, available, forInvoice, defaults };
