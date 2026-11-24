// Single gateway to the server. Every mutation carries X-POS-Client (CSRF guard).
// If the server answers "pin_required", the owner is asked for the PIN once and the request is retried.
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

let pinPrompt = null; // set by app.js: () => Promise<boolean> (true when elevated)
export const setPinPrompt = (fn) => { pinPrompt = fn; };

async function raw(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-POS-Client': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { res, data };
}

export async function api(path, opts = {}) {
  let { res, data } = await raw(path, opts);
  if (res.status === 403 && data?.error === 'pin_required' && pinPrompt && !opts.noPinRetry) {
    if (await pinPrompt(data.message)) ({ res, data } = await raw(path, opts));
  }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error, data?.message || `Request failed (${res.status})`);
    if (res.status === 401 && data?.error === 'unauthenticated') window.dispatchEvent(new CustomEvent('pos:locked'));
    if (res.status === 428 && data?.error === 'setup_required') window.dispatchEvent(new CustomEvent('pos:setup'));
    if (res.status === 403 && (data?.error === 'owner_required' || data?.error === 'owner_setup_required')) window.dispatchEvent(new CustomEvent('pos:owner'));
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}, opts = {}) => api(p, { method: 'POST', body, ...opts });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });
