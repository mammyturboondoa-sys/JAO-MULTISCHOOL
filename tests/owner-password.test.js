'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestApp, client, makeSchool, seedSchool, h2, PW } = require('./helpers');
const { createApp } = require('../server/app');
const { runBackup, restoreBackup } = require('../server/backup');
const S = require('../server/security');

const EMAIL = 'boss@test.local', TEMP = 'Temp-Initial-Pass-9', MINE = 'My-Own-Permanent-Pass-42', NEWER = 'Another-Strong-Pass-77';
let app, A;
const owner = async () => await app.h.get("SELECT * FROM users WHERE role = 'platform_owner'");
const asOwner = async (pw) => { const c = client(app); const r = await c.post('/auth/login', { email: EMAIL, password: pw, scope: 'platform' }); if (r.status === 200) c.csrf = r.data.csrf; c.res = r; return c; };

test.before(async () => {
  app = await startTestApp();
  // exactly how first run creates it: a random temporary password and "must change at first sign-in"
  await app.h.run("INSERT INTO users (school_id, email, password_hash, name, initials, role, must_change_password) VALUES (NULL, ?, ?, 'JAO Platform Owner', 'JO', 'platform_owner', 1)", EMAIL, S.hashPassword(TEMP));
  await makeSchool(app, 'School A', 'admin.a@test.local'); A = await seedSchool(app, 'admin.a@test.local', 'A');
  A.before = { schools: (await app.h.get('SELECT COUNT(*) n FROM schools')).n, students: (await app.h.get('SELECT COUNT(*) n FROM students')).n, owners: (await app.h.get("SELECT COUNT(*) n FROM users WHERE role = 'platform_owner'")).n };
});
test.after(() => app.stop());

test('first sign-in uses the temporary password and is forced to choose a permanent one', async () => {
  const c = await asOwner(TEMP); assert.equal(c.res.status, 200); assert.equal(c.res.data.user.must_change_password, true);
  assert.equal((await c.get('/platform/stats')).data.error, 'password_change_required', 'nothing else works until the permanent password is chosen');
  assert.equal((await c.post('/platform/account/password', { current_password: TEMP, new_password: TEMP, confirm_password: TEMP })).data.error, 'password_same', 'the temporary password cannot be kept');
  const r = await c.post('/platform/account/password', { current_password: TEMP, new_password: MINE, confirm_password: MINE }); assert.equal(r.status, 200);
  assert.equal((await c.get('/platform/stats')).status, 200, 'works straight after choosing it');
  assert.equal((await c.post('/auth/logout')).status, 200); assert.equal((await c.get('/platform/account')).status, 401, 'logout really ends the session');
});
test('the temporary password stops working; the new one works; the account is the same one', async () => {
  assert.equal((await asOwner(TEMP)).res.status, 401); assert.equal((await asOwner(TEMP + 'x')).res.status, 401);
  const c = await asOwner(MINE); assert.equal(c.res.status, 200); assert.equal(c.res.data.user.must_change_password, false);
  const o = await owner(); assert.equal(o.email, EMAIL, 'e-mail preserved'); assert.ok((await app.h.get('SELECT password_changed_at p FROM owner_security WHERE user_id = ?', o.id)).p);
  assert.match(o.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/); assert.ok(!o.password_hash.includes(MINE) && !o.password_hash.includes(TEMP), 'never stored as plain text');
  const now = { schools: (await app.h.get('SELECT COUNT(*) n FROM schools')).n, students: (await app.h.get('SELECT COUNT(*) n FROM students')).n, owners: (await app.h.get("SELECT COUNT(*) n FROM users WHERE role = 'platform_owner'")).n };
  assert.deepEqual(now, A.before, 'no school, student or account was created or removed');
});
test('changing the password needs the current one and a strong, confirmed, different new one', async () => {
  const c = await asOwner(MINE); const go = (b) => c.post('/platform/account/password', b);
  assert.equal((await go({ current_password: 'wrong-pass-123', new_password: NEWER, confirm_password: NEWER })).data.error, 'wrong_password');
  assert.equal((await go({ new_password: NEWER, confirm_password: NEWER })).data.error, 'wrong_password', 'the current password is required');
  assert.equal((await go({ current_password: MINE, new_password: NEWER, confirm_password: 'different-1234' })).data.error, 'password_mismatch');
  assert.equal((await go({ current_password: MINE, new_password: 'short1', confirm_password: 'short1' })).data.error, 'password_too_short');
  assert.equal((await go({ current_password: MINE, new_password: 'onlyletterspassword', confirm_password: 'onlyletterspassword' })).data.error, 'password_weak');
  assert.equal((await go({ current_password: MINE, new_password: MINE, confirm_password: MINE })).data.error, 'password_same');
  const other = await asOwner(MINE); // a second device
  assert.equal((await go({ current_password: MINE, new_password: NEWER, confirm_password: NEWER })).status, 200);
  assert.equal((await c.get('/platform/account')).status, 200, 'this session stays signed in'); assert.equal((await other.get('/platform/account')).status, 401, 'other devices are signed out');
  assert.equal((await asOwner(MINE)).res.status, 401); assert.equal((await asOwner(NEWER)).res.status, 200);
  const back = await asOwner(NEWER); assert.equal((await back.post('/platform/account/password', { current_password: NEWER, new_password: MINE, confirm_password: MINE })).status, 200);
});
test('the generic profile-menu change also refuses a "new" password equal to the current one', async () => {
  const c = await asOwner(MINE); assert.equal((await c.post('/auth/change-password', { current_password: MINE, new_password: MINE })).data.error, 'password_same');
});
test('only the Super Administrator can reach these routes; nobody can change it for them', async () => {
  const ad = client(app); await ad.login('admin.a@test.local', PW); const teacher = client(app); await teacher.login(`teacher.A@test.local`, A.teacherPw).catch(() => {});
  for (const [m, u, b] of [['get', '/platform/account'], ['post', '/platform/account/password', { current_password: PW, new_password: NEWER, confirm_password: NEWER }], ['post', '/platform/account/recovery-codes', { current_password: PW }]]) {
    assert.equal((await ad[m](u, b)).status, 403, 'school admin ' + u); assert.equal((await client(app)[m](u, b)).status, 401, 'signed out ' + u);
  }
  const o = await owner(); assert.equal((await ad.post(`/users/${o.id}/reset-password`, {})).status, 404, 'a school administrator cannot reset the owner');
  assert.equal((await ad.put(`/users/${o.id}`, { name: 'x' })).status, 404);
  assert.equal((await asOwner(MINE)).res.status, 200, 'still unchanged');
});
test('the password and its hash are never sent to anyone', async () => {
  const c = await asOwner(MINE); for (const u of ['/auth/me', '/platform/account', '/platform/stats', '/platform/schools']) { const r = await c.get(u); assert.equal(r.status, 200); assert.ok(!JSON.stringify(r.data).includes('scrypt'), u); assert.ok(!JSON.stringify(r.data).includes('password_hash'), u); }
  const logs = JSON.stringify(await app.h.all('SELECT * FROM audit_log')); assert.ok(!logs.includes(MINE) && !logs.includes(NEWER) && !logs.includes(TEMP), 'audit log holds no passwords');
  assert.ok(await app.h.get("SELECT 1 x FROM audit_log WHERE action = 'owner_password_changed'"));
});

