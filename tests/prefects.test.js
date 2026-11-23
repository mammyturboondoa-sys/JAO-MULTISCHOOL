'use strict';
// Prefects: only Form 5 / Lower Sixth / Upper Sixth students, per-school posts, isolation between schools, ending on leaving the range.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, PW, h2 } = require('./helpers');
const { isEligibleClass } = require('../server/prefect-defaults');

let app, A, B, f5, f3, upper, teacherC, parentC;
const mkClass = async (S, name, section = '') => (await S.admin.post('/classes', { name, section, year_id: S.year, teacher_id: null })).data.id;
const mkStudent = async (S, name, classId) => (await S.admin.post('/students', { full_name: name, dob: '2008-05-05', gender: 'female', enrolled_on: '2026-09-01', class_id: classId, year_id: S.year,
  guardians: [{ full_name: `Guardian ${name}`, relationship: 'Mother', phone: '+237600000000', is_primary: true }] })).data;
const login = async (S, email, role, name) => {
  const u = (await S.admin.post('/users', { role, name, email })).data; await h2(app, u.id);
  const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200); return c;
};

test.before(async () => {
  app = await startTestApp(); await makeOwner(app);
  await makeSchool(app, 'Pref A', 'admin.pa@test.local'); await makeSchool(app, 'Pref B', 'admin.pb@test.local');
  A = await seedSchool(app, 'admin.pa@test.local', 'PA'); B = await seedSchool(app, 'admin.pb@test.local', 'PB');
  await A.admin.post(`/academic-years/${A.year}/current`); await B.admin.post(`/academic-years/${B.year}/current`);
  f5 = await mkStudent(A, 'Form Five Girl', await mkClass(A, 'Form 5', 'A'));
  f3 = await mkStudent(A, 'Form Three Girl', await mkClass(A, 'Form 3'));
  upper = await mkStudent(A, 'Upper Sixth Girl', await mkClass(A, 'Upper Sixth', 'Arts'));
  teacherC = await login(A, 'teacher.pref@test.local', 'teacher', 'Pref Teacher');
  parentC = await login(A, 'parent.pref@test.local', 'parent', 'Pref Parent');
});
test.after(() => app.stop());

test('class names that count as Form 5 / Lower Sixth / Upper Sixth', () => {
  for (const n of ['Form 5', 'Form 5 B', 'Form Five', 'Lower Sixth', 'Lower Sixth Arts', 'Upper 6', 'Upper Sixth', 'Terminale', 'Première']) assert.ok(isEligibleClass(n), n);
  for (const n of ['Form 1', 'Form 3', 'Form 4', 'Form 50', 'Class 6', '6ème', '', null]) assert.ok(!isEligibleClass(n), String(n));
});

test('every school starts with the list of posts; the administrator can add, rename and switch off posts', async () => {
  for (const S of [A, B]) assert.ok((await S.admin.get('/prefects/posts')).data.length >= 19);
  const r = await A.admin.post('/prefects/posts', { name_en: 'Music Prefect', name_fr: 'Préfet de musique' });
  assert.equal(r.status, 200);
  assert.equal((await A.admin.post('/prefects/posts', { name_en: 'music prefect' })).status, 400);
  assert.equal((await A.admin.put(`/prefects/posts/${r.data.id}`, { name_fr: 'Préfet musique', active: false })).status, 200);
  assert.ok(!(await A.admin.get('/prefects/posts')).data.some((p) => p.id === r.data.id));
  assert.ok((await A.admin.get('/prefects/posts?all=1')).data.some((p) => p.id === r.data.id));
  assert.ok(!(await B.admin.get('/prefects/posts?all=1')).data.some((p) => p.id === r.data.id), 'another school never sees it');
  assert.equal((await teacherC.post('/prefects/posts', { name_en: 'X' })).status, 403);
});

test('only Form 5, Lower Sixth and Upper Sixth students can be chosen', async () => {
  const post = (await A.admin.get('/prefects/posts')).data[0];
  assert.equal((await A.admin.post('/prefects', { student_id: f3.id, post_id: post.id })).status, 400, 'Form 3 refused');
  const ok = await A.admin.post('/prefects', { student_id: f5.id, post_id: post.id });
  assert.equal(ok.status, 200);
  assert.equal((await A.admin.post('/prefects', { student_id: f5.id, post_id: post.id })).status, 400, 'same student, same post, same year refused');
  assert.equal((await A.admin.post('/prefects', { student_id: upper.id, post_id: post.id })).status, 200);
  const names = (await A.admin.get('/prefects/eligible')).data.map((s) => s.name);
  assert.ok(names.includes('Form Five Girl') && names.includes('Upper Sixth Girl') && !names.includes('Form Three Girl'));
  assert.equal((await teacherC.post('/prefects', { student_id: f5.id, post_id: post.id })).status, 403);
  assert.equal((await parentC.post('/prefects', { student_id: f5.id, post_id: post.id })).status, 403);
});

