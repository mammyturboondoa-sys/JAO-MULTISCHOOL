'use strict';
// Parent Access portal: registration by the administrator, sign-in by school code + phone/email, several children, isolation, notifications,
// attendance, fees + receipts, homework, announcements, messages, warning notices, password recovery.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, h2 } = require('./helpers');

let app, A, B, codeA, codeB, s1, s2, sB, reg, pc, other;
test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Par A', 'admin.pa@test.local'); await makeSchool(app, 'Par B', 'admin.pb@test.local');
  A = await seedSchool(app, 'admin.pa@test.local', 'A'); B = await seedSchool(app, 'admin.pb@test.local', 'B');
  codeA = (await app.h.get("SELECT code FROM schools WHERE name = 'Par A'")).code; codeB = (await app.h.get("SELECT code FROM schools WHERE name = 'Par B'")).code;
  s1 = await A.mk('Alice Alpha', 'G One'); s2 = await A.mk('Aaron Alpha', 'G Two'); sB = await B.mk('Bob Beta', 'G Beta');
});
test.after(() => app.stop());
const loginParent = async (code, identifier, password) => { const c = client(app); const r = await c.post('/auth/login', { school_code: code, identifier, password }); if (r.status === 200) c.csrf = r.data.csrf; return { c, r }; };

test('administrator registers a parent with two children; password shown once; must change it', async () => {
  assert.equal((await A.admin.post('/parents', { name: 'Mama', children: [{ student_id: s1.id, relationship: 'Mother' }] })).status, 400, 'phone or email needed');
  assert.equal((await A.admin.post('/parents', { name: 'Mama', phone: 'abc', children: [{ student_id: s1.id, relationship: 'Mother' }] })).status, 400);
  assert.equal((await A.admin.post('/parents', { name: 'Mama', phone: '+237 677 11 22 33', children: [{ student_id: sB.id, relationship: 'Mother' }] })).status, 400, 'a student of another school cannot be linked');
  reg = await A.admin.post('/parents', { name: 'Mama Alpha', phone: '+237 677 11 22 33', email: 'mama@alpha.test', children: [{ student_id: s1.id, relationship: 'Mother' }, { student_id: s2.id, relationship: 'Mother' }] });
  assert.equal(reg.status, 200); assert.ok(reg.data.created); assert.ok(reg.data.temporary_password); assert.equal(reg.data.linked, 2); assert.equal(reg.data.school_code, codeA);
  const again = await A.admin.post('/parents', { name: 'Mama Alpha', phone: '+237677112233', children: [{ student_id: s1.id, relationship: 'Mother' }] });
  assert.equal(again.data.created, false); assert.equal(again.data.temporary_password, null); assert.equal(again.data.id, reg.data.id, 'same phone = same account');
  const list = (await A.admin.get('/parents')).data; assert.equal(list.length, 1); assert.equal(list[0].children.length, 2);
});

test('parent signs in with school code + phone OR email; wrong school/pass fail identically', async () => {
  const pw = reg.data.temporary_password;
  const a = await loginParent(codeA, '+237 677 11 22 33', pw); assert.equal(a.r.status, 200); assert.equal(a.r.data.user.role, 'parent'); assert.equal(a.r.data.user.must_change_password, true);
  assert.equal((await loginParent(codeA, 'mama@alpha.test', pw)).r.status, 200);
  assert.equal((await loginParent(codeA, '677112233', pw)).r.status, 401, 'phone must match exactly (with country code)');
  const bad = await loginParent(codeA, '+237677112233', 'nope'); const wrongSchool = await loginParent(codeB, '+237677112233', pw);
  assert.equal(bad.r.status, 401); assert.equal(wrongSchool.r.status, 401); assert.deepEqual(bad.r.data, wrongSchool.r.data);
  assert.equal((await client(app).post('/auth/login', { school_code: codeA, identifier: 'admin.pa@test.local', password: '' })).status, 401, 'code sign-in is for parents only');
  assert.equal((await client(app).post('/auth/login', { school_code: codeA, identifier: 'admin.pa@test.local', password: require('./helpers').PW })).status, 401, 'school admins cannot use the parent door');
  // finish the first-login password change
  const c = a.c; assert.equal((await c.post('/auth/change-password', { current_password: pw, new_password: 'Parent-New-Pass1!' })).status, 200);
  pc = (await loginParent(codeA, '+237677112233', 'Parent-New-Pass1!')); assert.equal(pc.r.status, 200); pc = pc.c;
});

