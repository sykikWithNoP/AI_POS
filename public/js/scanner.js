// Barcode scanners.
//  1. USB/Bluetooth scanners act as keyboards: we detect a burst of fast keystrokes ending in Enter,
//     anywhere on the POS — the search box doesn't need focus.
//  2. Camera scanning with the browser's BarcodeDetector (Chrome/Edge; works on localhost).
import { h, icon, modal, toast, chime } from './ui.js';
import { getState } from './store.js';

let handler = null;
export function onScan(fn) { handler = fn; return () => { if (handler === fn) handler = null; }; }

let buf = '', last = 0, firstAt = 0;
document.addEventListener('keydown', (e) => {
  if (!handler || e.ctrlKey || e.altKey || e.metaKey) return;
  const cfg = getState().boot?.settings?.scanner || { minLength: 4, maxGapMs: 35 };
  const t = e.target;
  const editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const isSearch = t?.classList?.contains('search-input');
  if (editable && !isSearch) return; // typing into a form field stays a form field
  const now = performance.now();
  if (now - last > (cfg.maxGapMs || 35) * 3) { buf = ''; firstAt = now; }
  last = now;
  if (e.key === 'Enter') {
    const fast = buf.length >= (cfg.minLength || 4) && (now - firstAt) / Math.max(1, buf.length) <= (cfg.maxGapMs || 35);
    if (fast) {
      e.preventDefault(); e.stopPropagation();
      if (isSearch) t.value = '';
      const code = buf; buf = '';
      deliver(code);
    }
    buf = '';
    return;
  }
  if (e.key.length === 1) buf += e.key;
}, true);

function deliver(code) {
  if (getState().boot?.settings?.scanner?.beep !== false) chime('ok');
  handler?.(code.trim());
}

export const cameraSupported = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/** Camera scanner modal; keeps scanning until closed (each code once per 2 s). */
export async function cameraScan() {
  if (!cameraSupported()) return toast('Camera scanning needs Chrome or Edge on this computer', 'warn', 5000);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
  catch { return toast('Camera permission was refused', 'error'); }
  const video = h('video.cam', { autoplay: true, muted: true, playsInline: true });
  video.srcObject = stream;
  const status = h('p.muted', 'Point the camera at a barcode or QR code');
  const detector = new window.BarcodeDetector();
  let running = true; const seen = new Map();
  const m = modal({ title: 'Scan with camera', body: h('div.cam-wrap', video, status), onClose: () => { running = false; stream.getTracks().forEach((t) => t.stop()); } });
  const loop = async () => {
    if (!running) return;
    try {
      const codes = await detector.detect(video);
      for (const c of codes) {
        const v = c.rawValue;
        if (Date.now() - (seen.get(v) || 0) < 2000) continue;
        seen.set(v, Date.now());
        status.textContent = `Scanned ${v}`;
        deliver(v);
      }
    } catch { /* frame not ready */ }
    setTimeout(loop, 250);
  };
  video.addEventListener('loadeddata', loop, { once: true });
  return m;
}

export const cameraButton = () => h('button.icon-btn', { title: 'Scan with camera', 'aria-label': 'Scan with camera', onclick: cameraScan }, icon('qr', 20));
