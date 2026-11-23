'use strict';
// Discipline module, phase 3: council meetings, confidential record, decisions and approval, sanctions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, h2 } = require('./helpers');

let app, A, B, reporter, officer, principal, principal2, memberX, memberY, plain, parent, sA, sA2, sB, cat, incident, meeting, kase, decision, today;
const SECRET = 'SECRET-DISCUSSION-moustafa-said-this';
const SECRET2 = 'SECRET-FINDINGS-xyz';

test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Cou A', 'admin.ca@test.local'); await makeSchool(app, 'Cou B', 'admin.cb@test.local');
  A = await seedSchool(app, 'admin.ca@test.local', 'A'); B = await seedSchool(app, 'admin.cb@test.local', 'B');
  const mk = async (email, role, name, perms) => { const u = (await A.admin.post('/users', { role, name, email })).data; await h2(app, u.id); const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200);
    if (perms) await A.admin.put(`/discipline/staff/${u.id}/permissions`, { permissions: perms }); return { id: u.id, c }; };
  reporter = { c: client(app), id: A.teacherId }; assert.equal((await reporter.c.login('teacher.A@test.local', A.teacherPw)).status, 200);
  officer = await mk('officer.ca@test.local', 'teacher', 'Officer', ['manage_discipline']);
  principal = await mk('principal.ca@test.local', 'teacher', 'Principal', ['approve_decisions']);
  principal2 = await mk('principal2.ca@test.local', 'teacher', 'Principal Two', ['approve_decisions']);
  memberX = await mk('memberx.ca@test.local', 'teacher', 'Member X', ['council_member']);
  memberY = await mk('membery.ca@test.local', 'teacher', 'Member Y', ['council_member']);
  plain = await mk('plain.ca@test.local', 'teacher', 'Plain Teacher');
  parent = await mk('parent.ca@test.local', 'parent', 'Parent');
  sA = await A.mk('Alice Alpha', 'G Alpha'); sA2 = await A.mk('Carol Gamma', 'G Gamma'); sB = await B.mk('Bob Beta', 'G Beta');
  cat = (await A.admin.get('/discipline/categories')).data[0].id;
  today = new Date().toISOString().slice(0, 10);
  incident = (await reporter.c.post('/discipline/incidents', { student_id: sA.id, category_id: cat, occurred_date: today, occurred_time: '10:00', description: 'Serious fight in the yard.' })).data.id;
});
test.after(() => app.stop());

const MEET = (extra = {}) => ({ title: 'Council Term 1', meeting_date: today, meeting_time: '14:00', location: 'Conference room', ...extra });

test('officer schedules a meeting and registers members; ineligible people are refused', async () => {
  assert.equal((await plain.c.post('/discipline/council/meetings', MEET())).status, 403);
  assert.equal((await parent.c.post('/discipline/council/meetings', MEET())).status, 403);
  assert.equal((await officer.c.post('/discipline/council/meetings', MEET({ title: '' }))).status, 400);
  assert.equal((await officer.c.post('/discipline/council/meetings', MEET({ meeting_time: '99:99' }))).status, 400);
  assert.equal((await officer.c.post('/discipline/council/meetings', MEET({ members: [{ user_id: plain.id }] }))).status, 400, 'no council_member permission');
  assert.equal((await officer.c.post('/discipline/council/meetings', MEET({ members: [{ user_id: 999999 }] }))).status, 400);
  const bUser = (await B.admin.post('/users', { role: 'teacher', name: 'B Member', email: 'bmember@test.local' })).data;
  await B.admin.put(`/discipline/staff/${bUser.id}/permissions`, { permissions: ['council_member'] });
  assert.equal((await officer.c.post('/discipline/council/meetings', MEET({ members: [{ user_id: bUser.id }] }))).status, 400, 'another school\'s teacher');
  const r = await officer.c.post('/discipline/council/meetings', MEET({ members: [{ user_id: memberX.id, council_role: 'chair' }] }));
  assert.equal(r.status, 200, JSON.stringify(r.data)); meeting = r.data.id;
  const people = (await officer.c.get('/discipline/council/people')).data;
  assert.ok(people.members.some((m) => m.id === memberX.id) && !people.members.some((m) => m.id === plain.id)); assert.ok(people.approvers.some((m) => m.id === principal.id));
});

