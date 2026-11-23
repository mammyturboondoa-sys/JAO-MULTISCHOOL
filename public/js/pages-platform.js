// Super Administrator tools (owner only): overview, subscriptions, finance, announcements, administrators, activity, settings.
import { state, t, h, get, post, put, navigate, field, input, select, toast, fail, load, empty, badge, fmtDate, confirmDialog, modal, svgIcon } from './ui.js';

const TABS = ['overview', 'subs', 'finance', 'ann', 'admins', 'catalogue', 'activity', 'settings'];
const stat = (cls, icon, num, label) => h('div', { class: `stat ${cls}` }, svgIcon(icon, 34), h('div', h('div', { class: 'num' }, String(num)), h('div', { class: 'lbl' }, label)));
const money = (n, cur) => `${Number(n || 0).toLocaleString(state.lang === 'fr' ? 'fr-FR' : 'en-US')} ${cur || ''}`.trim();
const STATE_COLOR = { none: 'gold', active: 'green', expiring: 'gold', expired: 'red' };
const table = (head, rows) => (rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', head.map((x) => h('th', x)))), h('tbody', rows.map((r) => h('tr', r.map((c, i) => h('td', { 'data-label': head[i] }, c))))))) : empty(t('pf.none'), ''));
const dl = (type) => h('a', { class: 'btn btn-sm btn-ghost', href: `/api/platform/export?type=${type}`, download: '' }, t(`pf.x_${type}`));

export async function platformToolsPage(ctx, view) {
  const tab = TABS.includes(ctx.query.tab) ? ctx.query.tab : 'overview';
  const bar = h('div', { class: 'tabs', role: 'tablist' }, TABS.map((k) => h('a', { class: 'tab', role: 'tab', 'aria-selected': String(k === tab), href: `#/platform/tools?tab=${k}` }, t(`pf.t_${k}`))));
  const body = h('div');
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('pf.title')), h('p', t('pf.sub'))), h('a', { class: 'btn btn-ghost', href: '#/platform' }, t('pf.schools_page'))), bar, body);
  const P = { overview, subs, finance, ann, admins, catalogue, activity, settings }[tab];
  await P(body);
}

async function overview(body) {
  await load(body, () => get('/platform/overview'), (o) => h('div',
    h('div', { class: 'grid grid-4' }, stat('stat-blue', 'platform', o.schools.total, t('pf.total_schools')), stat('stat-green', 'check', o.schools.active, t('pf.active')), stat('stat-red', 'close', o.schools.suspended, t('pf.suspended')), stat('stat-gold', 'bell', o.schools.pending, t('pf.pending'))),
    h('div', { class: 'grid grid-4', style: { marginTop: '1rem' } }, stat('stat-blue', 'classes', o.people.students, t('pf.students')), stat('stat-green', 'classes', o.people.teachers, t('pf.teachers')), stat('stat-gold', 'classes', o.people.parents, t('pf.parents'))),
    h('h2', { style: { marginTop: '1.5rem' } }, t('pf.t_finance')),
    h('div', { class: 'grid grid-4' }, stat('stat-green', 'check', money(o.finance.revenue_total, o.currency), t('pf.revenue')), stat('stat-blue', 'check', money(o.finance.revenue_month, o.currency), t('pf.revenue_month')), stat('stat-red', 'close', money(o.finance.outstanding, o.currency), t('pf.outstanding')), stat('stat-gold', 'bell', o.finance.expiring, t('pf.expiring'))),
    h('div', { class: 'grid grid-4', style: { marginTop: '1rem' } }, stat('stat-red', 'close', o.finance.expired, t('pf.expired')), stat('stat-gold', 'bell', o.finance.no_subscription, t('pf.no_sub')),
      stat('stat-blue', 'platform', `${o.finance.by_plan.basic} / ${o.finance.by_plan.standard} / ${o.finance.by_plan.premium}`, `${t('pf.basic')} / ${t('pf.standard')} / ${t('pf.premium')}`)),
    h('div', { style: { marginTop: '1.5rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' } }, h('strong', t('pf.exports')), ['schools', 'subscriptions', 'payments', 'activity'].map(dl))));
}

