'use strict';
// Discipline module, phase 6: optional, school-controlled section on the report card.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, h2 } = require('./helpers');

let app, A, officer, principal, member, sA, sQ, today, kase, parentC, studentC;
const SECRET = 'SECRET-COUNCIL-DISCUSSION-ZZZ', FINDINGS = 'SECRET-FINDINGS-QQQ', DESC = 'PRIVATE-INCIDENT-DESCRIPTION-KKK', NOTE = 'PRIVATE-FOLLOWUP-NOTE-MMM';

test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Rep A', 'admin.ra@test.local');
  A = await seedSchool(app, 'admin.ra@test.local', 'A');
  const mk = async (email, role, name, perms) => { const u = (await A.admin.post('/users', { role, name, email })).data; await h2(app, u.id); const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200);
    if (perms) await A.admin.put(`/discipline/staff/${u.id}/permissions`, { permissions: perms }); return { id: u.id, c }; };
  officer = await mk('officer.ra@test.local', 'teacher', 'Officer', ['manage_discipline']);
  principal = await mk('principal.ra@test.local', 'teacher', 'Principal', ['approve_decisions']);
  member = await mk('member.ra@test.local', 'teacher', 'Member', ['council_member']);
  sA = await A.mk('Alice Alpha', 'G Alpha'); sQ = await A.mk('Quiet Kid', 'G Quiet');
  today = new Date().toISOString().slice(0, 10);
  // parent account linked to Alice
  const pu = (await A.admin.post('/users', { role: 'parent', name: 'Mum', email: 'mum.ra@test.local' })).data; await h2(app, pu.id);
  const g = (await app.h.get('SELECT guardian_id FROM student_guardians WHERE student_id = ?', sA.id)).guardian_id;
  await app.h.run('UPDATE guardians SET user_id = ? WHERE id = ?', pu.id, g);
  parentC = client(app); assert.equal((await parentC.login('mum.ra@test.local', pu.temporary_password)).status, 200);
  // academic data so that the report can be approved and seen by parents
  const a = (await A.admin.post('/assessments', { class_id: A.cls, subject_id: A.maths, term_id: A.term, name: 'T', type: 'test', max_score: 20, date: '2026-10-01' })).data.id;
  await A.admin.put(`/assessments/${a}/grades`, { entries: [{ student_id: sA.id, score: 14 }, { student_id: sQ.id, score: 12 }] });
});
test.after(() => app.stop());

const cat = async (sev) => (await A.admin.get('/discipline/categories')).data.find((x) => x.severity === sev).id;
const card = async (who, sid = sA.id) => who.get(`/reports/card?student_id=${sid}&term_id=${A.term}`);

test('both switches are OFF by default: nothing appears on the report card', async () => {
  const inc = (await officer.c.post('/discipline/incidents', { student_id: sA.id, category_id: await cat('serious'), occurred_date: today, occurred_time: '10:00', description: DESC })).data.id;
  assert.equal((await officer.c.put(`/discipline/incidents/${inc}`, { status: 'action_taken' })).status, 200);
  await officer.c.post(`/discipline/students/${sA.id}/followups`, { note: NOTE, trend: 'concerning' });
  const r = (await card(A.admin)).data;
  assert.equal(r.discipline, null);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE-|SECRET-/);
  // council + approved decision + approved sanction exist
  const meeting = (await officer.c.post('/discipline/council/meetings', { title: 'Council', meeting_date: today, meeting_time: '14:00', location: 'Room', members: [{ user_id: member.id, council_role: 'chair' }] })).data.id;
  kase = (await officer.c.post(`/discipline/council/meetings/${meeting}/cases`, { student_id: sA.id, incident_ids: [inc] })).data.id;
  assert.equal((await member.c.put(`/discipline/council/cases/${kase}`, { discussion: SECRET, findings: FINDINGS })).status, 200);
  assert.equal((await member.c.put(`/discipline/council/cases/${kase}/decision`, { decision_text: 'Two-day suspension.', decided_on: today, approver_id: principal.id })).status, 200);
  const dec = (await officer.c.get('/discipline/decisions')).data[0];
  assert.equal((await principal.c.post(`/discipline/council/decisions/${dec.id}/approve`, { approve: true })).status, 200);
  const susp = (await officer.c.get('/discipline/sanction-types')).data.find((t) => t.has_duration).id;
  const sid = (await officer.c.post('/discipline/sanctions', { student_id: sA.id, sanction_type_id: susp, reason: 'PRIVATE-REASON', imposed_on: today, duration_days: 2, decision_id: dec.id })).data.id;
  assert.equal((await principal.c.post(`/discipline/sanctions/${sid}/approve`, { approve: true })).status, 200);
  assert.equal((await card(A.admin)).data.discipline, null, 'still off');
});

