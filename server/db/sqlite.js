'use strict';
// SQLite adapter. Every method returns a Promise so route code is written ONCE and works unchanged with PostgreSQL later.
// Rules shared by all adapters (see tests/db-contract.test.js):
//   * SQL uses "?" placeholders and the token NOW_TS for "current UTC time as 'YYYY-MM-DD HH:MM:SS'".
//   * get() -> row or undefined; all() -> rows; run() -> { changes }; insert() -> the new row's integer id.
//   * tx(fn) -> everything inside fn is ONE transaction. Other requests wait for it (a single SQLite connection is shared).
const { AsyncLocalStorage } = require('node:async_hooks');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const als = new AsyncLocalStorage();
const sql = (s) => s.replace(/NOW_TS/g, "datetime('now')");
const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

class SqliteDatabase {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.kind = 'sqlite';
    this.file = file;
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.active = null; // the transaction currently holding the connection
  }
  async _turn() { // wait while ANOTHER request's transaction is open
    while (this.active && als.getStore() !== this.active) await this.active.done;
  }
  async get(q, ...p) { await this._turn(); return this.raw.prepare(sql(q)).get(...p); }
  async all(q, ...p) { await this._turn(); return this.raw.prepare(sql(q)).all(...p); }
  async run(q, ...p) { await this._turn(); const r = this.raw.prepare(sql(q)).run(...p); return { changes: Number(r.changes) }; }
  async insert(q, ...p) { await this._turn(); return Number(this.raw.prepare(sql(q)).run(...p).lastInsertRowid); }
  async tx(fn) {
    if (als.getStore() === this.active && this.active) return fn(); // already inside this transaction: join it
    while (this.active) await this.active.done;
    let release; const token = { done: new Promise((r) => { release = r; }) };
    this.active = token;
    this.raw.exec('BEGIN');
    try {
      const out = await als.run(token, fn);
      this.raw.exec('COMMIT');
      return out;
    } catch (e) { this.raw.exec('ROLLBACK'); throw e; }
    finally { this.active = null; release(); }
  }
  async audit(schoolId, actorId, action, record, meta) {
    await this.run('INSERT INTO audit_log (school_id, actor_id, action, record, meta) VALUES (?,?,?,?,?)',
      schoolId ?? null, actorId ?? null, action, record ?? null, meta ? JSON.stringify(meta) : null);
  }
  nowPlusDays(n) { return fmt(new Date(Date.now() + n * 86400e3)); }
  async close() { this.raw.close(); }
}
module.exports = { SqliteDatabase };