test('another school can neither see nor use these students and posts', async () => {
  const postA = (await A.admin.get('/prefects/posts')).data[0];
  const postB = (await B.admin.get('/prefects/posts')).data[0];
  assert.equal((await B.admin.post('/prefects', { student_id: f5.id, post_id: postB.id })).status, 400, 'school A student refused');
  const b5 = await mkStudent(B, 'B Form Five', await mkClass(B, 'Form 5'));
  assert.equal((await B.admin.post('/prefects', { student_id: b5.id, post_id: postA.id })).status, 400, 'school A post refused');
  assert.equal((await B.admin.get('/prefects')).data.rows.length, 0);
  const appt = (await A.admin.get('/prefects')).data.rows[0];
  assert.equal((await B.admin.put(`/prefects/${appt.id}`, { action: 'end' })).status, 404);
});

test('teachers and parents see names, classes and posts but no photos or student ids', async () => {
  for (const c of [teacherC, parentC]) {
    const r = (await c.get('/prefects')).data;
    assert.ok(r.rows.length >= 2);
    for (const row of r.rows) { assert.equal(row.photo, null); assert.equal(row.student_id, undefined); assert.ok(row.name && row.class_label); }
  }
});

test('ending a post keeps the record; a student who leaves the allowed classes ends automatically', async () => {
  const rows = (await A.admin.get('/prefects')).data.rows;
  const up = rows.find((r) => r.name === 'Upper Sixth Girl');
  assert.equal((await A.admin.put(`/prefects/${up.id}`, { action: 'end', reason: 'resigned' })).status, 200);
  let list = (await A.admin.get('/prefects')).data.rows;
  assert.equal(list.find((r) => r.id === up.id).status, 'ended');
  assert.ok(!(await parentC.get('/prefects')).data.rows.some((r) => r.id === up.id), 'parents see active posts only');
  assert.equal((await A.admin.put(`/prefects/${up.id}`, { action: 'restore' })).status, 200);
  // the student graduates -> the post ends by itself, the record stays
  await app.h.run("UPDATE students SET status = 'graduated' WHERE id = ? AND school_id = ?", upper.id, (await app.h.get('SELECT school_id FROM students WHERE id = ?', upper.id)).school_id);
  list = (await A.admin.get('/prefects')).data.rows;
  const after = list.find((r) => r.id === up.id);
  assert.equal(after.status, 'ended'); assert.equal(after.ended_reason, 'no_longer_eligible');
  assert.equal((await A.admin.put(`/prefects/${up.id}`, { action: 'restore' })).status, 400, 'cannot restore a student who is no longer eligible');
});

test('the prefect post shows on the student profile, for the administrator and for that student\'s parent only', async () => {
  // a parent account linked to the Form 5 student (through the guardian phone) and one that is not linked
  const st = (await A.admin.get(`/students/${f5.id}`)).data;
  assert.ok(Array.isArray(st.prefect_posts) && st.prefect_posts.length >= 1);
  assert.equal(st.prefect_posts[0].current, true);
  assert.ok(st.prefect_posts[0].post_en && st.prefect_posts[0].year_name);
  assert.equal((await A.admin.get(`/students/${f3.id}`)).data.prefect_posts.length, 0, 'a student with no post has an empty list');
  // a parent who is not linked to the student cannot open the record at all
  assert.equal((await parentC.get(`/students/${f5.id}`)).status, 404);
  // the real parent of the student sees the post on the child's profile
  const code = (await app.h.get("SELECT code FROM schools WHERE name = 'Pref A'")).code;
  const reg = await A.admin.post('/parents', { name: 'Mama Five', phone: '+237 677 55 66 77', children: [{ student_id: f5.id, relationship: 'Mother' }] });
  assert.equal(reg.status, 200);
  const pc = client(app); const lr = await pc.post('/auth/login', { school_code: code, identifier: '+237 677 55 66 77', password: reg.data.temporary_password });
  assert.equal(lr.status, 200); pc.csrf = lr.data.csrf; await h2(app, lr.data.user.id); // (a real parent chooses a new password first)
  const mine = await pc.get(`/students/${f5.id}`);
  assert.equal(mine.status, 200);
  assert.ok(mine.data.prefect_posts.some((p) => p.current && p.post_en), 'the parent sees the child\'s prefect post');
  assert.equal((await pc.get(`/students/${upper.id}`)).status, 404, 'but not another child');
});
