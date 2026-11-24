// IRD made easy: setup wizard, readiness checklist, sync everything, filing pack.
import { h, icon, toast, errorToast, field, badge, modal, confirmDialog } from '../ui.js';
import { thisDevice } from '../device.js';
import { get, post } from '../api.js';
import { getState } from '../store.js';

export async function renderIrd(box) {
  let st;
  try { st = await get('/api/ird/status'); } catch (e) { return errorToast(e); }
  const reload = () => renderIrd(box);
  const c = st.counts || {};
  const fys = (await get('/api/reports')).fiscalYears;
  const fy = h('select.input', { 'aria-label': 'Fiscal year' }, fys.map((f) => h('option', { value: f }, `FY ${f}`)));
  const month = h('select.input', { 'aria-label': 'Month' }, h('option', { value: '' }, 'Whole year'),
    ['04', '05', '06', '07', '08', '09', '10', '11', '12', '01', '02', '03'].map((m, i) => h('option', { value: m }, ['Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra', 'Baisakh', 'Jestha', 'Asar'][i])));

  box.replaceChildren(h('div.ird-page',
    h('section.card',
      h('header.card-head', h('h3', icon('shield', 18), 'IRD (CBMS) status'),
        st.enabled ? (st.dryRun ? badge('Practice mode — nothing sent', 'warn') : badge('Live', 'ok')) : badge('Off')),
      h('ul.checklist', st.checks.map((ch) => h(`li.${ch.ok ? 'ok' : 'todo'}`, icon(ch.ok ? 'check' : 'x', 16), ch.label))),
      h('div.kpis.small',
        stat('Accepted by IRD', c.synced || 0, 'ok'), stat('Waiting', c.pending || 0, ''), stat('Failed (auto-retrying)', c.failed || 0, c.failed ? 'down' : ''),
        stat('Credit notes waiting', st.pendingRefunds || 0, '')),
      st.lastError ? h('p.danger-text', `Last error on ${st.lastError.invoice}: ${st.lastError.message || 'unknown'}`) : null,
      h('footer.conn-actions',
        h('button.btn', { onclick: () => wizard(st, reload) }, icon('gear', 16), st.ready ? 'Change IRD setup' : 'Set up IRD (3 steps)'),
        h('button.btn.primary', { disabled: !st.enabled, onclick: async () => {
          try { const r = await post('/api/ird/sync-all'); toast(`Sent to IRD: ${r.synced} accepted, ${r.failed} failed${st.dryRun ? ' (practice mode)' : ''}`, r.failed ? 'warn' : 'success', 6000); reload(); } catch (e) { errorToast(e); }
        } }, icon('refresh', 16), 'Sync everything now'))),
    h('section.card',
      h('header.card-head', h('h3', icon('download', 18), 'Filing pack (attach to your IRD return)')),
      h('p.hint', 'One ZIP with: sales register (CSV + printable), VAT summary by month, credit notes, and a list of any bills IRD has not accepted yet.'),
      h('div.toolbar-actions', fy, month,
        h('button.btn.primary', { onclick: () => { const a = document.createElement('a'); a.href = `/api/ird/filing-pack?fy=${encodeURIComponent(fy.value)}${month.value ? `&month=${month.value}` : ''}`; document.body.append(a); a.click(); a.remove(); } }, icon('download', 16), 'Download filing pack'))),
    h('p.hint', 'Failed bills are retried automatically (after 1, 5, 15, 60 minutes, then every few hours). Bills imported from an old system are never sent.')));
}

const stat = (label, value, trend) => h('div.kpi', h('span.kpi-label', label), h('b.kpi-value', value), h(`small.kpi-sub${trend ? '.' + trend : ''}`, ''));

/** Three steps: business PAN → CBMS login → practice or go live. */
function wizard(st, done) {
  const biz = getState().boot.settings.business;
  const ird = getState().boot.settings.ird || {};
  let step = 1;
  const pan = h('input.input', { value: biz.pan || '', inputMode: 'numeric', maxLength: 9, placeholder: '9-digit PAN/VAT number' });
  const name = h('input.input', { value: biz.name || '' });
  const address = h('input.input', { value: biz.address || '' });
  const user = h('input.input', { value: ird.username || '', autocomplete: 'off', placeholder: 'CBMS username from IRD' });
  const pass = h('input.input', { type: 'password', autocomplete: 'off', placeholder: ird.passwordSet ? 'Saved — type to replace' : 'CBMS password from IRD' });
  const live = h('input', { type: 'checkbox', checked: st.enabled && !st.dryRun });
  const body = h('div');
  const draw = () => body.replaceChildren(h('ol.steps', ['Business', 'IRD login', 'Go live'].map((s, i) => h(`li${i + 1 === step ? '.on' : i + 1 < step ? '.done' : ''}`, s))),
    step === 1 ? h('div.form-grid', h('p.hint', 'Your bills will show this PAN and IRD receives it as the seller PAN.'), field('PAN / VAT number', pan), field('Business name (as registered)', name), field('Address', address))
      : step === 2 ? h('div.form-grid', h('p.hint', `The CBMS username and password IRD issued for your PAN (from the IRD taxpayer portal). The password is encrypted on ${thisDevice()} and is only ever sent to the IRD server.`), field('CBMS username', user), field('CBMS password', pass))
        : h('div.form-grid', h('p', 'Practice mode builds every IRD message but sends nothing, so you can check bills first.'),
          h('label.toggle', live, h('span.track'), h('span', h('b', 'Go live'), ' — send every new bill to IRD automatically')),
          h('p.hint', 'IRD has no test login: in live mode real bills are reported. Bills already issued in practice mode can be sent with “Sync everything now”.')));
  draw();
  const m = modal({ title: 'Set up IRD', wide: true, body, actions: [
    { label: 'Back', onClick: () => { if (step > 1) { step--; draw(); } } },
    { label: 'Next', primary: true, onClick: async (close) => {
      if (step === 1 && !/^\d{9}$/.test(pan.value)) return toast('PAN must be 9 digits', 'warn');
      if (step === 2 && !user.value) return toast('Enter the CBMS username', 'warn');
      if (step < 3) { step++; draw(); return; }
      if (live.checked && !(await confirmDialog('Go live? From now on every bill is reported to IRD.', { okLabel: 'Go live' }))) return;
      try {
        await post('/api/ird/setup', { pan: pan.value, name: name.value, address: address.value, username: user.value, password: pass.value, goLive: live.checked });
        if (!live.checked) await post('/api/ird/setup', { pan: pan.value });
        toast(live.checked ? 'IRD is live' : 'IRD set up in practice mode', 'success');
        close(); done();
      } catch (e) { errorToast(e); }
    } }] });
  return m;
}
