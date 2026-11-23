'use strict';
// Forgotten Super Administrator password: the local recovery script.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startTestApp, client, makeOwner, makeSchool, PW } = require('./helpers');

const run = (app, args = []) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'scripts', 'reset-owner-generated.js'), ...args],
  { env: { ...process.env, JAO_DATA_DIR: app.dataDir, JAO_DB_FILE: path.join(app.dataDir, 'test.db') }, encoding: 'utf8' });

test('reset gives a new working password, keeps the same account, ends old sessions, leaves no trace of the password', async () => {
  const app = await startTestApp();
  try {
    await makeOwner(app);
    const email = (await app.h.get("SELECT email FROM users WHERE role = 'platform_owner'")).email;
    const before = await app.h.get("SELECT id, name FROM users WHERE role = 'platform_owner'");
    const old = client(app); assert.equal((await old.login(email, PW)).status, 200);
    const r = run(app);
    assert.equal(r.status, 0, r.stderr);
    const pw = /New password:\s+(\S+)/.exec(r.stdout)[1];
    assert.equal(pw.length, 20); assert.match(pw, /[A-Z]/); assert.match(pw, /[a-z]/); assert.match(pw, /\d/); assert.match(pw, /[#$%&*+=?@]/);
    assert.match(r.stdout, new RegExp(email.replace('.', '\\.')));
    const c = client(app);
    assert.equal((await c.login(email, pw)).status, 200, 'works immediately, password only');
    assert.equal((await app.h.get("SELECT COUNT(*) n FROM users WHERE role = 'platform_owner'")).n, 1, 'no second owner is created');
    assert.deepEqual(await app.h.get("SELECT id, name FROM users WHERE role = 'platform_owner'"), before);
    assert.equal((await old.get('/platform/stats')).status, 401, 'old sessions are signed out');
    // the password is not stored anywhere readable
    const audit = await app.h.all("SELECT * FROM audit_log WHERE action = 'owner_password_reset_local'");
    assert.equal(audit.length, 1); assert.doesNotMatch(JSON.stringify(audit), new RegExp(pw.replace(/[$*+?]/g, '\\$&')));
    assert.equal(r.stderr, '');
    // a second run gives a different password and the first stops working
    const pw2 = /New password:\s+(\S+)/.exec(run(app).stdout)[1]; assert.notEqual(pw, pw2);
    assert.equal((await client(app).login(email, pw)).status, 401);
    // the owner can change it later
    const c2 = client(app); await c2.login(email, pw2);
    assert.equal((await c2.post('/auth/change-password', { current_password: pw2, new_password: 'My-New-Pass-2027' })).status, 200);
    assert.equal((await client(app).login(email, 'My-New-Pass-2027')).status, 200);
  } finally { await app.stop(); }
});

test('reset never touches a school administrator and refuses a missing database', async () => {
  const app = await startTestApp();
  try {
    await makeOwner(app); await makeSchool(app, 'Rst', 'admin.rst@test.local');
    const hash = (await app.h.get("SELECT password_hash h FROM users WHERE email = 'admin.rst@test.local'")).h;
    assert.equal(run(app).status, 0);
    assert.equal((await app.h.get("SELECT password_hash h FROM users WHERE email = 'admin.rst@test.local'")).h, hash);
    const bad = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'scripts', 'reset-owner-generated.js')], { env: { ...process.env, JAO_DATA_DIR: path.join(app.dataDir, 'nope') }, encoding: 'utf8' });
    assert.notEqual(bad.status, 0); assert.match(bad.stderr, /No JAO database/);
  } finally { await app.stop(); }
});
