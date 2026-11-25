// HTML page templates.
const f = require('./format');

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

function layout({ title, body, admin = false, flash, company }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(company.name)}</title>
<link rel="icon" href="/logo.png">
<link rel="stylesheet" href="/style.css">
</head>
<body class="${admin ? 'admin' : 'public'}">
<header class="topbar">
  <a class="brand" href="${admin ? '/' : '#'}"><img src="/logo.png" alt=""><span>${esc(company.name)}</span></a>
  ${admin ? `<nav>
    <a href="/">Change Orders</a>
    <a href="/new" class="btn small">+ New</a>
    <a href="/settings">Settings</a>
    <form method="post" action="/logout"><button class="link">Log out</button></form>
  </nav>` : ''}
</header>
<main>
${flash ? `<div class="flash ${esc(flash.type || 'ok')}">${esc(flash.text)}</div>` : ''}
${body}
</main>
<footer class="foot">${esc(company.name)} · ${esc(company.address)}, ${esc(company.cityStateZip)} · ${esc(company.phone)} · CSLB Lic. #${esc(company.license)}</footer>
</body>
</html>`;
}

function login({ company, error }) {
  return layout({
    title: 'Log in',
    company,
    body: `<div class="card narrow">
  <h1>Log in</h1>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/login">
    <label>Password<input type="password" name="password" autofocus required></label>
    <button class="btn">Log in</button>
  </form>
</div>`,
  });
}

function dashboard({ company, orders, flash, filter }) {
  const counts = orders.reduce((a, o) => ((a[o.status] = (a[o.status] || 0) + 1), a), {});
  const shown = filter ? orders.filter((o) => o.status === filter) : orders;
  const tabs = [['', 'All', orders.length], ...Object.keys(STATUS).map((k) => [k, STATUS[k][0], counts[k] || 0])]
    .map(([k, l, n]) => `<a class="tab ${filter === k || (!filter && !k) ? 'on' : ''}" href="/${k ? `?status=${k}` : ''}">${l} <span>${n}</span></a>`)
    .join('');
  const rows = shown.map((o) => `<tr onclick="location='/orders/${o.id}'">
    <td><a href="/orders/${o.id}"><b>${isContract(o) ? esc(o.number) : `#${esc(o.number)}`}</b></a><div class="muted">${isContract(o) ? 'Contract' : 'Change order'}</div></td>
    <td>${esc(o.projectName)}<div class="muted">${esc(o.ownerName)}</div></td>
    <td class="num">${isContract(o) ? f.money(o.contractPrice) : o.priceDirection === 'none' ? '—' : (o.priceDirection === 'decrease' ? '− ' : '+ ') + f.money(o.amount)}</td>
    <td>${badge(o.status)}</td>
    <td class="muted">${esc(f.dateTime(o.updatedAt))}</td>
  </tr>`).join('');
  return layout({
    title: 'Contracts & Change Orders',
    admin: true,
    company,
    flash,
    body: `<div class="row between wrap"><h1>Contracts &amp; Change Orders</h1><div class="row gap wrap"><a class="btn" href="/contracts/new">+ New contract</a><a class="btn" href="/orders/new">+ New change order</a></div></div>
<div class="tabs">${tabs}</div>
${shown.length ? `<div class="card flush"><table class="list">
  <thead><tr><th>Document</th><th>Project / Owner</th><th class="num">Amount</th><th>Status</th><th>Last activity</th></tr></thead>
  <tbody>${rows}</tbody></table></div>`
    : `<div class="card empty">Nothing here yet. Create a <a href="/contracts/new">contract</a> or a <a href="/orders/new">change order</a>.</div>`}`,
  });
}

function radio(name, value, current, label) {
  return `<label class="choice"><input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''}> ${label}</label>`;
}

function orderForm({ company, order, isNew, pastCustomers, error }) {
  const o = order;
  const v = (k) => esc(o[k]);
  return layout({
    title: isNew ? 'New change order' : `Edit #${o.number}`,
    admin: true,
    company,
    body: `<h1>${isNew ? 'New change order' : `Edit change order #${esc(o.number)}`}</h1>
${error ? `<div class="flash error">${esc(error)}</div>` : ''}
<form method="post" action="${isNew ? '/orders' : `/orders/${o.id}`}" class="card form" id="coForm" novalidate>
  ${pastCustomers.length ? `<div class="prefill">
    <label>Same customer as a previous change order?
      <select id="pastCustomer"><option value="">— Pick to fill in owner info —</option>
      ${pastCustomers.map((c, i) => `<option value="${i}">${esc(c.ownerName)} — ${esc(c.projectName)}</option>`).join('')}
      </select></label>
  </div>` : ''}

  <h2>Change order</h2>
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
  <div class="grid g3">
    <label>Mobile phone <span class="muted">(for texts)</span><input type="tel" name="ownerPhone" value="${v('ownerPhone')}"></label>
    <label>Fax <span class="muted">(optional)</span><input type="tel" name="ownerFax" value="${v('ownerFax')}"></label>
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
  if (sel) sel.addEventListener('change', () => {
    const c = past[sel.value]; if (!c) return;
    for (const k of Object.keys(c)) {
      const el = document.querySelector('[name="' + k + '"]');
      if (el && el.type !== 'radio') el.value = c[k] || '';
    }
  });
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
  ${pastCustomers.length ? `<div class="prefill">
    <label>Same customer as before?
      <select id="pastCustomer"><option value="">— Pick to fill in owner info —</option>
      ${pastCustomers.map((c, i) => `<option value="${i}">${esc(c.ownerName)} — ${esc(c.projectName)}</option>`).join('')}
      </select></label>
  </div>` : ''}

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
  <div class="grid g3">
    <label>Mobile phone <span class="muted">(for texts)</span><input type="tel" name="ownerPhone" value="${v('ownerPhone')}"></label>
    <label>Fax <span class="muted">(optional)</span><input type="tel" name="ownerFax" value="${v('ownerFax')}"></label>
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
    const c = past[sel.value]; if (!c) return;
    ['ownerName','owner2Name','ownerAddress','ownerCityStateZip','ownerPhone','ownerFax','ownerEmail','workAddress','workCityStateZip'].forEach((k) => { if ($(k) && c[k] !== undefined) $(k).value = c[k] || ''; });
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