async function subs(body) {
  const q = input({ type: 'search', placeholder: t('pf.search'), 'aria-label': t('pf.search') });
  const plan = select([['', t('pf.all')], ...['basic', 'standard', 'premium'].map((p) => [p, t(`pf.${p}`)])]), st = select([['', t('pf.all')], ...['none', 'active', 'expiring', 'expired'].map((p) => [p, t(`pf.state_${p}`)])]);
  const owing = h('input', { type: 'checkbox' });
  const list = h('div'), plans = h('div');
  const cur = (await get('/platform/plans')).currency;
  const refresh = () => load(list, () => get(`/platform/subscriptions?q=${encodeURIComponent(q.value)}&plan=${plan.value}&state=${st.value}&owing=${owing.checked ? 1 : 0}`), (d) => table(
    [t('portal.school_name'), t('pf.plan'), t('pf.expires'), t('form.status'), t('pf.due'), t('pf.paid'), t('pf.balance'), ''],
    d.rows.map((r) => [h('div', h('strong', r.school_name), h('div', { class: 'small muted' }, r.school_code)), r.plan_code ? t(`pf.${r.plan_code}`) : '—', r.expires_on ? fmtDate(r.expires_on) : '—', badge(t(`pf.state_${r.state}`), STATE_COLOR[r.state]),
      r.sub_id ? money(r.amount_due, cur) : '—', r.sub_id ? money(r.paid, cur) : '—', r.sub_id ? money(r.outstanding, cur) : '—',
      h('div', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm', onclick: () => subModal(r, refresh, cur) }, t('pf.set_sub')), r.sub_id ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => payModal(r, refresh) }, t('pf.record_pay')) : null)])));
  [q].forEach((x) => x.addEventListener('input', refresh)); [plan, st, owing].forEach((x) => x.addEventListener('change', refresh));
  const paintPlans = () => load(plans, () => get('/platform/plans'), (d) => h('div', { class: 'grid grid-3' }, d.plans.map((p) => {
    const price = input({ type: 'number', min: 0, value: p.price }), months = input({ type: 'number', min: 1, max: 60, value: p.period_months }), max = input({ type: 'number', min: 1, value: p.max_students ?? '' });
    return h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await put(`/platform/plans/${p.code}`, { price: price.value, period_months: months.value, max_students: max.value === '' ? null : max.value }); toast(t('pf.saved')); } catch (x) { fail(x); } } },
      h('h3', t(`pf.${p.code}`)), field(`${t('pf.price')} (${d.currency})`, price), field(t('pf.months'), months), field(t('pf.max_students'), max), h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, t('common.save')));
  })));
  body.replaceChildren(h('div', { class: 'notice notice-blue' }, t('pf.pay_note')), h('div', { class: 'toolbar', style: { marginTop: '.75rem' } }, h('div', { class: 'grow' }, q), h('div', plan), h('div', st), h('label', { class: 'small' }, owing, ` ${t('pf.owing')}`), dl('subscriptions')),
    list, h('h2', { style: { marginTop: '1.5rem' } }, t('pf.plans')), plans);
  refresh(); paintPlans();
}

function subModal(r, done, cur) {
  const plan = select(['basic', 'standard', 'premium'].map((p) => [p, t(`pf.${p}`)])); if (r.plan_code) plan.value = r.plan_code;
  const starts = input({ type: 'date', value: new Date().toISOString().slice(0, 10) }), exp = input({ type: 'date' }), due = input({ type: 'number', min: 0 }), note = input({ maxlength: 300 });
  modal({ title: `${t('pf.set_sub')}: ${r.school_name}`, body: h('form', { onsubmit: (e) => e.preventDefault() }, field(t('pf.plan'), plan), field(t('pf.starts'), starts), field(`${t('pf.expires')} (${t('pf.none')})`, exp), field(`${t('pf.due')} (${cur})`, due), field(t('pf.note'), note)),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      try { await post(`/platform/schools/${r.school_id}/subscription`, { plan_code: plan.value, starts_on: starts.value || undefined, expires_on: exp.value || undefined, amount_due: due.value === '' ? undefined : due.value, note: note.value }); toast(t('pf.saved')); c(); done(); } catch (e) { fail(e); } } }] });
}
function payModal(r, done) {
  const amount = input({ type: 'number', min: 1, value: r.outstanding || '' }), date = input({ type: 'date', value: new Date().toISOString().slice(0, 10) }), method = select(['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'].map((m) => [m, t(`pf.m_${m}`)])), ref = input({ maxlength: 80 }), note = input({ maxlength: 300 });
  modal({ title: `${t('pf.record_pay')}: ${r.school_name}`, body: h('form', { onsubmit: (e) => e.preventDefault() }, field(t('pf.amount'), amount, { required: true }), field(t('pf.paid_on'), date), field(t('pf.method'), method), field(t('pf.reference'), ref), field(t('pf.note'), note)),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      try { await post(`/platform/schools/${r.school_id}/payments`, { subscription_id: r.sub_id, amount: amount.value, paid_on: date.value, method: method.value, reference: ref.value, note: note.value }); toast(t('pf.saved')); c(); done(); } catch (e) { fail(e); } } }] });
}

