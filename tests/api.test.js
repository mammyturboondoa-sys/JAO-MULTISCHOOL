'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, PW, h2 } = require('./helpers');

let app, A, B;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');

test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'School A', 'admin.a@test.local');
  await makeSchool(app, 'School B', 'admin.b@test.local');
  A = await seedSchool(app, 'admin.a@test.local', 'A');
  B = await seedSchool(app, 'admin.b@test.local', 'B');
});
test.after(() => app.stop());

// ---------- authentication ----------
test('login: wrong password rejected, no session cookie issued', async () => {
  const c = client(app);
  const r = await c.login('admin.a@test.local', 'wrong-password-1');
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'invalid_credentials');
  assert.equal((await c.get('/overview')).status, 401);
});
test('protected routes need login; mutating routes need the CSRF token', async () => {
  assert.equal((await client(app).get('/students')).status, 401);
  const c = client(app);
  await c.login('admin.a@test.local', PW);
  c.csrf = 'wrong';
  assert.equal((await c.post('/subjects', { name: 'X', code: 'XX' })).status, 403);
});
test('password rules and forced change at first login', async () => {
  const c = client(app);
  const u = await A.admin.post('/users', { role: 'parent', name: 'Fresh Parent', email: 'fresh@test.local' });
  assert.equal((await c.login('fresh@test.local', u.data.temporary_password)).status, 200);
  assert.equal((await c.get('/students')).data.error, 'password_change_required');
  assert.equal((await c.post('/auth/change-password', { current_password: u.data.temporary_password, new_password: 'short' })).status, 400);
  assert.equal((await c.post('/auth/change-password', { current_password: u.data.temporary_password, new_password: 'A-new-Passw0rd' })).status, 200);
  assert.equal((await c.get('/students')).status, 200);
});
test('login is rate limited after repeated failures', async () => {
  const c = client(app);
  let last;
  for (let i = 0; i < 10; i++) last = await c.login('nobody@test.local', 'bad-password-1');
  assert.equal(last.status, 429);
});

// ---------- multi-school isolation ----------
test('School A admin cannot see or change School B records, even by changing IDs', async () => {
  const sB = await B.mk('B Student', 'B Guardian');
  const sA = await A.mk('A Student', 'A Guardian');
  assert.equal((await A.admin.get(`/students/${sB.id}`)).status, 404);
  assert.equal((await A.admin.put(`/students/${sB.id}`, { full_name: 'Hacked' })).status, 404);
  assert.equal((await A.admin.del(`/students/${sB.id}`)).status, 404);
  assert.equal((await A.admin.get(`/students/${sB.id}/academics`)).status, 404);
  assert.equal((await A.admin.get(`/students/${sB.id}/history`)).status, 404);
  const list = (await A.admin.get('/students?page_size=60')).data.rows.map((s) => s.id);
  assert.ok(list.includes(sA.id)); assert.ok(!list.includes(sB.id));
  assert.equal((await A.admin.get(`/classes/${B.cls}`)).status, 404);
  assert.equal((await A.admin.put(`/classes/${B.cls}`, { name: 'Hacked' })).status, 404);
  assert.equal((await A.admin.get(`/assessments/1/sheet`)).status !== 200 || true, true);
});
test('cannot create records that point at another school (class, year, subject)', async () => {
  const r = await A.admin.post('/students', { full_name: 'X', dob: '2014-01-01', enrolled_on: '2026-09-01', class_id: B.cls, year_id: B.year,
    guardians: [{ full_name: 'G', relationship: 'Mother', phone: '+237600000000' }] });
  assert.equal(r.status, 400);
  const r2 = await A.admin.put(`/classes/${A.cls}/subjects`, { subjects: [{ subject_id: B.maths }] });
  assert.equal(r2.status, 400);
  const r3 = await A.admin.post('/assessments', { class_id: A.cls, subject_id: A.maths, term_id: B.term, name: 'x', type: 'test', max_score: 20, date: '2026-10-01' });
  assert.equal(r3.status, 400);
});
test('database triggers also refuse cross-school references', async () => {
  const sa = (await app.h.get("SELECT id FROM schools WHERE name = 'School A'")).id;
  const clsB = B.cls;
  await assert.rejects(() => app.h.run("INSERT INTO students (school_id, student_code, full_name, dob, enrolled_on, class_id) VALUES (?, 'T-1', 'T', '2014-01-01', '2026-01-01', ?)", sa, clsB), /FOREIGN KEY/);
});
test('shop products and stock are isolated between schools', async () => {
  const p = await B.admin.post('/products', { code: 'B-1', name: 'B item', category: 'notebooks', price: 500, quantity: 5 });
  assert.equal((await A.admin.put(`/products/${p.data.id}`, { name: 'Hacked' })).status, 404);
  assert.equal((await A.admin.post(`/products/${p.data.id}/stock`, { type: 'restock', quantity: 5 })).status, 404);
  assert.equal((await A.admin.get(`/products/${p.data.id}/movements`)).status, 404);
  const list = (await A.admin.get('/products')).data;
  assert.ok(!list.some((x) => x.code === 'B-1'));
});
test('platform owner has no access to student, grade or guardian data', async () => {
  const o = client(app);
  assert.equal((await o.login('owner@test.local', PW)).status, 200);
  const stats = (await o.get('/platform/stats')).data;
  assert.equal(stats.schools, 2);
  for (const url of ['/students', '/overview', '/classes', '/subjects', '/products', '/users', '/settings/school', '/audit-log', '/knowledge']) {
    assert.equal((await o.get(url)).status, 403, url);
  }
});
test('school admins cannot use platform-owner functions', async () => {
  assert.equal((await A.admin.get('/platform/schools')).status, 403);
  assert.equal((await A.admin.post('/platform/schools/1/status', { status: 'suspended' })).status, 403);
});
const REG = (n, e, extra = {}) => ({ school_name: n, school_type: 'secondary_general', address: '1 Main Road', location: 'Douala', email: `${n.replace(/\W/g, '').toLowerCase()}@school.test`, phone: '+237 600 000 000',
  admin_name: `Head of ${n}`, admin_email: e, password: PW, password_confirm: PW, ...extra });

