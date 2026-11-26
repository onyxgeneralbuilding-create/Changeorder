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

// "Contract HIC-1001" or "Change Order #1004"
const docName = (d) => (d.type === 'hic' ? `Contract ${d.number}` : `Change Order #${d.number}`);

// Totals for a whole contract (or a stand-alone change order) across all its invoices.
function contractLedger(contract) {
  if (contract.type !== 'hic') {
    const amount = cents(Math.max(0, f.signedAmount(contract)));
    const invoices = store.listInvoices().filter((i) => i.contractId === contract.id);
    const billed = cents(invoices.reduce((a, i) => a + invoiceTotal(i), 0));
    const paid = cents(invoices.reduce((a, i) => a + invoicePaid(i), 0));
    return { isCO: true, original: amount, cos: [], coTotal: 0, adjusted: amount, invoices, billed, paid, balance: cents(amount - paid), unbilled: cents(amount - billed) };
  }
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
  // Schedule lines are per contract; a change order can only ever be billed once, anywhere.
  const all = store.listInvoices();
  const used = new Set([
    ...all.filter((i) => i.contractId === contract.id).flatMap((i) => (i.items || []).map((it) => it.source).filter(Boolean)),
    ...all.flatMap((i) => (i.items || []).map((it) => it.source).filter((s) => s && s.startsWith('co-'))),
  ]);
  if (contract.type !== 'hic') {
    const amount = cents(f.signedAmount(contract));
    const first = String(contract.description || '').split('\n')[0].slice(0, 90);
    return amount > 0 && !used.has(`co-${contract.id}`)
      ? [{ source: `co-${contract.id}`, description: `Change Order #${contract.number}${first ? ` — ${first}` : ''}`, amount }] : [];
  }
  const lines = [];
  const down = f.parseMoney(contract.downPayment);
  if (down) lines.push({ source: 'down', description: 'Down payment', amount: cents(down) });
  (contract.payments || []).forEach((p, i) => {
    if (f.parseMoney(p.amount)) lines.push({ source: `pay-${i}`, description: p.description || `Progress payment ${i + 1}`, amount: cents(f.parseMoney(p.amount)) });
  });
  changeOrdersFor(contract.id).forEach((c) => lines.push({ source: `co-${c.id}`, description: `Change Order #${c.number}`, amount: c.amount }));
  return lines.filter((l) => !used.has(l.source));
}

// The contract a change order is linked to (if that contract still exists).
function parentContract(co) {
  const p = co && co.type !== 'hic' && co.contractId && store.getOrder(co.contractId);
  return p && p.type === 'hic' ? p : null;
}
// Every invoice that bills this change order (its own, or a line on its contract's invoice).
function coInvoices(co) {
  return store.listInvoices().filter((i) => i.contractId === co.id || (i.items || []).some((it) => it.source === `co-${co.id}`));
}

module.exports = { cents, docName, parentContract, coInvoices, changeOrdersFor, invoiceTotal, invoicePaid, invoiceStatus, summary, contractLedger, unbilledLines };
