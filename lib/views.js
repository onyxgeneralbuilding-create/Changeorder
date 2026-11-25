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
    <a href="/orders/new" class="btn small">+ New</a>
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
    <td><a href="/orders/${o.id}"><b>#${esc(o.number)}</b></a></td>
    <td>${esc(o.projectName)}<div class="muted">${esc(o.ownerName)}</div></td>
    <td class="num">${o.priceDirection === 'none' ? '—' : (o.priceDirection === 'decrease' ? '− ' : '+ ') + f.money(o.amount)}</td>
    <td>${badge(o.status)}</td>
    <td class="muted">${esc(f.dateTime(o.updatedAt))}</td>
  </tr>`).join('');
  return layout({
    title: 'Change Orders',
    admin: true,
    company,
    flash,
    body: `<div class="row between"><h1>Change Orders</h1><a class="btn" href="/orders/new">+ New change order</a></div>
<div class="tabs">${tabs}</div>
${shown.length ? `<div class="card flush"><table class="list">
  <thead><tr><th>No.</th><th>Project / Owner</th><th class="num">Amount</th><th>Status</th><th>Last activity</th></tr></thead>
  <tbody>${rows}</tbody></table></div>`
    : `<div class="card empty">No change orders here yet. <a href="/orders/new">Create your first one.</a></div>`}`,
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

function orderDetail({ company, order: o, settings, emailReady, smsReady, signLink, flash }) {
  const sigs = o.signatures || {};
  const ownerSigned = Boolean(sigs.owner);
  const events = [...(o.events || [])].reverse().map((e) => `<li><span class="muted">${esc(f.dateTime(e.at))}</span> ${esc(e.text)}</li>`).join('');
  const smsText = `${company.name}: Change Order #${o.number} for ${o.projectName} is ready for your review and signature: ${signLink}`;
  return layout({
    title: `Change order #${o.number}`,
    admin: true,
    company,
    flash,
    body: `<div class="row between wrap">
  <div><h1>Change order #${esc(o.number)} ${badge(o.status)}</h1>
  <p class="muted">${esc(o.projectName)} · ${esc(o.ownerName)}</p></div>
  <div class="row gap wrap">
    <a class="btn ghost" href="/orders/${o.id}/pdf?download=1">Download PDF</a>
    ${ownerSigned ? '' : `<a class="btn ghost" href="/orders/${o.id}/edit">Edit</a>`}
    <form method="post" action="/orders/${o.id}/duplicate"><button class="btn ghost">Duplicate</button></form>
  </div>
</div>
<div class="detail">
  <div class="card flush pdfwrap"><iframe src="/orders/${o.id}/pdf#view=FitH" title="Change order PDF"></iframe></div>
  <div class="side">
    ${ownerSigned ? `<div class="card ok">
      <h2>Signed</h2>
      <p>Signed by <b>${esc(sigs.owner.name)}</b> on ${esc(f.dateTime(sigs.owner.at))}.</p>
      ${sigs.owner2 ? `<p>Second owner: <b>${esc(sigs.owner2.name)}</b> on ${esc(f.dateTime(sigs.owner2.at))}.</p>` : ''}
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
      : '<p class="muted">Save your signature in <a href="/settings">Settings</a> to sign change orders with one click (or automatically when you send).</p>'}
    </div>

    <div class="card">
      <h2>History</h2>
      <ul class="events">${events}</ul>
    </div>
    <form method="post" action="/orders/${o.id}/delete" onsubmit="return confirm('Delete change order #${esc(o.number)}? This cannot be undone.')"><button class="link danger">Delete change order</button></form>
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
  <form method="post" action="/settings" class="form" id="sigForm">
    <label>Your name (printed)<input name="contractorSignerName" value="${esc(settings.contractorSignerName)}" required></label>
    ${settings.contractorSignature ? `<div class="savedsig"><span class="lbl">Current signature</span><img src="${esc(settings.contractorSignature)}" alt="Saved signature"></div>` : ''}
    <span class="lbl">${settings.contractorSignature ? 'Draw a new signature (leave blank to keep the current one)' : 'Draw your signature'}</span>
    <div class="sigpad"><canvas></canvas><button type="button" class="link clear">Clear</button></div>
    <input type="hidden" name="signature">
    <label class="check"><input type="checkbox" name="autoSign" value="1" ${settings.autoSign !== false ? 'checked' : ''}> Sign automatically when I send a change order</label>
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
  const needOwner2 = o.owner2Name && !sigs.owner2;
  const price = o.priceDirection === 'none' || !Number(o.amount)
    ? 'No change'
    : `${o.priceDirection === 'decrease' ? 'Decrease' : 'Increase'} of ${f.money(o.amount)}`;
  const time = o.timeDirection === 'none' || !Number(o.days)
    ? 'No change'
    : `${o.timeDirection === 'reduce' ? 'Reduced' : 'Extended'} by ${Number(o.days)} day${Number(o.days) === 1 ? '' : 's'}`;

  const secondOwner = (preset) => `
    <label class="check add2-toggle"><input type="checkbox" name="addOwner2" value="1" ${preset ? 'checked' : ''}> Add a second owner signature (for example, a spouse or co-owner)</label>
    <div class="owner2-fields" ${preset ? '' : 'hidden'}>
      <label>Second owner’s full name<input name="name2" value="${esc(preset)}" autocomplete="off"></label>
      <span class="lbl">Second owner signs below</span>
      <div class="sigpad second"><canvas></canvas><button type="button" class="link clear">Clear</button></div>
      <input type="hidden" name="signature2">
    </div>`;

  const signForm = (who, name, heading) => `<div class="card">
  <h2>${heading}</h2>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/s/${esc(token)}/sign" class="form sign-form" novalidate>
    <input type="hidden" name="who" value="${who}">
    <label>Full name<input name="name" value="${esc(name)}" autocomplete="name"></label>
    <span class="lbl">Sign below with your finger or mouse</span>
    <div class="sigpad main"><canvas></canvas><button type="button" class="link clear">Clear</button></div>
    <input type="hidden" name="signature">
    ${who === 'owner' ? secondOwner(o.owner2Name || '') : ''}
    <label class="check"><input type="checkbox" name="consent" value="1"> I have reviewed Change Order #${esc(o.number)} and agree to its terms. I agree to sign electronically, and my electronic signature is the legal equivalent of my handwritten signature.</label>
    <button class="btn big">Sign change order</button>
  </form>
</div>`;

  return layout({
    title: `Change Order #${o.number}`,
    company,
    body: `<div class="public-head">
  <h1>Change Order #${esc(o.number)}</h1>
  <p class="muted">${esc(o.projectName)} · ${esc(f.date(o.date))}</p>
</div>
${o.status === 'declined' ? `<div class="flash error">You declined this change order. Please contact ${esc(company.name)} at ${esc(company.phone)} if this was a mistake.</div>` : ''}
${done ? `<div class="card ok"><h2>Thank you — signed</h2>
  <p>Signed by ${esc(sigs.owner.name)} on ${esc(f.dateTime(sigs.owner.at))}.${sigs.owner2 ? ` Second owner: ${esc(sigs.owner2.name)}.` : ''}</p>
  <a class="btn" href="/s/${esc(token)}/pdf?download=1">Download signed copy (PDF)</a></div>` : ''}
<div class="card summary">
  <dl>
    <dt>Contractor</dt><dd>${esc(company.name)} · CSLB #${esc(company.license)}</dd>
    <dt>Price</dt><dd><b>${esc(price)}</b></dd>
    <dt>Time</dt><dd>${esc(time)}</dd>
    <dt>Work</dt><dd class="pre">${esc(o.description)}</dd>
  </dl>
  <a class="btn ghost" href="/s/${esc(token)}/pdf" target="_blank" rel="noopener">View full change order (PDF)</a>
</div>
${!done && o.status !== 'declined' ? signForm('owner', o.ownerName, 'Sign') + `
<details class="decline"><summary>I don’t agree with this change order</summary>
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
    const toggle = form.querySelector('[name=addOwner2]');
    const fields2 = form.querySelector('.owner2-fields');
    if (toggle) toggle.addEventListener('change', () => { fields2.hidden = !toggle.checked; });
    form.addEventListener('submit', (e) => {
      const el = (n) => form.elements.namedItem(n);
      const stop = (msg) => { e.preventDefault(); alert(msg); };
      if (!el('name').value.trim()) return stop('Please type your full name.');
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

module.exports = { esc, login, dashboard, orderForm, orderDetail, settingsPage, signPage, notFound };
