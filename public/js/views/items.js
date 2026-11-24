// Items manager: add, change, delete, import/export the catalog.
import { h, icon, money, toMajor, toast, errorToast, modal, field, confirmDialog, empty, debounce, badge, fmtDate } from '../ui.js';
import { get, post, put, del, api } from '../api.js';
import { getState } from '../store.js';

export function renderItemsManager(root, { onChange }) {
  let q = '';
  const tbody = h('tbody');
  const search = h('input.input', { type: 'search', placeholder: 'Filter items…', 'aria-label': 'Filter items' });
  root.replaceChildren(
    h('div.toolbar',
      h('div.search-wrap', icon('search', 18), search),
      h('div.toolbar-actions',
        h('button.btn', { onclick: () => stockInDialog(load) }, icon('box', 16), 'Stock in'),
        h('button.btn', { onclick: () => historyDialog(null) }, icon('list', 16), 'Stock history'),
        h('button.btn', { onclick: importDialog }, icon('upload', 16), 'Import CSV'),
        h('a.btn', { href: '/api/items/export.csv' }, icon('download', 16), 'Export'),
        h('button.btn.primary', { onclick: () => itemDialog() }, icon('plus', 16), 'Add item'))),
    h('div.table-wrap', h('table.table',
      h('thead', h('tr', h('th', 'Item'), h('th', 'Category'), h('th.n', 'Price'), h('th.n', 'Cost'), h('th.n', 'Tax'), h('th.n', 'Stock'), h('th', 'Status'), h('th', ''))),
      tbody)));

  async function load() {
    const list = await get(`/api/items?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    if (!list.length) { tbody.replaceChildren(h('tr', h('td', { colSpan: 8 }, empty(q ? 'No matches' : 'No items yet — add your first one.')))); return; }
    const defRate = getState().boot.settings.tax.rate;
    tbody.replaceChildren(...list.map((i) => h('tr',
      h('td', h('div.item-cell', h('span.p-emoji.sm', i.emoji || i.name.slice(0, 2).toUpperCase()), h('div', h('b', i.name), h('small.muted', [i.sku, i.barcode].filter(Boolean).join(' · '))))),
      h('td', i.category),
      h('td.n', money(i.price)),
      h('td.n', i.cost ? money(i.cost) : '—'),
      h('td.n', i.tax_rate === null ? `${defRate}%*` : `${i.tax_rate}%`),
      h('td.n', i.stock === null ? '—' : h(`span${i.stock <= 0 ? '.danger-text' : i.stock <= 5 ? '.warn-text' : ''}`, `${i.stock} ${i.unit}`)),
      h('td', i.active ? badge('Active', 'ok') : badge('Hidden')),
      h('td.actions',
        i.stock !== null ? h('button.icon-btn', { title: 'Adjust stock', 'aria-label': `Adjust stock of ${i.name}`, onclick: () => adjustDialog(i, load) }, icon('refresh', 16)) : null,
        i.stock !== null ? h('button.icon-btn', { title: 'Stock history', 'aria-label': `Stock history of ${i.name}`, onclick: () => historyDialog(i) }, icon('list', 16)) : null,
        h('button.icon-btn', { title: 'Edit', 'aria-label': `Edit ${i.name}`, onclick: () => itemDialog(i) }, icon('edit', 16)),
        h('button.icon-btn', { title: 'Delete', 'aria-label': `Delete ${i.name}`, onclick: () => remove(i) }, icon('trash', 16))))));
  }

  async function remove(i) {
    if (!(await confirmDialog(`Delete "${i.name}"? Past bills keep their copy of this item.`, { okLabel: 'Delete', danger: true }))) return;
    try { await del(`/api/items/${i.id}`); toast('Item deleted', 'success'); load(); onChange?.(); } catch (e) { errorToast(e); }
  }

  function itemDialog(item) {
    const cats = getState().boot.categories.map((c) => c.category);
    const v = item || {};
    const f = {
      name: h('input.input', { value: v.name || '', required: true, maxLength: 120 }),
      category: h('input.input', { value: v.category || 'General', list: 'cat-list' }),
      price: h('input.input', { type: 'number', step: 'any', min: 0, value: v.price !== undefined ? toMajor(v.price) : '' }),
      cost: h('input.input', { type: 'number', step: 'any', min: 0, value: v.cost ? toMajor(v.cost) : '' }),
      tax_rate: h('input.input', { type: 'number', step: 'any', min: 0, max: 100, value: v.tax_rate ?? '', placeholder: `Default (${getState().boot.settings.tax.rate}%)` }),
      stock: h('input.input', { type: 'number', step: 'any', value: v.stock ?? '', placeholder: 'Blank = not tracked' }),
      unit: h('input.input', { value: v.unit || 'pc', maxLength: 10 }),
      sku: h('input.input', { value: v.sku || '' }),
      barcode: h('input.input', { value: v.barcode || '' }),
      emoji: h('input.input', { value: v.emoji || '', maxLength: 4, placeholder: '☕' }),
      color: h('input.input', { type: 'color', value: v.color || '#0f766e' }),
      active: h('input', { type: 'checkbox', checked: v.active !== false }),
    };
    const opts = optionsEditor(v.options || []);
    modal({
      title: item ? `Edit ${item.name}` : 'Add item', wide: true,
      body: h('div.form-grid.two',
        h('datalist#cat-list', cats.map((c) => h('option', { value: c }))),
        field('Name *', f.name), field('Category', f.category),
        field('Selling price *', f.price), field('Cost price', f.cost, 'Used for profit estimates'),
        field('Tax rate %', f.tax_rate, 'Leave blank for the default; 0 for VAT-exempt'), field('Stock', f.stock),
        field('Unit', f.unit), field('SKU', f.sku), field('Barcode', f.barcode, 'Scan into this box'), field('Emoji / icon', f.emoji),
        field('Tile colour', f.color), h('label.toggle', f.active, h('span.track'), h('span', 'Show on POS')),
        h('div.span-all', h('h4', 'Variants & add-ons'), h('p.hint', 'e.g. Size: Small −20 / Large +40, or Extras: Cheese +30 (pick any). Prices are added to the selling price.'), opts.el)),
      actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: item ? 'Save changes' : 'Add item', primary: true, onClick: async (c) => {
        const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
        body.options = opts.value();
        if (!item && body.color === '#0f766e') delete body.color;
        try {
          item ? await put(`/api/items/${item.id}`, body) : await post('/api/items', body);
          toast(item ? 'Item updated' : 'Item added', 'success'); c(); load(); onChange?.();
        } catch (e) { errorToast(e); }
      } }],
    });
  }

  function importDialog() {
    const ta = h('textarea.input.mono', { rows: 8, placeholder: 'name,category,price,cost,tax_rate,stock,sku,barcode,emoji\nMomo,Food,180,90,,50,MOMO1,,🥟' });
    const file = h('input', { type: 'file', accept: '.csv,text/csv', onchange: async (e) => { ta.value = await e.target.files[0].text(); } });
    modal({
      title: 'Import items from CSV', wide: true,
      body: h('div', h('p.hint', 'Header row required. Rows with an existing SKU are updated; others are created.'), file, ta),
      actions: [{ label: 'Import', primary: true, onClick: async (c) => {
        try {
          const r = await api('/api/items/import', { method: 'POST', body: { csv: ta.value } });
          toast(`Imported: ${r.created} new, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} errors` : ''}`, r.errors.length ? 'warn' : 'success', 6000);
          if (r.errors.length) console.table(r.errors);
          c(); load(); onChange?.();
        } catch (e) { errorToast(e); }
      } }],
    });
  }

  search.addEventListener('input', debounce(() => { q = search.value.trim(); load(); }, 200));
  load().catch(errorToast);
}

