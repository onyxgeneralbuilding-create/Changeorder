function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return '';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function parseMoney(s) {
  if (s === undefined || s === null || s === '') return null;
  const v = Number(String(s).replace(/[$,\s]/g, ''));
  return isFinite(v) ? v : null;
}

// "2026-11-25" -> "11/25/2026"
function date(s) {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
}

function dateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ' PT';
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// Signed change of the contract price for this order (+ increase, - decrease).
function signedAmount(order) {
  const amt = Number(order.amount) || 0;
  if (order.priceDirection === 'increase') return amt;
  if (order.priceDirection === 'decrease') return -amt;
  return 0;
}

function priceSentence(order) {
  if (order.priceDirection === 'none' || !Number(order.amount)) {
    return 'This change order does not change the contract price.';
  }
  const verb = order.priceDirection === 'decrease' ? 'decreased' : 'increased';
  const terms = (order.paymentTerms || '').trim();
  let s = `The parties agree that the contract price is ${verb} by ${money(order.amount)}.`;
  if (terms) s += ` This amount is ${terms.replace(/\.$/, '')}.`;
  return s;
}

function timeSentence(order) {
  const days = Number(order.days) || 0;
  if (order.timeDirection === 'none' || !days) {
    return 'This change order does not change the time for completion of the contract.';
  }
  const verb = order.timeDirection === 'reduce' ? 'reduced' : 'extended';
  return `The time for completion of the contract is ${verb} by ${days} calendar day${days === 1 ? '' : 's'}.`;
}

module.exports = { money, parseMoney, date, dateTime, todayISO, signedAmount, priceSentence, timeSentence };
