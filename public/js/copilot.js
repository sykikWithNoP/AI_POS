// AI copilot drawer (BYOK Anthropic). Conversation lives in memory for this tab only.
import { h, icon, errorToast, toast } from './ui.js';
import { getState } from './store.js';
import { post } from './api.js';

let open = false;
const history = [];

export function toggleCopilot() {
  if (!open && !getState().boot?.ownerSignedIn) { toast('The copilot sees your business numbers — sign in as owner first', 'warn'); location.hash = '#/overview'; return; }
  open = !open;
  document.querySelector('.copilot')?.remove();
  if (open) document.body.append(drawer());
}

function drawer() {
  const log = h('div.chat-log', { 'aria-live': 'polite' });
  const input = h('textarea.input', { rows: 2, placeholder: 'Ask about sales, stock, pricing… (Enter to send)' });
  const draw = () => {
    log.replaceChildren(...(history.length ? history.map((m) => h(`div.msg.${m.role}`, m.content)) : [
      h('div.msg.assistant', 'Hi! I can see this month\'s numbers, your catalog and stock. Try:'),
      ...['How is this month going vs last month?', 'Which items should I restock?', 'Suggest a combo deal from my top items'].map((q) => h('button.chip', { onclick: () => { input.value = q; send(); } }, q)),
    ]));
    log.scrollTop = log.scrollHeight;
  };
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    history.push({ role: 'user', content: text });
    draw();
    const thinking = h('div.msg.assistant.thinking', 'Thinking…');
    log.append(thinking);
    try {
      const r = await post('/api/ai/chat', { messages: history });
      history.push({ role: 'assistant', content: r.reply });
    } catch (e) { history.pop(); errorToast(e); input.value = text; }
    draw();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  draw();
  setTimeout(() => input.focus(), 50);
  return h('aside.copilot', { 'aria-label': 'AI copilot' },
    h('header.copilot-head', h('h3', icon('sparkles', 18), 'Copilot'), h('button.icon-btn', { 'aria-label': 'Close copilot', onclick: toggleCopilot }, icon('x'))),
    log, h('div.chat-input', input, h('button.btn.primary', { onclick: send, 'aria-label': 'Send' }, icon('send', 16))));
}
