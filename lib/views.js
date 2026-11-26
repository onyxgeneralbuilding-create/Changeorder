// HTML page templates.
const f = require('./format');
const ctx = require('./context');
const viewerIsOwner = () => { const v = ctx.viewer(); return !v || v.role === 'owner'; };
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Version stamp for CSS/JS so browsers fetch new files right after an update.
const ASSET_V = crypto.createHash('md5')
  .update(['style.css', 'signature.js', 'address.js'].map((n) => fs.readFileSync(path.join(__dirname, '..', 'public', n))).join(''))
  .digest('hex').slice(0, 8);

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STATUS = {
  draft: ['Draft', 'gray'],
  sent: ['Sent', 'blue'],
  viewed: ['Viewed', 'amber'],
  signed: ['Signed', 'green'],
  declined: ['Declined', 'red'],
};
const isContract = (o) => o && o.type === 'hic';
const docTitle = (o) => (isContract(o) ? `Home Improvement Contract ${o.number}` : `Change Order #${o.number}`);
const docWord = (o) => (isContract(o) ? 'contract' : 'change order');

const badge = (status) => {
  const [label, color] = STATUS[status] || [status, 'gray'];
  return `<span class="badge ${color}">${esc(label)}</span>`;
};

function layout({ title, body, admin = false, flash, company, active = 'documents' }) {
  const nav = (key, href, label) => `<a href="${href}"${active === key ? ' class="on" aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(admin || title === 'Log in' ? company.appName || company.name : company.name)}</title>
<link rel="icon" href="/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/style.css?v=${ASSET_V}">
</head>
<body class="${admin ? 'admin' : 'public'}">
<header class="topbar">
  <a class="brand" href="${admin ? '/dashboard' : '#'}"><img src="/logo.png" alt=""><span>${esc(admin ? company.appName || company.name : company.name)}</span></a>
  ${admin ? `<nav>
    ${nav('dashboard', '/dashboard', 'Dashboard')}
    ${nav('documents', '/', 'Documents')}
    ${nav('invoices', '/invoices', 'Invoices')}
    ${nav('customers', '/customers', 'Customers')}
    ${nav('estimates', '/estimates', 'Estimates')}
    <a href="/new" class="btn small">+ New</a>
    ${viewerIsOwner() ? nav('settings', '/settings', 'Settings') : `<span class="who">${esc(ctx.viewer().name)}</span>`}
    <form method="post" action="/logout"><button class="link">Log out</button></form>
  </nav>` : ''}
</header>
<main>
${flash ? `<div class="flash ${esc(flash.type || 'ok')}">${esc(flash.text)}</div>` : ''}
${body}
</main>
${admin ? `<script src="/address.js?v=${ASSET_V}"></script>` : ''}
<script>
  // Every form: show "Saving…" and ignore a second tap while the page loads.
  document.querySelectorAll('form').forEach((fm) => fm.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return;
    if (fm.dataset.busy) { e.preventDefault(); return; }
    fm.dataset.busy = '1';
    const b = e.submitter || fm.querySelector('button:not([type=button])');
    if (b && !b.classList.contains('link')) { b.dataset.label = b.textContent; b.textContent = 'Saving…'; b.setAttribute('aria-busy', 'true'); }
    setTimeout(() => { delete fm.dataset.busy; if (b && b.dataset.label) b.textContent = b.dataset.label; }, 15000);
  }));
</script>
<footer class="foot">${esc(company.name)} · ${esc(company.address)}, ${esc(company.cityStateZip)} · ${esc(company.phone)} · CSLB Lic. #${esc(company.license)}</footer>
</body>
</html>`;
}

function login({ company, error, username = '' }) {
  return layout({
    title: 'Log in',
    company,
    body: `<div class="card narrow">
  <h1>${esc(company.appName || 'Log in')}</h1>
  <p class="muted">Log in to manage contracts and change orders.</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/login" class="form">
    <label>Username <span class="muted">(leave blank if you’re the owner)</span><input name="username" value="${esc(username)}" autocapitalize="none" autocorrect="off" autocomplete="username"></label>
    <label>Password
      <span class="pw"><input type="password" name="password" id="pw" required autocomplete="current-password"><button type="button" class="link" id="pwShow" aria-controls="pw">Show</button></span>
    </label>
    <button class="btn">Log in</button>
  </form>
</div>
<script>
  const pw = document.getElementById('pw'), b = document.getElementById('pwShow');
  b.addEventListener('click', () => { const show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; });
</script>`,
  });
}

// Yearly totals for the dashboard tiles. A document counts in the year of its date.
function yearStats(orders, year) {
  const inYear = orders.filter((o) => String(o.date || o.createdAt || '').slice(0, 4) === String(year));
  const signed = (o) => o.status === 'signed';
  const waiting = (o) => ['sent', 'viewed'].includes(o.status);
  const contracts = inYear.filter(isContract);
  const cos = inYear.filter((o) => !isContract(o));
  const sum = (list, fn) => list.reduce((a, o) => a + (fn(o) || 0), 0);
  const coAmt = (o) => (o.priceDirection === 'decrease' ? -1 : o.priceDirection === 'increase' ? 1 : 0) * (Number(o.amount) || 0);
  const signedContracts = contracts.filter(signed);
  const signedCos = cos.filter(signed);
  const contractValue = sum(signedContracts, (o) => Number(o.contractPrice));
  const coValue = sum(signedCos, coAmt);
  const pending = inYear.filter(waiting);
  return {
    contracts: { count: signedContracts.length, value: contractValue, total: contracts.length },
    changeOrders: { count: signedCos.length, value: coValue, total: cos.length },
    combined: contractValue + coValue,
    pending: { count: pending.length, value: sum(pending, (o) => (isContract(o) ? Number(o.contractPrice) : coAmt(o))) },
    drafts: inYear.filter((o) => o.status === 'draft').length,
  };
}

// Renewal dates: Settings override the certificate dates in config/company.json.
function renewals(company, settings = {}) {
  const ins = company.insurance || {};
  return [
    { label: 'General liability', who: settings.insuranceCompany || ins.cglCompany, policy: ins.cglPolicy, date: settings.cglExpires || ins.cglExpires },
    { label: 'Workers’ comp', who: settings.wcCompany || ins.wcCompany, policy: ins.wcPolicy, date: settings.wcExpires || ins.wcExpires },
    { label: 'Contractor license', who: `CSLB #${company.license}`, date: settings.licenseExpires || company.licenseExpires },
  ];
}

// One expiration tile. Owners can tap through to edit; team members just see it.
function dateTile(x, href) {
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
  const tag = href ? 'a' : 'div';
  const link = href ? ` href="${href}"` : '';
  if (!x.date) {
    return `<${tag} class="stat renew none"${link}><span class="stat-label">${esc(x.label)}</span><span class="stat-num small">${href ? 'Add date' : 'No date yet'}</span><span class="stat-sub">${esc(x.who || '')}${href ? ' · set the expiration date in Settings' : ' · ask the owner to add it'}</span></${tag}>`;
  }
  const days = Math.round((new Date(x.date) - today) / 86400000);
  const state = days < 0 ? 'expired' : days <= 60 ? 'soon' : 'ok';
  const when = days < 0 ? `Expired ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} left`;
  return `<${tag} class="stat renew ${state}"${link}><span class="stat-label">${esc(x.label)}</span><span class="stat-num">${esc(f.date(x.date))}</span><span class="stat-sub"><b>${when}</b>${x.who ? ` · ${esc(x.who)}` : ''}${x.policy ? ` · ${esc(x.policy)}` : ''}</span></${tag}>`;
}