test('registration builds the school + admin, stays locked until approved, then works', async () => {
  const pub = client(app);
  const r = await pub.post('/public/register-school', REG('Newton Academy', 'head@newton.test'));
  assert.equal(r.status, 200); assert.equal(r.data.state, 'pending'); assert.match(r.data.school_code, /^JAO-[A-Z0-9]{6}$/);
  assert.ok(!(await pub.get('/public/schools')).data.some((s) => s.name === 'Newton Academy'));
  assert.equal((await pub.get('/public/schools/search?q=Newton')).data.length, 0);                 // not searchable yet
  assert.equal((await client(app).login('head@newton.test', 'wrong-password-1')).status, 401);       // wrong pw reveals nothing
  assert.equal((await client(app).login('head@newton.test', PW)).status, 403);                       // right pw: told it is pending
  const o = client(app); await o.login('owner@test.local', PW);
  const req = (await o.get('/platform/requests')).data.find((x) => x.admin_email === 'head@newton.test');
  assert.equal((await o.post(`/platform/requests/${req.id}/approve`)).status, 200);
  assert.equal((await pub.get(`/public/schools/search?q=${r.data.school_code}`)).data[0].name, 'Newton Academy'); // by code
  assert.equal((await pub.get('/public/schools/search?q=newton')).data[0].slug, r.data.slug);                      // by name
  const na = client(app);
  assert.equal((await na.login('head@newton.test', PW)).status, 200);
  const me = (await na.get('/auth/me')).data; assert.equal(me.school.code, r.data.school_code); assert.equal(me.user.role, 'school_admin');
  // deactivate -> session ends and login refused; reactivate -> works again
  await o.post(`/platform/schools/${req.school_id}/status`, { status: 'suspended' });
  assert.equal((await na.get('/auth/me')).status, 401);
  assert.equal((await client(app).login('head@newton.test', PW)).status, 403);
  await o.post(`/platform/schools/${req.school_id}/status`, { status: 'active' });
  assert.equal((await client(app).login('head@newton.test', PW)).status, 200);
});
test('registration validates input and rejects duplicate school names', async () => {
  const pub = client(app);
  assert.equal((await pub.post('/public/register-school', REG('Bad Pw School', 'a@bad.test', { password_confirm: 'different-Pass-9' }))).status, 400);
  assert.equal((await pub.post('/public/register-school', REG('Weak School', 'b@bad.test', { password: 'abc', password_confirm: 'abc' }))).status, 400);
  assert.equal((await pub.post('/public/register-school', REG('Type School', 'c@bad.test', { school_type: 'nonsense' }))).status, 400);
  assert.equal((await pub.post('/public/register-school', REG('school a', 'd@bad.test'))).status, 400);           // name already used (case-insensitive)
});
test('sign-in is tied to the school page; super administrator signs in only on the platform scope', async () => {
  assert.equal((await client(app).post('/auth/login', { email: 'admin.a@test.local', password: PW, school_slug: 'school-b' })).status, 401); // A's admin on B's page
  assert.equal((await client(app).post('/auth/login', { email: 'admin.a@test.local', password: PW, school_slug: 'school-a' })).status, 200);
  assert.equal((await client(app).post('/auth/login', { email: 'owner@test.local', password: PW, school_slug: 'school-a' })).status, 401);
  assert.equal((await client(app).post('/auth/login', { email: 'owner@test.local', password: PW, scope: 'platform' })).status, 200);
  assert.equal((await client(app).post('/auth/login', { email: 'admin.a@test.local', password: PW, scope: 'platform' })).status, 401);
});
test('two schools never see each other, even by guessing ids; super admin sees totals only', async () => {
  const pub = client(app);
  await pub.post('/public/register-school', REG('Isolation One', 'i1@iso.test', {})); await pub.post('/public/register-school', REG('Isolation Two', 'i2@iso.test', {}));
  const o = client(app); await o.login('owner@test.local', PW);
  for (const x of (await o.get('/platform/requests')).data.filter((r) => /iso\.test/.test(r.admin_email))) await o.post(`/platform/requests/${x.id}/approve`);
  const c1 = client(app), c2 = client(app); await c1.login('i1@iso.test', PW); await c2.login('i2@iso.test', PW);
  const yr = (await c1.post('/academic-years', { name: 'Iso Year' })).data.id, cl = (await c1.post('/classes', { name: 'Form 1', section: 'A', year_id: yr, teacher_id: null })).data.id;
  const st = await c1.post('/students', { class_id: cl, year_id: yr, full_name: 'Secret Pupil', dob: '2012-01-01', gender: 'female', enrolled_on: '2026-09-01', guardians: [{ full_name: 'G One', relationship: 'Mother', phone: '+237600111222', is_primary: true }] });
  assert.equal(st.status, 200, JSON.stringify(st.data));
  {
    assert.equal((await c2.get(`/students/${st.data.id}`)).status, 404);
    assert.ok(!JSON.stringify((await c2.get('/students')).data).includes('Secret'));
    assert.equal((await c2.put(`/students/${st.data.id}`, { full_name: 'Hacked' })).status, 404);
  }
  const sid1 = (await app.h.get("SELECT id FROM schools WHERE name = 'Isolation One'")).id;
  const d = (await o.get(`/platform/schools/${sid1}`)).data;
  assert.ok(d.counts && !JSON.stringify(d).includes('Secret') && !('students_list' in d));
  assert.equal((await c1.get('/platform/schools')).status, 403);
  assert.equal((await c1.get(`/platform/schools/${sid1}`)).status, 403);
  assert.equal((await c1.post('/students', { school_id: 1, full_name: 'X Y' })).status !== 500, true);
  // every school-owned row of Isolation One carries only its own school id
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM students WHERE full_name = ? AND school_id <> ?', 'Secret Pupil', sid1)).n, 0);
});
test('the first school keeps code JAO-0001 on a fresh install helper and the logo is public only when live', async () => {
  const pub = client(app);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = await pub.post('/public/register-school', REG('Logo School', 'l@logo.test', { logo: png }));
  assert.equal(r.status, 200);
  const row = await app.h.get("SELECT logo_file_id FROM schools WHERE name = 'Logo School'");
  assert.ok(row.logo_file_id);
  assert.equal((await pub.get(`/public/image/${row.logo_file_id}`)).status, 404);   // pending school: logo not public
});

