'use strict';
// One email address can belong to several schools: a SEPARATE account (own password, role, permissions) in each.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, PW, h2 } = require('./helpers');

let app, A, B;
const SHARED = 'maria@shared.test';
test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Mail A', 'admin.ma@test.local');
  await makeSchool(app, 'Mail B', 'admin.mb@test.local');
  A = await seedSchool(app, 'admin.ma@test.local', 'A');
  B = await seedSchool(app, 'admin.mb@test.local', 'B');
});
test.after(() => app.stop());

test('the same email can be a teacher in one school and a parent in another, with separate passwords', async () => {
  const t = await A.admin.post('/users', { role: 'teacher', name: 'Maria Teacher', email: SHARED });
  assert.equal(t.status, 200);
  assert.ok(t.data.temporary_password);
  const p = await B.admin.post('/users', { role: 'parent', name: 'Maria Parent', email: SHARED });
  assert.ok(p.data.temporary_password, JSON.stringify(p.data));
  assert.notEqual(t.data.temporary_password, p.data.temporary_password);
  await h2(app, t.data.id); await h2(app, p.data.id);

  const inA = client(app), inB = client(app);
  const ra = await inA.post('/auth/login', { email: SHARED, password: t.data.temporary_password, school_slug: 'mail-a' });
  const rb = await inB.post('/auth/login', { email: SHARED, password: p.data.temporary_password, school_slug: 'mail-b' });
  assert.equal(ra.status, 200); assert.equal(ra.data.user.role, 'teacher');
  assert.equal(rb.status, 200); assert.equal(rb.data.user.role, 'parent');
  // each password only works for its own school
  assert.equal((await client(app).post('/auth/login', { email: SHARED, password: t.data.temporary_password, school_slug: 'mail-b' })).status, 401);
  assert.equal((await client(app).post('/auth/login', { email: SHARED, password: p.data.temporary_password, school_slug: 'mail-a' })).status, 401);
  // with no school page the email is ambiguous, so it is refused
  assert.equal((await client(app).post('/auth/login', { email: SHARED, password: t.data.temporary_password })).status, 401);
  // permissions follow the school's role: the parent account cannot use teacher/admin functions
  inB.csrf = rb.data.csrf; inA.csrf = ra.data.csrf;
  assert.equal((await inB.post('/classes', { name: 'X', section: 'A', year_id: B.year })).status, 403);
  // and each session sees only its own school
  const meA = (await inA.get('/auth/me')).data, meB = (await inB.get('/auth/me')).data;
  assert.equal(meA.school.slug, 'mail-a'); assert.equal(meB.school.slug, 'mail-b');
});

test('an email is still unique inside one school', async () => {
  assert.equal((await A.admin.post('/users', { role: 'parent', name: 'Dup', email: SHARED })).status, 400);
});

test('resetting a password in one school does not touch the same email in another school', async () => {
  const snap = async () => Object.fromEntries((await app.h.all('SELECT school_id, password_hash FROM users WHERE email = ?', SHARED)).map((r) => [r.school_id, r.password_hash]));
  const before = await snap();
  assert.equal(Object.keys(before).length, 2);
  const t = await app.h.get('SELECT id, school_id FROM users WHERE email = ? AND role = ?', SHARED, 'teacher');
  assert.equal((await A.admin.post(`/users/${t.id}/reset-password`)).status, 200);
  const after = await snap();
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  assert.deepEqual(changed, [String(t.school_id)], 'only the teacher account in school A may change');
});

test('registering a new school with an email used elsewhere creates a separate admin account', async () => {
  const pub = client(app);
  const r = await pub.post('/public/register-school', { school_name: 'Shared Mail School', school_type: 'secondary_general', address: '1 Main Road', location: 'Douala', email: 'school@shared.test', phone: '+237 600 000 000',
    admin_name: 'Maria Admin', admin_email: SHARED, password: PW, password_confirm: PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await app.h.all('SELECT id FROM users WHERE email = ?', SHARED)).length, 3);
});

test('the super administrator email stays unique among super administrators', async () => {
  await assert.rejects(() => app.h.run("INSERT INTO users (school_id, email, password_hash, name, role) VALUES (NULL, 'owner@test.local', 'x', 'Second owner', 'platform_owner')"), /UNIQUE/);
});
