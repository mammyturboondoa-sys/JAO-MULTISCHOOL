'use strict';
// Discipline module, phase 4: convocations, official PDF, tracking, isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, h2 } = require('./helpers');

let app, A, B, officer, principal, plain, parent, sA, sB, today;
test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Conv A', 'admin.va@test.local'); await makeSchool(app, 'Conv B', 'admin.vb@test.local');
  A = await seedSchool(app, 'admin.va@test.local', 'A'); B = await seedSchool(app, 'admin.vb@test.local', 'B');
  const mk = async (email, role, name, perms) => { const u = (await A.admin.post('/users', { role, name, email })).data; await h2(app, u.id); const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200);
    if (perms) await A.admin.put(`/discipline/staff/${u.id}/permissions`, { permissions: perms }); return { id: u.id, c }; };
  officer = await mk('officer.va@test.local', 'teacher', 'Officer', ['manage_discipline']);
  principal = await mk('principal.va@test.local', 'teacher', 'Principal', ['approve_decisions']);
  plain = await mk('plain.va@test.local', 'teacher', 'Plain');
  parent = await mk('parent.va@test.local', 'parent', 'Parent');
  sA = await A.mk('Alice Alpha', 'G Alpha'); sB = await B.mk('Bob Beta', 'G Beta');
  today = new Date().toISOString().slice(0, 10);
});
test.after(() => app.stop());

const BODY = (sid, extra = {}) => ({ student_id: sid, recipient_name: 'Mr Alpha', meet_date: '2030-01-15', meet_time: '09:30', location: 'Principal office', reason_for_parent: 'Repeated lateness. Accents: é à ç œ.', ...extra });
let conv;

test('only officers/admin create; validation; no cross-school student', async () => {
  assert.equal((await plain.c.post('/discipline/convocations', BODY(sA.id))).status, 403);
  assert.equal((await parent.c.post('/discipline/convocations', BODY(sA.id))).status, 403);
  assert.equal((await principal.c.post('/discipline/convocations', BODY(sA.id))).status, 403, 'approver alone cannot create');
  assert.equal((await officer.c.post('/discipline/convocations', BODY(sB.id))).status, 400, 'student of another school');
  assert.equal((await officer.c.post('/discipline/convocations', BODY(sA.id, { meet_time: '25:00' }))).status, 400);
  assert.equal((await officer.c.post('/discipline/convocations', BODY(sA.id, { reason_for_parent: '' }))).status, 400);
  assert.equal((await officer.c.post('/discipline/convocations', BODY(sA.id, { guardian_id: 999999 }))).status, 400);
  const r = await officer.c.post('/discipline/convocations', BODY(sA.id));
  assert.equal(r.status, 200); assert.match(r.data.reference, /^CONV-\d{4}-0001$/); conv = r.data.id;
});

test('approval: officer cannot approve; principal can; locked afterwards', async () => {
  assert.equal((await officer.c.post(`/discipline/convocations/${conv}/approve`, { approve: true })).status, 403);
  assert.equal((await principal.c.post(`/discipline/convocations/${conv}/approve`, { approve: false })).status, 400, 'rejection needs a comment');
  assert.equal((await principal.c.post(`/discipline/convocations/${conv}/approve`, { approve: true })).status, 200);
  assert.equal((await officer.c.put(`/discipline/convocations/${conv}`, { location: 'x' })).status, 400, 'approved letters are locked');
  assert.equal((await principal.c.post(`/discipline/convocations/${conv}/approve`, { approve: true })).status, 400);
  assert.equal((await A.admin.get(`/discipline/convocations/${conv}`)).data.status, 'approved');
});