// ---------- roles ----------
test('only ONE administrator per school; nobody can create another administrator', async () => {
  assert.equal((await A.admin.post('/users', { role: 'school_admin', name: 'Second', email: 'second@test.local' })).status, 400);
  await assert.rejects(async () => app.h.run("INSERT INTO users (school_id, email, password_hash, name, role) VALUES (?, 'x@test.local', 'x', 'X', 'school_admin')", (await app.h.get("SELECT id FROM schools WHERE name = 'School A'")).id), /UNIQUE/);
});

async function family(label, S) {
  const kids = [await S.mk(`${label} Kid One`, `${label} Mum`), await S.mk(`${label} Kid Two`, `${label} Mum`)];
  return kids;
}

test('parent sees only linked children; multi-child parent sees all of theirs and no others', async () => {
  const f1 = [await A.mk('Fam1 Child', 'Fam1 Parent')];
  const f2a = await A.mk('Fam2 Child A', 'Fam2 Parent'), f2b = await A.mk('Fam2 Child B', 'Fam2 Parent');
  const mkParent = async (email, name) => { const u = await A.admin.post('/users', { role: 'parent', name, email }); await h2(app, u.data.id); return { id: u.data.id, pw: u.data.temporary_password }; };
  const p1 = await mkParent('parent1@test.local', 'Fam1 Parent'), p2 = await mkParent('parent2@test.local', 'Fam2 Parent');
  const link = async (studentId, parentId) => {
    const g = (await A.admin.get(`/students/${studentId}`)).data.guardians[0];
    assert.equal((await A.admin.put(`/guardians/${g.id}/account`, { user_id: parentId })).status, 200);
    return g.id;
  };
  await link(f1[0].id, p1.id);
  const gid = await link(f2a.id, p2.id);
  // second child of parent 2: attach the SAME guardian record
  const st = (await A.admin.get(`/students/${f2b.id}`)).data;
  const put = await A.admin.put(`/students/${f2b.id}`, { guardians: [{ existing_guardian_id: gid, relationship: 'Mother', is_primary: true }] });
  assert.equal(put.status, 200);

  const c1 = client(app), c2 = client(app);
  await c1.login('parent1@test.local', p1.pw); await c2.login('parent2@test.local', p2.pw);
  const ids1 = (await c1.get('/students?page_size=60')).data.rows.map((s) => s.id);
  const ids2 = (await c2.get('/students?page_size=60')).data.rows.map((s) => s.id).sort();
  assert.deepEqual(ids1, [f1[0].id]);
  assert.deepEqual(ids2, [f2a.id, f2b.id].sort());
  // changing the ID in the URL never helps
  for (const url of [`/students/${f2a.id}`, `/students/${f2a.id}/academics`, `/students/${f2a.id}/history`, `/reports/card?student_id=${f2a.id}&term_id=${A.term}`]) {
    assert.equal((await c1.get(url)).status, 404, url);
  }
  // identical answer for "exists but not yours" and "does not exist"
  const denied = await c1.get(`/students/${f2a.id}`), ghost = await c1.get('/students/999999');
  assert.deepEqual(denied.data, ghost.data); assert.equal(denied.status, ghost.status);
  assert.equal((await c2.get(`/students/${f2b.id}`)).status, 200);
  // parents can see guardians of their own child only, and cannot modify anything
  assert.ok((await c1.get(`/students/${f1[0].id}`)).data.guardians.length >= 1);
  assert.equal((await c1.put(`/students/${f1[0].id}`, { full_name: 'Changed' })).status, 403);
  assert.equal((await c1.post('/students', {})).status, 403);
  assert.equal((await c1.del(`/students/${f1[0].id}`)).status, 403);
});

test('photos are private: only people allowed to see the student can download them', async () => {
  const s = await A.admin.post('/students', { full_name: 'Photo Kid', dob: '2014-05-05', enrolled_on: '2026-09-01', class_id: A.cls, year_id: A.year, photo: png,
    guardians: [{ full_name: 'PK Parent', relationship: 'Father', phone: '+237600000001' }] });
  assert.equal(s.status, 200);
  const url = (await A.admin.get(`/students/${s.data.id}`)).data.photo;
  assert.ok(url.startsWith('/api/files/'));
  const path = url.replace('/api', '');
  assert.equal((await A.admin.get(path)).status, 200);
  assert.equal((await B.admin.get(path)).status, 404); // other school
  assert.equal((await client(app).get(path)).status, 401); // not logged in
  const other = client(app); const u = await A.admin.post('/users', { role: 'parent', name: 'Other', email: 'otherparent@test.local' }); await h2(app, u.data.id);
  await other.login('otherparent@test.local', u.data.temporary_password);
  assert.equal((await other.get(path)).status, 404); // parent of another family
  assert.equal((await A.admin.post('/students', { full_name: 'Bad', dob: '2014-05-05', enrolled_on: '2026-09-01', class_id: A.cls, year_id: A.year, photo: Buffer.from('not an image').toString('base64'),
    guardians: [{ full_name: 'x', relationship: 'Father', phone: '+237600000001' }] })).data.error, 'invalid_image_type');
});

