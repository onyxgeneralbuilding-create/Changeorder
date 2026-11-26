// Address autocomplete: type in an address box, pick a suggestion, and the
// street plus "City, State & Zip" fill in. Pairs: ownerAddress→ownerCityStateZip, workAddress→workCityStateZip.
(function () {
  const PAIRS = { ownerAddress: 'ownerCityStateZip', workAddress: 'workCityStateZip' };
  const session = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

  function attach(input) {
    const form = input.form;
    const target = form && form.elements.namedItem(PAIRS[input.name]);
    if (!target || input.dataset.ac) return;
    input.dataset.ac = '1';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    const wrap = document.createElement('div');
    wrap.className = 'ac';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const list = document.createElement('ul');
    list.className = 'ac-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(list);
    let tok = session(), timer = null, items = [], active = -1, lastQ = '';

    const close = () => { list.hidden = true; active = -1; };
    const render = () => {
      list.innerHTML = '';
      items.forEach((s, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.className = i === active ? 'on' : '';
        li.innerHTML = '<b></b><span></span>';
        li.firstChild.textContent = s.main;
        li.lastChild.textContent = s.secondary;
        li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(s); });
        list.appendChild(li);
      });
      const foot = document.createElement('li');
      foot.className = 'ac-foot';
      foot.textContent = 'Address suggestions by Google';
      list.appendChild(foot);
      list.hidden = !items.length;
    };
    async function pick(s) {
      close();
      input.value = s.main;
      try {
        // Use the community name Google shows in the suggestion (e.g. "Granada Hills" rather than "Los Angeles").
        const shownCity = (s.secondary || '').split(',')[0].trim();
        const r = await fetch(`/api/address/details?id=${encodeURIComponent(s.id)}&session=${tok}&city=${encodeURIComponent(shownCity)}`);
        const d = await r.json();
        if (d.street) input.value = d.street;
        if (d.cityStateZip) target.value = d.cityStateZip;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) { /* keep what was typed */ }
      tok = session();
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3 || q === lastQ) { if (q.length < 3) close(); return; }
      timer = setTimeout(async () => {
        lastQ = q;
        try {
          const r = await fetch(`/api/address/suggest?q=${encodeURIComponent(q)}&session=${tok}`);
          const d = await r.json();
          if (input.value.trim() !== q) return;
          items = d.suggestions || []; active = -1; render();
        } catch (_) { close(); }
      }, 250);
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
  }

  document.querySelectorAll('input[name=ownerAddress], input[name=workAddress]').forEach(attach);
})();
