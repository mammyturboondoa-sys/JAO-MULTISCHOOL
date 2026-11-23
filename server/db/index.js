'use strict';
// Database entry point. The rest of the app only ever sees the adapter's small async interface.
// To add PostgreSQL later: write server/db/postgres.js with the same methods and select it here (see docs/FUTURE_DATABASE.md). Not planned for this phase..
const { SqliteDatabase } = require('./sqlite');
const { runMigrations } = require('./migrate');
const crypto = require('node:crypto');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L so codes are easy to read aloud

async function openDatabase({ file }) {
  const db = new SqliteDatabase(file);
  const r = runMigrations(db.raw, file);
  if (r.backup) console.log(`JAO database upgraded. A backup of your data was saved to:\n  ${r.backup}`);
  db.raw.exec('PRAGMA foreign_keys = ON;');
  return db;
}

async function newSchoolCode(h) {
  for (let i = 0; i < 50; i++) {
    let s = '';
    for (const b of crypto.randomBytes(6)) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!(await h.get('SELECT 1 FROM schools WHERE code = ?', `JAO-${s}`))) return `JAO-${s}`;
  }
  throw new Error('could_not_generate_school_code');
}
module.exports = { openDatabase, newSchoolCode };
