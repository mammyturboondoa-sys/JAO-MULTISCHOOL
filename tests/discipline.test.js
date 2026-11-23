'use strict';
// Discipline module, phase 1: setup lists, permissions, report-card switches, isolation between schools.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, PW, h2 } = require('./helpers');

let app, A, B, teacherA, teacherA2, teacherB, parentA;
test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Disc A', 'admin.da@test.local');
  await makeSchool(app, 'Disc B', 'admin.db@test.local');
  A = await seedSchool(app, 'admin.da@test.local', 'A');
  B = await seedSchool(app, 'admin.db@test.local', 'B');
  const login = async (S, email, role, name) => {
    const u = (await S.admin.post('/users', { role, name, email })).data;
    await h2(app, u.id);
    const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200);
    return { id: u.id, c };
  };
  teacherA = await login(A, 'second.teacher.a@test.local', 'teacher', 'Teacher A2');
  teacherA2 = { id: A.teacherId };
  teacherB = await login(B, 'second.teacher.b@test.local', 'teacher', 'Teacher B2');
  parentA = await login(A, 'parent.da@test.local', 'parent', 'Parent A');
});
test.after(() => app.stop());

test('every school starts with misconduct categories and the four basic sanction types', async () => {
  for (const S of [A, B]) {
    const cats = (await S.admin.get('/discipline/categories')).data;
    assert.ok(cats.length >= 8);
    const sanc = (await S.admin.get('/discipline/sanction-types')).data;
    assert.deepEqual(sanc.map((x) => x.name_en), ['Verbal warning', 'Written warning', 'Reprimand', 'Temporary suspension']);
    assert.deepEqual(sanc.map((x) => !!x.has_duration), [false, false, false, true]);
  }
});

test('administrator can add, rename and switch off categories and sanctions; duplicates are refused', async () => {
  const r = await A.admin.post('/discipline/categories', { name_en: 'Smoking', name_fr: 'Tabagisme', severity: 'serious' });
  assert.equal(r.status, 200);
  assert.equal((await A.admin.post('/discipline/categories', { name_en: 'smoking' })).status, 400);
  assert.equal((await A.admin.post('/discipline/categories', { name_en: '', name_fr: '' })).status, 400);
  assert.equal((await A.admin.put(`/discipline/categories/${r.data.id}`, { name_fr: 'Fumer', active: false })).status, 200);
  assert.ok(!(await A.admin.get('/discipline/categories')).data.some((x) => x.id === r.data.id), 'switched-off category is hidden from the normal list');
  const all = (await A.admin.get('/discipline/categories?all=1')).data.find((x) => x.id === r.data.id);
  assert.equal(all.name_fr, 'Fumer'); assert.equal(all.active, 0);
  const s = await A.admin.post('/discipline/sanction-types', { name_en: 'Community service', name_fr: 'Travail d’intérêt général', has_duration: true });
  assert.equal(s.status, 200);
  // a name given in one language only is used for both
  const one = await A.admin.post('/discipline/categories', { name_fr: 'Bavardage' });
  assert.equal((await A.admin.get('/discipline/categories?all=1')).data.find((x) => x.id === one.data.id).name_en, 'Bavardage');
});

test('only the administrator can change the lists; parents and students see nothing', async () => {
  assert.equal((await teacherA.c.post('/discipline/categories', { name_en: 'X' })).status, 403);
  assert.equal((await teacherA.c.put('/discipline/settings', { report_show_conduct: true })).status, 403);
  assert.equal((await teacherA.c.get('/discipline/staff')).status, 403);
  assert.equal((await parentA.c.get('/discipline/categories')).status, 403);
  assert.equal((await parentA.c.get('/discipline/me')).status, 403);
  assert.equal((await client(app).get('/discipline/categories')).status, 401);
});

