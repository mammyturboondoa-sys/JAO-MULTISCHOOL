'use strict';
// 0012: Super Administrator security. Additive only: it never changes, creates or removes an account, a password or a school.
//   * owner_security             - when the Super Administrator last chose their own password (a NEW table: no existing table is altered)
//   * owner_recovery_codes       - single-use recovery codes for the Super Administrator, stored only as hashes
module.exports = {
  version: 12, name: 'owner_security',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_security (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, password_changed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS owner_recovery_codes (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,                 -- scrypt hash, like a password; the code itself is shown once and never stored
        created_at TEXT NOT NULL DEFAULT (datetime('now')), used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS owner_recovery_codes_user ON owner_recovery_codes(user_id);
    `);
  },
};
