// One-way data flow: dispatch(action) -> reducer -> new state -> subscribers re-render.
// Views never mutate state directly.
//
// Sessions: several bills can be open at once (tabs). `cart` is always the active session's cart;
// `sessions` holds every open session, including the active one.
const listeners = new Set();
const uid = () => Math.random().toString(36).slice(2, 9);
const emptyCart = () => ({ lines: [], cartDiscount: null, customer: {}, notes: '', redeemPoints: 0 });
const newSession = (n) => ({ id: uid(), label: `Bill ${n}`, at: Date.now(), cart: emptyCart() });

const first = newSession(1);
let state = {
  boot: null,          // settings, methods, categories, plans, shift, extensions from /api/bootstrap
  items: [],
  sessions: [first],
  active: first.id,
  cart: first.cart,
  notifications: [],
};

/** Replace the active cart and keep sessions in sync. */
function withCart(s, cart) {
  return { ...s, cart, sessions: s.sessions.map((x) => (x.id === s.active ? { ...x, cart } : x)) };
}

function cartReducer(c, a) {
  switch (a.type) {
    case 'cart/add': {
      const lines = [...c.lines];
      if (a.item.membershipPlanId && lines.some((l) => l.membershipPlanId)) return c; // one membership per bill
      const optSig = JSON.stringify(a.options || []);
      const i = a.item.id ? lines.findIndex((l) => l.itemId === a.item.id && !l.discount && JSON.stringify(l.options || []) === optSig) : -1;
      if (i >= 0) lines[i] = { ...lines[i], qty: lines[i].qty + (a.qty || 1) };
      else lines.push({ key: uid(), itemId: a.item.id || null, membershipPlanId: a.item.membershipPlanId || null, options: a.options || null, name: a.label || a.item.name, category: a.item.category || 'Custom', unitPrice: a.unitPrice ?? a.item.price, taxRate: a.item.tax_rate ?? null, qty: a.item.membershipPlanId ? 1 : a.qty || 1, emoji: a.item.emoji, discount: null });
      return { ...c, lines };
    }
    case 'cart/qty': return { ...c, lines: c.lines.map((l) => (l.key === a.key ? { ...l, qty: l.membershipPlanId ? Math.min(1, Math.max(0, a.qty)) : Math.max(0, a.qty) } : l)).filter((l) => l.qty > 0) };
    case 'cart/line': return { ...c, lines: c.lines.map((l) => (l.key === a.key ? { ...l, ...a.patch } : l)) };
    case 'cart/remove': return { ...c, lines: c.lines.filter((l) => l.key !== a.key) };
    case 'cart/discount': return { ...c, cartDiscount: a.discount };
    case 'cart/customer': return { ...c, customer: a.replace ? { ...a.customer } : { ...c.customer, ...a.customer }, redeemPoints: a.replace ? 0 : c.redeemPoints };
    case 'cart/redeem': return { ...c, redeemPoints: Math.max(0, Math.floor(a.points || 0)) };
    case 'cart/notes': return { ...c, notes: a.notes };
    case 'cart/clear': return emptyCart();
    default: return c;
  }
}

function reducer(s, a) {
  if (a.type.startsWith('cart/')) {
    const cart = cartReducer(s.cart, a);
    return cart === s.cart ? s : withCart(s, cart);
  }
  switch (a.type) {
    case 'boot': return { ...s, boot: a.boot };
    case 'items': return { ...s, items: a.items };
    case 'shift': return { ...s, boot: { ...s.boot, shift: a.shift } };
    case 'session/new': {
      const n = Math.max(0, ...s.sessions.map((x) => Number(x.label.replace(/\D/g, '')) || 0)) + 1;
      const ses = newSession(n);
      return { ...s, sessions: [...s.sessions, ses], active: ses.id, cart: ses.cart };
    }
    case 'session/switch': {
      const ses = s.sessions.find((x) => x.id === a.id);
      return ses ? { ...s, active: ses.id, cart: ses.cart } : s;
    }
    case 'session/close': {
      let sessions = s.sessions.filter((x) => x.id !== a.id);
      if (!sessions.length) sessions = [newSession(1)];
      const active = s.active === a.id ? sessions[Math.max(0, s.sessions.findIndex((x) => x.id === a.id) - 1)]?.id || sessions[0].id : s.active;
      return { ...s, sessions, active, cart: sessions.find((x) => x.id === active).cart };
    }
    case 'session/rename': return { ...s, sessions: s.sessions.map((x) => (x.id === a.id ? { ...x, label: String(a.label).slice(0, 24) || x.label } : x)) };
    case 'sessions/restore': {
      if (!a.sessions?.length) return s;
      const sessions = a.sessions.map((x) => ({ ...x, cart: { ...emptyCart(), ...x.cart } }));
      const active = sessions.find((x) => x.id === a.active) || sessions[0];
      return { ...s, sessions, active: active.id, cart: active.cart };
    }
    case 'notifications': return { ...s, notifications: a.list };
    case 'notification/add': return { ...s, notifications: [a.n, ...s.notifications].slice(0, 50) };
    default: return s;
  }
}

export const getState = () => state;

export function dispatch(action) {
  const prev = state;
  state = reducer(state, action);
  if (state !== prev) {
    if (state.sessions !== prev.sessions || state.active !== prev.active) persist();
    for (const l of listeners) l(state, prev, action);
  }
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Keep open sessions across reloads (this browser only).
// Open bills are kept in this browser and mirrored to the POS itself (see syncDrafts in app.js),
// so they survive a reload, a restart, a cleared browser or switching to the desktop window.
function persist() {
  try { localStorage.setItem('pos.sessions', JSON.stringify({ sessions: state.sessions, active: state.active, savedAt: new Date().toISOString() })); } catch { /* storage unavailable */ }
}
export const localDraftsSavedAt = () => { try { return JSON.parse(localStorage.getItem('pos.sessions') || 'null')?.savedAt || ''; } catch { return ''; } };
try {
  const saved = JSON.parse(localStorage.getItem('pos.sessions') || 'null');
  if (saved?.sessions?.length) {
    const active = saved.sessions.find((x) => x.id === saved.active) || saved.sessions[0];
    state = { ...state, sessions: saved.sessions.map((x) => ({ ...x, cart: { ...emptyCart(), ...x.cart } })), active: active.id, cart: { ...emptyCart(), ...active.cart } };
  }
} catch { /* ignore */ }
