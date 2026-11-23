'use strict';
// Super Administrator (platform owner) tools: overview, subscriptions, payments, finance, announcements to school administrators,
// school administrator accounts, activity and security monitoring, CSV reports.
// Privacy: the owner sees TOTALS and school-level facts only, never individual students, parents' details, grades or reports.
const crypto = require('node:crypto');
const S = require('./security');

const OWNER = ['platform_owner'];
const today = () => new Date().toISOString().slice(0, 10);
const addMonths = (iso, m) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };
const daysUntil = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);
const METHODS = ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'];
const csvCell = (v) => { let t = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const csv = (header, rows) => `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

module.exports = function (app) {
  const { h, route } = app;
  const currency = async () => (await h.get("SELECT value FROM platform_settings WHERE key = 'currency'")).value;

  // The latest subscription of every school, with what was paid and what is still owed.
  const subRows = async (where = '1=1', params = []) => {
    const rows = await h.all(`SELECT s.id school_id, s.name school_name, s.code school_code, s.status school_status, s.approval,
        v.id sub_id, v.plan_code, v.starts_on, v.expires_on, v.amount_due,
        COALESCE((SELECT SUM(p.amount) FROM subscription_payments p WHERE p.subscription_id = v.id), 0) paid
      FROM schools s LEFT JOIN school_subscriptions v ON v.id = (SELECT v2.id FROM school_subscriptions v2 WHERE v2.school_id = s.id ORDER BY v2.expires_on DESC, v2.id DESC LIMIT 1)
      WHERE s.approval = 'approved' AND ${where} ORDER BY s.name`, ...params);
    return rows.map((r) => {
      let state = 'none';
      if (r.sub_id) { const d = daysUntil(r.expires_on); state = d < 0 ? 'expired' : d <= 30 ? 'expiring' : 'active'; }
      return { ...r, state, outstanding: r.sub_id ? Math.max(0, r.amount_due - r.paid) : 0, days_left: r.sub_id ? daysUntil(r.expires_on) : null };
    });
  };

  route('GET', '/platform/overview', OWNER, async () => {
    const one = async (sql, ...p) => (await h.get(sql, ...p)).n;
    const subs = await subRows();
    const month = today().slice(0, 7);
    const byPlan = { basic: 0, standard: 0, premium: 0 };
    for (const s of subs) if (s.sub_id && s.state !== 'expired') byPlan[s.plan_code]++;
    return {
      currency: await currency(),
      schools: { total: await one('SELECT COUNT(*) n FROM schools'), active: await one("SELECT COUNT(*) n FROM schools WHERE status = 'active' AND approval = 'approved'"), suspended: await one("SELECT COUNT(*) n FROM schools WHERE status = 'suspended' AND approval = 'approved'"),
        pending: await one("SELECT COUNT(*) n FROM registration_requests WHERE status = 'pending'") },
      people: { students: await one('SELECT COUNT(*) n FROM students WHERE archived_at IS NULL'), teachers: await one("SELECT COUNT(*) n FROM users WHERE role = 'teacher' AND school_id IS NOT NULL AND active = 1"), parents: await one("SELECT COUNT(*) n FROM users WHERE role = 'parent' AND school_id IS NOT NULL AND active = 1") },
      finance: { revenue_total: await one('SELECT COALESCE(SUM(amount),0) n FROM subscription_payments'), revenue_month: await one('SELECT COALESCE(SUM(amount),0) n FROM subscription_payments WHERE substr(paid_on,1,7) = ?', month),
        payments: await one('SELECT COUNT(*) n FROM subscription_payments'), outstanding: subs.reduce((t, s) => t + s.outstanding, 0), outstanding_schools: subs.filter((s) => s.outstanding > 0).length,
        expiring: subs.filter((s) => s.state === 'expiring').length, expired: subs.filter((s) => s.state === 'expired').length, no_subscription: subs.filter((s) => s.state === 'none').length, by_plan: byPlan },
    };
  });

  // ----- plans -----
  route('GET', '/platform/plans', OWNER, async () => ({ currency: await currency(), plans: await h.all('SELECT * FROM platform_plans ORDER BY CASE code WHEN \'basic\' THEN 1 WHEN \'standard\' THEN 2 ELSE 3 END') }));
  route('PUT', '/platform/plans/:code', OWNER, async (c) => {
    const p = await h.get('SELECT * FROM platform_plans WHERE code = ?', c.params.code);
    if (!p) throw S.notFound();
    const price = c.body.price === undefined ? p.price : S.toInt(c.body.price), months = c.body.period_months === undefined ? p.period_months : S.toInt(c.body.period_months);
    const max = c.body.max_students === undefined ? p.max_students : (c.body.max_students === null || c.body.max_students === '' ? null : S.toInt(c.body.max_students));
    if (price === null || price < 0 || price > 1e9) throw S.bad('invalid_amount');
    if (months === null || months < 1 || months > 60) throw S.bad('invalid_data');
    if (max !== null && (max === undefined || max < 1)) throw S.bad('invalid_data');
    await h.run('UPDATE platform_plans SET price = ?, period_months = ?, max_students = ?, description = ? WHERE code = ?', price, months, max, c.body.description === undefined ? p.description : (S.str(c.body.description, 300) || null), p.code);
    await h.audit(null, c.user.id, 'platform_plan_changed', `plan:${p.code}`, { price, months });
  });

  // ----- subscriptions and payments -----
  route('GET', '/platform/subscriptions', OWNER, async (c) => {
    const where = ['1=1'], p = [];
    const q = S.str(c.query.q, 80);
    if (q) { where.push("(LOWER(s.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(s.code) LIKE LOWER(?) ESCAPE '\\')"); const l = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(l, l); }
    let rows = await subRows(where.join(' AND '), p);
    if (['basic', 'standard', 'premium'].includes(c.query.plan)) rows = rows.filter((r) => r.plan_code === c.query.plan);
    if (['none', 'active', 'expiring', 'expired'].includes(c.query.state)) rows = rows.filter((r) => r.state === c.query.state);
    if (c.query.owing === '1') rows = rows.filter((r) => r.outstanding > 0);
    return { currency: await currency(), rows };
  });
  route('POST', '/platform/schools/:id/subscription', OWNER, async (c) => {
    const id = S.toInt(c.params.id);
    const sc = id === null ? null : await h.get("SELECT id FROM schools WHERE id = ? AND approval = 'approved'", id);
    if (!sc) throw S.notFound();
    const plan = await h.get('SELECT * FROM platform_plans WHERE code = ?', c.body.plan_code);
    if (!plan) throw S.bad('invalid_plan');
    const starts = c.body.starts_on || today();
    if (!S.isDate(starts)) throw S.bad('invalid_date');
    const expires = c.body.expires_on || addMonths(starts, plan.period_months);
    if (!S.isDate(expires) || expires < starts) throw S.bad('invalid_date');
    const due = c.body.amount_due === undefined || c.body.amount_due === '' ? plan.price : S.toInt(c.body.amount_due);
    if (due === null || due < 0 || due > 1e10) throw S.bad('invalid_amount');
    const sid = await h.insert('INSERT INTO school_subscriptions (school_id, plan_code, starts_on, expires_on, amount_due, note, created_by) VALUES (?,?,?,?,?,?,?)', id, plan.code, starts, expires, due, S.str(c.body.note, 300) || null, c.user.id);
    await h.audit(id, c.user.id, 'subscription_set', `subscription:${sid}`, { plan: plan.code, expires });
    return { id: sid };
  });
  route('POST', '/platform/schools/:id/payments', OWNER, async (c) => {
    const id = S.toInt(c.params.id);
    const sc = id === null ? null : await h.get('SELECT id FROM schools WHERE id = ?', id);
    if (!sc) throw S.notFound();
    const sub = S.toInt(c.body.subscription_id) !== null ? await h.get('SELECT id FROM school_subscriptions WHERE id = ? AND school_id = ?', Number(c.body.subscription_id), id)
      : await h.get('SELECT id FROM school_subscriptions WHERE school_id = ? ORDER BY expires_on DESC, id DESC LIMIT 1', id);
    if (!sub) throw S.bad('no_subscription');
    const amount = S.toInt(c.body.amount);
    if (amount === null || amount < 1 || amount > 1e10) throw S.bad('invalid_amount');
    const paidOn = c.body.paid_on || today();
    if (!S.isDate(paidOn)) throw S.bad('invalid_date');
    if (!METHODS.includes(c.body.method)) throw S.bad('invalid_method');
    const pid = await h.insert('INSERT INTO subscription_payments (school_id, subscription_id, amount, paid_on, method, reference, note, recorded_by) VALUES (?,?,?,?,?,?,?,?)', id, sub.id, amount, paidOn, c.body.method, S.str(c.body.reference, 80) || null, S.str(c.body.note, 300) || null, c.user.id);
    await h.audit(id, c.user.id, 'payment_recorded', `payment:${pid}`, { amount, method: c.body.method });
    return { id: pid };
  });
  route('GET', '/platform/payments', OWNER, async (c) => {
    const where = ['1=1'], p = [];
    if (S.toInt(c.query.school_id) !== null) { where.push('p.school_id = ?'); p.push(Number(c.query.school_id)); }
    return { currency: await currency(), rows: await h.all(`SELECT p.id, p.school_id, s.name school_name, p.amount, p.paid_on, p.method, p.reference, p.note, v.plan_code, v.expires_on FROM subscription_payments p
      JOIN schools s ON s.id = p.school_id JOIN school_subscriptions v ON v.id = p.subscription_id WHERE ${where.join(' AND ')} ORDER BY p.paid_on DESC, p.id DESC LIMIT 300`, ...p) };
  });
  route('GET', '/platform/finance', OWNER, async () => {
    const months = [];
    const d = new Date(); d.setUTCDate(1);
    for (let i = 11; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); months.push(x.toISOString().slice(0, 7)); }
    const totals = Object.fromEntries((await h.all('SELECT substr(paid_on,1,7) m, SUM(amount) t FROM subscription_payments GROUP BY m')).map((r) => [r.m, r.t]));
    const subs = await subRows();
    return { currency: await currency(), months: months.map((m) => ({ month: m, total: totals[m] || 0 })), outstanding: subs.filter((s) => s.outstanding > 0).map((s) => ({ school_id: s.school_id, school_name: s.school_name, plan_code: s.plan_code, expires_on: s.expires_on, outstanding: s.outstanding })),
      expiring: subs.filter((s) => s.state === 'expiring' || s.state === 'expired').map((s) => ({ school_id: s.school_id, school_name: s.school_name, plan_code: s.plan_code, expires_on: s.expires_on, state: s.state, days_left: s.days_left })) };
  });

  // ----- announcements to school administrators (stored in-app notices; nothing is sent outside JAO) -----
  route('GET', '/platform/announcements', OWNER, async () => h.all('SELECT id, title, body, audience, recipients, created_at FROM platform_announcements ORDER BY id DESC LIMIT 100'));
  route('POST', '/platform/announcements', OWNER, async (c) => {
    const title = S.req(c.body.title, 'title_required', 120), body = S.req(c.body.body, 'body_required', 2000);
    let schools;
    if (c.body.school_ids === 'all' || c.body.school_ids === undefined) schools = await h.all("SELECT id FROM schools WHERE status = 'active' AND approval = 'approved'");
    else {
      if (!Array.isArray(c.body.school_ids) || !c.body.school_ids.length || c.body.school_ids.length > 500) throw S.bad('invalid_data');
      schools = [];
      for (const raw of new Set(c.body.school_ids.map(Number))) { const s = await h.get("SELECT id FROM schools WHERE id = ? AND status = 'active' AND approval = 'approved'", raw); if (!s) throw S.bad('invalid_school'); schools.push(s); }
    }
    let n = 0;
    const id = await h.insert('INSERT INTO platform_announcements (title, body, audience, sent_by) VALUES (?,?,?,?)', title, body, c.body.school_ids === 'all' || c.body.school_ids === undefined ? 'all' : 'selected', c.user.id);
    for (const s of schools) for (const u of await h.all("SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' AND active = 1", s.id)) { await app.notify(s.id, u.id, 'platform_announcement', { title, body, preview: String(body || '').replace(/\s+/g, ' ').trim().slice(0, 160) }, '#/overview'); n++; }
    await h.run('UPDATE platform_announcements SET recipients = ? WHERE id = ?', n, id);
    await h.audit(null, c.user.id, 'platform_announcement_sent', `announcement:${id}`, { recipients: n });
    return { id, recipients: n };
  });

  // ----- school administrator accounts -----
  route('GET', '/platform/admins', OWNER, async () => (await h.all(`SELECT u.id, u.name, u.email, u.active, u.last_login, u.school_id, s.name school_name, s.code school_code, s.status school_status
    FROM users u JOIN schools s ON s.id = u.school_id WHERE u.role = 'school_admin' ORDER BY s.name, u.name`)).map((u) => ({ ...u, active: !!u.active })));
  const adminOf = async (c) => {
    const id = S.toInt(c.params.id);
    const u = id === null ? null : await h.get("SELECT id, school_id, email, name, active FROM users WHERE id = ? AND role = 'school_admin' AND school_id IS NOT NULL", id);
    if (!u) throw S.notFound();
    return u;
  };
  route('POST', '/platform/admins/:id/status', OWNER, async (c) => {
    const u = await adminOf(c);
    if (typeof c.body.active !== 'boolean') throw S.bad('invalid_data');
    if (!c.body.active && (await h.get("SELECT COUNT(*) n FROM users WHERE school_id = ? AND role = 'school_admin' AND active = 1", u.school_id)).n <= 1 && u.active) { /* allowed: owner may lock a school out, it can be reversed */ }
    await h.run("UPDATE users SET active = ? WHERE id = ? AND school_id = ? AND role = 'school_admin'", c.body.active ? 1 : 0, u.id, u.school_id);
    if (!c.body.active) await h.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await h.audit(u.school_id, c.user.id, c.body.active ? 'school_admin_activated' : 'school_admin_deactivated', `user:${u.id}`);
  });
  route('POST', '/platform/admins/:id/password-reset', OWNER, async (c) => {
    const u = await adminOf(c);
    const token = crypto.randomBytes(32).toString('base64url');
    const sha = crypto.createHash('sha256').update(token).digest('hex');
    await h.tx(async () => {
      await h.run('UPDATE password_resets SET used_at = NOW_TS WHERE user_id = ? AND used_at IS NULL', u.id);
      await h.run('INSERT INTO password_resets (user_id, school_id, token_hash, created_by, expires_at) VALUES (?,?,?,?,?)', u.id, u.school_id, sha, c.user.id, h.nowPlusDays(1));
      await h.audit(u.school_id, c.user.id, 'password_reset_issued', `user:${u.id}`);
    });
    return { path: `/#/reset/${token}`, admin_name: u.name, admin_email: u.email, hours: 24 };
  });

  // ----- activity and security monitoring -----
  route('GET', '/platform/activity', OWNER, async (c) => {
    const where = ['1=1'], p = [];
    if (S.toInt(c.query.school_id) !== null) { where.push('a.school_id = ?'); p.push(Number(c.query.school_id)); }
    const q = S.str(c.query.action, 60);
    if (q) { where.push("a.action LIKE ? ESCAPE '\\'"); p.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
    return h.all(`SELECT a.id, a.at, a.action, a.record, s.name school_name, u.name actor FROM audit_log a LEFT JOIN schools s ON s.id = a.school_id LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 200`, ...p);   // meta is deliberately not returned
  });
  route('GET', '/platform/security', OWNER, async () => {
    const n = async (sql, ...p) => (await h.get(sql, ...p)).n;
    const since = (days) => h.nowPlusDays(-days);
    const failing = await h.all(`SELECT email, COUNT(*) fails, MAX(at) last_at FROM login_log WHERE ok = 0 AND at > ? GROUP BY lower(email) HAVING fails >= 3 ORDER BY fails DESC LIMIT 20`, since(1));
    return {
      failed_logins_24h: await n('SELECT COUNT(*) n FROM login_log WHERE ok = 0 AND at > ?', since(1)), failed_logins_7d: await n('SELECT COUNT(*) n FROM login_log WHERE ok = 0 AND at > ?', since(7)),
      successful_logins_24h: await n('SELECT COUNT(*) n FROM login_log WHERE ok = 1 AND at > ?', since(1)), active_sessions: await n('SELECT COUNT(*) n FROM sessions WHERE expires_at > ?', Date.now()),
      suspended_schools: await n("SELECT COUNT(*) n FROM schools WHERE status = 'suspended' AND approval = 'approved'"), deactivated_admins: await n("SELECT COUNT(*) n FROM users WHERE role = 'school_admin' AND active = 0"),
      repeated_failures: failing,
      recent_sensitive: await h.all(`SELECT a.at, a.action, s.name school_name FROM audit_log a LEFT JOIN schools s ON s.id = a.school_id WHERE a.action IN ('owner_password_reset_local','password_reset_issued','school_suspended','school_admin_deactivated','school_rejected','payment_recorded','subscription_set') ORDER BY a.id DESC LIMIT 15`),
    };
  });

  // ----- reports (CSV) -----
  route('GET', '/platform/export', OWNER, async (c) => {
    const type = ['schools', 'subscriptions', 'payments', 'activity'].includes(c.query.type) ? c.query.type : 'schools';
    let body;
    if (type === 'schools') body = csv(['name', 'code', 'type', 'location', 'status', 'approval', 'created_at', 'students', 'teachers', 'parents'], await Promise.all((await h.all('SELECT * FROM schools ORDER BY name')).map(async (s) => [s.name, s.code, s.school_type, s.location, s.status, s.approval, s.created_at,
      (await h.get('SELECT COUNT(*) n FROM students WHERE school_id = ? AND archived_at IS NULL', s.id)).n, (await h.get("SELECT COUNT(*) n FROM users WHERE school_id = ? AND role = 'teacher'", s.id)).n, (await h.get("SELECT COUNT(*) n FROM users WHERE school_id = ? AND role = 'parent'", s.id)).n])));
    else if (type === 'subscriptions') body = csv(['school', 'code', 'plan', 'starts_on', 'expires_on', 'state', 'amount_due', 'paid', 'outstanding'], (await subRows()).map((r) => [r.school_name, r.school_code, r.plan_code, r.starts_on, r.expires_on, r.state, r.amount_due, r.paid, r.outstanding]));
    else if (type === 'payments') body = csv(['id', 'school', 'plan', 'amount', 'paid_on', 'method', 'reference'], (await h.all('SELECT p.id, s.name school_name, v.plan_code, p.amount, p.paid_on, p.method, p.reference FROM subscription_payments p JOIN schools s ON s.id = p.school_id JOIN school_subscriptions v ON v.id = p.subscription_id ORDER BY p.paid_on, p.id'))
      .map((r) => [r.id, r.school_name, r.plan_code, r.amount, r.paid_on, r.method, r.reference]));
    else body = csv(['at', 'school', 'actor', 'action', 'record'], (await h.all('SELECT a.at, s.name school_name, u.name actor, a.action, a.record FROM audit_log a LEFT JOIN schools s ON s.id = a.school_id LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 5000')).map((r) => [r.at, r.school_name, r.actor, r.action, r.record]));
    await h.audit(null, c.user.id, 'platform_export', `export:${type}`);
    return { __raw: true, body: Buffer.from(body, 'utf8'), headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="jao-${type}.csv"` } };
  });
};
