// Customers tab: list with search, add/edit form, customer page with their documents.
const f = require('./format');
const { esc, layout, viewerIsOwner, badge } = require('./views');

const FIELDS = [
  ['ownerName', 'Name'], ['owner2Name', 'Second owner (optional)'],
  ['ownerAddress', 'Mailing address'], ['ownerCityStateZip', 'City, State & Zip'],
  ['ownerPhone', 'Phone'], ['ownerEmail', 'Email'],
  ['workAddress', 'Job address (if different)'], ['workCityStateZip', 'Job City, State & Zip'],
];

function customersPage({ company, rows, q, flash }) {
  const body = rows.map(({ c, docs, total }) => `<tr onclick="location='/customers/${c.id}'">
    <td><a href="/customers/${c.id}"><b>${esc(c.ownerName)}</b></a>${c.owner2Name ? `<div class="muted">&amp; ${esc(c.owner2Name)}</div>` : ''}</td>
    <td>${esc(c.ownerAddress)}<div class="muted">${esc(c.ownerCityStateZip)}</div></td>
    <td>${esc(c.ownerPhone)}<div class="muted">${esc(c.ownerEmail)}</div></td>
    <td class="num">${docs}</td>
    <td class="num">${total ? f.money(total) : '—'}</td>
  </tr>`).join('');
  return layout({
    title: 'Customers', admin: true, company, flash, active: 'customers',
    body: `<div class="row between wrap"><h1>Customers</h1><a class="btn" href="/customers/new">+ Add customer</a></div>
<form method="get" action="/customers" class="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search by name, address, phone or email" aria-label="Search customers"></form>
${rows.length ? `<div class="card flush tablescroll"><table class="list">
  <thead><tr><th>Customer</th><th>Address</th><th>Contact</th><th class="num">Documents</th><th class="num">Signed work</th></tr></thead>
  <tbody>${body}</tbody></table></div>`
    : `<div class="card empty">${q ? `No customers match “${esc(q)}”.` : 'No customers yet. <a href="/customers/new">Add your first customer</a>.'}</div>`}`,
  });
}

function customerForm({ company, customer: c = {}, isNew, error }) {
  const input = (k, label) => `<label>${esc(label)}<input name="${k}" value="${esc(c[k])}" ${k === 'ownerEmail' ? 'type="email"' : k.includes('Phone') || k.includes('Fax') ? 'type="tel"' : ''}></label>`;
  const by = Object.fromEntries(FIELDS);
  const pair = (a, b) => `<div class="grid g2">${input(a, by[a])}${input(b, by[b])}</div>`;
  return layout({
    title: isNew ? 'Add customer' : `Edit ${c.ownerName}`, admin: true, company, active: 'customers',
    body: `<h1>${isNew ? 'Add customer' : `Edit ${esc(c.ownerName)}`}</h1>
${error ? `<div class="flash error">${esc(error)}</div>` : ''}
<form method="post" action="${isNew ? '/customers' : `/customers/${c.id}`}" class="card form" novalidate>
  ${pair('ownerName', 'owner2Name')}
  ${pair('ownerAddress', 'ownerCityStateZip')}
  ${pair('ownerPhone', 'ownerEmail')}
  <h2>Job site</h2>
  <p class="hint">Leave blank if the work is at the mailing address.</p>
  ${pair('workAddress', 'workCityStateZip')}
  <label>Notes <span class="muted">(only you and your team see these)</span><textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>
  <div class="actions"><button class="btn">${isNew ? 'Save customer' : 'Save changes'}</button><a class="btn ghost" href="${isNew ? '/customers' : `/customers/${c.id}`}">Cancel</a></div>
</form>`,
  });
}

function customerDetail({ company, customer: c, docs, invoices, flash }) {
  const docRows = docs.map((o) => `<tr onclick="location='/orders/${o.id}'">
    <td><a href="/orders/${o.id}"><b>${o.type === 'hic' ? esc(o.number) : `#${esc(o.number)}`}</b></a><div class="muted">${o.type === 'hic' ? 'Contract' : 'Change order'}</div></td>
    <td>${esc(o.projectName)}</td>
    <td class="num">${o.type === 'hic' ? f.money(o.contractPrice) : o.priceDirection === 'none' ? '—' : (o.priceDirection === 'decrease' ? '− ' : '+ ') + f.money(o.amount)}</td>
    <td>${badge(o.status)}</td></tr>`).join('');
  const invRows = invoices.map(({ inv, sm }) => `<tr onclick="location='/invoices/${inv.id}'">
    <td><a href="/invoices/${inv.id}"><b>${esc(inv.number)}</b></a><div class="muted">${esc(f.date(inv.date))}</div></td>
    <td class="num">${f.money(sm.total)}</td><td class="num">${f.money(sm.paid)}</td><td class="num"><b>${f.money(sm.balance)}</b></td></tr>`).join('');
  const line = (a, b) => [a, b].filter(Boolean).map(esc).join('<br>');
  return layout({
    title: c.ownerName, admin: true, company, flash, active: 'customers',
    body: `<div class="row between wrap">
  <div><h1>${esc(c.ownerName)}${c.owner2Name ? ` <span class="muted">&amp; ${esc(c.owner2Name)}</span>` : ''}</h1>
  ${viewerIsOwner() && c.createdByName ? `<p class="muted">Customer of ${esc(c.createdByName)}</p>` : ''}</div>
  <div class="row gap wrap"><a class="btn" href="/contracts/new?customer=${c.id}">+ New contract</a><a class="btn" href="/orders/new?customer=${c.id}">+ New change order</a><a class="btn ghost" href="/customers/${c.id}/edit">Edit</a></div>
</div>
<div class="ledger">
  <div><span class="stat-label">Mailing address</span><span>${line(c.ownerAddress, c.ownerCityStateZip) || '—'}</span></div>
  <div><span class="stat-label">Job address</span><span>${line(c.workAddress, c.workCityStateZip) || 'Same as mailing'}</span></div>
  <div><span class="stat-label">Phone</span><span>${c.ownerPhone ? `<a href="tel:${esc(c.ownerPhone)}">${esc(c.ownerPhone)}</a>` : '—'}</span></div>
  <div><span class="stat-label">Email</span><span>${c.ownerEmail ? `<a href="mailto:${esc(c.ownerEmail)}">${esc(c.ownerEmail)}</a>` : '—'}</span></div>
</div>
${c.notes ? `<div class="card"><h2>Notes</h2><p class="pre">${esc(c.notes)}</p></div>` : ''}
<h2 class="stats-title">Contracts &amp; change orders</h2>
${docs.length ? `<div class="card flush tablescroll"><table class="list"><thead><tr><th>Document</th><th>Project</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${docRows}</tbody></table></div>` : '<p class="muted">None yet.</p>'}
<h2 class="stats-title" style="margin-top:1.6rem">Invoices</h2>
${invoices.length ? `<div class="card flush tablescroll"><table class="list"><thead><tr><th>Invoice</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>${invRows}</tbody></table></div>` : '<p class="muted">None yet.</p>'}
<form method="post" action="/customers/${c.id}/delete" onsubmit="return confirm('Remove ${esc(c.ownerName)} from Customers? Their contracts and invoices are kept.')" style="margin-top:2rem"><button class="link danger">Remove customer</button></form>`,
  });
}

module.exports = { FIELDS, customersPage, customerForm, customerDetail };
