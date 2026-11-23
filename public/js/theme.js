// Themes: 15 built-ins (pure CSS, see app.css) + custom themes generated from the owner's pictures.
export const THEMES = [
  { id: 'light', label: 'Classic Light' }, { id: 'dark', label: 'Classic Dark' }, { id: 'ocean', label: 'Ocean' },
  { id: 'forest', label: 'Forest' }, { id: 'sunset', label: 'Sunset' }, { id: 'rose', label: 'Rose' },
  { id: 'lavender', label: 'Lavender' }, { id: 'slate', label: 'Slate' }, { id: 'sand', label: 'Sand' },
  { id: 'arctic', label: 'Arctic' }, { id: 'saffron', label: 'Saffron' }, { id: 'contrast', label: 'High Contrast' },
  { id: 'midnight', label: 'Midnight' }, { id: 'mocha', label: 'Mocha' }, { id: 'neon', label: 'Neon' },
];
export const VAR_KEYS = ['bg', 'surface', 'surface-2', 'border', 'text', 'muted', 'accent', 'accent-ink', 'accent-soft', 'accent-strong', 'nav-bg', 'nav-text', 'nav-active-bg'];
const STATE_KEY = 'pos.themeState';

/** Apply a theme. `custom` is the theme object for 'custom:<id>'. Also cached for the no-flash boot script. */
export function applyTheme(theme, custom = null) {
  const root = document.documentElement;
  for (const k of VAR_KEYS) root.style.removeProperty(`--${k}`);
  for (const k of ['--bg-image', '--bg-veil', '--nav-veil']) root.style.removeProperty(k);
  delete root.dataset.bgImage;
  let state = { theme };
  if (theme && theme.startsWith('custom:') && custom) {
    root.dataset.theme = `custom-${custom.mode}`;
    for (const [k, v] of Object.entries(custom.vars)) root.style.setProperty(`--${k}`, v);
    root.style.colorScheme = custom.mode;
    state = { theme, mode: custom.mode, vars: custom.vars };
    if (custom.hasImage) {
      const img = `url("/api/themes/${custom.id}/image")`;
      setImageVars(root, img, custom.vars, custom.imageStrength);
      state.image = img; state.strength = custom.imageStrength;
    }
  } else if (theme && theme !== 'system') {
    root.dataset.theme = theme; root.style.removeProperty('color-scheme');
  } else {
    delete root.dataset.theme; root.style.removeProperty('color-scheme');
  }
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/** Picture shows through a veil of the theme's background colour; strength = how much picture (0–80%). */
export function setImageVars(el, img, vars, strength) {
  const veil = 100 - Math.max(0, Math.min(80, strength ?? 25));
  el.dataset.bgImage = '';
  el.style.setProperty('--bg-image', img);
  el.style.setProperty('--bg-veil', `color-mix(in srgb, ${vars.bg} ${veil}%, transparent)`);
  el.style.setProperty('--nav-veil', `color-mix(in srgb, ${vars['nav-bg']} ${Math.min(96, veil + 8)}%, transparent)`);
}

// ---------- palette generation from a picture ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToHex(h, s, l) {
  s = clamp(s); l = clamp(l);
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Read an <img>/<canvas>-drawable source and return { mode, accentHsl, vars }. */
export function paletteFromImage(img, forceMode) {
  const c = document.createElement('canvas');
  c.width = 48; c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 48, 48);
  const px = ctx.getImageData(0, 0, 48, 48).data;
  const buckets = new Map();
  let lumSum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; n++;
    const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    e.r += r; e.g += g; e.b += b; e.n++; buckets.set(key, e);
  }
  let best = null, bestScore = -1, dominant = null;
  for (const e of buckets.values()) {
    const [h, s, l] = rgbToHsl(e.r / e.n, e.g / e.n, e.b / e.n);
    if (!dominant || e.n > dominant.n) dominant = { h, s, l, n: e.n };
    const score = e.n * (s ** 2) * (1 - Math.abs(l - 0.5) * 1.6);
    if (s > 0.25 && score > bestScore) { bestScore = score; best = { h, s, l }; }
  }
  const pick = best || dominant || { h: 170, s: 0.6, l: 0.4 };
  const mode = forceMode || (n && lumSum / n < 0.45 ? 'dark' : 'light');
  return { mode, accentHsl: pick, vars: paletteFromHue(pick.h, Math.max(0.45, pick.s), mode) };
}

/** Full readable palette from a hue; the accent is nudged until it passes WCAG AA against its background. */
export function paletteFromHue(h, s, mode) {
  const t = Math.min(s, 0.5);
  if (mode === 'dark') {
    const bg = hslToHex(h, t * 0.5, 0.07);
    let l = 0.6, accent = hslToHex(h, s, l);
    while (contrast(accent, bg) < 4.5 && l < 0.9) accent = hslToHex(h, s, (l += 0.03));
    return {
      bg, surface: hslToHex(h, t * 0.45, 0.1), 'surface-2': hslToHex(h, t * 0.4, 0.13), border: hslToHex(h, t * 0.35, 0.2),
      text: hslToHex(h, 0.15, 0.92), muted: hslToHex(h, 0.12, 0.64), accent, 'accent-ink': hslToHex(h, 0.4, 0.08),
      'accent-soft': hslToHex(h, s * 0.6, 0.18), 'accent-strong': hslToHex(h, s, Math.min(0.92, l + 0.12)),
      'nav-bg': hslToHex(h, t * 0.6, 0.045), 'nav-text': hslToHex(h, 0.12, 0.64), 'nav-active-bg': hslToHex(h, t * 0.7, 0.15),
    };
  }
  let l = 0.42, accent = hslToHex(h, s, l);
  while (contrast(accent, '#ffffff') < 4.5 && l > 0.12) accent = hslToHex(h, s, (l -= 0.03));
  return {
    bg: hslToHex(h, t * 0.55, 0.955), surface: '#ffffff', 'surface-2': hslToHex(h, t * 0.5, 0.975), border: hslToHex(h, t * 0.4, 0.87),
    text: hslToHex(h, 0.3, 0.12), muted: hslToHex(h, 0.12, 0.42), accent, 'accent-ink': '#ffffff',
    'accent-soft': hslToHex(h, s * 0.8, 0.92), 'accent-strong': hslToHex(h, s, Math.max(0.08, l - 0.1)),
    'nav-bg': hslToHex(h, t * 0.7, 0.14), 'nav-text': hslToHex(h, 0.2, 0.76), 'nav-active-bg': hslToHex(h, t * 0.7, 0.24),
  };
}

/** Downscale + re-encode a user picture (strips metadata such as GPS location). */
export async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use a JPEG, PNG or WebP picture');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.82, url = c.toDataURL('image/jpeg', q);
  while (url.length > 3.6e6 && q > 0.4) url = c.toDataURL('image/jpeg', (q -= 0.12));
  return { dataUrl: url, bitmap: bmp, canvas: c };
}