async function finance(body) {
  const pay = h('div');
  await load(body, () => get('/platform/finance'), (f) => {
    const max = Math.max(1, ...f.months.map((m) => m.total));
    load(pay, () => get('/platform/payments'), (d) => table([t('common.date'), t('portal.school_name'), t('pf.plan'), t('pf.amount'), t('pf.method'), t('pf.reference')], d.rows.map((p) => [fmtDate(p.paid_on), p.school_name, t(`pf.${p.plan_code}`), money(p.amount, d.currency), t(`pf.m_${p.method}`), p.reference || '—'])));
    return h('div', h('h2', t('pf.monthly')),
      h('div', { class: 'bars', style: { display: 'flex', alignItems: 'flex-end', gap: '6px', height: '140px', margin: '.5rem 0 1rem' } }, f.months.map((m) => h('div', { style: { flex: '1', textAlign: 'center', fontSize: '.7rem' }, title: `${m.month}: ${money(m.total, f.currency)}` },
        h('div', { style: { height: `${Math.round((m.total / max) * 100)}px`, minHeight: '2px', background: 'var(--gold, #c9a227)', borderRadius: '3px 3px 0 0' } }), m.month.slice(5)))),
      h('h2', t('pf.outstanding')), table([t('portal.school_name'), t('pf.plan'), t('pf.expires'), t('pf.balance')], f.outstanding.map((o) => [o.school_name, t(`pf.${o.plan_code}`), fmtDate(o.expires_on), money(o.outstanding, f.currency)])),
      h('h2', { style: { marginTop: '1.5rem' } }, t('pf.expiring')), table([t('portal.school_name'), t('pf.plan'), t('pf.expires'), t('form.status')], f.expiring.map((o) => [o.school_name, t(`pf.${o.plan_code}`), fmtDate(o.expires_on), badge(t(`pf.state_${o.state}`), STATE_COLOR[o.state])])),
      h('h2', { style: { marginTop: '1.5rem' } }, t('pf.payments')), pay, h('div', { style: { marginTop: '1rem' } }, dl('payments')));
  });
}

async function ann(body) {
  const title = input({ maxlength: 120 }), text = h('textarea', { rows: 4, maxlength: 2000, class: 'input' }), pick = h('input', { type: 'radio', name: 'aud' }), all = h('input', { type: 'radio', name: 'aud', checked: true });
  const schools = h('div', { style: { display: 'none', maxHeight: '180px', overflow: 'auto', margin: '.5rem 0' } }), hist = h('div');
  const list = (await get('/platform/schools')).filter((s) => s.approval === 'approved' && s.status === 'active');
  const boxes = list.map((s) => ({ s, cb: h('input', { type: 'checkbox' }) }));
  schools.replaceChildren(...boxes.map(({ s, cb }) => h('label', { style: { display: 'block' } }, cb, ` ${s.name}`)));
  [pick, all].forEach((r) => r.addEventListener('change', () => { schools.style.display = pick.checked ? 'block' : 'none'; }));
  const paintHist = () => load(hist, () => get('/platform/announcements'), (rows) => table([t('common.date'), t('pf.ann_title'), t('pf.recipients')], rows.map((r) => [fmtDate(r.created_at), h('div', h('strong', r.title), h('div', { class: 'small muted' }, r.body)), String(r.recipients)])));
  body.replaceChildren(h('div', { class: 'notice notice-blue' }, t('pf.ann_how')), h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault();
    try { const ids = pick.checked ? boxes.filter((b) => b.cb.checked).map((b) => b.s.id) : 'all'; const r = await post('/platform/announcements', { title: title.value, body: text.value, school_ids: ids }); toast(t('pf.ann_sent', { n: r.recipients })); title.value = text.value = ''; paintHist(); } catch (x) { fail(x); } } },
    h('h2', t('pf.ann_new')), field(t('pf.ann_title'), title, { required: true }), field(t('pf.ann_body'), text, { required: true }),
    h('label', { style: { display: 'block' } }, all, ` ${t('pf.ann_to_all')}`), h('label', { style: { display: 'block' } }, pick, ` ${t('pf.ann_to_pick')}`), schools, h('button', { class: 'btn btn-primary', type: 'submit' }, t('pf.ann_send'))),
    h('h2', { style: { marginTop: '1.5rem' } }, t('pf.ann_history')), hist);
  paintHist();
}