test('switch on: only confirmed counts and approved decisions/sanctions; never confidential text', async () => {
  assert.equal((await A.admin.put('/discipline/settings', { report_show_conduct: true })).status, 200);
  let r = (await card(A.admin)).data;
  assert.deepEqual(r.discipline.conduct, { incidents: 1, serious: 1 }); assert.equal(r.discipline.decisions, undefined, 'decisions switch is separate');
  assert.equal((await A.admin.put('/discipline/settings', { report_show_decisions: true })).status, 200);
  r = (await card(A.admin)).data;
  assert.equal(r.discipline.decisions.length, 1); assert.equal(r.discipline.decisions[0].decision_text, 'Two-day suspension.'); assert.equal(r.discipline.decisions[0].sanctions[0].duration_days, 2);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE-|SECRET-/, 'no description, notes, discussion, findings or sanction reason');
  const q = (await card(A.admin, sQ.id)).data; assert.deepEqual(q.discipline.conduct, { incidents: 0, serious: 0 }); assert.deepEqual(q.discipline.decisions, []);
});

test('open or dismissed incidents and unapproved decisions are not counted', async () => {
  const c = await cat('minor');
  const i1 = (await officer.c.post('/discipline/incidents', { student_id: sQ.id, category_id: c, occurred_date: today, occurred_time: '09:00', description: 'Talking during the lesson repeatedly.' })).data.id;
  assert.deepEqual((await card(A.admin, sQ.id)).data.discipline.conduct, { incidents: 0, serious: 0 }, 'only reported');
  await officer.c.put(`/discipline/incidents/${i1}`, { status: 'dismissed' });
  assert.equal((await card(A.admin, sQ.id)).data.discipline.conduct.incidents, 0);
  const r2 = await officer.c.post('/discipline/incidents', { student_id: sQ.id, category_id: c, occurred_date: today, occurred_time: '09:30', description: 'Left the classroom without permission.' }); assert.equal(r2.status, 200, JSON.stringify(r2.data)); const i2 = r2.data.id;
  assert.equal((await officer.c.put(`/discipline/incidents/${i2}`, { status: 'closed' })).status, 200);
  assert.equal((await card(A.admin, sQ.id)).data.discipline.conduct.incidents, 1, 'only the closed one counts');
});

test('parents see the section only on an approved report, only for their child', async () => {
  assert.equal((await card(parentC)).status, 404, 'report not approved yet');
  assert.equal((await A.admin.post('/reports/approve', { student_id: sA.id, term_id: A.term, approve: true })).status, 200);
  const r = await card(parentC); assert.equal(r.status, 200); assert.equal(r.data.discipline.conduct.incidents, 1); assert.doesNotMatch(JSON.stringify(r.data), /PRIVATE-|SECRET-/);
  assert.equal((await card(parentC, sQ.id)).status, 404, 'not their child');
  await A.admin.put('/discipline/settings', { report_show_conduct: false, report_show_decisions: false });
  assert.equal((await card(parentC)).data.discipline, null, 'switching off hides it again');
});
