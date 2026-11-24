// First start after installing: "New shop" or "Restore my data" (from the encrypted copy that survives
// uninstalling, in Documents/NINDITO POS). Plain DOM, shown before the POS screens load.
import { findCopies, inspect, unlock } from './keep.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

/** Resolves to null (new shop) or the unlocked data { db, files, dirs, keep }. */
export function startChoice() {
  return new Promise((resolve) => {
    const root = document.createElement('main');
    root.className = 'login m-start';
    document.getElementById('app')?.replaceChildren(root);
    let picked = null;

    const home = async () => {
      root.innerHTML = `<div class="login-card">
        <div class="brand-mark"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/></svg></div>
        <p class="brand-product">NINDITO POS</p>
        <h1>Welcome</h1>
        <p class="muted">Is this a new shop, or are you reinstalling the app?</p>
        <div class="m-found"></div>
        <button type="button" class="btn primary block" data-new>Set up a new shop</button>
        <label class="btn block m-file">Restore my data from a file…<input type="file" hidden></label>
        <p class="hint">Your data is kept, encrypted, in the phone's <b>Documents › NINDITO POS</b> folder, even after uninstalling the app. To restore, choose the file there and enter your Owner Key.</p>
      </div>`;
      root.querySelector('[data-new]').onclick = () => { root.remove(); resolve(null); };
      root.querySelector('input[type=file]').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try { const bytes = new Uint8Array(await f.arrayBuffer()); picked = { name: f.name, bytes, header: inspect(bytes).header }; askKey(); }
        catch (err) { alert(err.message); }
      };
      // Copies this install can read by itself (older Android versions): offer them directly.
      const copies = await findCopies();
      if (copies.length) {
        const box = root.querySelector('.m-found');
        box.innerHTML = `<p><b>Found your data</b></p>${copies.slice(0, 3).map((c, i) => `<button type="button" class="btn block" data-i="${i}">Restore: ${esc(when(c.header.at))}${c.header.summary ? ` · ${c.header.summary.bills} bills` : ''}</button>`).join('')}`;
        box.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { picked = copies[Number(b.dataset.i)]; askKey(); }; });
      }
    };

    const askKey = () => {
      const h = picked.header;
      root.innerHTML = `<div class="login-card">
        <p class="brand-product">NINDITO POS</p>
        <h1>Restore your data</h1>
        <p class="muted">Saved ${esc(when(h.at))}${h.summary ? ` · ${h.summary.bills} bills · ${h.summary.items} products` : ''}</p>
        <label class="field"><span>Owner Key</span><input class="input mono" autocomplete="off" spellcheck="false" placeholder="OK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
        <p class="danger-text" hidden></p>
        <button type="button" class="btn primary block" data-go>Restore</button>
        <button type="button" class="btn ghost block" data-back>Back</button>
      </div>`;
      const input = root.querySelector('input'), err = root.querySelector('.danger-text'), go = root.querySelector('[data-go]');
      root.querySelector('[data-back]').onclick = home;
      const run = () => {
        go.disabled = true; go.textContent = 'Unlocking…'; err.hidden = true;
        setTimeout(() => {   // let the button repaint before the (deliberately slow) key check
          try { const data = unlock(picked.bytes, input.value); root.remove(); resolve(data); }
          catch (e) { err.textContent = e.message; err.hidden = false; go.disabled = false; go.textContent = 'Restore'; }
        }, 30);
      };
      go.onclick = run;
      input.onkeydown = (e) => { if (e.key === 'Enter') run(); };
      input.focus();
    };

    home();
  });
}