test('parent sees only own children; other parents and other schools see nothing', async () => {
  const kids = (await pc.get('/parent/children')).data; assert.deepEqual(kids.map((k) => k.full_name).sort(), ['Aaron Alpha', 'Alice Alpha']);
  const o = await A.admin.post('/parents', { name: 'Other Parent', email: 'other@alpha.test', children: [{ student_id: s2.id, relationship: 'Father' }] });
  await app.h.run('UPDATE users SET must_change_password = 0 WHERE id = ?', o.data.id); other = (await loginParent(codeA, 'other@alpha.test', o.data.temporary_password)).c;
  assert.deepEqual((await other.get('/parent/children')).data.map((k) => k.full_name), ['Aaron Alpha']);
  for (const p of [`/students/${s1.id}/attendance`, `/students/${s1.id}/fees`, `/students/${s1.id}/homework`, `/students/${s1.id}/warnings`, `/parent/children/${s1.id}/summary`]) assert.equal((await other.get(p)).status, 404, p);
  assert.equal((await pc.get(`/students/${sB.id}/fees`)).status, 404);
  for (const p of ['/parents', '/fees/overview', '/messages/threads']) assert.equal((await pc.get(p)).status, 403, p);
  assert.equal((await pc.post('/parents', { name: 'x', phone: '+237600000001', children: [{ student_id: s1.id, relationship: 'Mother' }] })).status, 403);
  assert.equal((await pc.post('/announcements', { title: 'x', body: 'y' })).status, 403);
  assert.equal((await pc.post('/attendance', { student_id: s1.id, status: 'absent' })).status, 403);
});

const unread = async (c) => (await c.get('/notifications')).data.items.map((i) => i.kind);

test('attendance, report publication and warnings notify the parents', async () => {
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await A.admin.post('/attendance', { student_id: s1.id, day, status: 'absent' })).data.notified, 1);
  assert.equal((await A.admin.post('/attendance', { student_id: s2.id, day, status: 'late', minutes_late: 15 })).status, 200);
  assert.equal((await A.admin.post('/attendance', { student_id: s1.id, day: '2999-01-01', status: 'absent' })).status, 400, 'no future dates');
  const att = (await pc.get(`/students/${s1.id}/attendance`)).data; assert.equal(att.absences, 1);
  assert.equal((await other.get(`/students/${s2.id}/attendance`)).data.lates, 1);
  const kinds = await unread(pc); assert.ok(kinds.includes('child_absent') && kinds.includes('child_late'));
  assert.ok(!(await unread(other)).includes('child_absent'), 'the other parent is not told about Alice');
  // teacher with no class cannot record; discipline warning needs the permission
  const t = (await A.admin.post('/users', { role: 'teacher', name: 'Plain T', email: 'plain.t@test.local' })).data; await h2(app, t.id); const tc = client(app); await tc.login('plain.t@test.local', t.temporary_password);
  assert.equal((await tc.post('/attendance', { student_id: s1.id, status: 'absent' })).status, 404);
  assert.equal((await tc.post(`/students/${s1.id}/warnings`, { title: 'x', message: 'y' })).status, 403);
  assert.equal((await A.admin.post(`/students/${s1.id}/warnings`, { title: 'Phone in class', message: 'First written warning.' })).data.notified, 1);
  assert.equal((await pc.get(`/students/${s1.id}/warnings`)).data[0].title, 'Phone in class');
  assert.ok((await unread(pc)).includes('child_warning'));
  // report card approval -> report_published
  const asm = (await A.admin.post('/assessments', { class_id: A.cls, subject_id: A.maths, term_id: A.term, name: 'T1', type: 'test', max_score: 20, date: '2026-10-01' })).data.id;
  await A.admin.put(`/assessments/${asm}/grades`, { entries: [{ student_id: s1.id, score: 15 }] });
  const ap = await A.admin.post('/reports/approve', { student_id: s1.id, term_id: A.term });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.ok((await unread(pc)).includes('report_published'));
});