test('who can see the meeting: officer, administrator and assigned members only', async () => {
  for (const who of [officer, { c: A.admin }, memberX]) assert.equal((await who.c.get(`/discipline/council/meetings/${meeting}`)).status, 200);
  assert.equal((await memberY.c.get(`/discipline/council/meetings/${meeting}`)).status, 404, 'council member who is not assigned');
  assert.equal((await plain.c.get(`/discipline/council/meetings/${meeting}`)).status, 403);
  assert.equal((await principal.c.get(`/discipline/council/meetings/${meeting}`)).status, 403);
  assert.equal((await reporter.c.get('/discipline/council/meetings')).status, 403);
  assert.equal((await parent.c.get('/discipline/council/meetings')).status, 403);
  assert.equal((await B.admin.get(`/discipline/council/meetings/${meeting}`)).status, 404);
  assert.equal((await memberX.c.get('/discipline/council/meetings')).data.length, 1);
  assert.equal((await memberY.c.get('/discipline/council/meetings')).data.length, 0);
  assert.equal((await officer.c.get('/discipline/council/meetings')).data.length, 1);
  assert.equal((await B.admin.get('/discipline/council/meetings')).data.length, 0);
});

test('cases link a student with that student\'s own incidents only', async () => {
  assert.equal((await memberX.c.post(`/discipline/council/meetings/${meeting}/cases`, { student_id: sA.id })).status, 403, 'members do not build the agenda');
  assert.equal((await officer.c.post(`/discipline/council/meetings/${meeting}/cases`, { student_id: sB.id })).status, 400, 'other school');
  assert.equal((await officer.c.post(`/discipline/council/meetings/${meeting}/cases`, { student_id: sA2.id, incident_ids: [incident] })).status, 400, 'incident of another student');
  const r = await officer.c.post(`/discipline/council/meetings/${meeting}/cases`, { student_id: sA.id, incident_ids: [incident] });
  assert.equal(r.status, 200, JSON.stringify(r.data)); kase = r.data.id;
  assert.equal((await officer.c.post(`/discipline/council/meetings/${meeting}/cases`, { student_id: sA.id })).status, 400, 'one case per student per meeting');
  const m = (await officer.c.get(`/discipline/council/meetings/${meeting}`)).data;
  assert.equal(m.cases.length, 1); assert.equal(m.can_run, true); assert.equal(m.can_record, false);
});

test('council discussion and findings are confidential: only the administrator and assigned members', async () => {
  assert.equal((await memberX.c.put(`/discipline/council/cases/${kase}`, { discussion: SECRET, findings: SECRET2 })).status, 200);
  assert.equal((await officer.c.put(`/discipline/council/cases/${kase}`, { discussion: 'x' })).status, 403);
  assert.equal((await memberY.c.put(`/discipline/council/cases/${kase}`, { discussion: 'x' })).status, 404);
  assert.equal((await plain.c.put(`/discipline/council/cases/${kase}`, { discussion: 'x' })).status, 403);
  const mx = (await memberX.c.get(`/discipline/council/cases/${kase}`)).data;
  assert.equal(mx.discussion, SECRET); assert.equal(mx.findings, SECRET2); assert.equal(mx.can_record, true);
  assert.equal((await A.admin.get(`/discipline/council/cases/${kase}`)).data.discussion, SECRET);
  const off = await officer.c.get(`/discipline/council/cases/${kase}`);
  assert.equal(off.status, 200); assert.equal('discussion' in off.data, false); assert.ok(!JSON.stringify(off.data).includes('SECRET'));
  assert.equal(off.data.incidents.length, 1, 'officer still sees the case facts');
  assert.equal((await memberY.c.get(`/discipline/council/cases/${kase}`)).status, 404);
  assert.equal((await principal.c.get(`/discipline/council/cases/${kase}`)).status, 403);
  assert.equal((await reporter.c.get(`/discipline/council/cases/${kase}`)).status, 403);
  assert.equal((await B.admin.get(`/discipline/council/cases/${kase}`)).status, 404);
  // losing the permission removes access at once, even though the person is still on the member list
  await A.admin.put(`/discipline/staff/${memberX.id}/permissions`, { permissions: [] });
  assert.equal((await memberX.c.get(`/discipline/council/cases/${kase}`)).status, 403);
  await A.admin.put(`/discipline/staff/${memberX.id}/permissions`, { permissions: ['council_member'] });
  assert.equal((await memberX.c.get(`/discipline/council/cases/${kase}`)).status, 200);
});

