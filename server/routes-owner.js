'use strict';
// Super Administrator (platform owner) account: choose a permanent password, change it, and recover it.
//  * Passwords and recovery codes are stored ONLY as scrypt hashes in the database (so they survive restarts, updates and backups).
//  * Nothing here can touch another account: every query is pinned to the signed-in platform owner.
//  * Wrong-password attempts are rate limited, and every change is written to the audit log (never the password itself).
const crypto = require('node:crypto');
const S = require('./security');

const OWNER = ['platform_owner'];
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L: easy to read out and to type
const CODE_COUNT = 10;
const WINDOW = 15 * 60 * 1000;
const DUMMY_HASH = S.hashPassword(crypto.randomBytes(12).toString('hex')); // keeps "unknown account" and "wrong code" equally slow

function newCode() {
  let out = '';
  while (out.length < 12) { const b = crypto.randomBytes(1)[0]; if (b < 248) out += ALPHABET[b % ALPHABET.length]; } // 248 = 31 x 8: no modulo bias
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

module.exports = function (app) {
  const { h, route } = app;
  const ownerRow = (id) => h.get("SELECT * FROM users WHERE id = ? AND school_id IS NULL AND role = 'platform_owner'", id);
  const keepSession = (c) => crypto.createHash('sha256').update(c.token).digest('hex');
  const limited = (key, max) => { if (!S.rateLimit(key, max, WINDOW)) throw new S.HttpError(429, 'too_many_attempts'); };

  route('GET', '/platform/account', OWNER, async (c) => {
    const u = await ownerRow(c.user.id); if (!u) throw S.notFound();
    const sec = await h.get('SELECT password_changed_at FROM owner_security WHERE user_id = ?', u.id);
    const left = await h.get('SELECT COUNT(*) n, MAX(created_at) at FROM owner_recovery_codes WHERE user_id = ? AND used_at IS NULL', u.id);
    return { name: u.name, email: u.email, password_changed_at: (sec && sec.password_changed_at) || null, last_login: u.last_login || null, previous_login: u.previous_login || null,
      recovery_codes_left: left.n, recovery_codes_generated_at: left.at || null };
  });

  // Choose / change the permanent password. Needs the CURRENT password, even for someone already signed in.
  // Also used by the very first sign-in (temporary password), so it is allowed while a password change is still required.
  route('POST', '/platform/account/password', OWNER, async (c) => {
    limited(`ownerpw:${c.user.id}`, 5);
    const u = await ownerRow(c.user.id); if (!u) throw S.notFound();
    if (!S.verifyPassword(String(c.body.current_password || ''), u.password_hash)) throw new S.HttpError(400, 'wrong_password');
    S.resetRate(`ownerpw:${c.user.id}`);               // only WRONG guesses of the current password count against the limit
    const next = c.body.new_password;
    const problem = S.passwordProblem(next); if (problem) throw S.bad(problem);
    if (next !== c.body.confirm_password) throw S.bad('password_mismatch');
    if (S.verifyPassword(next, u.password_hash)) throw S.bad('password_same');          // a "new" password must really be new (never keep the temporary one)
    await h.tx(async () => {
      await h.run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND school_id IS NULL AND role = 'platform_owner'", S.hashPassword(next), u.id);
      await h.run("INSERT INTO owner_security (user_id, password_changed_at) VALUES (?, NOW_TS) ON CONFLICT(user_id) DO UPDATE SET password_changed_at = excluded.password_changed_at", u.id);
      await h.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', u.id, keepSession(c)); // every other device is signed out
      await h.audit(null, u.id, 'owner_password_changed', `user:${u.id}`);
    });
    S.resetRate(`ownerpw:${c.user.id}`);
    return { ok: true };
  }).allowWhenMustChange = true;

  // New set of single-use recovery codes (replaces the old ones). Shown ONCE; only their hashes are kept.
  route('POST', '/platform/account/recovery-codes', OWNER, async (c) => {
    limited(`ownerpw:${c.user.id}`, 5);
    const u = await ownerRow(c.user.id); if (!u) throw S.notFound();
    if (!S.verifyPassword(String(c.body.current_password || ''), u.password_hash)) throw new S.HttpError(400, 'wrong_password');
    S.resetRate(`ownerpw:${c.user.id}`);
    const codes = Array.from({ length: CODE_COUNT }, newCode);
    await h.tx(async () => {
      await h.run('DELETE FROM owner_recovery_codes WHERE user_id = ?', u.id);
      for (const code of codes) await h.run('INSERT INTO owner_recovery_codes (user_id, code_hash) VALUES (?,?)', u.id, S.hashPassword(normCode(code)));
      await h.audit(null, u.id, 'owner_recovery_codes_generated', `user:${u.id}`);
    });
    return { codes, generated_at: new Date().toISOString() };
  });

  // Forgot the password: e-mail + one recovery code + a new password. Public, so it is strictly rate limited and never says
  // whether the e-mail exists or which part was wrong.
  route('POST', '/auth/owner-recover', 'public', async (c) => {
    const ip = app.clientIp(c.req); const email = S.str(c.body.email, 200).toLowerCase();
    limited(`ownrec-ip:${ip}`, 10); limited(`ownrec:${email}`, 5);
    const next = c.body.new_password;
    const problem = S.passwordProblem(next); if (problem) throw S.bad(problem);
    if (next !== c.body.confirm_password) throw S.bad('password_mismatch');
    const code = normCode(c.body.recovery_code);
    const u = email ? await h.get("SELECT * FROM users WHERE email = ? AND school_id IS NULL AND role = 'platform_owner' AND active = 1", email) : null;
    const rows = u ? await h.all('SELECT id, code_hash FROM owner_recovery_codes WHERE user_id = ? AND used_at IS NULL', u.id) : [];
    let hit = null;
    for (const r of rows) if (S.verifyPassword(code, r.code_hash) && !hit) hit = r;      // check every code: same time whichever one matches
    if (!rows.length) S.verifyPassword(code, DUMMY_HASH);
    if (!u || !hit || code.length < 12) {
      await h.audit(null, u ? u.id : null, 'owner_recovery_failed', 'owner', { ip });
      throw new S.HttpError(401, 'invalid_recovery');
    }
    await h.tx(async () => {
      await h.run('UPDATE owner_recovery_codes SET used_at = NOW_TS WHERE id = ? AND user_id = ?', hit.id, u.id);           // single use
      await h.run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND school_id IS NULL AND role = 'platform_owner'", S.hashPassword(next), u.id);
      await h.run("INSERT INTO owner_security (user_id, password_changed_at) VALUES (?, NOW_TS) ON CONFLICT(user_id) DO UPDATE SET password_changed_at = excluded.password_changed_at", u.id);
      await h.run('DELETE FROM sessions WHERE user_id = ?', u.id);                                                         // everyone is signed out
      await h.audit(null, u.id, 'owner_password_recovered', `user:${u.id}`, { ip, codes_left: rows.length - 1 });
    });
    S.resetRate(`ownrec:${email}`);
    return { ok: true, codes_left: rows.length - 1 };
  });
};