const salespersonTile = (u, href) => dateTile({ label: href ? `Salesperson card · ${u.name}` : 'Salesperson card', who: u.hisNumber ? `HIS #${u.hisNumber}` : (href ? '' : u.name), date: u.hisExpires }, href);

function renewalTiles(company, settings, rv, team = []) {
  const section = (title, tiles) => `<section class="stats-wrap" aria-label="${title}"><h2 class="stats-title">${title}</h2><div class="stats">${tiles}</div></section>`;
  if (!viewerIsOwner()) {
    return section('Business', reviewTile(rv) + team.map((u) => salespersonTile(u, null)).join(''));
  }
  // Owner: company items in Business; each team member's card gets its own full-width Team row.
  return section('Business', reviewTile(rv) + renewals(company, settings).map((x) => dateTile(x, '/settings#renewals')).join(''))
    + (team.length ? section('Team', team.map((u) => salespersonTile(u, '/settings#team')).join('')) : '');
}

function reviewTile(rv) {
  if ((!rv || !rv.configured) && !viewerIsOwner()) return '';
  if (!rv || !rv.configured) {
    return `<a class="stat review none" href="/settings#google"><span class="stat-label">Google reviews</span><span class="stat-num small">Connect</span><span class="stat-sub">Show your live Google rating and review count here</span></a>`;
  }
  if (rv.rating == null && rv.count == null) {
    return `<a class="stat review none" href="/settings#google"><span class="stat-label">Google reviews</span><span class="stat-num small">Not available</span><span class="stat-sub">${esc(rv.error || 'Check your Place ID in Settings')}</span></a>`;
  }
  const full = Math.round((rv.rating || 0) * 2) / 2;
  const stars = Array.from({ length: 5 }, (_, i) => (i + 1 <= full ? '★' : i + 0.5 === full ? '⯪' : '☆')).join('');
  const gain = (n, w) => (n == null ? '' : ` · <b>${n > 0 ? '+' : ''}${n}</b> ${w}`);
  return `<a class="stat review" href="${esc(rv.uri || '#')}" target="_blank" rel="noopener">
    <span class="stat-label">Google reviews</span>
    <span class="stat-num">${rv.rating != null ? rv.rating.toFixed(1) : '—'} <span class="stars" aria-hidden="true">${stars}</span></span>
    <span class="stat-sub">${rv.count} review${rv.count === 1 ? '' : 's'}${gain(rv.monthGain, 'this month')}${gain(rv.yearGain, 'this year')}${rv.error ? ' · last update failed' : ''}</span>
  </a>`;
}

function dashboard({ company, orders, flash, year, settings = {}, reviews: rv, team = [], money = null }) {
  const thisYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 4));
  const years = [...new Set([thisYear, ...orders.map((o) => Number(String(o.date || o.createdAt || '').slice(0, 4))).filter(Boolean)])].sort((a, b) => b - a);
  const yr = years.includes(Number(year)) ? Number(year) : thisYear;
  const st = yearStats(orders, yr);
  const signedMoney = (n) => (n < 0 ? '−' : '') + f.money(Math.abs(n));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const statsHtml = `<section class="stats-wrap" aria-label="Totals for ${yr}">
  <div class="row between wrap"><h2 class="stats-title">${yr} at a glance</h2>
    <div class="yearpick">${years.map((y) => `<a class="tab ${y === yr ? 'on' : ''}" href="/dashboard?year=${y}">${y}</a>`).join('')}</div></div>
  <div class="stats">
    <div class="stat"><span class="stat-label">Signed contracts</span><span class="stat-num">${f.money(st.contracts.value)}</span><span class="stat-sub">${plural(st.contracts.count, 'contract')} signed${st.contracts.total > st.contracts.count ? ` · ${st.contracts.total} created` : ''}</span></div>
    <div class="stat"><span class="stat-label">Signed change orders</span><span class="stat-num">${signedMoney(st.changeOrders.value)}</span><span class="stat-sub">${plural(st.changeOrders.count, 'change order')} signed</span></div>
    <div class="stat total"><span class="stat-label">Total signed work</span><span class="stat-num">${signedMoney(st.combined)}</span><span class="stat-sub">Contracts + change orders</span></div>
    <div class="stat"><span class="stat-label">Waiting for signature</span><span class="stat-num">${st.pending.count}</span><span class="stat-sub">${st.pending.count ? `${signedMoney(st.pending.value)} sent, not yet signed` : 'Nothing waiting'}${st.drafts ? ` · ${plural(st.drafts, 'draft')}` : ''}</span></div>
  </div>
</section>`;
  return layout({
    title: 'Dashboard',
    admin: true,
    company,
    flash,
    active: 'dashboard',
    body: `<div class="row between wrap"><h1>${viewerIsOwner() ? 'Dashboard' : `${esc(ctx.viewer().name)}’s dashboard`}</h1><a class="btn ghost" href="/">View documents</a></div>
${statsHtml}
${money ? `<section class="stats-wrap" aria-label="Payments"><h2 class="stats-title">Payments</h2><div class="stats">
  <a class="stat" href="/invoices"><span class="stat-label">Collected in ${esc(money.year)}</span><span class="stat-num">${f.money(money.collected)}</span><span class="stat-sub">Payments recorded this year</span></a>
  <a class="stat" href="/invoices?status=unpaid"><span class="stat-label">Outstanding</span><span class="stat-num">${f.money(money.outstanding)}</span><span class="stat-sub">Invoiced, not yet paid</span></a>
  <a class="stat renew ${money.overdueCount ? 'expired' : 'ok'}" href="/invoices?status=overdue"><span class="stat-label">Overdue</span><span class="stat-num">${f.money(money.overdue)}</span><span class="stat-sub">${money.overdueCount ? `<b>${money.overdueCount} invoice${money.overdueCount === 1 ? '' : 's'} past due</b>` : 'Nothing past due'}</span></a>
  <a class="stat renew ${money.releases ? 'soon' : 'ok'}" href="/invoices"><span class="stat-label">Lien releases</span><span class="stat-num">${money.releases}</span><span class="stat-sub">${money.releases ? `<b>waiting to be signed</b>${viewerIsOwner() ? '' : ' by the owner'}` : 'All payments released'}</span></a>
</div></section>` : ''}
${renewalTiles(company, settings, rv, team)}`,
  });
}

