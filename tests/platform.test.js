'use strict';
// Super Administrator tools: overview, subscriptions, payments, announcements, admin accounts, monitoring, exports, isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeOwner, makeSchool, PW } = require('./helpers');

test('platform tools: owner only, totals, subscriptions, payments, announcements, admins, exports', async () => {
  const app = await startTestApp();
  try {
    await makeOwner(app);
    const a = await makeSchool(app, 'Alpha School', 'a@alpha.test'), b = await makeSchool(app, 'Beta School', 'b@beta.test');
    const owner = client(app); assert.equal((await owner.login('owner@test.local', PW)).status, 200);
    const adminA = client(app); await adminA.login('a@alpha.test', PW);

    // school admins can never reach any of it
    for (const p of ['/platform/overview', '/platform/plans', '/platform/subscriptions', '/platform/payments', '/platform/finance', '/platform/announcements', '/platform/admins', '/platform/activity', '/platform/security', '/platform/export?type=schools'])
      assert.equal((await adminA.get(p)).status, 403, p);
    assert.equal((await adminA.post(`/platform/schools/${a}/subscription`, { plan_code: 'basic' })).status, 403);
    assert.equal((await adminA.post(`/platform/schools/${a}/payments`, { amount: 5 })).status, 403);
    assert.equal((await adminA.post('/platform/announcements', { title: 'x', body: 'y' })).status, 403);
    assert.equal((await adminA.post(`/platform/admins/1/status`, { active: false })).status, 403);
    assert.equal((await client(app).get('/platform/overview')).status, 401);

    const ov = (await owner.get('/platform/overview')).data;
    assert.equal(ov.schools.active, 2); assert.equal(ov.schools.suspended, 0);
    assert.equal(ov.people.students, 0);

    // plans: prices start at 0, owner edits
    const plans = (await owner.get('/platform/plans')).data.plans; assert.deepEqual(plans.map((p) => p.code), ['basic', 'standard', 'premium']);
    assert.equal((await owner.put('/platform/plans/standard', { price: 100000, period_months: 12 })).status, 200);
    assert.equal((await owner.put('/platform/plans/standard', { price: -1 })).status, 400);
    assert.equal((await owner.put('/platform/plans/gold', { price: 5 })).status, 404);

    // subscription + payments
    assert.equal((await owner.post(`/platform/schools/${a}/payments`, { amount: 10, method: 'cash' })).status, 400, 'no subscription yet');
    assert.equal((await owner.post(`/platform/schools/${a}/subscription`, { plan_code: 'diamond' })).status, 400);
    assert.equal((await owner.post(`/platform/schools/${a}/subscription`, { plan_code: 'standard' })).status, 200);
    assert.equal((await owner.post(`/platform/schools/${a}/payments`, { amount: 40000, method: 'mobile_money', reference: 'MM1' })).status, 200);
    assert.equal((await owner.post(`/platform/schools/${a}/payments`, { amount: 0, method: 'cash' })).status, 400);
    assert.equal((await owner.post(`/platform/schools/${a}/payments`, { amount: 5, method: 'bitcoin' })).status, 400);
    const exp = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10), st = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    assert.equal((await owner.post(`/platform/schools/${b}/subscription`, { plan_code: 'basic', starts_on: st, expires_on: exp, amount_due: 20000 })).status, 200);
    const subs = (await owner.get('/platform/subscriptions')).data.rows;
    const ra = subs.find((r) => r.school_id === a), rb = subs.find((r) => r.school_id === b);
    assert.equal(ra.state, 'active'); assert.equal(ra.paid, 40000); assert.equal(ra.outstanding, 60000);
    assert.equal(rb.state, 'expired');
    assert.equal((await owner.get('/platform/subscriptions?state=expired')).data.rows.length, 1);
    assert.equal((await owner.get('/platform/subscriptions?q=alph')).data.rows.length, 1);
    assert.equal((await owner.get('/platform/subscriptions?owing=1')).data.rows.length, 2);
    const fin = (await owner.get('/platform/finance')).data;
    assert.equal(fin.months.length, 12); assert.equal(fin.months.at(-1).total, 40000); assert.equal(fin.outstanding.length, 2);
    const ov2 = (await owner.get('/platform/overview')).data;
    assert.equal(ov2.finance.revenue_total, 40000); assert.equal(ov2.finance.outstanding, 80000); assert.equal(ov2.finance.expired, 1); assert.equal(ov2.finance.by_plan.standard, 1);

    // announcements reach school administrators only, as in-app notices
    assert.equal((await owner.post('/platform/announcements', { title: '', body: 'x' })).status, 400);
    const an = await owner.post('/platform/announcements', { title: 'Maintenance', body: 'Sunday night', school_ids: [a] });
    assert.equal(an.status, 200); assert.equal(an.data.recipients, 1);
    assert.equal((await owner.post('/platform/announcements', { title: 'T', body: 'B', school_ids: [999] })).status, 400);
    const nA = (await adminA.get('/notifications')).data, nB = await (async () => { const c = client(app); await c.login('b@beta.test', PW); return (await c.get('/notifications')).data; })();
    assert.ok(JSON.stringify(nA).includes('platform_announcement')); assert.ok(!JSON.stringify(nB).includes('platform_announcement'));
    assert.equal((await owner.post('/platform/announcements', { title: 'All', body: 'Everyone' })).data.recipients, 2);

    // admin accounts
    const admins = (await owner.get('/platform/admins')).data; assert.equal(admins.length, 2);
    const idA = admins.find((u) => u.email === 'a@alpha.test').id;
    assert.equal((await owner.post(`/platform/admins/${idA}/status`, { active: false })).status, 200);
    assert.equal((await client(app).login('a@alpha.test', PW)).status === 200, false, 'deactivated admin cannot sign in');
    assert.equal((await adminA.get('/notifications')).status, 401, 'sessions ended');
    assert.equal((await owner.post(`/platform/admins/${idA}/status`, { active: true })).status, 200);
    assert.equal((await client(app).login('a@alpha.test', PW)).status, 200);
    const rs = await owner.post(`/platform/admins/${idA}/password-reset`, {}); assert.equal(rs.status, 200); assert.match(rs.data.path, /^\/#\/reset\//);
    assert.equal((await owner.post(`/platform/admins/${(await app.h.get("SELECT id FROM users WHERE role='platform_owner'")).id}/status`, { active: false })).status, 404, 'cannot target the owner');

    // monitoring, logs, exports
    await client(app).login('a@alpha.test', 'wrong-wrong-1'); await client(app).login('a@alpha.test', 'wrong-wrong-2'); await client(app).login('a@alpha.test', 'wrong-wrong-3');
    const sec = (await owner.get('/platform/security')).data; assert.ok(sec.failed_logins_24h >= 3); assert.ok(sec.repeated_failures.length >= 1);
    const act = (await owner.get('/platform/activity')).data; assert.ok(act.some((r) => r.action === 'payment_recorded')); assert.ok(!('meta' in act[0]));
    const ex = await owner.get('/platform/export?type=subscriptions'); assert.equal(ex.status, 200); assert.match(String(ex.data), /Alpha School/); assert.match(ex.headers.get('content-type'), /text\/csv/);
    assert.match(String((await owner.get('/platform/export?type=payments')).data), /MM1/);
  } finally { await app.stop(); }
});
