// Invoices tab: list, new invoice, invoice detail with payments.
const f = require('./format');
const { esc, layout, viewerIsOwner } = require('./views');

const INV_STATUS = {
  draft: ['Draft', 'gray'],
  unpaid: ['Unpaid', 'blue'],
  partial: ['Partially paid', 'amber'],
  paid: ['Paid', 'green'],
  overdue: ['Overdue', 'red'],
};
const invBadge = (s) => { const [l, c] = INV_STATUS[s] || [s, 'gray']; return `<span class="badge ${c}">${esc(l)}</span>`; };
const METHODS = ['Check', 'Zelle', 'Credit card', 'Cash', 'Bank transfer', 'Other'];

function invoicesPage({ company, rows, filter, flash }) {
  const counts = rows.reduce((a, r) => ((a[r.sm.status] = (a[r.sm.status] || 0) + 1), a), {});
  const shown = filter ? rows.filter((r) => r.sm.status === filter) : rows;
  const tabs = [['', 'All', rows.length], ...Object.keys(INV_STATUS).map((k) => [k, INV_STATUS[k][0], counts[k] || 0])]
    .map(([k, l, n]) => `<a class="tab ${filter === k || (!filter && !k) ? 'on' : ''}" href="/invoices${k ? `?status=${k}` : ''}">${l} <span>${n}</span></a>`).join('');
  const body = shown.map(({ inv, c, sm }) => `<tr onclick="location='/invoices/${inv.id}'">
    <td><a href="/invoices/${inv.id}"><b>${esc(inv.number)}</b></a><div class="muted">${esc(f.date(inv.date))}${viewerIsOwner() && inv.createdByName ? ` · ${esc(inv.createdByName)}` : ''}</div></td>
    <td>${esc(c ? c.projectName : '')}<div class="muted">${esc(c ? c.ownerName : '')}${c ? ` · ${esc(c.number)}` : ''}</div></td>
    <td class="num">${f.money(sm.total)}</td>
    <td class="num">${f.money(sm.paid)}</td>
    <td class="num"><b>${f.money(sm.balance)}</b></td>
    <td>${invBadge(sm.status)}</td>
    <td class="muted">${inv.dueDate ? esc(f.date(inv.dueDate)) : 'On receipt'}</td>
  </tr>`).join('');
  return layout({
    title: 'Invoices', admin: true, company, flash, active: 'invoices',
    body: `<div class="row between wrap"><h1>Invoices</h1><a class="btn" href="/invoices/new">+ New invoice</a></div>
<div class="tabs">${tabs}</div>
${shown.length ? `<div class="card flush tablescroll"><table class="list">
  <thead><tr><th>Invoice</th><th>Project / Customer</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th>Due</th></tr></thead>
  <tbody>${body}</tbody></table></div>`
    : `<div class="card empty">No invoices here yet. <a href="/invoices/new">Create an invoice</a> from a contract.</div>`}`,
  });
}

function pickContract({ company, contracts }) {
  const list = contracts.map((c) => `<a class="card pick" href="/invoices/new?contract=${c.id}">
    <span class="muted small">${esc(c.number)} · ${esc(c.status === 'signed' ? 'Signed' : c.status)}</span>
    <h2>${esc(c.projectName)}</h2><p class="muted">${esc(c.ownerName)} · ${f.money(c.contractPrice)}</p></a>`).join('');
  return layout({
    title: 'New invoice', admin: true, company, active: 'invoices',
    body: `<h1>Which contract is this invoice for?</h1>
${contracts.length ? `<div class="choose">${list}</div>` : '<div class="card empty">You need a Home Improvement Contract first. <a href="/contracts/new">Create a contract</a>.</div>'}`,
  });
}

const methodBoxes = (methods, chosen) => methods.length
  ? methods.map((m) => `<label class="check"><input type="checkbox" name="payMethod" value="${m.key}" ${chosen.includes(m.key) ? 'checked' : ''}> <span><b>${esc(m.label)}</b> <span class="muted">${esc(m.detail)}</span></span></label>`).join('')
  : '<p class="muted">Add payment details in <a href="/settings#payments">Settings → Invoices</a>.</p>';