async function admins(body) {
  const run = () => load(body, () => get('/platform/admins'), (rows) => table([t('portal.admin_name'), t('portal.school_name'), t('pf.last_login'), t('form.status'), ''], rows.map((u) => [h('div', h('strong', u.name), h('div', { class: 'small muted' }, u.email)),
    h('div', u.school_name, h('div', { class: 'small muted' }, u.school_code)), u.last_login ? fmtDate(u.last_login) : t('pf.never'), badge(u.active ? t('pf.active') : t('pf.inactive'), u.active ? 'green' : 'red'),
    h('div', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm', onclick: async () => { if (u.active && !(await confirmDialog(t('pf.admin_deact_confirm', { name: u.name }), t('pf.admin_deact')))) return;
        try { await post(`/platform/admins/${u.id}/status`, { active: !u.active }); toast(t('pf.saved')); run(); } catch (e) { fail(e); } } }, u.active ? t('pf.admin_deact') : t('pf.admin_act')),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (!(await confirmDialog(t('platform.reset_confirm', { name: u.name }), t('platform.reset_pw'), false))) return;
        try { const x = await post(`/platform/admins/${u.id}/password-reset`); modal({ title: t('platform.reset_ready'), body: h('div', h('p', `${x.admin_name} (${x.admin_email})`), h('input', { class: 'input', readonly: true, value: location.origin + x.path, onfocus: (e) => e.target.select() }), h('p', { class: 'small muted' }, t('platform.reset_hours', { n: x.hours }))), actions: [{ label: t('common.close'), class: 'btn-primary', onclick: (c) => c() }] }); } catch (e) { fail(e); } } }, t('platform.reset_pw')))])));
  run();
}

async function activity(body) {
  const f = input({ type: 'search', placeholder: t('pf.filter_action') }), log = h('div'), sec = h('div');
  const paint = () => load(log, () => get(`/platform/activity?action=${encodeURIComponent(f.value)}`), (rows) => table([t('pf.when'), t('pf.school'), t('pf.who'), t('pf.action')], rows.map((r) => [fmtDate(r.at), r.school_name || '—', r.actor || '—', h('code', r.action)])));
  f.addEventListener('input', paint);
  load(sec, () => get('/platform/security'), (s) => h('div', h('div', { class: 'grid grid-4' }, stat('stat-red', 'close', s.failed_logins_24h, t('pf.fail24')), stat('stat-gold', 'bell', s.failed_logins_7d, t('pf.fail7')), stat('stat-green', 'check', s.successful_logins_24h, t('pf.ok24')), stat('stat-blue', 'platform', s.active_sessions, t('pf.sessions'))),
    h('h3', { style: { marginTop: '1rem' } }, t('pf.repeated')), table(['Email', t('pf.attempts'), t('pf.when')], s.repeated_failures.map((r) => [r.email || '—', String(r.fails), fmtDate(r.last_at)])),
    h('h3', { style: { marginTop: '1rem' } }, t('pf.sensitive')), table([t('pf.when'), t('pf.school'), t('pf.action')], s.recent_sensitive.map((r) => [fmtDate(r.at), r.school_name || '—', h('code', r.action)]))));
  body.replaceChildren(sec, h('h2', { style: { marginTop: '1.5rem' } }, t('pf.log')), h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, f), dl('activity')), log); paint();
}