const KIND_LABEL = { opening: 'Opening', in: 'Received', adjust: 'Adjusted', sale: 'Sold', refund: 'Returned', void: 'Void', edit: 'Edited' };

async function stockInDialog(done) {
  const items = (await get('/api/items')).filter((i) => i.stock !== null);
  if (!items.length) return toast('No items track stock yet. Give an item a stock number first.', 'warn');
  const supplier = h('input.input', { placeholder: 'Supplier name' });
  const ref = h('input.input', { placeholder: 'Supplier bill / reference no.' });
  const rows = h('div.stockin-rows');
  const addRow = () => {
    const sel = h('select.input', items.map((i) => h('option', { value: i.id }, `${i.name} (${i.stock} ${i.unit})`)));
    const qty = h('input.input', { type: 'number', min: 0, step: 'any', placeholder: 'Qty' });
    const cost = h('input.input', { type: 'number', min: 0, step: 'any', placeholder: 'Unit cost' });
    const upd = h('input', { type: 'checkbox', checked: true });
    const row = h('div.stockin-row', sel, qty, cost, h('label.check', upd, 'set as item cost'), h('button.icon-btn', { type: 'button', 'aria-label': 'Remove line', onclick: () => row.remove() }, icon('x', 16)));
    row._get = () => ({ itemId: Number(sel.value), qty: qty.value, unitCost: cost.value, updateCost: upd.checked });
    rows.append(row); qty.focus();
  };
  addRow();
  modal({
    title: 'Stock in — goods received', wide: true,
    body: h('div.form-grid', h('div.form-grid.two', field('Supplier', supplier), field('Reference', ref)), rows,
      h('button.btn.sm', { type: 'button', onclick: addRow }, icon('plus', 14), 'Add line')),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Receive stock', primary: true, onClick: async (c) => {
      const lines = [...rows.children].map((r) => r._get()).filter((l) => Number(l.qty) > 0);
      if (!lines.length) return toast('Enter quantities', 'warn');
      try { const r = await post('/api/stock/in', { supplier: supplier.value, ref: ref.value, lines }); toast(`Received ${r.received} line(s)${r.totalCost ? ' · cost ' + money(r.totalCost) : ''}`, 'success'); c(); done?.(); }
      catch (e) { errorToast(e); }
    } }],
  });
}