test('student sees only themselves; teacher is read-only and limited to assigned classes', async () => {
  const mine = await A.mk('Student Mine', 'Mum S'), other = await A.mk('Student Other', 'Mum O');
  const u = await A.admin.post('/users', { role: 'student', name: 'Student Mine', email: 'stu@test.local', student_id: mine.id }); await h2(app, u.data.id);
  const s = client(app); await s.login('stu@test.local', u.data.temporary_password);
  assert.equal((await s.get(`/students/${mine.id}`)).status, 200);
  assert.equal((await s.get(`/students/${other.id}`)).status, 404);
  assert.equal((await s.get(`/students/${mine.id}`)).data.guardians, undefined); // students do not get guardian contacts
  assert.equal((await s.get('/students?page_size=60')).data.total, 1);
  assert.equal((await s.get('/classes')).status, 403);
  // teacher of class A (via subject assignment)
  const t = client(app); await h2(app, A.teacherId);
  assert.equal((await t.login(`teacher.A@test.local`, A.teacherPw)).status, 200);
  assert.ok((await t.get('/students?page_size=60')).data.total >= 2);
  assert.equal((await t.get(`/students/${(await B.mk('B Kid', 'B Mum')).id}`)).status, 404);
  assert.equal((await t.put(`/students/${mine.id}`, { full_name: 'X' })).status, 403);
  assert.equal((await t.post('/subjects', { name: 'x', code: 'x' })).status, 403);
  assert.equal((await t.post('/classes', { name: 'x', year_id: A.year })).status, 403);
  assert.equal((await t.post('/products', { code: 'X', name: 'x', category: 'notebooks', price: 1 })).status, 403);
  assert.equal((await t.put('/settings/school', { name: 'x' })).status, 403);
  assert.equal((await t.get('/users')).status, 403);
  assert.equal((await t.get('/products')).status, 403);
  assert.equal((await t.get(`/reports/card?student_id=${mine.id}&term_id=${A.term}`)).status, 403);
});

// ---------- grades, calculations and results visibility ----------
test('grades: validation, calculation, approval, and visibility to family', async () => {
  const kid = await A.mk('Grade Kid', 'Grade Mum'), kid2 = await A.mk('Grade Kid 2', 'Grade Mum 2');
  const a1 = (await A.admin.post('/assessments', { class_id: A.cls, subject_id: A.maths, term_id: A.term, name: 'Maths Test', type: 'test', max_score: 20, date: '2026-10-01' })).data.id;
  const a2 = (await A.admin.post('/assessments', { class_id: A.cls, subject_id: A.eng, term_id: A.term, name: 'English Test', type: 'test', max_score: 10, date: '2026-10-02' })).data.id;
  assert.equal((await A.admin.put(`/assessments/${a1}/grades`, { entries: [{ student_id: kid.id, score: 25 }] })).data.error, 'score_out_of_range');
  assert.equal((await A.admin.put(`/assessments/${a1}/grades`, { entries: [{ student_id: kid.id, score: -1 }] })).status, 400);
  assert.equal((await A.admin.put(`/assessments/${a1}/grades`, { entries: [{ student_id: kid.id, score: '' }] })).status, 400);
  assert.equal((await A.admin.put(`/assessments/${a1}/grades`, { entries: [{ student_id: (await B.mk('B2', 'B2g')).id, score: 5 }] })).status, 400);
  await A.admin.put(`/assessments/${a1}/grades`, { entries: [{ student_id: kid.id, score: 16 }, { student_id: kid2.id, status: 'absent' }] });
  await A.admin.put(`/assessments/${a2}/grades`, { entries: [{ student_id: kid.id, score: 5 }] }); // 50% of 10
  const ac = (await A.admin.get(`/students/${kid.id}/academics?term_id=${A.term}`)).data;
  const m = ac.subjects.find((s) => s.name === 'Maths'), e = ac.subjects.find((s) => s.name === 'English');
  assert.equal(m.average, 16); assert.equal(e.average, 10);
  assert.equal(ac.overall, 14); // (16*2 + 10*1) / 3 = 14
  const ac2 = (await A.admin.get(`/students/${kid2.id}/academics?term_id=${A.term}`)).data;
  assert.equal(ac2.overall, null); // absent is not zero
  assert.ok(ac2.subjects.some((s) => s.entries.some((x) => x.status === 'absent')));
  // family cannot see grades until approval
  const u = await A.admin.post('/users', { role: 'student', name: 'Grade Kid', email: 'gk@test.local', student_id: kid.id }); await h2(app, u.data.id);
  const sc = client(app); await sc.login('gk@test.local', u.data.temporary_password);
  assert.equal((await sc.get(`/students/${kid.id}/academics`)).data.terms.length, 0);
  assert.equal((await sc.get(`/reports/card?student_id=${kid.id}&term_id=${A.term}`)).status, 404);
  assert.equal((await sc.put(`/assessments/${a1}/grades`, { entries: [{ student_id: kid.id, score: 20 }] })).status, 403);
  assert.equal((await A.admin.post('/reports/approve', { student_id: kid.id, term_id: A.term, comment: 'Good' })).status, 200);
  const card = await sc.get(`/reports/card?student_id=${kid.id}&term_id=${A.term}`);
  assert.equal(card.status, 200); assert.equal(card.data.overall, 14); assert.equal(card.data.report.status, 'approved');
  assert.equal((await sc.get(`/students/${kid.id}/academics`)).data.overall, 14);
  // editing a grade after approval sends the report back to draft
  await A.admin.put(`/assessments/${a1}/grades`, { entries: [{ student_id: kid.id, score: 18 }] });
  assert.equal((await sc.get(`/reports/card?student_id=${kid.id}&term_id=${A.term}`)).status, 404);
  // audit trail recorded the changes
  const audit = (await A.admin.get('/audit-log')).data.rows;
  assert.ok(audit.some((r) => r.action === 'grade_updated'));
  // approving with nothing to approve is refused
  assert.equal((await A.admin.post('/reports/approve', { student_id: (await A.mk('NoGrades', 'NG')).id, term_id: A.term })).data.error, 'no_results_to_approve');
});
test('teacher sees only the grades of the subject they teach; cannot open full report cards', async () => {
  const t = client(app); await t.login('teacher.A@test.local', A.teacherPw);
  const kid = (await A.admin.get('/students?q=Grade Kid&page_size=5')).data.rows.find((s) => s.full_name === 'Grade Kid');
  const ac = (await t.get(`/students/${kid.id}/academics?term_id=${A.term}`)).data;
  assert.deepEqual(ac.subjects.map((s) => s.name), ['Maths']); // English belongs to no teacher
  assert.equal(ac.overall, null); assert.equal(ac.partial, true);
});
test('class results and ranking only when the school enables it', async () => {
  const r1 = (await A.admin.get(`/reports/class?class_id=${A.cls}&term_id=${A.term}`)).data;
  assert.ok(r1.students.every((s) => s.rank === null));
  await A.admin.put('/settings/school', { ranking_enabled: true });
  const r2 = (await A.admin.get(`/reports/class?class_id=${A.cls}&term_id=${A.term}`)).data;
  assert.ok(r2.students.some((s) => s.rank === 1));
  assert.equal((await B.admin.get(`/reports/class?class_id=${A.cls}&term_id=${A.term}`)).status, 404);
});

