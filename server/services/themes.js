// Appearance: 15 built-in themes + custom themes made from the owner's own pictures.
// Custom theme colours are validated strictly (hex only) and images are type/size checked by magic bytes.
import { db } from '../db.js';
import { badRequest, notFound } from '../lib.js';

export const BUILT_IN = ['light', 'dark', 'ocean', 'forest', 'sunset', 'rose', 'lavender', 'slate', 'sand', 'arctic', 'saffron', 'contrast', 'midnight', 'mocha', 'neon'];
export const VAR_KEYS = ['bg', 'surface', 'surface-2', 'border', 'text', 'muted', 'accent', 'accent-ink', 'accent-soft', 'accent-strong', 'nav-bg', 'nav-text', 'nav-active-bg'];
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_IMAGE = 3 * 1024 * 1024;

export function isValidTheme(t) {
  return t === 'system' || BUILT_IN.includes(t) || /^custom:\d+$/.test(String(t));
}

function cleanVars(vars) {
  if (!vars || typeof vars !== 'object') throw badRequest('Theme colours are required');
  const out = {};
  for (const k of VAR_KEYS) {
    const v = String(vars[k] ?? '');
    if (!HEX.test(v)) throw badRequest(`Colour "${k}" must be a hex colour like #1a2b3c`);
    out[k] = v.toLowerCase();
  }
  return out;
}

function decodeImage(dataUrl) {
  if (!dataUrl) return { image: null, type: null };
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw badRequest('Picture must be a JPEG, PNG or WebP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE) throw badRequest('Picture is too large (max 3 MB)');
  const sig = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] }[m[1]];
  if (!sig.every((b, i) => buf[i] === b)) throw badRequest('File content does not match its picture type');
  return { image: buf, type: m[1] };
}

const out = (r) => r && ({ id: r.id, name: r.name, mode: r.mode, vars: JSON.parse(r.vars), hasImage: !!r.image_type, imageStrength: r.image_strength, created_at: r.created_at });

export const listThemes = () => db.prepare('SELECT id, name, mode, vars, image_type, image_strength, created_at FROM themes ORDER BY id').all().map(out);

export function getTheme(id) {
  const r = db.prepare('SELECT id, name, mode, vars, image_type, image_strength, created_at FROM themes WHERE id = ?').get(Number(id));
  if (!r) throw notFound('Theme');
  return out(r);
}

export function getThemeImage(id) {
  const r = db.prepare('SELECT image, image_type FROM themes WHERE id = ?').get(Number(id));
  if (!r?.image) throw notFound('Theme picture');
  return { data: Buffer.from(r.image), type: r.image_type };
}

function common(input) {
  const name = String(input.name || '').trim().slice(0, 40);
  if (!name) throw badRequest('Give the theme a name');
  const mode = input.mode === 'dark' ? 'dark' : 'light';
  const strength = Math.max(0, Math.min(80, Math.round(Number(input.imageStrength ?? 25))));
  return { name, mode, vars: cleanVars(input.vars), strength };
}

export function createTheme(input) {
  if (db.prepare('SELECT COUNT(*) AS n FROM themes').get().n >= 30) throw badRequest('Up to 30 custom themes');
  const c = common(input);
  const img = decodeImage(input.image);
  const r = db.prepare('INSERT INTO themes (name, mode, vars, image, image_type, image_strength) VALUES (?, ?, ?, ?, ?, ?)')
    .run(c.name, c.mode, JSON.stringify(c.vars), img.image, img.type, c.strength);
  return getTheme(r.lastInsertRowid);
}

export function updateTheme(id, input) {
  getTheme(id);
  const c = common(input);
  db.prepare('UPDATE themes SET name = ?, mode = ?, vars = ?, image_strength = ? WHERE id = ?').run(c.name, c.mode, JSON.stringify(c.vars), c.strength, Number(id));
  if (input.image !== undefined) {
    const img = decodeImage(input.image);
    db.prepare('UPDATE themes SET image = ?, image_type = ? WHERE id = ?').run(img.image, img.type, Number(id));
  }
  return getTheme(id);
}

export function deleteTheme(id) {
  getTheme(id);
  db.prepare('DELETE FROM themes WHERE id = ?').run(Number(id));
  return { deleted: true };
}