function settings(body) {
  const cur = input({ type: 'password', autocomplete: 'current-password' }), nw = input({ type: 'password', autocomplete: 'new-password' }), nw2 = input({ type: 'password', autocomplete: 'new-password' });
  body.replaceChildren(h('form', { class: 'card', style: { maxWidth: '480px' }, onsubmit: async (e) => { e.preventDefault(); if (nw.value !== nw2.value) return toast(t('err.password_mismatch'), 'error');
    try { await post('/auth/change-password', { current_password: cur.value, new_password: nw.value }); toast(t('auth.password_changed')); cur.value = nw.value = nw2.value = ''; } catch (x) { fail(x); } } },
    h('h2', t('pf.pw_title')), h('p', { class: 'small muted' }, t('pf.pw_hint')), field(t('auth.current_password'), cur, { required: true }), field(t('auth.new_password'), nw, { required: true }), field(t('auth.confirm_password'), nw2, { required: true }),
    h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save')), h('p', { class: 'small muted', style: { marginTop: '1rem' } }, t('pf.pw_forgot'))));
}
void navigate;

// ----- shared catalogue of external scholarships (Scholarship Finder) -----
async function catalogue(body) {
  const run = () => load(body, () => get('/platform/external-scholarships'), (rows) => h('div',
    h('div', { class: 'notice notice-blue' }, t('fd.owner_note')),
    h('div', { style: { display: 'flex', gap: '.5rem', margin: '.75rem 0', flexWrap: 'wrap' } }, h('button', { class: 'btn btn-primary', onclick: () => editEntry(null, run) }, t('fd.add')),
      h('button', { class: 'btn btn-ghost', onclick: async () => { try { const r = await post('/platform/external-scholarships/starter', {}); toast(t('fd.starter_done', { n: r.added })); run(); } catch (e) { fail(e); } } }, t('fd.starter'))),
    table([t('fd.title'), t('fd.provider'), t('fd.deadline'), t('fd.verified'), t('fd.schools'), t('form.status'), ''], rows.map((e) => [h('strong', e.title), e.provider, e.deadline ? fmtDate(e.deadline) : '—', fmtDate(e.last_verified_on), String(e.schools),
      badge(t(`fd.st_${e.status}`), e.status === 'published' ? 'green' : e.status === 'draft' ? 'gold' : 'red'), h('button', { class: 'btn btn-sm', onclick: () => editEntry(e, run) }, t('common.edit'))]))));
  run();
}
function editEntry(e, done) {
  const v = e || {}, f = {};
  const mk = (k, label, props = {}, area = false) => { f[k] = area ? h('textarea', { class: 'input', rows: 3, maxlength: 3000, ...props }, v[k] || '') : input({ value: v[k] || '', ...props }); return field(label, f[k], props.required ? { required: true } : undefined); };
  const status = select([['draft', t('fd.st_draft')], ['published', t('fd.st_published')], ['archived', t('fd.st_archived')]]); status.value = v.status || 'draft';
  modal({ title: e ? e.title : t('fd.add'), wide: true, body: h('form', { onsubmit: (x) => x.preventDefault() }, mk('title', t('fd.title'), { required: true, maxlength: 160 }), mk('provider', t('fd.provider'), { required: true, maxlength: 160 }), mk('country', t('fd.country'), { maxlength: 120 }), mk('levels', t('fd.level'), { maxlength: 160 }),
    mk('eligibility', t('fd.eligibility'), {}, true), mk('coverage', t('fd.coverage'), {}, true), mk('how_to_apply', t('fd.how'), {}, true), mk('official_url', t('fd.official_url'), { required: true, type: 'url', placeholder: 'https://' }),
    mk('deadline', `${t('fd.deadline')} (${t('fd.only_if_stated')})`, { type: 'date' }), mk('deadline_note', t('fd.deadline_note'), { maxlength: 600 }), mk('last_verified_on', t('fd.verified'), { required: true, type: 'date', value: v.last_verified_on || new Date().toISOString().slice(0, 10) }), field(t('form.status'), status)),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      const data = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])); data.status = status.value;
      try { if (e) await put(`/platform/external-scholarships/${e.id}`, data); else await post('/platform/external-scholarships', data); toast(t('pf.saved')); c(); done(); } catch (x) { fail(x); } } }] });
}