test('recovery codes: shown once, stored only as hashes, replace the old ones', async () => {
  const c = await asOwner(MINE);
  assert.equal((await c.post('/platform/account/recovery-codes', { current_password: 'nope-nope-123' })).data.error, 'wrong_password');
  const r = await c.post('/platform/account/recovery-codes', { current_password: MINE }); assert.equal(r.status, 200); assert.equal(r.data.codes.length, 10);
  assert.ok(r.data.codes.every((x) => /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(x))); assert.equal(new Set(r.data.codes).size, 10);
  const rows = await app.h.all('SELECT code_hash FROM owner_recovery_codes'); assert.equal(rows.length, 10);
  for (const code of r.data.codes) assert.ok(!rows.some((x) => x.code_hash.includes(code.replace(/-/g, ''))), 'a code is never stored as plain text'); assert.ok(rows.every((x) => x.code_hash.startsWith('scrypt$')));
  assert.equal((await c.get('/platform/account')).data.recovery_codes_left, 10);
  const again = await c.post('/platform/account/recovery-codes', { current_password: MINE }); assert.notDeepEqual(again.data.codes, r.data.codes);
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM owner_recovery_codes')).n, 10, 'the old set is gone');
  app.oldCodes = r.data.codes; app.codes = again.data.codes;
  const rec = (body) => client(app).post('/auth/owner-recover', { email: EMAIL, new_password: NEWER, confirm_password: NEWER, ...body });
  assert.equal((await rec({ recovery_code: app.oldCodes[0] })).status, 401, 'a replaced code no longer works');
});
test('recovery: a valid code sets a new password, works once, signs everyone out; every failure looks the same', async () => {
  const live = await asOwner(MINE); const rec = (body) => client(app).post('/auth/owner-recover', { new_password: NEWER, confirm_password: NEWER, ...body });
  const wrongCode = await rec({ email: EMAIL, recovery_code: 'AAAA-BBBB-CCCC' }); const noUser = await rec({ email: 'nobody@test.local', recovery_code: app.codes[0] }); const schoolAdmin = await rec({ email: 'admin.a@test.local', recovery_code: app.codes[0] });
  for (const r of [wrongCode, noUser, schoolAdmin]) { assert.equal(r.status, 401); assert.equal(r.data.error, 'invalid_recovery'); }
  assert.deepEqual([wrongCode.data, noUser.data, schoolAdmin.data].map((d) => JSON.stringify(d)).filter((v, i, a) => a.indexOf(v) === i).length, 1, 'identical answer: nothing is revealed');
  assert.equal((await rec({ email: EMAIL, recovery_code: app.codes[0], new_password: 'weak' })).status, 400);
  assert.equal((await asOwner(MINE)).res.status, 200, 'failed attempts changed nothing');
  const ok = await rec({ email: EMAIL.toUpperCase(), recovery_code: app.codes[0].toLowerCase().replace(/-/g, ' ') }); assert.equal(ok.status, 200); assert.equal(ok.data.codes_left, 9);
  assert.equal((await live.get('/platform/account')).status, 401, 'all sessions were signed out');
  assert.equal((await asOwner(MINE)).res.status, 401); const c = await asOwner(NEWER); assert.equal(c.res.status, 200); assert.equal(c.res.data.user.must_change_password, false);
  assert.equal((await rec({ email: EMAIL, recovery_code: app.codes[0] })).status, 401, 'a code works only once');
  assert.equal((await rec({ email: EMAIL, recovery_code: app.codes[1] })).status, 200, 'the other codes still work');
  assert.ok(await app.h.get("SELECT 1 x FROM audit_log WHERE action = 'owner_password_recovered'")); assert.ok(await app.h.get("SELECT 1 x FROM audit_log WHERE action = 'owner_recovery_failed'"));
  assert.equal((await app.h.get("SELECT email FROM users WHERE role = 'platform_owner'")).email, EMAIL);
});

