'use strict';
// Recover a forgotten JAO Super Administrator password.
//   1. STOP JAO.   2. Run:  npm run reset-owner      (add  -- --email you@example.com  only if there is more than one owner)
// What it does: finds the EXISTING Super Administrator account, makes a safety copy of the database, sets a new strong random
// password, signs that account out everywhere, and prints the password ONCE on this screen. It never creates another account,
// never writes the password to any file or log, and keeps the account's name, e-mail and privileges unchanged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('../server/security');

const dataDir = path.resolve(process.env.JAO_DATA_DIR || path.join(__dirname, '..', 'data'));
const dbFile = process.env.JAO_DB_FILE || path.join(dataDir, 'jao.db');
const argv = process.argv.slice(2);
const wanted = argv.includes('--email') ? String(argv[argv.indexOf('--email') + 1] || '').toLowerCase() : null;

function strongPassword() {                         // 20 characters, no look-alike letters, always has upper, lower, digit and symbol
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '#$%&*+=?@'];
  const all = sets.join('');
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = [...sets.map(pick)];
  while (chars.length < 20) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

if (!fs.existsSync(dbFile)) { console.error(`No JAO database found at ${dbFile}.\nIf your data is elsewhere, set JAO_DATA_DIR to that folder. Nothing was changed.`); process.exit(1); }
const db = new DatabaseSync(dbFile);
try {
  db.exec('PRAGMA busy_timeout = 3000');
  const owners = db.prepare("SELECT id, email, name FROM users WHERE role = 'platform_owner' AND school_id IS NULL ORDER BY id").all();
  if (!owners.length) { console.error('There is no Super Administrator account in this database yet. Start JAO once: it creates the account and shows its first password.'); process.exit(1); }
  let owner = owners[0];
  if (owners.length > 1 || wanted) {
    owner = owners.find((o) => o.email.toLowerCase() === wanted);
    if (!owner) { console.error(`More than one Super Administrator exists (or the e-mail did not match). Run again with --email <one of>:\n${owners.map((o) => `  ${o.email}`).join('\n')}`); process.exit(1); }
  }
  const backupDir = path.join(dataDir, 'backups'); fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `before-owner-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  const password = strongPassword();
  db.exec('BEGIN');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND role = \'platform_owner\' AND school_id IS NULL').run(hashPassword(password), owner.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(owner.id);
  db.prepare("INSERT INTO audit_log (school_id, actor_id, action, record, meta) VALUES (NULL, ?, 'owner_password_reset_local', ?, ?)").run(owner.id, `user:${owner.id}`, JSON.stringify({ how: 'local recovery script' }));
  db.exec('COMMIT');
  console.log('\n  JAO Super Administrator password reset\n  --------------------------------------');
  console.log(`  Username (e-mail): ${owner.email}`);
  console.log(`  New password:      ${password}`);
  console.log('\n  This is shown ONLY NOW. Copy it, sign in, then change it under Settings.');
  console.log(`  A safety copy of the database was saved in: ${backup}\n`);
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
  console.error('The reset failed and nothing was changed:', e.message);
  process.exit(1);
} finally { db.close(); }
