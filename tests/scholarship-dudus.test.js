'use strict';
// DOUDOUS² scholarship answers: real records only, scoped to the asker.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, PW } = require('./helpers');

test('DOUDOUS² answers scholarship questions from real data, per school and per asker', async () => {
  const app = await startTestApp();
  try {
    await makeOwner(app); await makeSchool(app, 'Chat A', 'ca@test.local'); await makeSchool(app, 'Chat B', 'cb@test.local');
    const A = await seedSchool(app, 'ca@test.local', 'A'), B = await seedSchool(app, 'cb@test.local', 'B');
    const owner = client(app); await owner.login('owner@test.local', PW); await owner.post('/platform/external-scholarships/starter', {});
    const ask = async (c, message, language = 'en') => (await c.post('/dudus/chat', { message, language })).data.text;
    assert.match(await ask(A.admin, 'What scholarships are available?'), /no open scholarship/i);
    const ext = (await owner.get('/platform/external-scholarships')).data.find((e) => /Eiffel/.test(e.title));
    await A.admin.post(`/finder/catalogue/${ext.id}/approve`, { approved: true });
    const sc = await A.admin.post('/scholarships', { title: 'Merit Award', description: 'Top pupils', category: 'academic_merit', benefits: '50% tuition', status: 'open', places: 2, closes_on: '2999-01-01' });
    assert.equal(sc.status, 200); assert.equal((await A.admin.post(`/scholarships/${sc.data.id}/status`, { status: 'open' })).status, 200);
    const a1 = await ask(A.admin, 'Which scholarships are open?');
    assert.match(a1, /Merit Award/); assert.match(a1, /Eiffel/); assert.match(a1, /2027-01-06/); assert.match(a1, /https:\/\/www\.campusfrance\.org/);
    const noDate = await ask(A.admin, 'tell me about the DAAD scholarship');
    assert.equal(/DAAD/.test(noDate), false, 'an entry the school did not approve is not offered');
    const other = await ask(B.admin, 'scholarships available');
    assert.doesNotMatch(other, /Merit Award|Eiffel/, 'another school sees nothing of this school');
    assert.match(await ask(A.admin, 'Quelles bourses sont disponibles ?', 'fr'), /Bourses de votre école/);
    // a parent asking about their own applications sees only their own children
    const kid = await A.mk('Kid One', 'G'); const pr = await A.admin.post('/parents', { name: 'Fam', email: 'fam@ca.test', children: [{ student_id: kid.id, relationship: 'Mother' }] });
    await app.h.run('UPDATE users SET must_change_password = 0 WHERE id = ?', pr.data.id);
    const pc = client(app); const r = await pc.post('/auth/login', { school_code: pr.data.school_code, identifier: 'fam@ca.test', password: pr.data.temporary_password }); pc.csrf = r.data.csrf;
    assert.match(await ask(pc, 'What is the status of my scholarship application?'), /no scholarship application/i);
    assert.match(await ask(pc, 'scholarships open'), /Merit Award/);
    assert.match(await ask(pc, 'how do I apply for a scholarship'), /Apply/);
  } finally { await app.stop(); }
});