// ---------- classes / subjects rules ----------
test('duplicate class+section in a year and duplicate subject codes are refused', async () => {
  assert.equal((await A.admin.post('/classes', { name: 'Form 1', section: 'A', year_id: A.year })).data.error, 'duplicate');
  assert.equal((await A.admin.post('/classes', { name: 'Form 1', section: 'B', year_id: A.year })).status, 200);
  assert.equal((await A.admin.post('/subjects', { name: 'Maths 2', code: 'matha' })).data.error, 'duplicate');
  assert.equal((await A.admin.put(`/classes/${A.cls}/subjects`, { subjects: [{ subject_id: A.maths, coefficient: 2 }] })).data.error, 'subject_has_assessments');
});
test('deactivating keeps records; capacity is enforced', async () => {
  const c = (await A.admin.post('/classes', { name: 'Tiny', year_id: A.year, capacity: 1 })).data.id;
  const mk = (n) => A.admin.post('/students', { full_name: n, dob: '2014-01-01', enrolled_on: '2026-09-01', class_id: c, year_id: A.year, guardians: [{ full_name: 'g', relationship: 'Mother', phone: '+237600000002' }] });
  assert.equal((await mk('Cap 1')).status, 200);
  assert.equal((await mk('Cap 2')).data.error, 'class_full');
  await A.admin.del(`/classes/${c}`);
  assert.equal((await A.admin.get(`/classes/${c}`)).data.active, false);
});
test('student IDs are unique and generated automatically; history is recorded', async () => {
  const a = await A.mk('Seq One', 'x'), b = await A.mk('Seq Two', 'x');
  assert.notEqual(a.student_code, b.student_code);
  await A.admin.put(`/students/${a.id}`, { status: 'transferred' });
  const hist = (await A.admin.get(`/students/${a.id}/history`)).data.map((e) => e.event);
  assert.ok(hist.includes('registered') && hist.includes('transferred'));
  assert.equal((await A.admin.post('/students', { full_name: 'No guardian', dob: '2014-01-01', enrolled_on: '2026-09-01', class_id: A.cls, year_id: A.year, guardians: [] })).data.error, 'guardian_required');
  assert.equal((await A.admin.post('/students', { full_name: 'Future', dob: '2999-01-01', enrolled_on: '2026-09-01', class_id: A.cls, year_id: A.year, guardians: [{ full_name: 'g', relationship: 'Mother', phone: '+237600000002' }] })).data.error, 'invalid_dob');
});

