'use strict';
// Scholarships, phase 2: applications, server-side eligibility, documents, reviewers, decisions, privacy and school separation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, h2 } = require('./helpers');

let app, A, B, rev1, rev2, plainT, stuC, parC, otherParC, kid, kid2, outsider, sch, appId;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SECRETNOTE = 'REVIEWER-PRIVATE-NOTE-XYZ';

test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'App A', 'admin.pa@test.local'); await makeSchool(app, 'App B', 'admin.pb@test.local');
  A = await seedSchool(app, 'admin.pa@test.local', 'A'); B = await seedSchool(app, 'admin.pb@test.local', 'B');
  const mk = async (email, role, name, extra = {}) => { const u = (await A.admin.post('/users', { role, name, email, ...extra })).data; await h2(app, u.id); const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200); return { id: u.id, c }; };
  rev1 = await mk('rev1.pa@test.local', 'teacher', 'Reviewer One'); rev2 = await mk('rev2.pa@test.local', 'teacher', 'Reviewer Two'); plainT = await mk('plain.pa@test.local', 'teacher', 'Plain');
  kid = await A.mk('Kid One', 'G One'); kid2 = await A.mk('Kid Two', 'G Two'); outsider = await B.mk('Out Sider', 'G Out');
  stuC = await mk('stu.pa@test.local', 'student', 'Kid One', { student_id: kid.id });
  parC = await mk('par.pa@test.local', 'parent', 'Parent One'); otherParC = await mk('par2.pa@test.local', 'parent', 'Parent Two');
  const g = (await app.h.get('SELECT guardian_id FROM student_guardians WHERE student_id = ?', kid.id)).guardian_id; await app.h.run('UPDATE guardians SET user_id = ? WHERE id = ?', parC.id, g);
  const g2 = (await app.h.get('SELECT guardian_id FROM student_guardians WHERE student_id = ?', kid2.id)).guardian_id; await app.h.run('UPDATE guardians SET user_id = ? WHERE id = ?', otherParC.id, g2);
  await A.admin.put('/scholarships-reviewers', { user_ids: [rev1.id, rev2.id] });
  sch = (await A.admin.post('/scholarships', { title: 'Merit', description: 'd', category: 'academic_merit', benefits: 'b', places: 1, min_average: 12, opens_on: '2020-01-01', closes_on: '2099-01-01', class_ids: [A.cls] })).data.id;
  await A.admin.post(`/scholarships/${sch}/status`, { status: 'open' });
});
test.after(() => app.stop());

const approveResults = async (student, score) => {
  const a = (await A.admin.post('/assessments', { class_id: A.cls, subject_id: A.maths, term_id: A.term, name: `T${student.id}`, type: 'test', max_score: 20, date: '2026-10-01' })).data.id;
  await A.admin.put(`/assessments/${a}/grades`, { entries: [{ student_id: student.id, score }] });
  return (await A.admin.post('/reports/approve', { student_id: student.id, term_id: A.term, approve: true })).status;
};

test('eligibility is computed on the server from APPROVED results only', async () => {
  const e = (await stuC.c.get(`/scholarships/${sch}/eligibility`)).data;
  assert.equal(e.eligible, false); assert.equal(e.checks.find((x) => x.key === 'min_average').ok, false, 'no approved result: never assumed');
  assert.equal((await stuC.c.post('/scholarship-applications', { scholarship_id: sch, motivation: 'x' })).data.error, 'not_eligible');
  // grades exist but the report card is NOT approved: still not eligible
  const a = (await A.admin.post('/assessments', { class_id: A.cls, subject_id: A.maths, term_id: A.term, name: 'T', type: 'test', max_score: 20, date: '2026-10-01' })).data.id;
  await A.admin.put(`/assessments/${a}/grades`, { entries: [{ student_id: kid.id, score: 16 }, { student_id: kid2.id, score: 5 }] });
  assert.equal((await stuC.c.get(`/scholarships/${sch}/eligibility`)).data.eligible, false, 'unapproved results are not used');
  assert.equal((await A.admin.post('/reports/approve', { student_id: kid.id, term_id: A.term, approve: true })).status, 200);
  assert.equal((await A.admin.post('/reports/approve', { student_id: kid2.id, term_id: A.term, approve: true })).status, 200);
  const ok = (await stuC.c.get(`/scholarships/${sch}/eligibility`)).data; assert.equal(ok.eligible, true); assert.equal(ok.checks.find((x) => x.key === 'min_average').detail.average, 16);
  assert.equal((await otherParC.c.get(`/scholarships/${sch}/eligibility?student_id=${kid2.id}`)).data.eligible, false, 'average 5 < 12');
  assert.equal((await otherParC.c.get(`/scholarships/${sch}/eligibility?student_id=${kid.id}`)).status, 404, 'not their child');
  assert.equal((await plainT.c.get(`/scholarships/${sch}/eligibility`)).status, 403);
});