function orderDetail({ company, order: o, settings, emailReady, smsReady, signLink, flash, warnings = [] }) {
  const sigs = o.signatures || {};
  const ownerSigned = Boolean(sigs.owner);
  const events = [...(o.events || [])].reverse().map((e) => `<li><span class="muted">${esc(f.dateTime(e.at))}</span> ${esc(e.text)}</li>`).join('');
  const smsText = `${company.name}: ${docTitle(o)} for ${o.projectName} is ready for your review and signature: ${signLink}`;
  const acks = o.acks;
  return layout({
    title: docTitle(o),
    admin: true,
    company,
    flash,
    body: `<div class="row between wrap">
  <div><h1>${esc(docTitle(o))} ${badge(o.status)}</h1>
  <p class="muted">${esc(o.projectName)} · ${esc(o.ownerName)}</p></div>
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
        <label class="check"><input type="checkbox" name="viaEmail" value="1" ${o.ownerEmail ? 'checked' : ''}> Email</label>
        <input type="email" name="email" value="${esc(o.ownerEmail)}" placeholder="customer@email.com">
        ${emailReady ? '' : '<p class="hint warn">Email isn’t set up yet — see Settings.</p>'}
        <label class="check"><input type="checkbox" name="viaSms" value="1" ${o.ownerPhone ? 'checked' : ''}> Text message</label>
        <input type="tel" name="phone" value="${esc(o.ownerPhone)}" placeholder="(818) 555-0100">
        ${smsReady ? '' : '<p class="hint warn">Texting isn’t set up yet — see Settings.</p>'}
        <label>Note to include <span class="muted">(optional)</span><textarea name="note" rows="2"></textarea></label>
        <button class="btn">${o.status === 'draft' ? 'Send for signature' : 'Send again'}</button>
      </form>
      <div class="linkbox">
        <span class="lbl">Or share the signing link yourself</span>
        <div class="row gap"><input readonly value="${esc(signLink)}" id="signLink"><button type="button" class="btn ghost small" onclick="navigator.clipboard.writeText(document.getElementById('signLink').value);this.textContent='Copied'">Copy</button></div>
        <a class="small" href="sms:${esc(o.ownerPhone)}?&body=${encodeURIComponent(smsText)}">Text it from my phone</a>
      </div>
    </div>`}

    <div class="card">
      <h2>Contractor signature</h2>
      ${sigs.contractor
    ? `<p>Signed by <b>${esc(sigs.contractor.name)}</b> on ${esc(f.dateTime(sigs.contractor.at))}.</p>`
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

function settingsPage({ company, settings, emailReady, smsReady, appUrl, flash }) {
  return layout({
    title: 'Settings',
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
    <h2>Default salesperson <span class="muted">(optional)</span></h2>
    <div class="grid g2">
      <label>Name<input name="salesmanName" value="${esc(settings.salesmanName)}"></label>
      <label>State registration number<input name="salesmanReg" value="${esc(settings.salesmanReg)}"></label>
    </div>
    <button class="btn">Save</button>
  </form>
</div>
<div class="card">
  <h2>Email &amp; text setup</h2>
  <p>Email: ${emailReady ? '<span class="badge green">Ready</span>' : '<span class="badge red">Not set up</span>'}
     &nbsp; Text messages: ${smsReady ? '<span class="badge green">Ready</span>' : '<span class="badge red">Not set up</span>'}</p>
  <p class="muted">These are set in the server's <code>.env</code> file. The README explains how to get a Gmail app password and a Twilio number.</p>
  <p class="muted">Customer links point to: <code>${esc(appUrl)}</code></p>
</div>
<div class="card">
  <h2>Company info</h2>
  <p>${esc(company.name)}<br>${esc(company.address)}<br>${esc(company.cityStateZip)}<br>${esc(company.phone)}<br>${esc(company.email)}<br>CSLB License #${esc(company.license)}</p>
  <p class="muted">Stored in <code>config/company.json</code>.</p>
</div>
<script src="/signature.js"></script>
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
<script src="/signature.js"></script>
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

module.exports = { esc, login, dashboard, newChooser, orderForm, contractForm, orderDetail, settingsPage, signPage, notFound };
