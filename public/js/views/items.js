// Items manager: add, change, delete, import/export the catalog.
import { h, icon, money, toMajor, toast, errorToast, modal, field, confirmDialog, empty, debounce, badge } from '../ui.js';
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
    modal({
      title: item ? `Edit ${item.name}` : 'Add item', wide: true,
      body: h('div.form-grid.two',
        h('datalist#cat-list', cats.map((c) => h('option', { value: c }))),
        field('Name *', f.name), field('Category', f.category),
        field('Selling price *', f.price), field('Cost price', f.cost, 'Used for profit estimates'),
        field('Tax rate %', f.tax_rate, 'Leave blank for the default; 0 for VAT-exempt'), field('Stock', f.stock),
        field('Unit', f.unit), field('SKU', f.sku), field('Barcode', f.barcode, 'Scan into this box'), field('Emoji / icon', f.emoji),
        field('Tile colour', f.color), h('label.toggle', f.active, h('span.track'), h('span', 'Show on POS'))),
      actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: item ? 'Save changes' : 'Add item', primary: true, onClick: async (c) => {
        const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
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