test('the confidential text never appears in logs, lists or the student history', async () => {
  const sid = (await app.h.get("SELECT id FROM schools WHERE name = 'Cou A'")).id;
  const audits = JSON.stringify(await app.h.all('SELECT * FROM audit_log WHERE school_id = ?', sid));
  assert.ok(!audits.includes('SECRET')); assert.ok(audits.includes('council_case_notes_updated') && audits.includes('council_case_viewed'));
  for (const url of ['/discipline/decisions', '/discipline/council/meetings', `/discipline/students/${sA.id}/history`, '/discipline/incidents', '/discipline/sanctions']) {
    assert.ok(!JSON.stringify((await officer.c.get(url)).data).includes('SECRET'), url);
    assert.ok(!JSON.stringify((await principal.c.get(url)).data || {}).includes('SECRET'), url);
  }
});

test('decisions: recorded by the council, approved only by the named principal (or the administrator), then locked', async () => {
  const D = (extra = {}) => ({ decision_text: 'Three-day suspension recommended.', decided_on: today, approver_id: principal.id, follow_up: 'Meet the parents next week.', ...extra });
  assert.equal((await officer.c.put(`/discipline/council/cases/${kase}/decision`, D())).status, 403, 'discipline officer is not on the council');
  assert.equal((await memberX.c.put(`/discipline/council/cases/${kase}/decision`, D({ approver_id: officer.id }))).status, 400, 'approver must hold approval rights');
  assert.equal((await memberX.c.put(`/discipline/council/cases/${kase}/decision`, D({ decision_text: '' }))).status, 400);
  assert.equal((await memberX.c.put(`/discipline/council/cases/${kase}/decision`, D({ decided_on: 'soon' }))).status, 400);
  assert.equal((await memberX.c.put(`/discipline/council/cases/${kase}/decision`, D())).status, 200);
  decision = (await officer.c.get('/discipline/decisions')).data[0];
  assert.equal(decision.status, 'draft'); assert.equal(decision.approver_name, 'Principal'); assert.equal(decision.can_approve, false);
  assert.equal((await principal.c.get('/discipline/decisions')).data[0].can_approve, true);
  // approval rules
  const ap = (who, body) => who.c.post(`/discipline/council/decisions/${decision.id}/approve`, body);
  assert.equal((await ap(officer, { approve: true })).status, 403); assert.equal((await ap(memberX, { approve: true })).status, 403);
  assert.equal((await ap(principal2, { approve: true })).status, 403, 'a different principal is not the named approver');
  assert.equal((await ap({ c: B.admin }, { approve: true })).status, 404);
  assert.equal((await ap(principal, { approve: false })).status, 400, 'rejecting needs a reason');
  assert.equal((await ap(principal, { approve: false, comment: 'Please revisit the duration.' })).status, 200);
  assert.equal((await officer.c.get('/discipline/decisions')).data[0].status, 'rejected');
  assert.equal((await memberX.c.put(`/discipline/council/cases/${kase}/decision`, D({ decision_text: 'Two-day suspension recommended.' }))).status, 200, 'council may amend a rejected decision');
  assert.equal((await officer.c.get('/discipline/decisions')).data[0].status, 'draft');
  // a sanction cannot cite a decision that is not approved yet
  const susp = (await officer.c.get('/discipline/sanction-types')).data.find((t) => t.has_duration).id;
  assert.equal((await officer.c.post('/discipline/sanctions', { student_id: sA.id, sanction_type_id: susp, reason: 'x', imposed_on: today, duration_days: 2, decision_id: decision.id })).status, 400);
  assert.equal((await ap(principal, { approve: true, comment: 'Agreed.' })).status, 200);
  assert.equal((await officer.c.get('/discipline/decisions')).data[0].status, 'approved');
  assert.equal((await ap(principal, { approve: true })).status, 400, 'already approved');
  // locked
  assert.equal((await memberX.c.put(`/discipline/council/cases/${kase}/decision`, D())).status, 400);
  assert.equal((await memberX.c.put(`/discipline/council/cases/${kase}`, { discussion: 'rewrite history' })).status, 400);
  assert.equal((await officer.c.del(`/discipline/council/cases/${kase}`)).status, 400, 'a case with a decision cannot be deleted');
});