test('who can apply, draft rules, one application per student, documents', async () => {
  assert.equal((await plainT.c.post('/scholarship-applications', { scholarship_id: sch })).status, 403);
  assert.equal((await A.admin.post('/scholarship-applications', { scholarship_id: sch })).status, 403);
  assert.equal((await otherParC.c.post('/scholarship-applications', { scholarship_id: sch, student_id: kid.id })).status, 404);
  assert.equal((await otherParC.c.post('/scholarship-applications', { scholarship_id: sch, student_id: kid2.id })).data.error, 'not_eligible');
  const r = await parC.c.post('/scholarship-applications', { scholarship_id: sch, student_id: kid.id, motivation: 'I work hard.' });
  assert.equal(r.status, 200); appId = r.data.id;
  assert.equal((await stuC.c.post('/scholarship-applications', { scholarship_id: sch })).data.error, 'already_applied', 'the child cannot apply twice');
  assert.equal((await stuC.c.get(`/scholarship-applications/${appId}`)).data.can_edit, true);
  assert.equal((await otherParC.c.get(`/scholarship-applications/${appId}`)).status, 404);
  assert.equal((await B.admin.get(`/scholarship-applications/${appId}`)).status, 404);
  assert.equal((await rev1.c.get(`/scholarship-applications/${appId}`)).status, 404, 'drafts and unassigned are invisible to reviewers');
  assert.equal((await stuC.c.post(`/scholarship-applications/${appId}/documents`, { name: 'bad.exe', data: Buffer.from('MZ not an image').toString('base64') })).data.error, 'invalid_file_type');
  const up = await stuC.c.post(`/scholarship-applications/${appId}/documents`, { name: 'id.png', data: PNG }); assert.equal(up.status, 200);
  assert.equal((await stuC.c.get(`/scholarship-applications/${appId}/documents/${up.data.id}`)).status, 200);
  assert.equal((await otherParC.c.get(`/scholarship-applications/${appId}/documents/${up.data.id}`)).status, 404);
  assert.equal((await stuC.c.put(`/scholarship-applications/${appId}`, { motivation: '' })).status, 200);
  assert.equal((await stuC.c.post(`/scholarship-applications/${appId}/submit`)).data.error, 'motivation_required');
  assert.equal((await stuC.c.put(`/scholarship-applications/${appId}`, { motivation: 'I work hard and help others.' })).status, 200);
  assert.equal((await stuC.c.post(`/scholarship-applications/${appId}/submit`)).status, 200);
  const d = (await stuC.c.get(`/scholarship-applications/${appId}`)).data;
  assert.equal(d.status, 'submitted'); assert.equal(d.average_at_submission, 16); assert.equal(d.can_edit, false);
  assert.equal((await stuC.c.put(`/scholarship-applications/${appId}`, { motivation: 'changed' })).status, 400, 'locked after submitting');
  assert.equal((await stuC.c.post(`/scholarship-applications/${appId}/documents`, { name: 'a.png', data: PNG })).status, 400);
  assert.equal((await parC.get?.('/x')) === undefined, true);
});

