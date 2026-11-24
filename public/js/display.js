// Customer display window: shows the current bill and a thank-you after payment. Read-only; it never
// talks to the server — it only listens to the till in this browser.
const d = document.getElementById('d');
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
const ch = new BroadcastChannel('pos-display');
let shop = 'Welcome';

function render(m) {
  if (m.shop) shop = m.shop;
  d.className = m.type;
  d.replaceChildren();
  if (m.type === 'cart' && m.lines?.length) {
    d.append(el('h2', 'shop', shop));
    const ul = el('ul', 'lines');
    for (const l of m.lines.slice(-14)) { const li = el('li'); li.append(el('span', 'qty', `${l.qty}×`), el('span', 'name', l.name), el('b', 'amt', l.total)); ul.append(li); }
    d.append(ul);
    const t = el('div', 'totals');
    for (const [k, v] of m.rows || []) { const r = el('div', 'row'); r.append(el('span', '', k), el('b', '', v)); t.append(r); }
    const g = el('div', 'grand'); g.append(el('span', '', 'Total'), el('b', '', m.total)); t.append(g);
    d.append(t);
    if (m.member) d.append(el('p', 'member', `★ ${m.member}`));
  } else if (m.type === 'paid') {
    d.append(el('div', 'tick', '✓'), el('h1', '', 'Thank you!'), el('p', 'sub', `Paid ${m.total}`));
    if (m.change) d.append(el('p', 'change', `Your change: ${m.change}`));
  } else {
    d.className = 'idle';
    d.append(el('h1', '', shop), el('p', 'sub', 'Your bill will appear here'));
  }
}

ch.onmessage = (e) => render(e.data || {});
ch.postMessage({ type: 'hello' });
document.getElementById('fs').addEventListener('click', () => document.documentElement.requestFullscreen?.().catch(() => {}));
document.addEventListener('fullscreenchange', () => { document.getElementById('fs').hidden = !!document.fullscreenElement; });