test('sanctions: proposed by an officer, imposed only when an authorised person approves', async () => {
  const types = (await officer.c.get('/discipline/sanction-types')).data;
  const susp = types.find((t) => t.has_duration).id, warn = types.find((t) => !t.has_duration).id;
  const P = (extra = {}) => ({ student_id: sA.id, sanction_type_id: warn, reason: 'Fighting in the yard', imposed_on: today, incident_id: incident, ...extra });
  assert.equal((await reporter.c.post('/discipline/sanctions', P())).status, 403);
  assert.equal((await parent.c.post('/discipline/sanctions', P())).status, 403);
  assert.equal((await principal.c.post('/discipline/sanctions', P())).status, 403, 'principals approve, officers propose');
  assert.equal((await officer.c.post('/discipline/sanctions', P({ reason: '' }))).status, 400);
  assert.equal((await officer.c.post('/discipline/sanctions', P({ sanction_type_id: susp }))).status, 400, 'suspension needs a duration');
  assert.equal((await officer.c.post('/discipline/sanctions', P({ sanction_type_id: susp, duration_days: 0 }))).status, 400);
  assert.equal((await officer.c.post('/discipline/sanctions', P({ student_id: sB.id }))).status, 400);
  assert.equal((await officer.c.post('/discipline/sanctions', P({ student_id: sA2.id }))).status, 400, 'incident belongs to another student');
  assert.equal((await officer.c.post('/discipline/sanctions', P({ incident_id: undefined, student_id: sA2.id, decision_id: decision.id }))).status, 400, 'decision belongs to another student');
  const otherType = (await B.admin.get('/discipline/sanction-types')).data[0].id;
  assert.equal((await officer.c.post('/discipline/sanctions', P({ sanction_type_id: otherType }))).status, 400);
  const r = await officer.c.post('/discipline/sanctions', P({ sanction_type_id: susp, duration_days: 3, decision_id: decision.id })); assert.equal(r.status, 200, JSON.stringify(r.data));
  let x = (await officer.c.get('/discipline/sanctions')).data[0];
  assert.equal(x.status, 'proposed'); assert.equal(x.notification_status, 'not_notified'); assert.equal(x.duration_days, 3); assert.equal(x.authorized_by, null);
  // nothing is imposed yet: an officer cannot approve their own proposal
  assert.equal((await officer.c.post(`/discipline/sanctions/${x.id}/approve`, { approve: true })).status, 403);
  assert.equal((await memberX.c.post(`/discipline/sanctions/${x.id}/approve`, { approve: true })).status, 403);
  assert.equal((await B.admin.post(`/discipline/sanctions/${x.id}/approve`, { approve: true })).status, 404);
  assert.equal((await principal.c.post(`/discipline/sanctions/${x.id}/approve`, { approve: false })).status, 400);
  assert.equal((await principal.c.post(`/discipline/sanctions/${x.id}/approve`, { approve: true })).status, 200);
  x = (await officer.c.get('/discipline/sanctions')).data[0];
  assert.equal(x.status, 'approved'); assert.equal(x.authorized_by, 'Principal'); assert.ok(x.authorized_at);
  assert.equal((await principal.c.post(`/discipline/sanctions/${x.id}/approve`, { approve: true })).status, 400, 'cannot approve twice');
  assert.equal((await principal.c.post(`/discipline/sanctions/${x.id}/withdraw`, {})).status, 400, 'withdrawal needs a reason');
  assert.equal((await officer.c.post(`/discipline/sanctions/${x.id}/withdraw`, { comment: 'x' })).status, 403);
  assert.equal((await principal.c.post(`/discipline/sanctions/${x.id}/withdraw`, { comment: 'Imposed in error.' })).status, 200);
  assert.equal((await officer.c.get('/discipline/sanctions?status=withdrawn')).data.length, 1);
  assert.equal((await B.admin.get('/discipline/sanctions')).data.length, 0);
  // a rejected proposal
  const r2 = await officer.c.post('/discipline/sanctions', P());
  assert.equal((await A.admin.post(`/discipline/sanctions/${r2.data.id}/approve`, { approve: false, comment: 'Too severe.' })).status, 200);
  assert.equal((await officer.c.get(`/discipline/sanctions?student_id=${sA.id}&status=rejected`)).data.length, 1);
});

