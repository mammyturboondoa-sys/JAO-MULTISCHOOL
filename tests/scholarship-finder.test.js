'use strict';
// Scholarship Finder: owner-maintained shared catalogue, per-school approval, per-user bookmarks, isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, PW } = require('./helpers');

test('finder: owner catalogue, school approval, visibility, bookmarks', async () => {
  const app = await startTestApp();
  try {
    await makeOwner(app); await makeSchool(app, 'Find A', 'fa@test.local'); await makeSchool(app, 'Find B', 'fb@test.local');
    const A = await seedSchool(app, 'fa@test.local', 'A'), B = await seedSchool(app, 'fb@test.local', 'B');
    const owner = client(app); await owner.login('owner@test.local', PW);
    // only the owner can touch the catalogue
    assert.equal((await A.admin.get('/platform/external-scholarships')).status, 403);
    assert.equal((await A.admin.post('/platform/external-scholarships/starter', {})).status, 403);
    const st = await owner.post('/platform/external-scholarships/starter', {}); assert.equal(st.status, 200); assert.equal(st.data.added, st.data.total); assert.ok(st.data.total >= 5);
    assert.equal((await owner.post('/platform/external-scholarships/starter', {})).data.added, 0, 'safe to load twice');
    const all = (await owner.get('/platform/external-scholarships')).data;
    const eiffel = all.find((e) => /Eiffel/.test(e.title)); assert.equal(eiffel.deadline, '2027-01-06'); assert.ok(all.filter((e) => e.deadline).length === 1, 'only stated deadlines are filled in');
    assert.ok(all.every((e) => /^https:\/\//.test(e.official_url) && e.last_verified_on));
    // validation
    assert.equal((await owner.post('/platform/external-scholarships', { title: 'X', provider: 'Y', official_url: 'http://insecure.test', last_verified_on: '2026-01-01' })).status, 400);
    assert.equal((await owner.post('/platform/external-scholarships', { title: 'X', provider: 'Y', official_url: 'javascript:alert(1)', last_verified_on: '2026-01-01' })).status, 400);
    assert.equal((await owner.post('/platform/external-scholarships', { title: 'X', provider: 'Y', official_url: 'https://x.test/a', last_verified_on: '2999-01-01' })).status, 400, 'cannot claim a future verification');
    const mine = await owner.post('/platform/external-scholarships', { title: 'Draft one', provider: 'Y', official_url: 'https://x.test/a', last_verified_on: '2026-01-01' }); assert.equal(mine.status, 200);
    assert.equal((await owner.post('/platform/external-scholarships', { title: 'Dup', provider: 'Y', official_url: 'https://x.test/a', last_verified_on: '2026-01-01' })).status, 400);
    // schools see nothing until their administrator approves; drafts are never offered
    assert.equal((await A.admin.get('/finder')).data.length, 0);
    const cat = (await A.admin.get('/finder/catalogue')).data; assert.equal(cat.length, st.data.total, 'drafts are not in the school catalogue'); assert.ok(cat.every((e) => e.approved === false));
    assert.equal((await A.admin.post(`/finder/catalogue/${mine.data.id}/approve`, { approved: true })).status, 404, 'a draft cannot be approved');
    assert.equal((await A.admin.post(`/finder/catalogue/${eiffel.id}/approve`, { approved: true })).status, 200);
    assert.equal((await A.admin.get('/finder')).data.length, 1); assert.equal((await B.admin.get('/finder')).data.length, 0, 'approval is per school');
    // a parent of school A sees it, bookmarks it; another school cannot bookmark it
    const pr = await A.admin.post('/parents', { name: 'Fam', email: 'fam@a.test', children: [{ student_id: (await A.mk('Kid A', 'G')).id, relationship: 'Mother' }] });
    const pc = client(app); await pc.post('/auth/login', { school_code: pr.data.school_code, identifier: 'fam@a.test', password: pr.data.temporary_password }).then((r) => { pc.csrf = r.data.csrf; });
    await app.h.run('UPDATE users SET must_change_password = 0 WHERE id = ?', pr.data.id);
    const seen = (await pc.get('/finder')).data; assert.equal(seen.length, 1); assert.equal(seen[0].saved, false);
    assert.equal((await pc.post(`/finder/${eiffel.id}/bookmark`, { saved: true })).status, 200); assert.equal((await pc.get('/finder')).data[0].saved, true);
    assert.equal((await B.admin.post(`/finder/${eiffel.id}/bookmark`, { saved: true })).status, 404);
    assert.equal((await pc.get('/finder?q=france')).data.length, 1); assert.equal((await pc.get('/finder?q=zzz')).data.length, 0); assert.equal((await pc.get('/finder?level=phd')).data.length, 1);
    assert.equal((await pc.post(`/finder/catalogue/${eiffel.id}/approve`, { approved: false })).status, 403, 'families cannot change what the school shows');
    // owner archives -> disappears everywhere; admin can withdraw
    assert.equal((await owner.put(`/platform/external-scholarships/${eiffel.id}`, { status: 'archived' })).status, 200); assert.equal((await pc.get('/finder')).data.length, 0);
    await owner.put(`/platform/external-scholarships/${eiffel.id}`, { status: 'published' });
    assert.equal((await A.admin.post(`/finder/catalogue/${eiffel.id}/approve`, { approved: false })).status, 200); assert.equal((await pc.get('/finder')).data.length, 0);
    assert.equal((await client(app).get('/finder')).status, 401);
  } finally { await app.stop(); }
});
