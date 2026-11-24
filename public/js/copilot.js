// AI copilot drawer (owner area). It can look things up and prepare work; anything that changes data
// appears as a proposal card for the owner to approve or reject. Attach supplier bills (photo/PDF) or
// exports from an old system (CSV/TSV/JSON). Chat history is kept in this browser only.
import { h, icon, errorToast, toast } from './ui.js';
import { post } from './api.js';
import { getState } from './store.js';

const STORE = 'pos.copilot';
let open = false;
let state = load();
function load() { try { return JSON.parse(localStorage.getItem(STORE)) || { conversationId: null, log: [] }; } catch { return { conversationId: null, log: [] }; } }
function save() { try { localStorage.setItem(STORE, JSON.stringify({ conversationId: state.conversationId, log: state.log.slice(-60) })); } catch { /* ignore */ } }

export function toggleCopilot() {
  if (!open && !getState().boot?.ownerSignedIn) { toast('The copilot sees your business numbers — sign in as owner first', 'warn'); location.hash = '#/overview'; return; }
  open = !open;
  document.querySelector('.copilot')?.remove();
  if (open) document.body.append(drawer());
}

const MAX_FILE = 8 * 1024 * 1024;
const readFile = (f) => new Promise((resolve, reject) => {
  if (f.size > MAX_FILE) return reject(new Error(`${f.name} is larger than 8 MB`));
  const r = new FileReader();
  r.onload = () => resolve({ name: f.name, dataUrl: r.result });
  r.onerror = () => reject(new Error(`Could not read ${f.name}`));
  r.readAsDataURL(f);
});

/** Render text with download links (only same-origin /api/ links become clickable). */
function rich(text) {
  const parts = String(text || '').split(/(\/api\/[\w/?=&%.-]+)/g);
  return parts.map((p) => (/^\/api\/[\w/?=&%.-]+$/.test(p) ? h('a.btn.sm', { href: p }, icon('download', 12), 'Download') : p));
}

function drawer() {
  const logEl = h('div.chat-log', { 'aria-live': 'polite' });
  const input = h('textarea.input', { rows: 2, placeholder: 'Ask, or attach a supplier bill / old export… (Enter to send)' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: 'image/*,application/pdf,.csv,.tsv,.txt,.json' });
  const chips = h('div.attach-chips');
  let files = [];
  let busy = false;
  fileIn.addEventListener('change', async () => {
    try { files.push(...await Promise.all([...fileIn.files].map(readFile))); } catch (e) { errorToast(e); }
    fileIn.value = ''; drawChips();
  });
  const drawChips = () => chips.replaceChildren(...files.map((f, i) => h('span.chip', icon('upload', 12), f.name, h('button.icon-btn.sm', { 'aria-label': `Remove ${f.name}`, onclick: () => { files.splice(i, 1); drawChips(); } }, icon('x', 12)))));

  const draw = () => {
    logEl.replaceChildren(...(state.log.length ? state.log.map(entry) : [
      h('div.msg.assistant', 'I can look up sales, stock and customers, prepare stock-in from a supplier bill photo, map an export from your old system, and get your IRD filing pack. I always ask before changing anything.'),
      ...['How is this month going vs last month?', 'Which items should I restock?', 'Get the IRD filing pack for this fiscal year'].map((q) => h('button.chip', { onclick: () => { input.value = q; send(); } }, q)),
    ]));
    logEl.scrollTop = logEl.scrollHeight;
  };

  const entry = (m) => {
    if (m.role === 'user') return h('div.msg.user', m.text, m.files?.length ? h('small', ` 📎 ${m.files.join(', ')}`) : null);
    if (m.role === 'proposals') {
      return h('div.proposals', m.items.map((p) => h(`div.proposal${p.state ? '.' + p.state : ''}`,
        h('div', h('b', p.state === 'approve' ? '✓ Approved: ' : p.state === 'reject' ? '✗ Rejected: ' : 'Proposed: '), p.summary),
        h('details', h('summary', 'Details'), h('pre.code', JSON.stringify(p.input, null, 2))))),
      m.items.some((p) => !p.state) ? h('div.row-actions',
        h('button.btn.sm.primary', { onclick: () => decide(m, 'approve') }, icon('check', 14), m.items.length > 1 ? 'Approve all' : 'Approve'),
        h('button.btn.sm', { onclick: () => decide(m, 'reject') }, icon('x', 14), 'Reject')) : null);
    }
    return h('div.msg.assistant', rich(m.text));
  };

  async function run(fn) {
    if (busy) return;
    busy = true;
    const thinking = h('div.msg.assistant.thinking', 'Working…');
    logEl.append(thinking); logEl.scrollTop = logEl.scrollHeight;
    try {
      const r = await fn();
      state.conversationId = r.conversationId;
      if (r.reply) state.log.push({ role: 'assistant', text: r.reply });
      if (r.proposals?.length) state.log.push({ role: 'proposals', items: r.proposals.map((p) => ({ id: p.id, tool: p.tool, summary: p.summary, input: p.input })) });
    } catch (e) {
      if (e.status === 404) { state.conversationId = null; toast('That conversation expired — starting a new one', 'info'); }
      else errorToast(e);
    } finally { busy = false; save(); draw(); }
  }

  async function send() {
    const text = input.value.trim();
    if (!text && !files.length) return;
    const pendingCard = state.log.findLast?.((m) => m.role === 'proposals' && m.items.some((p) => !p.state));
    if (pendingCard) return toast('Approve or reject the proposed actions first', 'warn');
    const sending = files; files = []; drawChips(); input.value = '';
    state.log.push({ role: 'user', text, files: sending.map((f) => f.name) });
    draw();
    await run(() => post('/api/ai/agent', { conversationId: state.conversationId, text, files: sending }));
  }

  async function decide(card, choice) {
    const decisions = Object.fromEntries(card.items.filter((p) => !p.state).map((p) => [p.id, choice]));
    card.items.forEach((p) => { if (!p.state) p.state = choice; });
    save(); draw();
    await run(() => post('/api/ai/agent/decide', { conversationId: state.conversationId, decisions }));
    if (choice === 'approve') window.dispatchEvent(new CustomEvent('pos:data-changed'));
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  draw();
  setTimeout(() => input.focus(), 50);
  return h('aside.copilot', { 'aria-label': 'AI copilot' },
    h('header.copilot-head', h('h3', icon('sparkles', 18), 'Copilot'),
      h('div.row-actions',
        h('button.btn.sm.ghost', { onclick: () => { state = { conversationId: null, log: [] }; save(); draw(); } }, 'New chat'),
        h('button.icon-btn', { 'aria-label': 'Close copilot', onclick: toggleCopilot }, icon('x')))),
    logEl,
    h('p.copilot-note', 'Messages and attachments go to the AI service through the privacy gate; your keys never do.'),
    chips,
    h('div.chat-input', h('label.icon-btn', { title: 'Attach photo, PDF or export', 'aria-label': 'Attach files' }, icon('upload', 18), fileIn), input, h('button.btn.primary', { onclick: send, 'aria-label': 'Send' }, icon('send', 16))));
}