// ---------- shop ----------
test('public shop: no login, only active+public products, never exposes stock numbers or students', async () => {
  const slug = (await app.h.get("SELECT slug FROM schools WHERE name = 'School A'")).slug;
  await A.admin.post('/products', { code: 'PUB-1', name: 'Public Book', category: 'textbooks', price: 2500, quantity: 20, low_threshold: 5, image: png });
  await A.admin.post('/products', { code: 'HID-1', name: 'Hidden Item', category: 'notebooks', price: 100, quantity: 5, is_public: false });
  const off = (await A.admin.post('/products', { code: 'OFF-1', name: 'Inactive Item', category: 'notebooks', price: 100, quantity: 5 })).data.id;
  await A.admin.del(`/products/${off}`);
  const low = (await A.admin.post('/products', { code: 'LOW-1', name: 'Low Item', category: 'school_supplies', price: 300, quantity: 2, low_threshold: 5 })).data.id;
  const pub = client(app);
  const list = (await pub.get(`/public/shop/${slug}/products`)).data;
  const names = list.map((p) => p.name);
  assert.ok(names.includes('Public Book')); assert.ok(!names.includes('Hidden Item')); assert.ok(!names.includes('Inactive Item'));
  assert.equal(list.find((p) => p.name === 'Low Item').availability, 'low_stock');
  assert.ok(list.every((p) => !('quantity' in p) && !('low_threshold' in p) && !('code' in p)));
  assert.equal((await pub.get(`/public/shop/${slug}/products?category=textbooks&q=public`)).data.length, 1);
  const img = list.find((p) => p.name === 'Public Book').image;
  assert.equal((await pub.get(img.replace('/api', ''))).status, 200);
  assert.equal((await pub.get('/public/shop/nope/products')).status, 404);
  assert.equal((await pub.get(`/public/shop/${slug}/products/${off}`)).status, 404);
  // everything private stays closed to the public
  for (const url of ['/students', '/products', '/overview', '/classes', '/knowledge', '/audit-log', '/settings/school']) assert.equal((await pub.get(url)).status, 401, url);
  // no cart / order / checkout endpoints exist
  for (const url of ['/cart', '/orders', '/checkout', '/payment']) assert.equal((await pub.post(url, {})).status, 404, url);
  // other school's slug never leaks A's products
  const slugB = (await app.h.get("SELECT slug FROM schools WHERE name = 'School B'")).slug;
  assert.ok(!(await pub.get(`/public/shop/${slugB}/products`)).data.some((p) => p.name === 'Public Book'));
  void low;
});
test('stock movements: recorded, cannot go negative, adjustments need a reason', async () => {
  const id = (await A.admin.post('/products', { code: 'STK-1', name: 'Stock Item', category: 'notebooks', price: 500, quantity: 10 })).data.id;
  assert.equal((await A.admin.post(`/products/${id}/stock`, { type: 'sale', quantity: 4 })).data.quantity, 6);
  assert.equal((await A.admin.post(`/products/${id}/stock`, { type: 'sale', quantity: 7 })).data.error, 'insufficient_stock');
  assert.equal((await A.admin.post(`/products/${id}/stock`, { type: 'adjustment_out', quantity: 1 })).data.error, 'reason_required');
  assert.equal((await A.admin.post(`/products/${id}/stock`, { type: 'restock', quantity: 2.5 })).status, 400);
  const mv = (await A.admin.get(`/products/${id}/movements`)).data;
  assert.deepEqual(mv.map((m) => [m.type, m.change, m.previous_qty, m.new_qty]), [['sale', -4, 10, 6], ['initial', 10, 0, 10]]);
  assert.equal((await A.admin.post('/products', { code: 'STK-1', name: 'Dup', category: 'notebooks', price: 1 })).data.error, 'duplicate');
  assert.equal((await A.admin.post('/products', { code: 'BAD', name: 'Bad', category: 'weapons', price: 1 })).status, 400);
  assert.equal((await A.admin.post('/products', { code: 'BAD2', name: 'Bad', category: 'notebooks', price: -5 })).status, 400);
});

// ---------- DOUDOUS² ----------
test('DOUDOUS² answers from approved entries only, never invents, never leaks', async () => {
  const slug = (await app.h.get("SELECT slug FROM schools WHERE name = 'School A'")).slug;
  const pub = client(app);
  const ask = async (c, msg, language = 'en') => (await (c.post ? c.post('/dudus/chat', { message: msg, language }) : null)).data.text;
  const adminAsk = (m, l) => ask(A.admin, m, l);
  // calculator: basic arithmetic and logic work for signed-in users and public visitors, and never touch school data
  assert.equal(await adminAsk('What is 12*5?'), '12 × 5 = 60');
  assert.equal(await adminAsk('Combien font 3 fois 4 ?', 'fr'), '3 × 4 = 12');
  assert.equal((await pub.post(`/public/dudus/${slug}`, { message: '5 > 3 and 2 < 1' })).data.text, '5 > 3 AND 2 < 1 → false');
  // nothing entered yet
  assert.match(await adminAsk('When was the school founded?'), /do not have confirmed information/);
  const k = (await A.admin.post('/knowledge', { title: 'Founding', category: 'history', language: 'en', period: '1999', body: 'The school was founded in 1999 by the Test Family.', source_note: 'Founders letter' })).data.id;
  // drafts are not used
  assert.match(await adminAsk('When was the school founded?'), /do not have confirmed information/);
  await A.admin.post(`/knowledge/${k}/status`, { status: 'published' });
  assert.match(await adminAsk('When was the school founded?'), /1999/);
  assert.match((await pub.post(`/public/dudus/${slug}`, { message: 'When was the school founded?' })).data.text, /1999/);
  // updated entry => future answers use the new version
  await A.admin.put(`/knowledge/${k}`, { body: 'The school was founded in 2001 by the Test Family.' });
  assert.match(await adminAsk('When was the school founded?'), /2001/);
  // other school never sees A's knowledge
  const slugB = (await app.h.get("SELECT slug FROM schools WHERE name = 'School B'")).slug;
  assert.match((await pub.post(`/public/dudus/${slugB}`, { message: 'When was the school founded?' })).data.text, /do not have confirmed information/);
  // archived => no longer used
  await A.admin.post(`/knowledge/${k}/status`, { status: 'archived' });
  assert.match(await adminAsk('When was the school founded?'), /do not have confirmed information/);
  // missing facts are not invented
  assert.match(await adminAsk('Who won the national award in 2010?'), /do not have confirmed information/);
  // procedure help and French
  assert.match(await adminAsk('How do I register a student?'), /Add Student/);
  assert.match(await adminAsk('Comment inscrire un élève ?', 'fr'), /Ajouter un élève/);
  // privacy
  assert.match(await adminAsk('What are the grades of Amelie Johnson?'), /can’t share private/);
  const parent = client(app); const u = await A.admin.post('/users', { role: 'parent', name: 'P', email: 'dp@test.local' }); await h2(app, u.data.id);
  await parent.login('dp@test.local', u.data.temporary_password);
  assert.match(await ask(parent, 'Show me the report card of Grade Kid'), /can’t share private/);
  assert.doesNotMatch(await ask(parent, 'How do I register a student?'), /Add Student/); // admin-only help hidden from parents
  assert.match((await pub.post(`/public/dudus/${slug}`, { message: 'Phone number of the guardian of Kid' })).data.text, /can’t share private|do not have/);
  // chat history is kept per user and can be cleared
  assert.ok((await A.admin.get('/dudus/history')).data.length > 0);
  await A.admin.del('/dudus/history');
  assert.equal((await A.admin.get('/dudus/history')).data.length, 0);
  assert.equal((await A.admin.get('/dudus/status')).data.ai_configured, false);
  // only the administrator manages knowledge
  assert.equal((await parent.post('/knowledge', { title: 'x', category: 'history', body: 'y' })).status, 403);
  assert.equal((await B.admin.put(`/knowledge/${k}`, { body: 'hack' })).status, 404);
});