function adjustDialog(item, done) {
  const counted = h('input.input', { type: 'number', step: 'any', value: item.stock });
  const reason = h('select.input', ['count', 'damaged', 'expired', 'lost', 'theft', 'own use', 'other'].map((r) => h('option', { value: r }, r === 'count' ? 'Stock count correction' : r[0].toUpperCase() + r.slice(1))));
  const note = h('input.input', { placeholder: 'Note (optional)' });
  modal({
    title: `Adjust stock · ${item.name}`,
    body: h('div.form-grid', h('p.hint', `System quantity: ${item.stock} ${item.unit}. Enter what is actually on the shelf. Adjustments need the owner PIN and are logged.`),
      field('Counted quantity', counted), field('Reason', reason), field('Note', note)),
    actions: [{ label: 'Save adjustment', primary: true, onClick: async (c) => {
      try { await post('/api/stock/adjust', { itemId: item.id, newQty: counted.value, reason: reason.value, note: note.value }); toast('Stock adjusted', 'success'); c(); done?.(); }
      catch (e) { errorToast(e); }
    } }],
  });
}

async function historyDialog(item) {
  const rows = await get(`/api/stock/history?limit=300${item ? `&itemId=${item.id}` : ''}`);
  modal({
    title: item ? `Stock history · ${item.name}` : 'Stock history', wide: true,
    body: rows.length ? h('div.table-wrap', h('table.table.compact', h('thead', h('tr', h('th', 'When'), !item ? h('th', 'Item') : null, h('th', 'What'), h('th.n', 'Change'), h('th.n', 'Balance'), h('th', 'Details'))),
      h('tbody', rows.map((m) => h('tr', h('td', fmtDate(m.created_at)), !item ? h('td', m.item_name) : null, h('td', KIND_LABEL[m.kind] || m.kind),
        h('td.n', h(`b.${m.qty > 0 ? 'ok-text' : 'danger-text'}`, `${m.qty > 0 ? '+' : ''}${m.qty}`)), h('td.n', m.balance ?? '—'),
        h('td', [m.supplier, m.ref, m.reason, m.unit_cost != null ? `@ ${money(m.unit_cost)}` : null].filter(Boolean).join(' · ')))))))
      : empty('No stock movements yet', 'box'),
  });
}

/** Editor for option groups. value() returns groups with prices in major units. */
function optionsEditor(initial) {
  const el = h('div.opt-editor');
  const groupRow = (g = { name: '', required: false, multi: false, choices: [{ name: '', price: 0 }] }) => {
    const name = h('input.input', { value: g.name, placeholder: 'Group (e.g. Size)' });
    const req = h('input', { type: 'checkbox', checked: g.required });
    const multi = h('input', { type: 'checkbox', checked: g.multi });
    const list = h('div.opt-choices');
    const choiceRow = (c = { name: '', price: 0 }) => {
      const cn = h('input.input', { value: c.name, placeholder: 'Choice' });
      const cp = h('input.input', { type: 'number', step: 'any', value: c.price ? toMajor(c.price) : '', placeholder: '± price' });
      const row = h('div.opt-choice', cn, cp, h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Remove choice', onclick: () => row.remove() }, icon('x', 14)));
      row._get = () => ({ name: cn.value.trim(), price: Number(cp.value) || 0 });
      list.append(row);
    };
    (g.choices.length ? g.choices : [{ name: '', price: 0 }]).forEach(choiceRow);
    const box = h('div.opt-group-edit',
      h('div.opt-head', name, h('label.check', req, 'required'), h('label.check', multi, 'pick many'),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Remove group', onclick: () => box.remove() }, icon('trash', 14))),
      list, h('button.btn.sm.ghost', { type: 'button', onclick: () => choiceRow() }, icon('plus', 12), 'Choice'));
    box._get = () => ({ name: name.value.trim(), required: req.checked, multi: multi.checked, choices: [...list.children].map((r) => r._get()).filter((c) => c.name) });
    el.insertBefore(box, addBtn);
  };
  const addBtn = h('button.btn.sm', { type: 'button', onclick: () => groupRow() }, icon('plus', 14), 'Add option group');
  el.append(addBtn);
  initial.forEach(groupRow);
  return { el, value: () => [...el.querySelectorAll('.opt-group-edit')].map((b) => b._get()).filter((g) => g.name && g.choices.length) };
}