test('the password survives a backup, a restore and a restart of the application', async () => {
  const dataDir = app.dataDir;
  const bk = runBackup(app.db.raw, dataDir);                                              // a backup made while running
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'jao-restore-'));
  restoreBackup(bk, dest);                                                                 // ...restored somewhere else (a new deployment)
  const app2 = await createApp({ dbFile: path.join(dest, 'jao.db'), dataDir: dest, env: { JAO_REGISTER_LIMIT: '1000' } });
  await new Promise((r) => app2.server.listen(0, '127.0.0.1', r)); app2.base = `http://127.0.0.1:${app2.server.address().port}`;
  try {
    const c = client(app2); const r = await c.post('/auth/login', { email: EMAIL, password: NEWER, scope: 'platform' }); assert.equal(r.status, 200, 'permanent password works on the restored copy');
    assert.equal((await client(app2).post('/auth/login', { email: EMAIL, password: TEMP, scope: 'platform' })).status, 401);
    assert.equal((await app2.h.get('SELECT COUNT(*) n FROM schools')).n, A.before.schools); assert.equal((await app2.h.get('SELECT COUNT(*) n FROM students')).n, A.before.students);
    assert.equal((await app2.h.get("SELECT COUNT(*) n FROM owner_recovery_codes WHERE used_at IS NULL")).n, 8, 'recovery codes are part of the backup too');
  } finally { app2.server.close(); app2.server.closeAllConnections?.(); }
});

test('guessing is rate limited (change, recovery codes and recovery)', async () => {
  const c = await asOwner(NEWER);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/platform/account/password', { current_password: 'guess-guess-' + i + 'a', new_password: MINE, confirm_password: MINE })).status, 400);
  assert.equal((await c.post('/platform/account/password', { current_password: 'guess-again-9', new_password: MINE, confirm_password: MINE })).status, 429, 'blocked after 5 wrong guesses');
  assert.equal((await c.post('/platform/account/password', { current_password: NEWER, new_password: MINE, confirm_password: MINE })).status, 429, 'even the right password has to wait');
  const guesser = client(app); let last; for (let i = 0; i < 7; i++) last = await guesser.post('/auth/owner-recover', { email: EMAIL, recovery_code: `ZZZZ-ZZZZ-ZZ${i}Z`, new_password: MINE, confirm_password: MINE });
  assert.equal(last.status, 429, 'recovery attempts are limited too');
  assert.equal((await asOwner(NEWER)).res.status, 200, 'the owner can still sign in normally');
});
