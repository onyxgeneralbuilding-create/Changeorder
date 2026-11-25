// Invoice math: contract totals with change orders, what's been billed and paid,
// and each invoice's status (draft · unpaid · partially paid · paid · overdue).
const store = require('./store');
const f = require('./format');

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => f.todayISO();

// Signed change orders linked to a contract (positive = increase, negative = decrease).
function changeOrdersFor(contractId) {
  return store.listOrders()
    .filter((o) => o.type !== 'hic' && o.contractId === contractId && o.status === 'signed')
    .map((o) => ({ id: o.id, number: o.number, description: o.description, amount: cents(f.signedAmount(o)) }));
}

const invoiceTotal = (inv) => cents((inv.items || []).reduce((a, it) => a + (Number(it.amount) || 0), 0));
const invoicePaid = (inv) => cents((inv.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0));

function invoiceStatus(inv) {
  const total = invoiceTotal(inv);
  const paid = invoicePaid(inv);
  if (total > 0 && paid >= total - 0.005) return 'paid';
  if (!inv.sentAt && paid === 0) return 'draft';
  const overdue = inv.dueDate && inv.dueDate < today();
  if (paid > 0) return overdue ? 'overdue' : 'partial';
  return overdue ? 'overdue' : 'unpaid';
}

function summary(inv) {
  const total = invoiceTotal(inv);
  const paid = invoicePaid(inv);
  return { total, paid, balance: cents(total - paid), status: invoiceStatus(inv) };
}

// Totals for a whole contract across all its invoices.
function contractLedger(contract) {
  const cos = changeOrdersFor(contract.id);
  const original = cents(f.parseMoney(contract.contractPrice) || 0);
  const coTotal = cents(cos.reduce((a, c) => a + c.amount, 0));
  const adjusted = cents(original + coTotal);
  const invoices = store.listInvoices().filter((i) => i.contractId === contract.id);
  const billed = cents(invoices.reduce((a, i) => a + invoiceTotal(i), 0));
  const paid = cents(invoices.reduce((a, i) => a + invoicePaid(i), 0));
  return { original, cos, coTotal, adjusted, invoices, billed, paid, balance: cents(adjusted - paid), unbilled: cents(adjusted - billed) };
}

// Lines not yet put on an invoice: the contract's schedule (down payment + progress
// payments) and signed change orders.
function unbilledLines(contract) {
  const used = new Set(store.listInvoices().filter((i) => i.contractId === contract.id)
    .flatMap((i) => (i.items || []).map((it) => it.source).filter(Boolean)));
  const lines = [];
  const down = f.parseMoney(contract.downPayment);
  if (down) lines.push({ source: 'down', description: 'Down payment', amount: cents(down) });
  (contract.payments || []).forEach((p, i) => {
    if (f.parseMoney(p.amount)) lines.push({ source: `pay-${i}`, description: p.description || `Progress payment ${i + 1}`, amount: cents(f.parseMoney(p.amount)) });
  });
  changeOrdersFor(contract.id).forEach((c) => lines.push({ source: `co-${c.id}`, description: `Change Order #${c.number}`, amount: c.amount }));
  return lines.filter((l) => !used.has(l.source));
}

module.exports = { cents, changeOrdersFor, invoiceTotal, invoicePaid, invoiceStatus, summary, contractLedger, unbilledLines };
