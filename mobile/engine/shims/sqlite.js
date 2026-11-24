// node:sqlite (DatabaseSync / StatementSync) on top of sql.js (SQLite compiled to WebAssembly).
// The POS server code uses exactly this API, so it runs unchanged inside the phone.
import { SQL, persistSoon, MAIN_DB, setMainDb } from '../runtime.js';
import fs from './fs.js';

const isNamed = (a) => a !== null && typeof a === 'object' && !(a instanceof Uint8Array) && !Array.isArray(a);
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'bigint' ? Number(v) : v);
const READ = /^\s*(select|pragma|with|explain)\b/i;

function bindArgs(stmt, args) {
  stmt.reset();
  if (!args.length) return;
  if (isNamed(args[0])) {
    const o = {};
    for (const [k, v] of Object.entries(args[0])) { const val = norm(v); o[`:${k}`] = val; o[`$${k}`] = val; o[`@${k}`] = val; }
    stmt.bind(o);
    return;
  }
  stmt.bind(args.map(norm));
}

class StatementSync {
  constructor(db, sql) { this.db = db; this.sql = sql; this.stmt = db.raw.prepare(sql); }
  run(...args) {
    bindArgs(this.stmt, args);
    while (this.stmt.step()) { /* RETURNING rows are ignored by run() */ }
    this.stmt.reset();
    const changes = this.db.raw.getRowsModified();
    const id = this.db.raw.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
    this.db.touched();
    return { changes, lastInsertRowid: id };
  }
  get(...args) {
    bindArgs(this.stmt, args);
    const row = this.stmt.step() ? this.stmt.getAsObject() : undefined;
    this.stmt.reset();
    if (!READ.test(this.sql)) this.db.touched();
    return row;
  }
  all(...args) {
    bindArgs(this.stmt, args);
    const rows = [];
    while (this.stmt.step()) rows.push(this.stmt.getAsObject());
    this.stmt.reset();
    if (!READ.test(this.sql)) this.db.touched();
    return rows;
  }
  *iterate(...args) { yield* this.all(...args); }
}

export class DatabaseSync {
  constructor(file, { readOnly = false } = {}) {
    const Sql = SQL();
    if (!Sql) throw new Error('database engine not started');
    this.file = String(file);
    this.main = this.file === MAIN_DB();
    this.readOnly = readOnly;
    let bytes = null;
    if (this.main) bytes = globalThis.__POS_DB_BYTES__ || null;
    else if (fs.existsSync(this.file)) bytes = fs.readFileSync(this.file);
    this.raw = new Sql.Database(bytes && bytes.length ? new Uint8Array(bytes) : undefined);
    if (this.main) setMainDb(this);
  }
  exec(sql) {
    let s = String(sql);
    // WAL needs shared memory that the in-app SQLite does not have; it keeps the rollback journal.
    s = s.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;?/gi, '');
    // VACUUM INTO 'file' → write a consistent copy into the app's file store.
    const into = /^\s*VACUUM\s+INTO\s+'((?:[^']|'')+)'\s*;?\s*$/i.exec(s);
    if (into) { fs.writeFileSync(into[1].replace(/''/g, "'"), this.raw.export()); return; }
    this.raw.exec(s);
    if (!READ.test(s)) this.touched();
  }
  prepare(sql) { return new StatementSync(this, sql); }
  touched() { if (this.main) persistSoon(); }
  close() { try { this.raw.close(); } catch { /* already closed */ } }
}

export default { DatabaseSync };