test('notices go to the family; reviewers see only assigned applications and their notes stay private', async () => {
  assert.equal((await stuC.c.get('/notifications')).data.items.some((n) => n.kind === 'scholarship_received'), true);
  assert.equal((await parC.c.get('/notifications')).data.items.some((n) => n.kind === 'scholarship_received'), true);
  assert.equal((await otherParC.c.get('/notifications')).data.items.some((n) => n.kind === 'scholarship_received'), false);
  assert.equal((await rev1.c.get('/scholarship-applications')).data.length, 0);
  assert.equal((await stuC.c.put(`/scholarship-applications/${appId}/reviewers`, { user_ids: [rev1.id] })).status, 403);
  assert.equal((await A.admin.put(`/scholarship-applications/${appId}/reviewers`, { user_ids: [plainT.id] })).status, 400, 'not named as a reviewer');
  assert.equal((await A.admin.put(`/scholarship-applications/${appId}/reviewers`, { user_ids: [rev1.id] })).status, 200);
  assert.equal((await A.admin.get(`/scholarship-applications/${appId}`)).data.status, 'under_review');
  assert.equal((await rev1.c.get('/scholarship-applications')).data.length, 1);
  assert.equal((await rev2.c.get(`/scholarship-applications/${appId}`)).status, 404, 'a different reviewer is not assigned');
  assert.equal((await rev2.c.post(`/scholarship-applications/${appId}/review`, { recommendation: 'recommend' })).status, 404);
  assert.equal((await rev1.c.post(`/scholarship-applications/${appId}/review`, { recommendation: 'recommend', note: SECRETNOTE })).status, 200);
  assert.equal((await rev1.c.post(`/scholarship-applications/${appId}/decision`, { decision: 'approved' })).status, 403, 'reviewers advise, they do not decide');
  const fam = (await stuC.c.get(`/scholarship-applications/${appId}`)).data; assert.doesNotMatch(JSON.stringify(fam), /REVIEWER-PRIVATE|recommend/);
  assert.equal(fam.reviews, undefined);
  assert.match(JSON.stringify((await A.admin.get(`/scholarship-applications/${appId}`)).data.reviews), /REVIEWER-PRIVATE/);
  assert.equal((await rev1.c.get(`/scholarship-applications/${appId}/documents/1`)).status, 200, 'assigned reviewer can open the documents');
});

test('decisions: reasons, places, waitlist, notices; one school cannot touch another', async () => {
  assert.equal((await A.admin.post(`/scholarship-applications/${appId}/decision`, { decision: 'rejected' })).data.error, 'reason_required');
  assert.equal((await B.admin.post(`/scholarship-applications/${appId}/decision`, { decision: 'approved' })).status, 404);
  // second applicant for the single place
  await A.admin.post('/scholarships', { title: 'x', description: 'd', category: 'external', benefits: 'b' });
  assert.equal((await A.admin.post(`/scholarship-applications/${appId}/decision`, { decision: 'approved', reason: 'Excellent file.' })).status, 200);
  assert.equal((await A.admin.post(`/scholarship-applications/${appId}/decision`, { decision: 'rejected', reason: 'x' })).status, 400, 'decided applications are final here');
  const fam = (await parC.c.get(`/scholarship-applications/${appId}`)).data; assert.equal(fam.status, 'approved'); assert.equal(fam.decision_reason, 'Excellent file.');
  assert.equal((await stuC.c.get('/notifications')).data.items.some((n) => n.kind === 'scholarship_approved'), true);
  // the only place is taken: another approval is refused, waitlist works
  await app.h.run("UPDATE scholarship_applications SET status = 'draft' WHERE id = ?", appId); await app.h.run("UPDATE scholarship_applications SET status = 'approved' WHERE id = ?", appId);
  const row = await app.h.run("INSERT INTO scholarship_applications (school_id, scholarship_id, student_id, applied_by, motivation, status) SELECT school_id, scholarship_id, ?, applied_by, 'm', 'submitted' FROM scholarship_applications WHERE id = ?", kid2.id, appId);
  void row;
  const second = (await app.h.get("SELECT id FROM scholarship_applications WHERE student_id = ?", kid2.id)).id;
  assert.equal((await A.admin.post(`/scholarship-applications/${second}/decision`, { decision: 'approved' })).data.error, 'no_places_left');
  assert.equal((await A.admin.post(`/scholarship-applications/${second}/decision`, { decision: 'waitlisted', reason: 'No place left.' })).status, 200);
  assert.equal((await A.admin.get(`/scholarship-applications?status=waitlisted`)).data.length, 1);
  assert.equal((await B.admin.get('/scholarship-applications')).data.length, 0);
  assert.equal((await outsider && (await B.admin.get(`/scholarship-applications/${second}`)).status), 404);
});

test('a suspended or closed scholarship takes no new applications', async () => {
  const s2 = (await A.admin.post('/scholarships', { title: 'Second', description: 'd', category: 'social_support', benefits: 'b', places: 2 })).data.id;
  assert.equal((await stuC.c.post('/scholarship-applications', { scholarship_id: s2 })).status, 404, 'draft is invisible');
  await A.admin.post(`/scholarships/${s2}/status`, { status: 'open' }); await A.admin.post(`/scholarships/${s2}/status`, { status: 'suspended' });
  assert.equal((await stuC.c.post('/scholarship-applications', { scholarship_id: s2 })).status, 404);
  await A.admin.post(`/scholarships/${s2}/status`, { status: 'open' }); await A.admin.put(`/scholarships/${s2}`, { closes_on: '2021-01-01' });
  assert.equal((await stuC.c.post('/scholarship-applications', { scholarship_id: s2 })).data.error, 'not_eligible', 'deadline passed');
});