test('the student history shows decisions and sanctions, never the council discussion', async () => {
  const h1 = (await officer.c.get(`/discipline/students/${sA.id}/history`)).data;
  assert.equal(h1.decisions.length, 1); assert.equal(h1.decisions[0].status, 'approved'); assert.equal(h1.sanctions.length, 2);
  assert.ok(!JSON.stringify(h1).includes('SECRET'));
  assert.equal((await reporter.c.get(`/discipline/students/${sA.id}/history`)).status, 403);
  assert.equal((await memberX.c.get(`/discipline/students/${sA.id}/history`)).status, 403, 'council members read the case, not the whole history');
  const sid = (await app.h.get("SELECT id FROM schools WHERE name = 'Cou A'")).id;
  const acts = (await app.h.all('SELECT action FROM audit_log WHERE school_id = ?', sid)).map((r) => r.action);
  for (const a of ['council_meeting_created', 'council_case_created', 'council_decision_saved', 'council_decision_approved', 'council_decision_rejected', 'sanction_proposed', 'sanction_approved', 'sanction_rejected', 'sanction_withdrawn']) assert.ok(acts.includes(a), a);
});

test('meeting changes: members replaced, cancelled meetings take no new cases; cases removed before any decision', async () => {
  assert.equal((await officer.c.put(`/discipline/council/meetings/${meeting}`, { status: 'weird' })).status, 400);
  assert.equal((await officer.c.put(`/discipline/council/meetings/${meeting}`, { members: [{ user_id: memberX.id }, { user_id: memberY.id }] })).status, 200);
  assert.equal((await memberY.c.get(`/discipline/council/meetings/${meeting}`)).status, 200, 'now assigned');
  const m2 = (await officer.c.post('/discipline/council/meetings', MEET({ title: 'Second' }))).data.id;
  const k2 = (await officer.c.post(`/discipline/council/meetings/${m2}/cases`, { student_id: sA2.id })).data.id;
  assert.equal((await officer.c.del(`/discipline/council/cases/${k2}`)).status, 200);
  assert.equal((await plain.c.del(`/discipline/council/cases/${k2}`)).status, 403);
  assert.equal((await officer.c.put(`/discipline/council/meetings/${m2}`, { status: 'cancelled' })).status, 200);
  assert.equal((await officer.c.post(`/discipline/council/meetings/${m2}/cases`, { student_id: sA2.id })).status, 400);
});

test('the database itself refuses council or sanction records that mix two schools', async () => {
  const schoolA = (await app.h.get("SELECT id FROM schools WHERE name = 'Cou A'")).id;
  const typeB = (await B.admin.get('/discipline/sanction-types')).data[0].id;
  await assert.rejects(async () => app.h.run("INSERT INTO council_cases (school_id, meeting_id, student_id, created_by) VALUES (?,?,?,?)", schoolA, meeting, sB.id, A.teacherId), /FOREIGN KEY/);
  await assert.rejects(async () => app.h.run("INSERT INTO sanctions (school_id, student_id, sanction_type_id, reason, imposed_on, proposed_by) VALUES (?,?,?,?,?,?)", schoolA, sA.id, typeB, 'x', today, officer.id), /FOREIGN KEY/);
  await assert.rejects(async () => app.h.run("INSERT INTO council_members (school_id, meeting_id, user_id) VALUES (?,?,?)", schoolA, meeting, (await app.h.get("SELECT id FROM users WHERE email = 'bmember@test.local'")).id), /FOREIGN KEY/);
});
