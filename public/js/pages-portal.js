// Multi-School Portal: the first page, school search, per-school sign-in, "Create a New School", and the super administrator pages.
import { state, t, h, get, post, navigate, brand, langSwitch, svgIcon, field, input, select, toast, fail, load, empty, spinner, readImage, ApiError, errText,
  badge, fmtDate, confirmDialog, showSecret, modal } from './ui.js';

export const SCHOOL_TYPES = ['nursery', 'primary', 'nursery_primary', 'secondary_general', 'secondary_technical', 'vocational', 'higher_education', 'other'];
export const typeLabel = (v) => (v ? t(`stype.${v}`) : '—');
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const schoolMark = (s, size = 52) => (s.logo ? h('img', { class: 'school-logo', src: s.logo, alt: '', style: { width: `${size}px`, height: `${size}px` } })
  : h('div', { class: 'school-logo school-logo-ph', style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' }, initials(s.name)));
const signInError = (ex) => (ex.code === 'network' ? t('err.network') : ex.code === 'too_many_attempts' ? t('err.too_many_attempts') : ['school_pending', 'school_rejected', 'school_suspended'].includes(ex.code) ? errText(ex.code) : t('err.invalid_credentials'));

// ---------- First page ----------
export function portalPage(root) {
  const q = input({ type: 'search', placeholder: t('portal.search_placeholder'), 'aria-label': t('portal.search_label'), maxlength: 80, autocomplete: 'off' });
  const results = h('div', { class: 'portal-results', 'aria-live': 'polite' });
  let timer, seq = 0;
  const run = async () => {
    const v = q.value.trim(); const mine = ++seq;
    if (v.length < 2) { results.replaceChildren(v ? h('p', { class: 'small muted' }, t('portal.type_more')) : ''); return; }
    try {
      const list = await get(`/public/schools/search?q=${encodeURIComponent(v)}`);
      if (mine !== seq) return;
      results.replaceChildren(list.length ? h('ul', { class: 'school-list' }, list.map((s) => h('li', h('a', { class: 'school-row', href: `#/school/${encodeURIComponent(s.slug)}` },
        schoolMark(s, 44), h('div', { class: 'grow' }, h('strong', s.name), h('div', { class: 'small muted' }, [typeLabel(s.school_type), s.location, s.code].filter((x) => x && x !== '—').join(' · '))), svgIcon('check', 18)))))
        : h('p', { class: 'muted' }, t('portal.none_found')));
    } catch (ex) { results.replaceChildren(h('p', { class: 'error-text' }, ex.code === 'too_many_attempts' ? t('err.too_many_attempts') : t('err.network'))); }
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  root.replaceChildren(h('div', { class: 'portal' },
    h('header', { class: 'welcome-top' }, brand({ light: true }), langSwitch()),
    h('main', { class: 'portal-main' },
      h('h1', { class: 'portal-title' }, t('portal.title')),
      h('p', { class: 'portal-sub' }, t('portal.subtitle')),
      h('div', { class: 'portal-grid' },
        h('section', { class: 'portal-card' }, h('div', { class: 'portal-ico' }, svgIcon('search', 28)), h('h2', t('portal.enter_title')), h('p', { class: 'muted' }, t('portal.enter_text')),
          h('form', { role: 'search', onsubmit: (e) => { e.preventDefault(); clearTimeout(timer); run(); } }, q), results),
        h('section', { class: 'portal-card portal-card-gold' }, h('div', { class: 'portal-ico' }, svgIcon('plus', 28)), h('h2', t('portal.create_title')), h('p', { class: 'muted' }, t('portal.create_text')),
          h('a', { class: 'btn btn-primary btn-block', href: '#/register' }, t('portal.create_btn')))),
      h('a', { class: 'btn btn-gold btn-block parent-access-btn', href: '#/parent-access', style: { maxWidth: '420px', margin: '1.25rem auto 0', display: 'flex', justifyContent: 'center', gap: '.5rem', alignItems: 'center' } }, svgIcon('students', 22), t('start.parent')),
      h('p', { class: 'portal-sub', style: { textAlign: 'center', marginTop: '.5rem' } }, t('start.parent_text')),
      h('p', { class: 'portal-foot' }, h('a', { href: '#/shops' }, t('start.shop')), ' · ', h('a', { href: '#/super' }, t('portal.super_link'))),
      h('p', { class: 'small', style: { color: '#9fb6e3' } }, t('brand.by')))));
  q.focus({ preventScroll: true });
}

// ---------- Sign in (to one school, or as super administrator) ----------
export function signInPage(root, { slug, platform }, onDone) {
  const card = h('div', { class: 'auth-card' });
  root.replaceChildren(h('div', { class: 'auth-page' }, card));
  const email = input({ type: 'email', autocomplete: 'username', required: true }), pw = input({ type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'error-text', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.sign_in'));
  const form = (info) => h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try {
      const r = await post('/auth/login', { email: email.value, password: pw.value, ...(platform ? { scope: 'platform' } : { school_slug: slug }) });
      state.user = r.user; state.csrf = r.csrf;
      const me = await get('/auth/me'); state.school = me.school;
      if (r.user.role === 'school_admin') { try { state.school = { ...me.school, ...(await get('/settings/school')) }; } catch { /* ok */ } }
      onDone();
    } catch (ex) { err.textContent = signInError(ex); btn.disabled = false; }
  } }, field(t('auth.email'), email, { required: true }), field(t('auth.password'), pw, { required: true }), err, btn,
  h('p', { class: 'small muted', style: { marginTop: '1rem' } }, t('auth.forgot_help')),
  platform ? h('p', { class: 'small' }, h('a', { href: '#/super/recover' }, t('owner.forgot_link'))) : null,
  h('p', { style: { marginTop: '.5rem' } }, h('a', { href: '#/start' }, platform ? t('common.back') : t('portal.switch_school'))), info);
  if (platform) { card.replaceChildren(brand(), h('h1', { style: { textAlign: 'center' } }, t('portal.super_title')), h('p', { class: 'muted', style: { textAlign: 'center' } }, t('portal.super_text')), form()); email.focus(); return; }
  card.replaceChildren(spinner());
  get(`/public/schools/${encodeURIComponent(slug)}`).then((s) => {
    const head = h('div', { class: 'school-head' }, schoolMark(s, 64), h('h1', s.name), s.code ? h('div', { class: 'code-chip' }, s.code) : null, s.motto ? h('p', { class: 'muted' }, s.motto) : null);
    if (s.state && s.state !== 'active') { card.replaceChildren(head, h('div', { class: 'notice notice-gold' }, t(`portal.state_${s.state}`)), h('a', { class: 'btn btn-primary btn-block', href: '#/start' }, t('portal.switch_school'))); return; }
    card.replaceChildren(head, form()); email.focus();
  }).catch(() => card.replaceChildren(brand(), empty(t('portal.not_found'), t('portal.not_found_text'), h('a', { class: 'btn btn-primary', href: '#/start' }, t('portal.switch_school')))));
}

// ---------- Set a new password from a one-time reset link ----------
export function resetPasswordPage(root, token, onDone) {
  const card = h('div', { class: 'auth-card' }); root.replaceChildren(h('div', { class: 'auth-page' }, card)); card.replaceChildren(spinner());
  get(`/public/password-reset/${encodeURIComponent(token)}`).then((info) => {
    const pw = input({ type: 'password', required: true, autocomplete: 'new-password' }), pc = input({ type: 'password', required: true, autocomplete: 'new-password' });
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('reset.save'));
    card.replaceChildren(brand(), h('h1', { style: { textAlign: 'center' } }, t('reset.title')), h('p', { class: 'muted', style: { textAlign: 'center' } }, t('reset.for', { school: info.school_name, email: info.email })),
      h('form', { onsubmit: async (e) => { e.preventDefault();
        if (pw.value !== pc.value) return toast(t('err.password_mismatch'), 'error');
        btn.disabled = true;
        try { await post(`/public/password-reset/${encodeURIComponent(token)}`, { password: pw.value, password_confirm: pc.value });
          card.replaceChildren(brand(), h('div', { class: 'success-ico' }, svgIcon('check', 34)), h('h1', { style: { textAlign: 'center' } }, t('reset.done')), h('p', { class: 'muted', style: { textAlign: 'center' } }, t('reset.done_text')),
            h('a', { class: 'btn btn-primary btn-block', href: '#/start' }, t('reset.go_signin')));
        } catch (ex) { fail(ex); btn.disabled = false; } } },
      field(t('reset.new_password'), pw, { required: true, hint: t('auth.password_rules') }), field(t('auth.confirm_password'), pc, { required: true }), btn));
  }).catch(() => card.replaceChildren(brand(), empty(t('reset.invalid'), t('reset.invalid_text'), h('a', { class: 'btn btn-primary', href: '#/start' }, t('portal.switch_school')))));
}
void 0;

// ---------- Create a New School ----------
export function registerPage(root) {
  const f = { school_name: input({ maxlength: 120, required: true }), school_type: select([['', t('portal.choose')], ...SCHOOL_TYPES.map((v) => [v, typeLabel(v)])], '', { required: true }),
    address: input({ maxlength: 200, required: true }), location: input({ maxlength: 120, required: true, placeholder: t('portal.location_ph') }), email: input({ type: 'email', required: true, maxlength: 200 }),
    phone: input({ type: 'tel', required: true, maxlength: 30 }), admin_name: input({ maxlength: 120, required: true, autocomplete: 'name' }), admin_email: input({ type: 'email', required: true, maxlength: 200, autocomplete: 'email' }),
    password: input({ type: 'password', required: true, autocomplete: 'new-password' }), password_confirm: input({ type: 'password', required: true, autocomplete: 'new-password' }) };
  let logo = null; const prev = h('div', { class: 'logo-prev' }, h('span', { class: 'small muted' }, t('portal.logo_none')));
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': t('portal.logo'), onchange: async (e) => {
    try { logo = await readImage(e.target.files[0]); prev.replaceChildren(logo ? h('img', { src: logo, alt: '', style: { width: '72px', height: '72px', objectFit: 'contain' } }) : h('span', { class: 'small muted' }, t('portal.logo_none'))); } catch (ex) { logo = null; e.target.value = ''; fail(ex); } } });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('portal.register_btn'));
  const sec = (title, ...kids) => h('fieldset', { class: 'form-sec' }, h('legend', title), h('div', { class: 'form-grid' }, kids));
  const card = h('div', { class: 'auth-card auth-wide' });
  card.append(brand(), h('h1', { style: { textAlign: 'center' } }, t('portal.register_title')), h('p', { class: 'muted', style: { textAlign: 'center' } }, t('portal.register_text')),
    h('form', { novalidate: false, onsubmit: async (e) => {
      e.preventDefault();
      if (f.password.value !== f.password_confirm.value) return toast(t('err.password_mismatch'), 'error');
      btn.disabled = true;
      try {
        const r = await post('/public/register-school', { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), logo });
        card.replaceChildren(brand(), h('div', { class: 'success-ico' }, svgIcon('check', 34)), h('h1', { style: { textAlign: 'center' } }, t('portal.created_title')),
          h('p', { style: { textAlign: 'center' } }, t('portal.created_name', { name: r.school_name })), h('div', { class: 'code-chip big' }, r.school_code),
          h('p', { class: 'muted' }, t('portal.created_code_help')), h('div', { class: `notice ${r.state === 'pending' ? 'notice-gold' : 'notice-blue'}` }, t(r.state === 'pending' ? 'portal.created_pending' : 'portal.created_active')),
          h('a', { class: 'btn btn-primary btn-block', href: `#/school/${encodeURIComponent(r.slug)}` }, t('portal.go_signin')));
      } catch (ex) { fail(ex); btn.disabled = false; }
    } },
    sec(t('portal.sec_school'), field(t('portal.school_name'), f.school_name, { required: true }), field(t('portal.school_type'), f.school_type, { required: true }),
      field(t('portal.address'), f.address, { required: true }), field(t('portal.location'), f.location, { required: true }), field(t('portal.school_email'), f.email, { required: true }), field(t('portal.school_phone'), f.phone, { required: true }),
      field(t('portal.logo'), h('div', { class: 'logo-field' }, prev, file), { hint: t('portal.logo_hint') })),
    sec(t('portal.sec_admin'), field(t('portal.admin_name'), f.admin_name, { required: true }), field(t('portal.admin_email'), f.admin_email, { required: true }),
      field(t('auth.password'), f.password, { required: true, hint: t('auth.password_rules') }), field(t('auth.confirm_password'), f.password_confirm, { required: true })),
    btn, h('p', { style: { marginTop: '1rem' } }, h('a', { href: '#/start' }, t('common.back')))));
  root.replaceChildren(h('div', { class: 'auth-page' }, card));
}

