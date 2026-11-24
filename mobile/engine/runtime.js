// Shared runtime for the in-phone engine: the SQLite (WebAssembly) module and saving to the phone's
// storage. Everything is kept in IndexedDB inside the app, which only this app can read.
let sqlModule = null;
let mainDb = null;
let timer = null;
const listeners = new Set();

export const DATA_DIR = '/data';
export const MAIN_DB = () => globalThis.process?.env?.DB_FILE || '/data/pos.db';
export const SQL = () => sqlModule;
export const setSqlModule = (m) => { sqlModule = m; };
export const setMainDb = (db) => { mainDb = db; };
export const getMainDb = () => mainDb;
export const onPersist = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---------- IndexedDB key/value store ----------
const DB_NAME = 'nindito-pos';
let idb = null;
function openIdb() {
  if (idb) return idb;
  idb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idb;
}
export async function kvGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function kvSet(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error);
  });
}

/** Save the database (and changed files) shortly after a change. */
export function persistSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => { persistNow().catch((e) => console.error('save failed', e)); }, 250);
}

export async function persistNow() {
  clearTimeout(timer);
  if (mainDb) {
    try { await kvSet('db', mainDb.raw.export()); } catch (e) {
      // Mid-transaction exports are refused; try again a moment later.
      if (/transaction/i.test(e.message)) return persistSoon();
      throw e;
    }
  }
  for (const fn of listeners) await fn();
}