test('fees: charges, payments, receipts, balances, reminders; overpayment refused', async () => {
  const due = '2000-01-01';
  assert.equal((await A.admin.post('/fees/charges', { title: 'Tuition T1', amount: 50000, due_date: due, class_id: A.cls })).data.students, 2);
  const f = (await pc.get(`/students/${s1.id}/fees`)).data; assert.equal(f.balance, 50000); assert.equal(f.charges[0].overdue, true);
  const cid = f.charges[0].id;
  assert.equal((await A.admin.post(`/fees/charges/${cid}/payments`, { amount: 60000, method: 'cash' })).status, 400, 'overpayment');
  const pay = await A.admin.post(`/fees/charges/${cid}/payments`, { amount: 20000, method: 'mobile_money', reference: 'MM9' }); assert.equal(pay.status, 200); assert.match(pay.data.receipt_no, /^R\d{4}-\d{5}$/);
  assert.equal((await pc.get(`/students/${s1.id}/fees`)).data.balance, 30000);
  const rc = await pc.get(`/fees/payments/${pay.data.id}/receipt`); assert.equal(rc.status, 200); assert.match(rc.headers.get('content-type'), /pdf/);
  assert.equal((await other.get(`/fees/payments/${pay.data.id}/receipt`)).status, 404, "another parent cannot open Alice's receipt");
  assert.equal((await B.admin.get(`/fees/payments/${pay.data.id}/receipt`)).status, 404, 'another school cannot');
  const ov = (await A.admin.get('/fees/overview?owing=1')).data; assert.equal(ov.balance, 80000); assert.equal(ov.rows.length, 2);
  const rem = await A.admin.post('/fees/remind', {}); assert.equal(rem.data.students, 2); assert.ok((await unread(pc)).includes('fee_due'));
  assert.equal((await B.admin.post(`/fees/charges/${cid}/payments`, { amount: 1, method: 'cash' })).status, 404);
});

test('homework, announcements, messages, password recovery', async () => {
  assert.equal((await A.admin.post('/homework', { class_id: A.cls, title: 'Exercises 1-5', due_date: '2999-01-01', subject_id: A.maths })).status, 200);
  assert.equal((await A.admin.post('/homework', { class_id: 999999, title: 'x', due_date: '2999-01-01' })).status, 400);
  assert.equal((await pc.get(`/students/${s1.id}/homework`)).data[0].title, 'Exercises 1-5');
  assert.equal((await A.admin.post('/announcements', { title: 'Exams', body: 'Start Monday', important: true })).data.notified, 2);
  assert.equal((await A.admin.post('/announcements', { title: 'Parents only', body: 'PTA', audience: 'parents' })).status, 200);
  assert.equal((await pc.get('/announcements')).data.length, 2); assert.ok((await unread(pc)).includes('announcement_important'));
  assert.equal((await B.admin.get('/announcements')).data.length, 0, 'announcements are per school');
  assert.equal((await pc.post('/messages', { body: 'Hello, question about fees', student_id: s1.id })).status, 200);
  assert.equal((await pc.post('/messages', { body: 'x', student_id: sB.id })).status, 404);
  const th = (await A.admin.get('/messages/threads')).data; assert.equal(th.length, 1); assert.equal(th[0].unread, 1);
  assert.equal((await A.admin.post(`/messages/threads/${th[0].parent_id}`, { body: 'Please visit the office.' })).status, 200);
  assert.equal((await pc.get('/messages')).data.length, 2); assert.equal((await other.get('/messages')).data.length, 0);
  assert.equal((await B.admin.get(`/messages/threads/${th[0].parent_id}`)).status, 404);
  // notifications carry a preview of the message that was written
  const adminNote = (await A.admin.get('/notifications')).data.items.find((n) => n.kind === 'message_from_parent');
  assert.equal(adminNote.data.preview, 'Hello, question about fees');
  const parentNote = (await pc.get('/notifications')).data.items.find((n) => n.kind === 'message_from_school');
  assert.equal(parentNote.data.preview, 'Please visit the office.');
  assert.equal((await pc.get('/notifications')).data.items.find((n) => n.kind === 'announcement_important').data.preview, 'Start Monday');
  // recovery: same answer whether or not the account exists; admins are told
  const ok = await client(app).post('/auth/forgot', { school_code: codeA, identifier: '+237677112233' }), no = await client(app).post('/auth/forgot', { school_code: codeA, identifier: 'nobody@x.test' });
  assert.deepEqual(ok.data, no.data); assert.ok((await unread(A.admin)).includes('parent_reset_request'));
  const rs = await A.admin.post(`/parents/${reg.data.id}/reset-password`, {}); assert.ok(rs.data.temporary_password);
  assert.equal((await loginParent(codeA, '+237677112233', 'Parent-New-Pass1!')).r.status, 401, 'old password stops working');
  assert.equal((await loginParent(codeA, '+237677112233', rs.data.temporary_password)).r.status, 200);
  assert.equal((await A.admin.put(`/parents/${reg.data.id}`, { active: false })).status, 200);
  assert.equal((await loginParent(codeA, '+237677112233', rs.data.temporary_password)).r.status, 401, 'deactivated');
  assert.equal((await A.admin.del(`/parents/${reg.data.id}/children/${s2.id}`)).status, 200);
});