test('PDF: real A4 PDF in English and French, authenticated, school-scoped', async () => {
  for (const lang of ['en', 'fr']) {
    const r = await officer.c.get(`/discipline/convocations/${conv}/pdf?lang=${lang}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/pdf/); assert.match(r.headers.get('content-disposition'), /attachment/);
    const buf = Buffer.from(r.data); assert.equal(buf.slice(0, 5).toString(), '%PDF-'); assert.match(buf.slice(-8).toString(), /%%EOF/);
    assert.match(buf.toString('latin1'), /MediaBox \[0 0 595 842\]/);
  }
  assert.equal((await plain.c.get(`/discipline/convocations/${conv}/pdf`)).status, 403);
  assert.equal((await parent.c.get(`/discipline/convocations/${conv}/pdf`)).status, 403);
  assert.equal((await B.admin.get(`/discipline/convocations/${conv}/pdf`)).status, 404);
  assert.equal((await client(app).get(`/discipline/convocations/${conv}/pdf`)).status, 401);
});

test('tracking: handover is a manual record; response, postpone, complete; history', async () => {
  assert.equal((await officer.c.post(`/discipline/convocations/${conv}/handover`, { method: 'whatsapp' })).status, 400, 'no pretend channels');
  assert.equal((await officer.c.post(`/discipline/convocations/${conv}/handover`, { method: 'hand_delivered' })).status, 200);
  assert.equal((await officer.c.post(`/discipline/convocations/${conv}/response`, { parent_response: 'unable', response_note: 'Travelling' })).status, 200);
  assert.equal((await officer.c.post(`/discipline/convocations/${conv}/status`, { status: 'postponed', comment: 'Parent travelling' })).status, 400, 'needs a new date');
  assert.equal((await officer.c.post(`/discipline/convocations/${conv}/status`, { status: 'postponed', comment: 'Parent travelling', meet_date: '2030-01-22', meet_time: '10:00' })).status, 200);
  assert.equal((await officer.c.post(`/discipline/convocations/${conv}/response`, { parent_response: 'attending', attended: true, outcome: 'Agreed a plan.' })).status, 200);
  assert.equal((await officer.c.post(`/discipline/convocations/${conv}/status`, { status: 'completed' })).status, 200);
  const d = (await A.admin.get(`/discipline/convocations/${conv}`)).data;
  assert.equal(d.status, 'completed'); assert.equal(d.meet_date, '2030-01-22'); assert.equal(d.handed_over_method, 'hand_delivered'); assert.equal(d.attended, true);
  assert.deepEqual(d.events.map((e) => e.event), ['created', 'approved', 'handover_hand_delivered', 'response_recorded', 'postponed', 'response_recorded', 'completed']);
  const hist = (await officer.c.get(`/discipline/students/${sA.id}/history`)).data;
  assert.equal(hist.convocations.length, 1);
});

test('rejected and cancelled letters are not issued; school separation in lists', async () => {
  const id = (await officer.c.post('/discipline/convocations', BODY(sA.id))).data.id;
  assert.equal((await principal.c.post(`/discipline/convocations/${id}/approve`, { approve: false, comment: 'Wrong date' })).status, 200);
  assert.equal((await officer.c.get(`/discipline/convocations/${id}/pdf`)).status, 400);
  assert.equal((await B.admin.get('/discipline/convocations')).data.length, 0);
  assert.equal((await B.admin.get(`/discipline/convocations/${conv}`)).status, 404);
  assert.equal((await B.admin.post(`/discipline/convocations/${conv}/handover`, { method: 'printed' })).status, 404);
  assert.equal((await A.admin.get('/discipline/convocations')).data.length, 2);
  assert.ok((await app.h.get("SELECT COUNT(*) n FROM audit_log WHERE action = 'convocation_pdf_generated'")).n >= 2);
});

test('phase 5: in-app notices, parent view, and honest message preparation', async () => {
  // a linked parent account with a guardian that has a phone and email
  const pu = (await A.admin.post('/users', { role: 'parent', name: 'Linked Parent', email: 'lp.va@test.local' })).data; await h2(app, pu.id);
  const lp = client(app); assert.equal((await lp.login('lp.va@test.local', pu.temporary_password)).status, 200);
  const st = await A.mk('Dora Delta', 'G Delta');
  const g = (await app.h.get('SELECT guardian_id FROM student_guardians WHERE student_id = ?', st.id)).guardian_id;
  await app.h.run('UPDATE guardians SET user_id = ?, phone = ?, email = ? WHERE id = ?', pu.id, '+237 677 12 34 56', 'dad@example.com', g);
  const id = (await officer.c.post('/discipline/convocations', BODY(st.id, { guardian_id: g }))).data.id;
  assert.equal((await lp.get('/parent/convocations')).data.length, 0, 'drafts are invisible to parents');
  assert.equal((await lp.get(`/parent/convocations/${id}/pdf`)).status, 404);
  assert.equal((await officer.c.post(`/discipline/convocations/${id}/prepare`, { channel: 'whatsapp' })).status, 400, 'not approved yet');
  assert.equal((await principal.c.post(`/discipline/convocations/${id}/approve`, { approve: true })).status, 200);
  // notice stored for the parent only
  const n = (await lp.get('/notifications')).data; assert.equal(n.unread, 1); assert.equal(n.items[0].kind, 'convocation_issued');
  assert.equal((await parent.c.get('/notifications')).data.unread, 0, 'an unrelated parent gets nothing');
  assert.equal((await lp.post(`/notifications/${n.items[0].id}/read`)).status, 200); assert.equal((await lp.get('/notifications')).data.unread, 0);
  // parent sees only own child, with no internal fields, and can download the letter
  const list = (await lp.get('/parent/convocations')).data; assert.equal(list.length, 1); assert.equal(list[0].decision_comment, undefined); assert.equal(list[0].created_by_name, undefined);
  const pdf = await lp.get(`/parent/convocations/${id}/pdf?lang=fr`); assert.equal(pdf.status, 200); assert.equal(Buffer.from(pdf.data).slice(0, 5).toString(), '%PDF-');
  assert.equal((await parent.c.get(`/parent/convocations/${id}/pdf`)).status, 404, 'other parents cannot read it');
  assert.equal((await lp.get('/discipline/convocations')).status, 403);
  // prepared messages: real links, status only "prepared", never "delivered"
  const w = (await officer.c.post(`/discipline/convocations/${id}/prepare`, { channel: 'whatsapp', lang: 'en' })).data;
  assert.match(w.url, /^https:\/\/wa\.me\/237677123456\?text=/); assert.equal(w.status, 'prepared');
  assert.match(w.text, /CONV-/); assert.doesNotMatch(w.text, /Repeated lateness/, 'the reason is not put in a chat message');
  assert.match((await officer.c.post(`/discipline/convocations/${id}/prepare`, { channel: 'email' })).data.url, /^mailto:dad%40example\.com/);
  assert.equal((await officer.c.post(`/discipline/convocations/${id}/prepare`, { channel: 'fax' })).status, 400);
  const d = (await officer.c.get(`/discipline/convocations/${id}`)).data; assert.equal(d.dispatches.length, 2); assert.ok(d.dispatches.every((x) => x.status === 'prepared'));
  // postponing notifies again
  assert.equal((await officer.c.post(`/discipline/convocations/${id}/status`, { status: 'postponed', comment: 'x', meet_date: '2030-03-01', meet_time: '08:00' })).status, 200);
  const n2 = (await lp.get('/notifications')).data; assert.equal(n2.items[0].kind, 'convocation_postponed'); assert.equal(n2.items[0].data.date, '2030-03-01');
  // another school's admin sees none of it
  assert.equal((await B.admin.get('/notifications')).data.items.length, 0);
});