// ---------- Super administrator ----------
const stat = (cls, icon, num, label) => h('div', { class: `stat ${cls}` }, svgIcon(icon, 34), h('div', h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, label)));
const APPROVAL = { pending: 'gold', approved: 'green', rejected: 'red' };
function schoolState(s) { return s.approval !== 'approved' ? s.approval : s.status; }

export async function platformPage(ctx, view) {
  const stats = h('div', { class: 'grid grid-4' }), reqs = h('div'), schools = h('div');
  const filter = input({ type: 'search', placeholder: t('platform.filter'), 'aria-label': t('platform.filter') });
  let all = [];
  const showDetail = async (s) => {
    try {
      const d = await get(`/platform/schools/${s.id}`);
      modal({ title: d.name, body: h('div', h('div', { class: 'school-head', style: { flexDirection: 'row', gap: '1rem', textAlign: 'left' } }, schoolMark({ name: d.name, logo: d.logo }, 64), h('div', h('div', { class: 'code-chip' }, d.code), h('div', { style: { marginTop: '.3rem' } }, badge(t(`platform.state_${schoolState(d)}`), { active: 'green', suspended: 'red', pending: 'gold', rejected: 'red' }[schoolState(d)])))),
        h('dl', { class: 'detail-list' }, [[t('portal.school_type'), typeLabel(d.school_type)], [t('portal.address'), d.address || '—'], [t('portal.location'), d.location || '—'], [t('portal.school_email'), d.email || '—'], [t('portal.school_phone'), d.phone || '—'],
          [t('portal.admin_name'), d.admin ? d.admin.name : '—'], [t('portal.admin_email'), d.admin ? d.admin.email : '—'], [t('common.date'), fmtDate(d.created_at)],
          [t('platform.counts'), `${d.counts.students} ${t('nav.students').toLowerCase()} · ${d.counts.teachers} ${t('platform.teachers')} · ${d.counts.classes} ${t('nav.classes').toLowerCase()}`]].flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
        h('p', { class: 'small muted' }, t('platform.privacy'))), actions: [{ label: t('common.close'), class: 'btn-primary', onclick: (c) => c() }] });
    } catch (e) { fail(e); }
  };
  const paintSchools = () => {
    const v = filter.value.trim().toLowerCase();
    const list = all.filter((s) => !v || `${s.name} ${s.code} ${s.location || ''}`.toLowerCase().includes(v));
    schools.replaceChildren(list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('portal.school_name')), h('th', t('portal.school_type')), h('th', t('portal.admin_name')), h('th', t('common.date')), h('th', t('form.status')), h('th', ''))),
      h('tbody', list.map((s) => h('tr', h('td', { 'data-label': t('portal.school_name') }, h('strong', s.name), h('div', { class: 'small muted' }, `${s.code} · ${s.location || ''}`)), h('td', { 'data-label': t('portal.school_type') }, typeLabel(s.school_type)),
        h('td', { 'data-label': t('portal.admin_name') }, s.admin_name || '—'), h('td', { 'data-label': t('common.date') }, fmtDate(s.created_at)),
        h('td', { 'data-label': t('form.status') }, badge(t(`platform.state_${schoolState(s)}`), { active: 'green', suspended: 'red', pending: 'gold', rejected: 'red' }[schoolState(s)])),
        h('td', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm btn-ghost', onclick: () => showDetail(s) }, t('platform.view')),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
            if (!(await confirmDialog(t('platform.reset_confirm', { name: s.name }), t('platform.reset_pw')))) return;
            try { const x = await post(`/platform/schools/${s.id}/password-reset`); showSecret(t('platform.reset_ready'), [[t('portal.admin_name'), `${x.admin_name} (${x.admin_email})`], [t('platform.reset_link'), location.origin + x.path], [t('platform.reset_valid'), t('platform.reset_hours', { n: x.hours })]]); } catch (e) { fail(e); } } }, t('platform.reset_pw')),
          h('button', { class: 'btn btn-sm', onclick: async () => { const next = schoolState(s) === 'active' ? 'suspended' : 'active';
            if (next === 'suspended' && !(await confirmDialog(t('platform.suspend_confirm', { name: s.name }), t('platform.suspend')))) return;
            try { await post(`/platform/schools/${s.id}/status`, { status: next }); toast(t(next === 'active' ? 'platform.activated' : 'platform.suspended')); run(); } catch (e) { fail(e); } } }, schoolState(s) === 'active' ? t('platform.suspend') : t('platform.activate'))))))))
      : empty(t('platform.none'), ''));
  };
  const run = () => {
    get('/platform/stats').then((s) => stats.replaceChildren(stat('stat-blue', 'platform', s.schools, t('platform.schools')), stat('stat-green', 'check', s.active, t('platform.active')), stat('stat-red', 'close', s.suspended, t('platform.inactive')), stat('stat-gold', 'bell', s.pending_requests, t('platform.pending')))).catch(fail);
    load(reqs, () => get('/platform/requests'), (list) => list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('portal.school_name')), h('th', t('portal.admin_name')), h('th', t('auth.email')), h('th', t('form.status')), h('th', ''))),
      h('tbody', list.map((r) => h('tr', h('td', { 'data-label': t('portal.school_name') }, h('strong', r.school_name), h('div', { class: 'small muted' }, [r.school_code, typeLabel(r.school_type), r.location].filter((x) => x && x !== '—').join(' · '))), h('td', { 'data-label': t('portal.admin_name') }, r.admin_name),
        h('td', { 'data-label': t('auth.email') }, r.admin_email), h('td', { 'data-label': t('form.status') }, badge(t(`req.${r.status}`), APPROVAL[r.status])),
        h('td', { class: 'actions-cell' }, r.status === 'pending' ? [h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { try { const x = await post(`/platform/requests/${r.id}/approve`);
            if (x.temporary_password) showSecret(t('platform.approved'), [[t('auth.email'), x.admin_email], [t('auth.temp_password'), x.temporary_password]]); else toast(t('platform.approved')); run(); } catch (e) { fail(e); } } }, t('platform.approve')),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await confirmDialog(t('platform.reject_confirm'), t('platform.reject'))) { try { await post(`/platform/requests/${r.id}/reject`); run(); } catch (e) { fail(e); } } } }, t('platform.reject'))] : null))))))
      : empty(t('platform.no_requests'), ''));
    get('/platform/schools').then((l) => { all = l; paintSchools(); }).catch((e) => schools.replaceChildren(h('p', { class: 'error-text' }, e instanceof ApiError ? errText(e.code) : t('err.generic'))));
  };
  filter.addEventListener('input', paintSchools);
  const name = input({ maxlength: 120 }), an = input({ maxlength: 120 }), ae = input({ type: 'email' });
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.platform')), h('p', t('platform.subtitle')))), h('div', { class: 'notice notice-blue' }, t('platform.privacy')), stats,
    h('h2', { style: { marginTop: '1.5rem' } }, t('platform.requests')), reqs, h('h2', { style: { marginTop: '1.5rem' } }, t('platform.registered')), h('div', { style: { maxWidth: '360px', margin: '.5rem 0' } }, filter), schools,
    h('form', { class: 'card', style: { marginTop: '1.5rem' }, onsubmit: async (e) => { e.preventDefault(); try { const x = await post('/platform/schools', { school_name: name.value, admin_name: an.value, admin_email: ae.value });
      showSecret(t('platform.created'), [[t('portal.school_code'), x.school_code], [t('auth.email'), x.admin_email], [t('auth.temp_password'), x.temporary_password]]); name.value = an.value = ae.value = ''; run(); } catch (ex) { fail(ex); } } },
      h('h2', t('platform.create')), h('div', { class: 'form-grid' }, field(t('portal.school_name'), name, { required: true }), field(t('portal.admin_name'), an, { required: true }), field(t('auth.email'), ae, { required: true })), h('button', { class: 'btn btn-primary', type: 'submit' }, t('platform.create_btn'))));
  run();
}
void navigate;