test('teachers can report by default; sanctions list needs a permission the administrator grants', async () => {
  assert.deepEqual((await teacherA.c.get('/discipline/me')).data.permissions, ['report_incidents']);
  assert.equal((await teacherA.c.get('/discipline/categories')).status, 200);
  assert.equal((await teacherA.c.get('/discipline/sanction-types')).status, 403);
  const staff = (await A.admin.get('/discipline/staff')).data;
  assert.ok(staff.some((u) => u.id === teacherA.id) && staff.every((u) => Array.isArray(u.permissions)));
  assert.equal((await A.admin.put(`/discipline/staff/${teacherA.id}/permissions`, { permissions: ['manage_discipline', 'council_member'] })).status, 200);
  assert.deepEqual((await teacherA.c.get('/discipline/me')).data.permissions.sort(), ['council_member', 'manage_discipline', 'report_incidents']);
  assert.equal((await teacherA.c.get('/discipline/sanction-types')).status, 200);
  assert.equal((await teacherA.c.get('/auth/me')).data.user.permissions.includes('manage_discipline'), true);
  // replacing the set removes what is no longer listed
  await A.admin.put(`/discipline/staff/${teacherA.id}/permissions`, { permissions: [] });
  assert.deepEqual((await teacherA.c.get('/discipline/me')).data.permissions, ['report_incidents']);
  // nobody can be given an unknown permission or the built-in one
  assert.equal((await A.admin.put(`/discipline/staff/${teacherA.id}/permissions`, { permissions: ['everything'] })).status, 400);
  assert.equal((await A.admin.put(`/discipline/staff/${teacherA.id}/permissions`, { permissions: 'manage_discipline' })).status, 400);
  // permissions go only to teachers, not to parents
  assert.equal((await A.admin.put(`/discipline/staff/${parentA.id}/permissions`, { permissions: ['manage_discipline'] })).status, 404);
});

test('school B can never read or change school A discipline data, even by guessing ids', async () => {
  const catA = (await A.admin.get('/discipline/categories?all=1')).data[0];
  const sancA = (await A.admin.get('/discipline/sanction-types?all=1')).data[0];
  assert.equal((await B.admin.put(`/discipline/categories/${catA.id}`, { name_en: 'Hacked' })).status, 404);
  assert.equal((await B.admin.put(`/discipline/sanction-types/${sancA.id}`, { active: false })).status, 404);
  assert.equal((await B.admin.put(`/discipline/staff/${teacherA.id}/permissions`, { permissions: ['approve_decisions'] })).status, 404);
  assert.equal((await B.admin.put(`/discipline/staff/${teacherB.id}/permissions`, { permissions: ['approve_decisions'] })).status, 200);
  assert.ok(!(await B.admin.get('/discipline/categories?all=1')).data.some((x) => x.name_en === 'Hacked'));
  assert.equal((await app.h.get('SELECT name_en FROM discipline_categories WHERE id = ?', catA.id)).name_en, catA.name_en);
  // the same name may exist in both schools
  assert.equal((await B.admin.post('/discipline/categories', { name_en: 'Smoking' })).status, 200);
  // a permission cannot be attached to someone from another school, even straight in the database
  const schoolA = (await app.h.get("SELECT id FROM schools WHERE name = 'Disc A'")).id;
  await assert.rejects(async () => app.h.run("INSERT INTO user_permissions (school_id, user_id, permission) VALUES (?, ?, 'manage_discipline')", schoolA, teacherB.id), /FOREIGN KEY/);
});

test('report-card switches are OFF by default, saved per school and recorded in the audit log', async () => {
  assert.deepEqual((await A.admin.get('/discipline/settings')).data, { report_show_conduct: false, report_show_decisions: false });
  assert.equal((await A.admin.put('/discipline/settings', { report_show_conduct: true })).status, 200);
  assert.deepEqual((await A.admin.get('/discipline/settings')).data, { report_show_conduct: true, report_show_decisions: false });
  assert.deepEqual((await B.admin.get('/discipline/settings')).data, { report_show_conduct: false, report_show_decisions: false });
  const sid = (await app.h.get("SELECT id FROM schools WHERE name = 'Disc A'")).id;
  const acts = (await app.h.all('SELECT action FROM audit_log WHERE school_id = ?', sid)).map((r) => r.action);
  for (const a of ['discipline_category_created', 'discipline_permissions_set', 'discipline_settings_updated', 'sanction_type_created']) assert.ok(acts.includes(a), a);
});

test('a school created later also gets the starting lists (registration path)', async () => {
  const id = await makeSchool(app, 'Disc C', 'admin.dc@test.local');
  assert.ok((await app.h.get('SELECT COUNT(*) n FROM discipline_categories WHERE school_id = ?', id)).n >= 8);
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM sanction_types WHERE school_id = ?', id)).n, 4);
});