function documentsPage({ company, orders, flash, filter }) {
  const counts = orders.reduce((a, o) => ((a[o.status] = (a[o.status] || 0) + 1), a), {});
  const shown = filter ? orders.filter((o) => o.status === filter) : orders;
  const tabs = [['', 'All', orders.length], ...Object.keys(STATUS).map((k) => [k, STATUS[k][0], counts[k] || 0])]
    .map(([k, l, n]) => `<a class="tab ${filter === k || (!filter && !k) ? 'on' : ''}" href="/${k ? `?status=${k}` : ''}">${l} <span>${n}</span></a>`)
    .join('');
  const rows = shown.map((o) => `<tr onclick="location='/orders/${o.id}'">
    <td><a href="/orders/${o.id}"><b>${isContract(o) ? esc(o.number) : `#${esc(o.number)}`}</b></a><div class="muted">${isContract(o) ? 'Contract' : 'Change order'}${viewerIsOwner() && o.createdByName ? ` · ${esc(o.createdByName)}` : ''}</div></td>
    <td>${esc(o.projectName)}<div class="muted">${esc(o.ownerName)}</div></td>
    <td class="num">${isContract(o) ? f.money(o.contractPrice) : o.priceDirection === 'none' ? '—' : (o.priceDirection === 'decrease' ? '− ' : '+ ') + f.money(o.amount)}</td>
    <td>${badge(o.status)}</td>
    <td class="muted">${esc(f.dateTime(o.updatedAt))}</td>
  </tr>`).join('');
  return layout({
    title: 'Documents',
    admin: true,
    company,
    flash,
    body: `<div class="row between wrap"><h1>${viewerIsOwner() ? 'Contracts &amp; Change Orders' : `${esc(ctx.viewer().name)}’s documents`}</h1><div class="row gap wrap"><a class="btn" href="/contracts/new">+ New contract</a><a class="btn" href="/orders/new">+ New change order</a></div></div>
<div class="tabs">${tabs}</div>
${shown.length ? `<div class="card flush tablescroll"><table class="list">
  <thead><tr><th>Document</th><th>Project / Owner</th><th class="num">Amount</th><th>Status</th><th>Last activity</th></tr></thead>
  <tbody>${rows}</tbody></table></div>`
    : `<div class="card empty">Nothing here yet. Create a <a href="/contracts/new">contract</a> or a <a href="/orders/new">change order</a>.</div>`}`,
  });
}

// "Choose a saved customer" box + "save to Customers" checkbox, shared by the forms.
function customerPicker(customers, o, isNew) {
  const chosen = o.customerId && customers.find((c) => c.id === o.customerId);
  return `<div class="prefill">
    <input type="hidden" name="customerId" value="${esc(o.customerId)}">
    ${customers.length ? `<label>Customer
      <select id="pastCustomer"><option value="">— New customer (type below) —</option>
      ${customers.map((c) => `<option value="${esc(c.id)}" ${chosen && chosen.id === c.id ? 'selected' : ''}>${esc(c.ownerName)}${c.owner2Name ? ` &amp; ${esc(c.owner2Name)}` : ''}${c.ownerCityStateZip ? ` · ${esc(c.ownerCityStateZip)}` : ''}</option>`).join('')}
      </select></label>` : '<p class="muted small">Customers you save are listed here next time.</p>'}
    ${isNew ? `<label class="check" id="saveCustWrap" ${chosen ? 'hidden' : ''}><input type="checkbox" name="saveCustomer" value="1" checked> Save this customer to Customers</label>` : ''}
  </div>`;
}

function radio(name, value, current, label) {
  return `<label class="choice"><input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''}> ${label}</label>`;
}

function orderForm({ company, order, isNew, pastCustomers, error, contracts = [] }) {
  const o = order;
  const v = (k) => esc(o[k]);
  return layout({
    title: isNew ? 'New change order' : `Edit #${o.number}`,
    admin: true,
    company,
    body: `<h1>${isNew ? 'New change order' : `Edit change order #${esc(o.number)}`}</h1>
${error ? `<div class="flash error">${esc(error)}</div>` : ''}
<form method="post" action="${isNew ? '/orders' : `/orders/${o.id}`}" class="card form" id="coForm" novalidate>
  ${customerPicker(pastCustomers, o, isNew)}

  <h2>Change order</h2>
  ${contracts.length ? `<label>Related contract <span class="muted">(so this change order is added to that contract’s invoices)</span>
    <select name="contractId" id="contractPick"><option value="">— None —</option>
    ${contracts.map((c) => `<option value="${esc(c.id)}" ${o.contractId === c.id ? 'selected' : ''}>${esc(c.number)} · ${esc(c.projectName)} · ${esc(c.ownerName)}</option>`).join('')}
    </select></label>` : ''}
  <div class="grid g3">
    <label>Change order #<input name="number" value="${v('number')}" required></label>
    <label>Date<input type="date" name="date" value="${v('date')}" required></label>
    <label>Original contract date<input type="date" name="contractDate" value="${v('contractDate')}"></label>
  </div>
  <label>Project<input name="projectName" value="${v('projectName')}" placeholder="e.g. Garcia Kitchen Remodel" required></label>
  <div class="field">
    <span class="lbl">Check box at the top of the form</span>
    ${radio('copyFor', 'owner', o.copyFor, 'Owner')}
    ${radio('copyFor', 'architect', o.copyFor, 'Architect')}
    ${radio('copyFor', 'contractor', o.copyFor, 'Contractor')}
    ${radio('copyFor', 'field', o.copyFor, 'Field')}
    ${radio('copyFor', 'other', o.copyFor, 'Other')}
    ${radio('copyFor', '', o.copyFor || '', 'None')}
  </div>

  <h2>Owner</h2>
  <div class="grid g2">
    <label>Owner name<input name="ownerName" value="${v('ownerName')}" required></label>
    <label>Second owner <span class="muted">(optional)</span><input name="owner2Name" value="${v('owner2Name')}"></label>
  </div>
  <div class="grid g2">
    <label>Address<input name="ownerAddress" value="${v('ownerAddress')}"></label>
    <label>City, State &amp; Zip<input name="ownerCityStateZip" value="${v('ownerCityStateZip')}"></label>
  </div>
  <div class="grid g2">
    <label>Phone<input type="tel" name="ownerPhone" value="${v('ownerPhone')}"></label>
    <label>Email<input type="email" name="ownerEmail" value="${v('ownerEmail')}"></label>
  </div>

  <h2>Work</h2>
  <div class="field">
    <span class="lbl">Will a subcontractor be used on the project?</span>
    ${radio('subcontractors', 'yes', o.subcontractors, 'Yes')}
    ${radio('subcontractors', 'no', o.subcontractors, 'No')}
  </div>
  <label>Describe work requested
    <textarea name="description" rows="10" required>${v('description')}</textarea>
    <span class="hint">About 20 lines fit on the form; longer descriptions continue on an attached page.</span>
  </label>

  <h2>Price &amp; time</h2>
  <div class="field">
    <span class="lbl">Contract price is</span>
    ${radio('priceDirection', 'increase', o.priceDirection, 'Increased')}
    ${radio('priceDirection', 'decrease', o.priceDirection, 'Decreased')}
    ${radio('priceDirection', 'none', o.priceDirection, 'No change')}
  </div>
  <label class="short">Amount ($)<input name="amount" inputmode="decimal" value="${v('amount')}" placeholder="0.00"></label>
  <div class="field">
    <span class="lbl">Time for completion is</span>
    ${radio('timeDirection', 'extend', o.timeDirection, 'Extended')}
    ${radio('timeDirection', 'reduce', o.timeDirection, 'Reduced')}
    ${radio('timeDirection', 'none', o.timeDirection, 'No change')}
  </div>
  <label class="short">Days<input name="days" inputmode="numeric" value="${v('days')}" placeholder="0"></label>

  <div class="actions">
    <button class="btn">${isNew ? 'Save &amp; preview' : 'Save changes'}</button>
    <a class="btn ghost" href="${isNew ? '/' : `/orders/${o.id}`}">Cancel</a>
  </div>
</form>
<script>
  const past = ${JSON.stringify(pastCustomers).replace(/</g, '\\u003c')};
  document.getElementById('coForm').addEventListener('submit', (e) => {
    const b = e.target.querySelector('button.btn'); if (b) { b.textContent = 'Saving…'; }
  });
  const sel = document.getElementById('pastCustomer');
  const fill = (c) => {
    for (const k of Object.keys(c)) {
      const el = document.querySelector('[name="' + k + '"]');
      if (el && el.type !== 'radio' && el.tagName !== 'SELECT' && k !== 'id' && k !== 'number') el.value = c[k] || '';
    }
  };
  const pickCust = () => {
    const c = past.find((x) => x.id === sel.value);
    document.querySelector('[name=customerId]').value = c ? c.id : '';
    const w = document.getElementById('saveCustWrap'); if (w) w.hidden = Boolean(c);
    if (c) fill(c);
  };
  if (sel) sel.addEventListener('change', pickCust);
  const contracts = ${JSON.stringify(contracts).replace(/</g, '\\u003c')};
  const cp = document.getElementById('contractPick');
  if (cp) cp.addEventListener('change', () => { const c = contracts.find((x) => x.id === cp.value); if (c) fill(c); });
</script>`,
  });
}

function newChooser({ company }) {
  return layout({
    title: 'New',
    admin: true,
    company,
    body: `<h1>What do you want to create?</h1>
<div class="choose">
  <a class="card pick" href="/contracts/new"><h2>Home Improvement Contract</h2><p class="muted">The main contract for a new job: scope, price, down payment, progress payments, right to cancel and arbitration. 5 pages.</p></a>
  <a class="card pick" href="/invoices/new"><h2>Invoice</h2><p class="muted">Bill a customer for a completed stage of a contract, record payments, and send receipts and lien releases.</p></a>
  <a class="card pick" href="/orders/new"><h2>Change Order</h2><p class="muted">A change to an existing contract: extra or reduced work, price and schedule. 1 page.</p></a>
</div>`,
  });
}

function contractForm({ company, order, isNew, pastCustomers, error }) {
  const o = order;
  const v = (k) => esc(o[k]);
  const pays = (o.payments || []).length ? o.payments : [{}, {}, {}];
  const payRow = (p = {}) => `<div class="payrow">
      <label>Amount ($)<input name="payAmount" inputmode="decimal" value="${esc(p.amount)}" placeholder="0.00"></label>
      <label>Work or services to be performed / materials supplied<input name="payDesc" value="${esc(p.description)}" placeholder="e.g. Foundation poured and inspected"></label>
      <label>Date<input type="date" name="payDate" value="${esc(p.date)}"></label>
      <button type="button" class="link danger rm" aria-label="Remove payment">Remove</button>
    </div>`;
  return layout({
    title: isNew ? 'New contract' : `Edit ${o.number}`,
    admin: true,
    company,
    body: `<h1>${isNew ? 'New home improvement contract' : `Edit contract ${esc(o.number)}`}</h1>
${error ? `<div class="flash error">${esc(error)}</div>` : ''}
<form method="post" action="${isNew ? '/contracts' : `/orders/${o.id}`}" class="card form" id="hicForm" novalidate>
  ${customerPicker(pastCustomers, o, isNew)}

  <h2>Contract</h2>
  <div class="grid g3">
    <label>Contract #<input name="number" value="${v('number')}"></label>
    <label>Date<input type="date" name="date" value="${v('date')}"></label>
    <label>Project name <span class="muted">(for your list)</span><input name="projectName" value="${v('projectName')}" placeholder="e.g. Aharon Game Room Addition"></label>
  </div>

  <h2>Property owner</h2>
  <div class="grid g2">
    <label>Owner name<input name="ownerName" value="${v('ownerName')}"></label>
    <label>Second owner <span class="muted">(optional)</span><input name="owner2Name" value="${v('owner2Name')}"></label>
  </div>
  <div class="grid g2">
    <label>Mailing address<input name="ownerAddress" value="${v('ownerAddress')}"></label>
    <label>City, State &amp; Zip<input name="ownerCityStateZip" value="${v('ownerCityStateZip')}"></label>
  </div>
  <div class="grid g2">
    <label>Phone<input type="tel" name="ownerPhone" value="${v('ownerPhone')}"></label>
    <label>Email<input type="email" name="ownerEmail" value="${v('ownerEmail')}"></label>
  </div>

  <h2>Job</h2>
  <div class="grid g2">
    <label>Work to be performed at (address)<input name="workAddress" value="${v('workAddress')}"></label>
    <label>City, State &amp; Zip<input name="workCityStateZip" value="${v('workCityStateZip')}"></label>
  </div>
  <label class="check"><input type="checkbox" id="sameAddr"> Same as the owner’s mailing address</label>
  <label>Construction lender <span class="muted">(name and address of construction fund holder, or “none”)</span><input name="lender" value="${v('lender')}"></label>
  <label>Description of the project and significant materials and equipment
    <textarea name="description" rows="8">${v('description')}</textarea>
    <span class="hint">Describe labor, significant materials, and equipment to be furnished. About 6 lines fit on page 1; anything longer goes on an attachment page automatically.</span>
  </label>
  <label>Substantial commencement of work is described as<input name="commencement" value="${v('commencement')}"></label>
  <div class="grid g2">
    <label>Approximate start date<input type="date" name="startDate" value="${v('startDate')}"></label>
    <label>Approximate completion date<input type="date" name="completionDate" value="${v('completionDate')}"></label>
  </div>

  <h2>Price &amp; payments</h2>
  <div class="grid g3">
    <label>Contract price ($)<input name="contractPrice" id="price" inputmode="decimal" value="${v('contractPrice')}" placeholder="0.00"></label>
    <label>Down payment ($) <span class="muted">or “none”</span><input name="downPayment" id="down" value="${v('downPayment')}" placeholder="none"></label>
    <label>Finance charge ($) <span class="muted">or “none”</span><input name="financeCharge" value="${v('financeCharge')}" placeholder="none"></label>
  </div>
  <p class="hint" id="downHint">The down payment may not exceed $1,000 or 10% of the contract price, whichever is less.</p>
  <span class="lbl">Schedule of progress payments</span>
  <div id="pays">${pays.map(payRow).join('')}</div>
  <button type="button" class="btn ghost small" id="addPay">+ Add payment</button>
  <p class="hint" id="payTotal"></p>
  <label>Allowances <span class="muted">(optional)</span><input name="allowances" value="${v('allowances')}" placeholder="e.g. Tile $12/sq ft; plumbing fixtures $8,000"></label>
  <label class="short">Change order fee (%)<input name="changeOrderFee" inputmode="decimal" value="${v('changeOrderFee') || '20'}"></label>

  <h2>Salesperson <span class="muted">(optional)</span></h2>
  <div class="grid g2">
    <label>Name<input name="salesmanName" value="${v('salesmanName')}"></label>
    <label>State registration number<input name="salesmanReg" value="${v('salesmanReg')}"></label>
  </div>

  <div class="actions">
    <button class="btn">${isNew ? 'Save &amp; preview' : 'Save changes'}</button>
    <a class="btn ghost" href="${isNew ? '/' : `/orders/${o.id}`}">Cancel</a>
  </div>
</form>
<template id="payTpl">${payRow()}</template>
<script>
  const past = ${JSON.stringify(pastCustomers).replace(/</g, '\\u003c')};
  const form = document.getElementById('hicForm');
  const $ = (n) => form.elements.namedItem(n);
  form.addEventListener('submit', () => { const b = form.querySelector('.actions .btn'); if (b) b.textContent = 'Saving…'; });
  const sel = document.getElementById('pastCustomer');
  if (sel) sel.addEventListener('change', () => {
    const c = past.find((x) => x.id === sel.value);
    $('customerId').value = c ? c.id : '';
    const w = document.getElementById('saveCustWrap'); if (w) w.hidden = Boolean(c);
    if (!c) return;
    ['ownerName','owner2Name','ownerAddress','ownerCityStateZip','ownerPhone','ownerEmail','workAddress','workCityStateZip'].forEach((k) => { if ($(k) && c[k] !== undefined) $(k).value = c[k] || ''; });
  });
  document.getElementById('sameAddr').addEventListener('change', (e) => {
    if (!e.target.checked) return;
    $('workAddress').value = $('ownerAddress').value; $('workCityStateZip').value = $('ownerCityStateZip').value;
  });
  const pays = document.getElementById('pays');
  document.getElementById('addPay').addEventListener('click', () => {
    pays.insertAdjacentHTML('beforeend', document.getElementById('payTpl').innerHTML); update();
  });
  pays.addEventListener('click', (e) => { if (e.target.classList.contains('rm')) { e.target.closest('.payrow').remove(); update(); } });
  const num = (v) => { v = String(v || '').replace(/[$\\s]/g, ''); if (/,\\d{2}$/.test(v) && !/\\./.test(v)) v = v.replace(/,(\\d{2})$/, '.$1'); const n = Number(v.replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  function update() {
    const price = num(document.getElementById('price').value);
    const downRaw = document.getElementById('down').value;
    const down = /none/i.test(downRaw) ? 0 : num(downRaw);
    const max = Math.min(1000, price * 0.1);
    const dh = document.getElementById('downHint');
    dh.textContent = price ? 'Maximum down payment for this price: ' + money(max) + (down > max ? ' — the down payment is too high.' : '') : 'The down payment may not exceed $1,000 or 10% of the contract price, whichever is less.';
    dh.classList.toggle('warn', down > max);
    let sum = down;
    pays.querySelectorAll('[name=payAmount]').forEach((i) => { sum += num(i.value); });
    const pt = document.getElementById('payTotal');
    pt.textContent = price ? 'Down payment + progress payments = ' + money(sum) + (Math.abs(sum - price) > 0.009 ? ' (contract price is ' + money(price) + ', difference ' + money(price - sum) + ')' : ' ✓ matches the contract price') : '';
    pt.classList.toggle('warn', price && Math.abs(sum - price) > 0.009);
  }
  form.addEventListener('input', update); update();
</script>`,
  });
}

function orderDetail({ company, order: o, settings, emailReady, signLink, flash, warnings = [], ledger = null }) {
  const sigs = o.signatures || {};
  const ownerSigned = Boolean(sigs.owner);
  const events = [...(o.events || [])].reverse().map((e) => `<li><span class="muted">${esc(f.dateTime(e.at))}</span> ${esc(e.text)}</li>`).join('');
  const acks = o.acks;
  return layout({
    title: docTitle(o),
    admin: true,
    company,
    flash,
    body: `<div class="row between wrap">
  <div><h1>${esc(docTitle(o))} ${badge(o.status)}</h1>
  <p class="muted">${esc(o.projectName)} · ${esc(o.ownerName)}${viewerIsOwner() && o.createdByName ? ` · created by ${esc(o.createdByName)}` : ''}</p></div>
  <div class="row gap wrap">
    <a class="btn ghost" href="/orders/${o.id}/pdf?download=1">Download PDF</a>
    ${ownerSigned ? '' : `<a class="btn ghost" href="/orders/${o.id}/edit">Edit</a>`}
    <form method="post" action="/orders/${o.id}/duplicate"><button class="btn ghost">Duplicate</button></form>
  </div>
</div>
${warnings.length && !ownerSigned ? `<div class="flash warn"><b>Check before sending:</b><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
<div class="detail">
  <div class="card flush pdfwrap"><iframe src="/orders/${o.id}/pdf#view=FitH" title="${esc(docTitle(o))} PDF"></iframe></div>
  <div class="side">
    ${ownerSigned ? `<div class="card ok">
      <h2>Signed</h2>
      <p>Signed by <b>${esc(sigs.owner.name)}</b> on ${esc(f.dateTime(sigs.owner.at))}.</p>
      ${sigs.owner2 ? `<p>Second owner: <b>${esc(sigs.owner2.name)}</b> on ${esc(f.dateTime(sigs.owner2.at))}.</p>` : ''}
      ${acks ? `<p class="small">Age(s): ${esc(acks.ages)} · ${acks.rightToCancel}-day right to cancel · Arbitration: ${acks.arbitration ? 'agreed' : '<b>not agreed</b>'}</p>` : ''}
      <a class="btn" href="/orders/${o.id}/pdf?download=1">Download signed PDF</a>
    </div>` : `<div class="card">
      <h2>Send to customer</h2>
      <form method="post" action="/orders/${o.id}/send" class="form">
        <label>Customer email<input type="email" name="email" value="${esc(o.ownerEmail)}" placeholder="customer@email.com"></label>
        ${emailReady ? '' : '<p class="hint warn">Email isn’t set up yet — see Settings.</p>'}
        <label>Note to include <span class="muted">(optional)</span><textarea name="note" rows="2"></textarea></label>
        <button class="btn">${o.status === 'draft' ? 'Send for signature' : 'Send again'}</button>
      </form>
      <div class="linkbox">
        <span class="lbl">Or share the signing link yourself</span>
        <div class="row gap"><input readonly value="${esc(signLink)}" id="signLink"><button type="button" class="btn ghost small" onclick="navigator.clipboard.writeText(document.getElementById('signLink').value);this.textContent='Copied'">Copy</button></div>
      </div>
    </div>`}

    ${ledger ? `<div class="card">
      <h2>Payments</h2>
      <dl class="mini">
        <dt>Contract</dt><dd>${f.money(ledger.original)}</dd>
        <dt>Change orders</dt><dd>${ledger.coTotal < 0 ? '− ' : '+ '}${f.money(Math.abs(ledger.coTotal))}</dd>
        <dt>Adjusted total</dt><dd><b>${f.money(ledger.adjusted)}</b></dd>
        <dt>Paid</dt><dd>${f.money(ledger.paid)}</dd>
        <dt>Balance</dt><dd><b>${f.money(ledger.balance)}</b></dd>
      </dl>
      ${ledger.invoiceRows.length ? `<ul class="events">${ledger.invoiceRows.map(({ inv, sm }) => `<li><a href="/invoices/${inv.id}">${esc(inv.number)}</a> · ${f.money(sm.total)} <span class="muted">· ${esc({ draft: 'Draft', unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue' }[sm.status])}</span></li>`).join('')}</ul>` : '<p class="muted">No invoices yet.</p>'}
      <a class="btn ghost small" href="/invoices/new?contract=${o.id}">+ Create invoice</a>
    </div>` : ''}

    <div class="card">
      <h2>Contractor signature</h2>
      ${sigs.contractor
    ? `<p>Signed by <b>${esc(sigs.contractor.name)}</b> on ${esc(f.dateTime(sigs.contractor.at))}.</p>`
    : !viewerIsOwner()
      ? '<p class="muted">The owner signs as the contractor.</p>'
      : settings.contractorSignature
      ? `<form method="post" action="/orders/${o.id}/contractor-sign"><p class="muted">Apply your saved signature (${esc(settings.contractorSignerName)}).</p><button class="btn ghost">Sign as contractor</button></form>`
      : '<p class="muted">Save your signature in <a href="/settings">Settings</a> to sign with one click (or automatically when you send).</p>'}
    </div>

    <div class="card">
      <h2>History</h2>
      <ul class="events">${events}</ul>
    </div>
    <form method="post" action="/orders/${o.id}/delete" onsubmit="return confirm('Delete ${esc(docTitle(o))}? This cannot be undone.')"><button class="link danger">Delete ${docWord(o)}</button></form>
  </div>
</div>`,
  });
}

function settingsPage({ company, settings, emailReady, appUrl, flash, users = [] }) {
  return layout({
    title: 'Settings',
    active: 'settings',
    admin: true,
    company,
    flash,
    body: `<h1>Settings</h1>
<div class="card">
  <h2>Your signature</h2>
  <p class="muted">Draw your signature once. It's applied to the contractor signature line${settings.autoSign !== false ? ' automatically when you send a change order' : ''}.</p>
  <form method="post" action="/settings" class="form" id="sigForm" novalidate>
    <label>Your name (printed)<input name="contractorSignerName" value="${esc(settings.contractorSignerName)}" required></label>
    ${settings.contractorSignature ? `<div class="savedsig"><span class="lbl">Current signature</span><img src="${esc(settings.contractorSignature)}" alt="Saved signature"></div>` : ''}
    <span class="lbl">${settings.contractorSignature ? 'Draw a new signature (leave blank to keep the current one)' : 'Draw your signature'}</span>
    <div class="sigpad"><canvas></canvas><button type="button" class="link clear">Clear</button></div>
    <input type="hidden" name="signature">
    <label class="short">Your title <span class="muted">(on lien releases)</span><input name="contractorSignerTitle" value="${esc(settings.contractorSignerTitle || 'Owner')}"></label>
    <label class="short">Your initials <span class="muted">(for contract arbitration boxes)</span><input name="contractorInitials" value="${esc(settings.contractorInitials)}" maxlength="4"></label>
    <label class="check"><input type="checkbox" name="autoSign" value="1" ${settings.autoSign !== false ? 'checked' : ''}> Sign automatically when I send a contract or change order</label>
    <h2>Contract notices</h2>
    <span class="lbl">Commercial general liability insurance</span>
    ${['A|does not carry CGL insurance', 'B|carries CGL insurance', 'C|is self-insured', 'D|is an LLC with liability insurance or other security']
    .map((x) => { const [k, t] = x.split('|'); return radio('cglOption', k, settings.cglOption || 'B', `(${k}) ${company.name} ${t}`); }).join('<br>')}
    <div class="grid g2">
      <label>Insurance company<input name="insuranceCompany" value="${esc(settings.insuranceCompany || company.insurance?.cglCompany)}"></label>
      <label>Insurance company phone<input type="tel" name="insurancePhone" value="${esc(settings.insurancePhone || company.insurance?.phone)}"></label>
    </div>
    <span class="lbl">Workers’ compensation</span>
    ${radio('wcOption', 'A', settings.wcOption || 'B', '(A) No employees — exempt')}<br>
    ${radio('wcOption', 'B', settings.wcOption || 'B', '(B) Carries workers’ compensation for all employees')}
    <h2 id="payments">Invoices</h2>
    <label>How customers can pay <span class="muted">(printed on every invoice)</span>
      <textarea name="paymentInstructions" rows="3" placeholder="e.g. Zelle: onyxgeneralbuilding@gmail.com · Checks payable to Onyx General Building, Inc.">${esc(settings.paymentInstructions)}</textarea></label>
    <h2 id="google">Google reviews</h2>
    <label>Google Maps link or Place ID<input name="googlePlaceId" value="${esc(settings.googlePlaceId)}" placeholder="Paste your Google Maps share link"></label>
    <p class="muted small">In Google Maps, open your business, tap <b>Share</b>, copy the link and paste it here, then tap Save. Needs <code>GOOGLE_PLACES_API_KEY</code> set in Render first.</p>
    <h2 id="renewals">Renewal dates</h2>
    <p class="muted small">Shown on the home page. Update these when you get a new certificate of insurance or renew your license.</p>
    <div class="grid g3">
      <label>General liability expires<input type="date" name="cglExpires" value="${esc(settings.cglExpires || company.insurance?.cglExpires)}"></label>
      <label>Workers’ comp expires<input type="date" name="wcExpires" value="${esc(settings.wcExpires || company.insurance?.wcExpires)}"></label>
      <label>Contractor license expires<input type="date" name="licenseExpires" value="${esc(settings.licenseExpires || company.licenseExpires)}"></label>
    </div>
    <p class="muted small">Email reminders go to you 60, 30, 7 and 1 days before each date, on the day, and once if it lapses.</p>
    <h2>Default salesperson <span class="muted">(optional)</span></h2>
    <div class="grid g2">
      <label>Name<input name="salesmanName" value="${esc(settings.salesmanName)}"></label>
      <label>State registration number<input name="salesmanReg" value="${esc(settings.salesmanReg)}"></label>
    </div>
    <button class="btn">Save</button>
  </form>
</div>
<div class="card" id="team">
  <h2>Team</h2>
  <p class="muted">Team members log in with their own username and password. They see and create only their own contracts and change orders, and can’t open Settings. You see everything.</p>
  ${users.length ? `<ul class="team">${users.map((u) => `<li>
    <div><b>${esc(u.name)}</b> <span class="muted">· ${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''}</span></div>
    ${u.hisExpires || u.hisNumber ? `<div class="muted small">Salesperson card${u.hisNumber ? ` HIS #${esc(u.hisNumber)}` : ''}${u.hisExpires ? ` · expires ${esc(f.date(u.hisExpires))}` : ''}</div>` : ''}
    <details><summary>Edit details, password or remove</summary>
      <form method="post" action="/settings/users/${u.id}" class="form" novalidate>
        <div class="grid g3">
          <label>Email<input type="email" name="email" value="${esc(u.email)}"></label>
          <label>Salesperson card # (HIS)<input name="hisNumber" value="${esc(u.hisNumber)}"></label>
          <label>Card expires<input type="date" name="hisExpires" value="${esc(u.hisExpires)}"></label>
        </div>
        <button class="btn ghost small">Save details</button>
      </form>
      <form method="post" action="/settings/users/${u.id}/password" class="form row gap wrap">
        <input type="text" name="password" placeholder="New password (8+ characters)" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="New password for ${esc(u.name)}">
        <button class="btn ghost small">Change password</button>
      </form>
      <form method="post" action="/settings/users/${u.id}/delete" onsubmit="return confirm('Remove ${esc(u.name)}? Their documents stay in your list.')"><button class="link danger">Remove ${esc(u.name)}</button></form>
    </details>
  </li>`).join('')}</ul>` : '<p>No team members yet.</p>'}
  <form method="post" action="/settings/users" class="form" novalidate>
    <h3>Add a team member</h3>
    <div class="grid g2">
      <label>Name<input name="name" placeholder="e.g. Yair"></label>
      <label>Username<input name="username" placeholder="e.g. yair" autocapitalize="none" autocorrect="off"></label>
    </div>
    <div class="grid g2">
      <label>Email <span class="muted">(gets an email when their customer signs)</span><input type="email" name="email"></label>
      <label>Password <span class="muted">(8+ characters)</span><input type="text" name="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
    </div>
    <div class="grid g2">
      <label>Salesperson card # (HIS) <span class="muted">(optional)</span><input name="hisNumber"></label>
      <label>Card expires <span class="muted">(optional)</span><input type="date" name="hisExpires"></label>
    </div>
    <button class="btn">Add team member</button>
  </form>
</div>
<div class="card">
  <h2>Google reviews</h2>
  <p class="muted">The home page checks Google every 6 hours. ${process.env.GOOGLE_PLACES_API_KEY ? '<span class="badge green">API key set</span>' : '<span class="badge red">API key not set</span>'} ${settings.googlePlaceId ? '<span class="badge green">Place ID set</span>' : '<span class="badge red">Place ID not set</span>'}</p>
  <form method="post" action="/settings/refresh-reviews"><button class="btn ghost">Check Google now</button></form>
</div>
<div class="card">
  <h2>Renewal reminders</h2>
  <p class="muted">Send yourself a test email to check that reminders arrive.</p>
  <form method="post" action="/settings/test-reminder"><button class="btn ghost">Send test reminder</button></form>
</div>
<div class="card">
  <h2>Email setup</h2>
  <p>Email: ${emailReady ? '<span class="badge green">Ready</span>' : '<span class="badge red">Not set up</span>'}</p>
  <p class="muted">Set in Render → Environment (SMTP settings with a Gmail app password).</p>
  <p class="muted">Customer links point to: <code>${esc(appUrl)}</code></p>
</div>
<div class="card">
  <h2>Company info</h2>
  <p>${esc(company.name)}<br>${esc(company.address)}<br>${esc(company.cityStateZip)}<br>${esc(company.phone)}<br>${esc(company.email)}<br>CSLB License #${esc(company.license)}</p>
  <p class="muted">Stored in <code>config/company.json</code>.</p>
</div>
<script src="/signature.js?v=${ASSET_V}"></script>
<script>
  const pad = new SignaturePad(document.querySelector('.sigpad'));
  document.getElementById('sigForm').addEventListener('submit', () => {
    document.querySelector('[name=signature]').value = pad.isEmpty() ? '' : pad.toDataURL();
  });
</script>`,
  });
}

// ---------- customer-facing ----------

function signPage({ company, order: o, token, error }) {
  const sigs = o.signatures || {};
  const done = Boolean(sigs.owner);
  const contract = isContract(o);
  const needOwner2 = o.owner2Name && !sigs.owner2;
  const title = docTitle(o);

  let summary;
  if (contract) {
    const down = o.downPayment && o.downPayment !== 'none' ? f.money(o.downPayment) : 'None';
    const pays = (o.payments || []).map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.description)}</td><td class="num">${f.money(p.amount)}</td><td>${esc(f.date(p.date))}</td></tr>`).join('');
    summary = `<dl>
    <dt>Contractor</dt><dd>${esc(company.name)} · CSLB #${esc(company.license)}</dd>
    <dt>Work at</dt><dd>${esc([o.workAddress, o.workCityStateZip].filter(Boolean).join(', '))}</dd>
    <dt>Price</dt><dd><b>${f.money(o.contractPrice)}</b></dd>
    <dt>Down payment</dt><dd>${esc(down)}</dd>
    <dt>Dates</dt><dd>Start about ${esc(f.date(o.startDate) || '—')}, complete about ${esc(f.date(o.completionDate) || '—')}</dd>
    <dt>Work</dt><dd class="pre">${esc(o.description)}</dd>
  </dl>
  ${pays ? `<div class="tablewrap"><table class="list small-table"><thead><tr><th>#</th><th>Progress payment</th><th class="num">Amount</th><th>Date</th></tr></thead><tbody>${pays}</tbody></table></div>` : ''}
  <p class="muted small">The full contract includes the Terms and Conditions, Three-Day and Five-Day Right to Cancel, Notice of Cancellation, Statutory Notices (CSLB, insurance, workers’ compensation), Note About Extra Work and Change Orders, Mechanics Lien Warning, and Arbitration of Disputes. Please read it before signing.</p>`;
  } else {
    const price = o.priceDirection === 'none' || !Number(o.amount)
      ? 'No change'
      : `${o.priceDirection === 'decrease' ? 'Decrease' : 'Increase'} of ${f.money(o.amount)}`;
    const time = o.timeDirection === 'none' || !Number(o.days)
      ? 'No change'
      : `${o.timeDirection === 'reduce' ? 'Reduced' : 'Extended'} by ${Number(o.days)} day${Number(o.days) === 1 ? '' : 's'}`;
    summary = `<dl>
    <dt>Contractor</dt><dd>${esc(company.name)} · CSLB #${esc(company.license)}</dd>
    <dt>Price</dt><dd><b>${esc(price)}</b></dd>
    <dt>Time</dt><dd>${esc(time)}</dd>
    <dt>Work</dt><dd class="pre">${esc(o.description)}</dd>
  </dl>`;
  }

  const secondOwner = (preset) => `
    <label class="check add2-toggle"><input type="checkbox" name="addOwner2" value="1" ${preset ? 'checked' : ''}> Add a second owner signature (for example, a spouse or co-owner)</label>
    <div class="owner2-fields" ${preset ? '' : 'hidden'}>
      <label>Second owner’s full name<input name="name2" value="${esc(preset)}" autocomplete="off"></label>
      <span class="lbl">Second owner signs below</span>
      <div class="sigpad second"><canvas></canvas><button type="button" class="link clear">Clear</button></div>
      <input type="hidden" name="signature2">
    </div>`;

  const contractQuestions = () => `
    <div class="qblock">
      <label class="short">Your initials<input name="initials" maxlength="5" autocomplete="off" placeholder="e.g. LA" style="text-transform:uppercase"></label>
      <span class="hint">Your initials are placed in each spot the contract asks you to initial.</span>
    </div>
    <div class="qblock">
      <label class="short">Owner’s age(s)<input name="ages" inputmode="numeric" placeholder="e.g. 45 or 45, 43"></label>
      <span class="hint">The law requires you to state your age. If any owner is 65 or older, you get five business days to cancel instead of three.</span>
    </div>
    <div class="qblock field">
      <span class="lbl">Arbitration of disputes <span class="muted">(voluntary)</span></span>
      <span class="hint">Read the “Arbitration of Disputes” section on page 5 of the contract. By agreeing, you give up the right to have a dispute decided in court or by a jury.</span>
      <label class="choice"><input type="radio" name="arbitration" value="yes"> I agree to arbitration (initial the arbitration boxes)</label><br>
      <label class="choice"><input type="radio" name="arbitration" value="no"> I do not agree to arbitration</label>
    </div>`;

  const consentText = contract
    ? `I have read ${esc(title)}, including the Terms and Conditions and all attached notices, and I agree to its terms. I acknowledge receiving a completely filled-in copy, including the Notice of Cancellation. I agree to sign electronically, and my electronic signature and initials are the legal equivalent of my handwritten signature and initials.`
    : `I have reviewed ${esc(title)} and agree to its terms. I agree to sign electronically, and my electronic signature is the legal equivalent of my handwritten signature.`;

  const signForm = (who, name, heading) => `<div class="card">
  <h2>${heading}</h2>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/s/${esc(token)}/sign" class="form sign-form" novalidate data-contract="${contract && who === 'owner' ? '1' : ''}">
    <input type="hidden" name="who" value="${who}">
    <label>Full name<input name="name" value="${esc(name)}" autocomplete="name"></label>
    ${contract && who === 'owner' ? contractQuestions() : ''}
    <span class="lbl">Sign below with your finger or mouse</span>
    <div class="sigpad main"><canvas></canvas><button type="button" class="link clear">Clear</button></div>
    <input type="hidden" name="signature">
    ${who === 'owner' ? secondOwner(o.owner2Name || '') : ''}
    <label class="check"><input type="checkbox" name="consent" value="1"> ${consentText}</label>
    <button class="btn big">Sign ${docWord(o)}</button>
  </form>
</div>`;

  return layout({
    title,
    company,
    body: `<div class="public-head">
  <h1>${esc(title)}</h1>
  <p class="muted">${esc(o.projectName)} · ${esc(f.date(o.date))}</p>
</div>
${o.status === 'declined' ? `<div class="flash error">You declined this ${docWord(o)}. Please contact ${esc(company.name)} at ${esc(company.phone)} if this was a mistake.</div>` : ''}
${done ? `<div class="card ok"><h2>Thank you — signed</h2>
  <p>Signed by ${esc(sigs.owner.name)} on ${esc(f.dateTime(sigs.owner.at))}.${sigs.owner2 ? ` Second owner: ${esc(sigs.owner2.name)}.` : ''}</p>
  ${contract && o.acks ? `<p class="small">You have <b>${o.acks.rightToCancel} business days</b> to cancel. See the Notice of Cancellation on page 3 of your copy.</p>` : ''}
  <a class="btn" href="/s/${esc(token)}/pdf?download=1">Download signed copy (PDF)</a></div>` : ''}
<div class="card summary">
  ${summary}
  <a class="btn ghost" href="/s/${esc(token)}/pdf" target="_blank" rel="noopener">View full ${docWord(o)} (PDF)</a>
</div>
${!done && o.status !== 'declined' ? signForm('owner', o.ownerName, 'Sign') + `
<details class="decline"><summary>I don’t agree with this ${docWord(o)}</summary>
  <form method="post" action="/s/${esc(token)}/decline" class="form">
    <label>Tell us why (optional)<textarea name="reason" rows="3"></textarea></label>
    <button class="btn ghost">Decline</button>
  </form>
</details>` : ''}
${done && !sigs.owner2 ? (needOwner2
    ? signForm('owner2', o.owner2Name, 'Second owner signature')
    : `<details class="add-owner2"><summary>Add a second owner’s signature</summary>${signForm('owner2', '', 'Second owner signature')}</details>`) : ''}
<p class="muted center">Questions? Call ${esc(company.phone)} or email <a href="mailto:${esc(company.email)}">${esc(company.email)}</a>.</p>
<script src="/signature.js?v=${ASSET_V}"></script>
<script>
  document.querySelectorAll('.sign-form').forEach((form) => {
    const pad = new SignaturePad(form.querySelector('.sigpad.main'));
    const secondWrap = form.querySelector('.sigpad.second');
    const pad2 = secondWrap ? new SignaturePad(secondWrap) : null;
    const el = (n) => form.elements.namedItem(n);
    const toggle = el('addOwner2');
    const fields2 = form.querySelector('.owner2-fields');
    if (toggle) toggle.addEventListener('change', () => { fields2.hidden = !toggle.checked; });
    form.addEventListener('submit', (e) => {
      const stop = (msg) => { e.preventDefault(); alert(msg); };
      if (!el('name').value.trim()) return stop('Please type your full name.');
      if (form.dataset.contract) {
        if (!el('initials').value.trim()) return stop('Please type your initials.');
        if (!/\\d/.test(el('ages').value)) return stop('Please enter your age.');
        if (!form.querySelector('[name=arbitration]:checked')) return stop('Please choose whether you agree to arbitration.');
      }
      if (pad.isEmpty()) return stop('Please sign in the box first.');
      if (toggle && toggle.checked) {
        if (!el('name2').value.trim()) return stop('Please type the second owner’s full name.');
        if (pad2.isEmpty()) return stop('Please have the second owner sign in their box.');
        el('signature2').value = pad2.toDataURL();
      }
      if (!el('consent').checked) return stop('Please check the box to agree.');
      el('signature').value = pad.toDataURL();
    });
  });
</script>`,
  });
}

function notFound({ company }) {
  return layout({ title: 'Not found', company, body: '<div class="card narrow"><h1>Not found</h1><p>This link is invalid or has expired.</p></div>' });
}

// Placeholder for sections still being built (Leads, Estimates).
function comingSoon({ company, active, title, lead, items = [] }) {
  return layout({
    title,
    admin: true,
    company,
    active,
    body: `<section class="coming">
  <p class="eyebrow">Coming soon</p>
  <h1>${esc(title)}</h1>
  <p class="soon-lead">${esc(lead)}</p>
  ${items.length ? `<ul class="soon-list">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  <a class="btn ghost" href="/">Back to documents</a>
</section>`,
  });
}

module.exports = { esc, layout, radio, viewerIsOwner, badge, comingSoon, login, dashboard, documentsPage, newChooser, orderForm, contractForm, orderDetail, settingsPage, signPage, notFound };
