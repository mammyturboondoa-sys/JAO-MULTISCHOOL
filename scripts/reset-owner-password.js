'use strict';
// Break-glass recovery for the Super Administrator, run on the SERVER by whoever controls it.
//   npm run reset-owner                 -> you type a new permanent password (hidden, twice)
//   npm run reset-owner -- --generate   -> prints a one-time temporary password that must be changed at the next sign-in
// It only ever changes the password of the EXISTING platform owner (it never creates an account, never changes the e-mail,
// never touches schools or their records), signs that account out everywhere, takes a backup first and writes an audit entry.
const path = require('node:path');
const readline = require('node:readline');
const { DatabaseSync } = require('node:sqlite');
const S = require('../server/security');
const { runBackup } = require('../server/backup');

const dataDir = path.resolve(process.env.JAO_DATA_DIR || path.join(__dirname, '..', 'data'));
const dbFile = path.join(dataDir, 'jao.db');
const args = process.argv.slice(2);

let piped = null; // when the passwords are piped in (not typed), read all the lines at once
function ask(question, hidden) {
  if (!process.stdin.isTTY) { if (!piped) piped = require('node:fs').readFileSync(0, 'utf8').split(/\r?\n/); return Promise.resolve(piped.shift() ?? ''); }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };   // do not echo what is typed
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}
const fail = (m) => { console.error('\n' + m + '\n'); process.exit(1); };

(async () => {
  if (!require('node:fs').existsSync(dbFile)) fail(`No database found at ${dbFile}. Set JAO_DATA_DIR if your data is elsewhere.`);
  const db = new DatabaseSync(dbFile); db.exec('PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = ON;');
  const owners = db.prepare("SELECT id, email, name FROM users WHERE role = 'platform_owner' AND school_id IS NULL").all();
  if (owners.length === 0) fail('There is no Super Administrator account in this database. Start the application once to create it; this tool never creates accounts.');
  if (owners.length > 1) fail('More than one Super Administrator exists. Nothing was changed.');
  const owner = owners[0];
  console.log(`Super Administrator account: ${owner.email}`);
  let pw, mustChange = 0;
  if (args.includes('--generate')) { pw = S.randomPassword(); mustChange = 1; }
  else {
    pw = await ask('New permanent password (hidden): ', true); const again = await ask('Type it again: ', true);
    if (pw !== again) fail('The two passwords do not match. Nothing was changed.');
    const problem = S.passwordProblem(pw); if (problem) fail('That password is too weak (at least 10 characters, with letters and numbers). Nothing was changed.');
  }
  if (!args.includes('--no-backup')) { try { console.log('Safety backup saved:', runBackup(db, dataDir)); } catch (e) { fail('Backup failed, so nothing was changed: ' + e.message); } }
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ? AND school_id IS NULL AND role = 'platform_owner'").run(S.hashPassword(pw), mustChange, owner.id);
    if (!mustChange) db.prepare("INSERT INTO owner_security (user_id, password_changed_at) VALUES (?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET password_changed_at = excluded.password_changed_at").run(owner.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(owner.id);
    db.prepare("INSERT INTO audit_log (school_id, actor_id, action, record, meta) VALUES (NULL, NULL, 'owner_password_reset_cli', ?, ?)").run(`user:${owner.id}`, JSON.stringify({ generated: !!mustChange }));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); fail('Could not save: ' + e.message); }
  db.close();
  if (mustChange) console.log(`\nTemporary password (shown once): ${pw}\nSign in with it; you will be asked to choose your own permanent password.\n`);
  else console.log('\nDone. The new password is saved. The Super Administrator was signed out everywhere.\n');
})();
