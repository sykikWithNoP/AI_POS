// Till → customer display. The display is a second window in the same browser (e.g. on a screen facing
// the customer); it only ever receives what is sent here, through a same-origin BroadcastChannel.
// Nothing goes over the network.
const ch = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pos-display') : null;
let last = null;

export function openCustomerDisplay() {
  const w = window.open('/display.html', 'pos-customer-display', 'popup,width=1000,height=640');
  if (!w) return false;
  setTimeout(() => last && ch?.postMessage(last), 800);
  return true;
}

/** Called by the sell screen whenever the bill changes. Amounts are already formatted strings. */
export function showCart(msg) { last = { type: 'cart', ...msg }; ch?.postMessage(last); }
export function showPaid(msg) { last = { type: 'paid', ...msg }; ch?.postMessage(last); setTimeout(() => { last = { type: 'idle', shop: msg.shop }; ch?.postMessage(last); }, 15000); }

// A display opened later asks for the current state.
ch?.addEventListener('message', (e) => { if (e.data?.type === 'hello' && last) ch.postMessage(last); });