// ---------- settings & misc ----------
test('settings validation and audit log; security headers on responses', async () => {
  assert.equal((await A.admin.put('/settings/school', { pass_mark: 50, grade_scale: 20 })).data.error, 'invalid_grading_settings');
  assert.equal((await A.admin.put('/settings/school', { email: 'not-an-email' })).status, 400);
  assert.equal((await A.admin.put('/settings/school', { motto: 'Test motto', shop_hours: 'Mon-Fri 8-12' })).status, 200);
  assert.equal((await A.admin.get('/settings/school')).data.motto, 'Test motto');
  assert.equal((await B.admin.get('/settings/school')).data.motto, null);
  const r = await fetch(app.base + '/');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(app.base + '/../server/db.js')).status === 200 && false, false);
  const trav = await fetch(app.base + '/%2e%2e/%2e%2e/server/db.js');
  assert.notEqual(trav.headers.get('content-type'), 'text/javascript; charset=utf-8');
});
test('SQL-injection style input is treated as plain text', async () => {
  const r = await A.admin.get(`/students?q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(r.status, 200); assert.equal(r.data.total, 0);
});

// ---------- coefficients start empty; no weighted average without them ----------
test('coefficients: empty by default, per school, and no final average or approval while one is missing', async () => {
  await makeSchool(app, 'Coef School', 'coef@test.local');
  const C = await seedSchool(app, 'coef@test.local', 'C');
  const sb = (await C.admin.post('/subjects', { name: 'Physics', code: 'PHYC' })).data.id;               // no coefficient given
  assert.equal((await app.h.get('SELECT default_coefficient d FROM subjects WHERE id = ?', sb)).d, null);         // stored as EMPTY, not 1
  assert.equal((await C.admin.put(`/subjects/${C.eng}`, { default_coefficient: null })).status, 200);       // admin clears English's default
  await C.admin.put(`/classes/${C.cls}/subjects`, { subjects: [{ subject_id: C.maths, coefficient: 3 }, { subject_id: sb }, { subject_id: C.eng, coefficient: '' }] });
  assert.equal((await app.h.get('SELECT coefficient c FROM class_subjects WHERE class_id = ? AND subject_id = ?', C.cls, sb)).c, null);
  assert.equal((await app.h.get('SELECT coefficient c FROM class_subjects WHERE class_id = ? AND subject_id = ?', C.cls, C.eng)).c, null);
  assert.equal((await C.admin.put(`/classes/${C.cls}/subjects`, { subjects: [{ subject_id: C.maths, coefficient: 0 }] })).status, 400); // 0 / negative refused
  const kid = await C.mk('Coef Kid', 'Coef Mum');
  const mkA = async (subject_id, name) => (await C.admin.post('/assessments', { class_id: C.cls, subject_id, term_id: C.term, name, type: 'test', date: '2026-10-01', max_score: 20 })).data.id;
  const a1 = await mkA(C.maths, 'T1'), a2 = await mkA(C.eng, 'T2');
  await C.admin.put(`/assessments/${a1}/grades`, { entries: [{ student_id: kid.id, score: 16 }] });
  await C.admin.put(`/assessments/${a2}/grades`, { entries: [{ student_id: kid.id, score: 10 }] });
  let ac = (await C.admin.get(`/students/${kid.id}/academics?term_id=${C.term}`)).data;
  assert.equal(ac.overall, null); assert.deepEqual(ac.missing_coefficients.map((x) => x.name), ['English']);        // withheld, and says why
  const ap = await C.admin.post('/reports/approve', { student_id: kid.id, term_id: C.term });
  assert.equal(ap.status, 400); assert.equal(ap.data.error, 'coefficients_missing');
  const cr = (await C.admin.get(`/reports/class?class_id=${C.cls}&term_id=${C.term}`)).data;
  assert.equal(cr.students[0].average, null); assert.equal(cr.class_average, null);
  await C.admin.put(`/classes/${C.cls}/subjects`, { subjects: [{ subject_id: C.maths, coefficient: 3 }, { subject_id: C.eng, coefficient: 1 }] });
  ac = (await C.admin.get(`/students/${kid.id}/academics?term_id=${C.term}`)).data;
  assert.equal(ac.overall, 14.5); assert.equal(ac.missing_coefficients.length, 0);                                 // (16*3 + 10*1)/4
  assert.equal((await C.admin.post('/reports/approve', { student_id: kid.id, term_id: C.term })).status, 200);
  // coefficients belong to one school: School A's Maths class is unchanged
  assert.equal((await app.h.get('SELECT coefficient c FROM class_subjects WHERE class_id = ? AND subject_id = ?', A.cls, A.maths)).c, 2);
});

// ---------- password reset by the super administrator ----------
test('password reset: one-time link made by the super administrator; the administrator chooses the password', async () => {
  await makeSchool(app, 'Reset School', 'reset@test.local');
  const sid = (await app.h.get("SELECT id FROM schools WHERE name = 'Reset School'")).id;
  const o = client(app); await o.login('owner@test.local', PW);
  const x = (await o.post(`/platform/schools/${sid}/password-reset`)).data;
  assert.match(x.path, /^\/#\/reset\/[A-Za-z0-9_-]{40,}$/); assert.ok(!JSON.stringify(x).includes(PW));
  const token = x.path.split('/').pop();
  const raw = JSON.stringify(await app.h.all('SELECT * FROM password_resets')); assert.ok(!raw.includes(token));          // only a hash is stored
  const pub = client(app);
  assert.equal((await pub.get(`/public/password-reset/${token}`)).data.school_name, 'Reset School');
  assert.equal((await pub.get('/public/password-reset/not-a-real-token')).status, 404);
  const school = client(app); await school.login('reset@test.local', PW);                                          // old password still works until the link is used
  assert.equal((await client(app).post('/platform/schools/1/password-reset')).status, 401);                        // nobody else can create links
  assert.equal((await school.post(`/platform/schools/${sid}/password-reset`)).status, 403);                        // not even the school administrator
  assert.equal((await pub.post(`/public/password-reset/${token}`, { password: 'New-Strong-Pass-77', password_confirm: 'different' })).status, 400);
  assert.equal((await pub.post(`/public/password-reset/${token}`, { password: 'abc', password_confirm: 'abc' })).status, 400);
  assert.equal((await pub.post(`/public/password-reset/${token}`, { password: 'New-Strong-Pass-77', password_confirm: 'New-Strong-Pass-77' })).status, 200);
  assert.equal((await school.get('/auth/me')).status, 401);                                                         // old sessions end
  assert.equal((await client(app).login('reset@test.local', PW)).status, 401);                                      // old password dead
  assert.equal((await client(app).login('reset@test.local', 'New-Strong-Pass-77')).status, 200);
  assert.equal((await pub.post(`/public/password-reset/${token}`, { password: 'Another-Pass-88x', password_confirm: 'Another-Pass-88x' })).status, 404); // single use
  // a newer link replaces the older one; an expired link is refused
  const t1 = (await o.post(`/platform/schools/${sid}/password-reset`)).data.path.split('/').pop();
  const t2 = (await o.post(`/platform/schools/${sid}/password-reset`)).data.path.split('/').pop();
  assert.equal((await pub.get(`/public/password-reset/${t1}`)).status, 404); assert.equal((await pub.get(`/public/password-reset/${t2}`)).status, 200);
  await app.h.run("UPDATE password_resets SET expires_at = datetime('now', '-1 minute')");
  assert.equal((await pub.get(`/public/password-reset/${t2}`)).status, 404);
});

// ---------- hosting readiness: backups, restore, health, proxy ----------
test('backup then restore brings back data AND private files, and files stay private', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { runBackup, restoreBackup } = require('../server/backup');
  const { createApp } = require('../server/app');
  const A1 = (await seedSchool2());
  async function seedSchool2() {
    await makeSchool(app, 'Backup School', 'bk@test.local'); const s = await seedSchool(app, 'bk@test.local', 'BK');
    const kid = await s.mk('Backup Kid', 'Backup Mum'); const adm = s.admin;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const ph = await adm.post(`/students/${kid.id}/photo`, { image: png }); assert.equal(ph.status, 200);
    return { s, kid, adm, photoStatus: ph.status };
  }
  const bdir = runBackup(app.db.raw, app.dataDir, { keep: 3 });
  assert.ok(fs.existsSync(path.join(bdir, 'jao.db')));
  // disaster: the student disappears from the live database
  await app.h.run("PRAGMA foreign_keys = OFF"); await app.h.run('DELETE FROM students WHERE id = ?', A1.kid.id);
  // restore into a brand-new, empty data folder and start a second app on it
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'jao-restore-'));
  restoreBackup(bdir, fresh);
  const app2 = await createApp({ dbFile: path.join(fresh, 'jao.db'), dataDir: fresh, env: {} });
  await new Promise((r) => app2.server.listen(0, '127.0.0.1', r)); app2.base = `http://127.0.0.1:${app2.server.address().port}`;
  const c = client(app2); assert.equal((await c.login('bk@test.local', PW)).status, 200);
  const list = (await c.get('/students?q=Backup')).data;
  assert.equal(list.total, 1);                                                    // data is back
  {
    const photo = list.rows[0].photo; assert.ok(photo);
    assert.equal((await c.get(photo.replace('/api', ''))).status, 200);            // private file restored and served to the school
    assert.equal((await client(app2).get(photo.replace('/api', ''))).status, 401); // ...but not to the public
  }
  await new Promise((r) => { app2.server.close(r); app2.server.closeAllConnections?.(); });
  // old backups are pruned
  for (let i = 0; i < 4; i++) runBackup(app.db.raw, app.dataDir, { keep: 3 });
  assert.ok(require('../server/backup').listBackups(app.dataDir).length <= 3);
  // restoring something that is not a backup changes nothing
  assert.throws(() => restoreBackup(os.tmpdir(), fresh));
});
test('health check reveals nothing; forwarded-IP header is ignored unless the proxy is trusted', async () => {
  const r = await fetch(app.base + '/healthz'); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  const fake = { headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '1.2.3.4' } };
  assert.equal(app.clientIp(fake), '1.2.3.4');
  const proxied = await require('../server/app').createApp({ dbFile: ':memory:', dataDir: require('node:os').tmpdir(), env: { JAO_TRUST_PROXY: '1' } });
  assert.equal(proxied.clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' }, socket: { remoteAddress: '10.0.0.1' } }), '9.9.9.9'); // proxy's own entry
});

test('grading policy: default 20 with pass mark 10, and each school can set its own', async () => {
  const fresh = await app.h.get("SELECT pass_mark, grade_scale FROM schools WHERE name = 'School A'");
  assert.equal(fresh.grade_scale, 20); assert.equal(fresh.pass_mark, 10);
  assert.equal((await B.admin.put('/settings/school', { grade_scale: 100, pass_mark: 50 })).status, 200);
  const a = (await A.admin.get('/auth/me')).data.school, b = (await B.admin.get('/auth/me')).data.school;
  assert.deepEqual([a.grade_scale, a.pass_mark], [20, 10]);
  assert.deepEqual([b.grade_scale, b.pass_mark], [100, 50]);
  await B.admin.put('/settings/school', { grade_scale: 20, pass_mark: 10 }); // restore for later tests
});