function invoiceForm({ company, contract: c, ledger, lines, number, error, form = {}, methods = [], preset = [] }) {
  const due = form.dueDate || (() => { const d = new Date(`${f.todayISO()}T12:00:00`); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const lineRows = lines.map((l, i) => `<label class="check invline"><input type="checkbox" name="src" value="${esc(l.source)}" ${i === 0 ? 'checked' : ''} data-amount="${l.amount}">
    <span class="grow">${esc(l.description)}</span><span class="num">${f.money(l.amount)}</span></label>`).join('');
  return layout({
    title: 'New invoice', admin: true, company, active: 'invoices',
    body: `<h1>New invoice</h1>
<p class="muted">${esc(c.number)} · ${esc(c.projectName)} · ${esc(c.ownerName)}</p>
${error ? `<div class="flash error">${esc(error)}</div>` : ''}
<div class="ledger">
  <div><span class="stat-label">Contract</span><b>${f.money(ledger.original)}</b></div>
  <div><span class="stat-label">Change orders</span><b>${ledger.coTotal < 0 ? '− ' : '+ '}${f.money(Math.abs(ledger.coTotal))}</b></div>
  <div><span class="stat-label">Adjusted total</span><b>${f.money(ledger.adjusted)}</b></div>
  <div><span class="stat-label">Billed so far</span><b>${f.money(ledger.billed)}</b></div>
  <div><span class="stat-label">Paid so far</span><b>${f.money(ledger.paid)}</b></div>
</div>
<form method="post" action="/invoices" class="card form" id="invForm" novalidate>
  <input type="hidden" name="contractId" value="${esc(c.id)}">
  <div class="grid g3">
    <label>Invoice #<input name="number" value="${esc(form.number || number)}"></label>
    <label>Invoice date<input type="date" name="date" value="${esc(form.date || f.todayISO())}"></label>
    <label>Due date<input type="date" name="dueDate" value="${esc(due)}"></label>
  </div>
  <h2>What are you billing for?</h2>
  ${lines.length ? `<p class="hint">From the contract’s payment schedule and signed change orders that haven’t been invoiced yet. California law: bill only for work completed or materials delivered.</p>${lineRows}` : '<p class="muted">Everything on the payment schedule has been invoiced. Add a custom line below if needed.</p>'}
  <span class="lbl" style="margin-top:1.2rem">Other line <span class="muted">(optional)</span></span>
  <div class="payrow"><label>Amount ($)<input name="customAmount" inputmode="decimal" placeholder="0.00"></label><label>Description<input name="customDesc" placeholder="e.g. Additional work per change order"></label></div>
  <p class="invtotal">Invoice total: <b id="invTotal">$0.00</b></p>
  <h2>How the customer can pay</h2>
  <p class="hint">Only the methods you check are printed on the invoice. Choose which are checked automatically in <a href="/settings#payments">Settings → Invoices</a>.</p>
  ${methodBoxes(methods, form.payMethod ? [].concat(form.payMethod) : preset)}
  <label>Notes on the invoice <span class="muted">(optional)</span><textarea name="notes" rows="2">${esc(form.notes)}</textarea></label>
  <div class="actions"><button class="btn">Create invoice</button><a class="btn ghost" href="/invoices">Cancel</a></div>
</form>
<script>
  const form = document.getElementById('invForm');
  const num = (v) => { v = String(v || '').replace(/[$\\s]/g, ''); const n = Number(v.replace(/,/g, '')); return isFinite(n) ? n : 0; };
  function upd() {
    let t = 0; form.querySelectorAll('[name=src]:checked').forEach((c) => { t += Number(c.dataset.amount); });
    t += num(form.elements.customAmount.value);
    document.getElementById('invTotal').textContent = t.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
  form.addEventListener('submit', () => { form.querySelector('.actions .btn').textContent = 'Creating…'; });
</script>`,
  });
}

function invoiceDetail({ company, invoice: inv, contract: c, ledger, sm, settings, flash, emailReady, methods = [], chosen = [] }) {
  const owner = viewerIsOwner();
  const pays = (inv.payments || []).map((p) => {
    const rel = p.release || {};
    let relHtml = '';
    if (rel.signedAt) relHtml = `<span class="badge green">Lien release sent</span> <a class="small" href="/invoices/${inv.id}/payments/${p.id}/release" target="_blank">View</a>`;
    else if (owner && settings.contractorSignature) relHtml = `<form method="post" action="/invoices/${inv.id}/payments/${p.id}/release" class="inline"><button class="btn ghost small">${p.method === 'Check' ? 'Check cleared · sign &amp; send lien release' : 'Sign &amp; send lien release'}</button></form>`;
    else if (owner) relHtml = '<span class="muted small">Save your signature in Settings to send lien releases.</span>';
    else relHtml = '<span class="badge amber">Lien release waiting for owner</span>';
    return `<li>
      <div class="row between"><b>${f.money(p.amount)}</b><span class="muted small">${esc(f.date(p.date))}</span></div>
      <div class="muted small">${esc(p.method)}${p.reference ? ` #${esc(p.reference)}` : ''} · ${esc(p.receiptNumber)}${p.byName ? ` · recorded by ${esc(p.byName)}` : ''}</div>
      <div class="row gap wrap paylinks"><a class="small" href="/invoices/${inv.id}/payments/${p.id}/receipt" target="_blank">Receipt PDF</a> ${relHtml}</div>
      <form method="post" action="/invoices/${inv.id}/payments/${p.id}/delete" onsubmit="return confirm('Remove this payment record? Use this only to fix a mistake.')"><button class="link danger small">Remove payment</button></form>
    </li>`;
  }).join('');
  const events = [...(inv.events || [])].reverse().map((e) => `<li><span class="muted">${esc(f.dateTime(e.at))}</span> ${esc(e.text)}</li>`).join('');
  const methodOpts = METHODS.map((m) => `<option>${m}</option>`).join('');
  return layout({
    title: inv.number, admin: true, company, flash, active: 'invoices',
    body: `<div class="row between wrap">
  <div><h1>Invoice ${esc(inv.number)} ${invBadge(sm.status)}</h1>
  <p class="muted">${esc(c.projectName)} · ${esc(c.ownerName)} · <a href="/orders/${c.id}">${esc(c.number)}</a>${owner && inv.createdByName ? ` · ${esc(inv.createdByName)}` : ''}</p></div>
  <div class="row gap wrap"><a class="btn ghost" href="/invoices/${inv.id}/pdf?download=1">Download PDF</a></div>
</div>
<div class="ledger">
  <div><span class="stat-label">Invoice total</span><b>${f.money(sm.total)}</b></div>
  <div><span class="stat-label">Paid</span><b>${f.money(sm.paid)}</b></div>
  <div><span class="stat-label">Balance due</span><b>${f.money(sm.balance)}</b></div>
  <div><span class="stat-label">Contract balance</span><b>${f.money(ledger.balance)}</b></div>
</div>
<div class="detail">
  <div class="card flush pdfwrap"><iframe src="/invoices/${inv.id}/pdf#view=FitH" title="Invoice PDF"></iframe></div>
  <div class="side">
    ${sm.balance > 0 ? `<div class="card">
      <h2>Record a payment</h2>
      <form method="post" action="/invoices/${inv.id}/payments" class="form" novalidate>
        <div class="grid g2">
          <label>Amount ($)<input name="amount" inputmode="decimal" value="${sm.balance.toFixed(2)}"></label>
          <label>Date<input type="date" name="date" value="${f.todayISO()}"></label>
        </div>
        <div class="grid g2">
          <label>Method<select name="method">${methodOpts}</select></label>
          <label>Check # / reference<input name="reference"></label>
        </div>
        <label>Note <span class="muted">(optional)</span><input name="note"></label>
        <label class="check"><input type="checkbox" name="emailReceipt" value="1" ${c.ownerEmail ? 'checked' : ''}> Email the receipt to ${esc(c.ownerEmail || 'the customer')}</label>
        ${owner ? '<p class="hint">For cash, Zelle and bank transfers, the lien release is signed and sent with the receipt. For checks, it waits until you mark the check cleared.</p>' : '<p class="hint">The customer gets the receipt now. The lien release is signed by the owner.</p>'}
        <button class="btn">Record payment</button>
      </form>
    </div>` : '<div class="card ok"><h2>Paid in full</h2><p>This invoice is fully paid.</p></div>'}
    ${pays ? `<div class="card"><h2>Payments</h2><ul class="events paylist">${pays}</ul></div>` : ''}
    <div class="card">
      <h2>Send invoice</h2>
      <form method="post" action="/invoices/${inv.id}/send" class="form" novalidate>
        <label>Customer email<input type="email" name="email" value="${esc(c.ownerEmail)}"></label>
        ${emailReady ? '' : '<p class="hint warn">Email isn’t set up yet.</p>'}
        <label>Message <span class="muted">(optional)</span><textarea name="note" rows="2"></textarea></label>
        <button class="btn ghost">${inv.sentAt ? 'Send again' : 'Email invoice'}</button>
      </form>
    </div>
    <div class="card">
      <h2>Payment methods shown</h2>
      <form method="post" action="/invoices/${inv.id}/methods" class="form" novalidate>
        ${methodBoxes(methods, chosen)}
        ${methods.length ? '<button class="btn ghost small">Update invoice</button>' : ''}
      </form>
    </div>
    <div class="card"><h2>History</h2><ul class="events">${events}</ul></div>
    ${(inv.payments || []).length ? '' : `<form method="post" action="/invoices/${inv.id}/delete" onsubmit="return confirm('Delete invoice ${esc(inv.number)}?')"><button class="link danger">Delete invoice</button></form>`}
  </div>
</div>`,
  });
}

module.exports = { invoicesPage, pickContract, invoiceForm, invoiceDetail, invBadge, METHODS };
