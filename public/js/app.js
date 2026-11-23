// JAO front-end entry point: session start-up, shell (sidebar + header), routes.
import { platformToolsPage } from './pages-platform.js';
import { parentLoginPage, parentDashboard, parentsAdminPage, parentThreadPage, schoolLifePage } from './pages-parents.js';
import { state, t, h, api, get, post, navigate, defineRoute, renderRoute, setLang, langSwitch, svgIcon, brand, modal, field, input, toast, fail, load, spinner, errText, ApiError, setLastHash } from './ui.js';
import { welcomePage, forcePasswordPage, publicShopPage, schoolPickerPage } from './pages-public.js';
import { portalPage, signInPage, registerPage, platformPage, resetPasswordPage } from './pages-portal.js';
import { overviewPage, productsPage, settingsPage } from './pages-admin.js';
import { staffManagementPage, officeDashboardPage } from './pages-staff.js';
import { studentsPage, studentFormPage, studentProfilePage } from './pages-students.js';
import { classesPage, classDetailPage, subjectsPage, gradesPage, reportsPage, reportCardPage } from './pages-academic.js';
import { shopPage } from './pages-shop.js';
import { scholarshipsPage, applicationPage } from './pages-scholarships.js';
import { importCentrePage } from './pages-import.js';
import { ownerAccountPage, ownerRecoverPage } from './pages-owner.js';
import { disciplinePage, incidentPage, studentHistoryPage, meetingPage, casePage, convocationPage, myConvocationsPage } from './pages-discipline.js';
import { prefectsPage } from './pages-prefects.js';
import { mountDudus } from './dudus.js';

const NAV = {
  school_admin: [['overview', 'overview'], ['students', 'students'], ['classes', 'classes'], ['subjects', 'subjects'], ['grades', 'grades'], ['reports', 'reports'], ['discipline', 'discipline'], ['prefects', 'prefects'], ['parents', 'students'], ['school-life', 'classes'], ['scholarships', 'scholarship'], ['shop', 'shop'], ['products', 'products'], ['import', 'products'], ['staff', 'students'], ['settings', 'settings']],
  teacher: [['office', 'students'], ['overview', 'overview'], ['students', 'students'], ['classes', 'classes'], ['subjects', 'subjects'], ['grades', 'grades'], ['discipline', 'discipline'], ['prefects', 'prefects'], ['school-life', 'classes'], ['scholarships', 'scholarship'], ['shop', 'shop']],
  parent: [['parent', 'students'], ['my-convocations', 'discipline'], ['overview', 'overview'], ['students', 'students'], ['reports', 'reports'], ['prefects', 'prefects'], ['scholarships', 'scholarship'], ['shop', 'shop']],
  student: [['overview', 'overview'], ['students', 'students'], ['reports', 'reports'], ['scholarships', 'scholarship'], ['shop', 'shop']],
  platform_owner: [['platform', 'platform'], ['platform/tools', 'platform'], ['account', 'settings']],
};
const homeFor = (u) => (u.role === 'platform_owner' ? '#/platform' : u.role === 'parent' ? '#/parent' : '#/overview');

async function loadSession() {
  try {
    const me = await get('/auth/me');
    state.user = me.user; state.csrf = me.csrf; state.school = me.school;
    if (me.school && me.user.role === 'school_admin') { try { state.school = { ...me.school, ...(await get('/settings/school')) }; } catch { /* keep basic info */ } }
    state.modules = null; if (me.user.role === 'teacher') { try { state.modules = (await get('/staff/my-office')).modules || null; } catch { /* menu stays complete */ } }
    if (!localStorage.getItem('jao_lang')) { state.lang = me.user.language; document.documentElement.lang = state.lang; }
  } catch { state.user = null; state.school = null; state.csrf = ''; }
}

// ---------- shell ----------
let shell = null;
function buildShell() {
  const u = state.user;
  const NAV_MODULE = { students: 'students', classes: 'teaching', subjects: 'teaching', grades: 'teaching', reports: 'teaching', discipline: 'discipline', 'school-life': 'school_life', scholarships: 'scholarships' };
  const mods = u.role === 'teacher' && Array.isArray(state.modules) ? state.modules : null; // department access: the menu mirrors what the server allows
  const items = (NAV[u.role] || []).filter(([key]) => !mods || !NAV_MODULE[key] || mods.includes(NAV_MODULE[key]));
  const side = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': t('nav.main') },
    h('div', { class: 'brand-wrap' }, brand({ light: true, size: 40, school: state.school })),
    h('nav', { class: 'nav' }, items.map(([key, icon]) => h('a', { href: `#/${key}`, 'data-key': key, onclick: closeSide }, svgIcon(icon), t(`nav.${key}`)))),
    h('div', { class: 'side-foot' }, state.school ? state.school.name : t('platform.owner'), state.school && state.school.code ? h('div', { class: 'small' }, state.school.code) : null, h('br'), t('brand.by')));
  const scrim = h('div', { class: 'scrim', hidden: true, onclick: closeSide });
  function closeSide() { side.classList.remove('open'); scrim.hidden = true; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSide(); });
  const bell = h('div', { class: 'menu' });
  const profile = h('div', { class: 'menu' });
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn menu-btn', 'aria-label': t('nav.open_menu'), onclick: () => { side.classList.add('open'); scrim.hidden = false; } }, svgIcon('menu', 24)),
    h('div', { class: 'top-brand' }, brand({ light: true, size: 30, sub: false, school: state.school })),
    h('div', { class: 'spacer' }), langSwitch(), bell, profile);
  const view = h('main', { class: 'content', id: 'view', tabindex: '-1' });
  const el = h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, view), scrim);
  buildProfile(profile); if (u.role !== 'platform_owner') buildBell(bell);
  return { el, view, side };
}
function buildProfile(box) {
  const u = state.user; let open = false;
  const panel = h('div', { class: 'menu-panel', hidden: true },
    h('div', { class: 'who' }, h('strong', u.name), h('br'), h('span', { class: 'muted small' }, t(`role.${u.role}`))),
    h('button', { onclick: () => { panel.hidden = true; changePasswordModal(); } }, t('auth.change_password')),
    h('button', { onclick: logout }, t('auth.logout')),
    h('button', { onclick: logout }, t('portal.switch_school')));
  const btn = h('button', { class: 'profile-btn', 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; } },
    h('span', { class: 'initials' }, u.initials || u.name[0]), h('span', { class: 'pname' }, u.name));
  document.addEventListener('click', () => { panel.hidden = true; });
  box.append(btn, panel); void open;
}
async function buildBell(box) {
  const panel = h('div', { class: 'menu-panel', hidden: true });
  const btn = h('button', { class: 'icon-btn', style: { position: 'relative', color: '#fff' }, 'aria-label': t('nav.notifications'), onclick: (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; } }, svgIcon('bell', 22));
  document.addEventListener('click', () => { panel.hidden = true; });
  box.append(btn, panel);
  const items = [];
  try {
    const o = await get('/overview');
    if (o.shop) { if (o.shop.low_stock) items.push([t('notify.low_stock', { n: o.shop.low_stock }), '#/products']); if (o.shop.out_of_stock) items.push([t('notify.out_of_stock', { n: o.shop.out_of_stock }), '#/products']); }
    if (state.user.role === 'parent' || state.user.role === 'student') {
      const r = await get('/reports/terms'); if (r.length) items.push([t('notify.results', { n: r.length }), '#/reports']);
    }
  } catch { /* notifications are optional */ }
  let stored = { unread: 0, items: [] };
  try { stored = await get('/notifications'); } catch { /* optional */ }
  if (!document.body.contains(box)) return;
  const shown = stored.items.filter((n) => !n.read);
  const total = items.length + shown.length;
  if (total) btn.append(h('span', { class: 'dot' }, total));
  panel.append(total ? [...shown.map((n) => h('a', { href: n.link || '#/overview', onclick: () => { panel.hidden = true; post(`/notifications/${n.id}/read`).catch(() => {}); } }, t(`notify.${n.kind}`, n.data), (n.data && (n.data.preview || (n.kind === 'platform_announcement' && n.data.body))) ? h('span', { class: 'notif-preview' }, n.data.preview || n.data.body) : null)),
    ...items.map(([text, href]) => h('a', { href, onclick: () => { panel.hidden = true; } }, text))] : h('div', { class: 'muted', style: { padding: '.7rem' } }, t('notify.none')));
}
async function logout() {
  try { await post('/auth/logout'); } catch { /* already signed out */ }
  state.user = null; state.csrf = ''; state.school = null; shell = null; sessionStorage.setItem('jao_welcomed', '1');
  navigate('#/start');
}
export function changePasswordModal(forced) {
  const cur = input({ type: 'password', autocomplete: 'current-password' }), nw = input({ type: 'password', autocomplete: 'new-password' }), nw2 = input({ type: 'password', autocomplete: 'new-password' });
  modal({ title: t('auth.change_password'), body: h('form', { onsubmit: (e) => e.preventDefault() },
    field(t('auth.current_password'), cur, { required: true }), field(t('auth.new_password'), nw, { required: true, hint: t('auth.password_rules') }), field(t('auth.confirm_password'), nw2, { required: true })),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      if (nw.value !== nw2.value) return toast(t('err.password_mismatch'), 'error');
      try { await post('/auth/change-password', { current_password: cur.value, new_password: nw.value }); toast(t('auth.password_changed')); c(); if (forced) { state.user.must_change_password = false; navigate(homeFor(state.user)); } }
      catch (e) { fail(e); } } }] });
}

// Pages that need a signed-in user are wrapped by authed(); it builds the shell once and fills #view.
function authed(roles, fn) {
  return async (ctx) => {
    if (!state.user) { navigate('#/start'); return; }
    if (state.user.must_change_password) { navigate('#/change-password'); return; }
    if (roles && !roles.includes(state.user.role)) { navigate(homeFor(state.user)); return; }
    const root = document.getElementById('root');
    if (!shell || !root.contains(shell.el)) { shell = buildShell(); root.replaceChildren(shell.el, chatHost()); if (state.user.role !== 'platform_owner') mountDudus(document.getElementById('dudus-host'), { mode: 'private' }); }
    shell.side.querySelectorAll('.nav a').forEach((a) => { const on = ctx.path.split('/')[1] === a.dataset.key; if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const view = shell.view; view.replaceChildren(spinner());
    window.scrollTo(0, 0);
    try { await fn(ctx, view); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) { view.replaceChildren(h('div', { class: 'empty error-box' }, h('h3', t('common.error_title')), h('p', e instanceof ApiError ? errText(e.code) : t('err.generic')))); console.error(e); } }
    view.focus({ preventScroll: true });
  };
}
const chatHost = () => h('div', { id: 'dudus-host' });
const publicPage = (fn) => async (ctx) => { shell = null; const root = document.getElementById('root'); window.scrollTo(0, 0); await fn(ctx, root); };

const ADMIN = ['school_admin'], STAFF = ['school_admin', 'teacher'], ALL = ['school_admin', 'teacher', 'parent', 'student'];
defineRoute('/', publicPage((c, r) => { if (state.user) return navigate(homeFor(state.user)); return sessionStorage.getItem('jao_welcomed') ? navigate('#/start') : welcomePage(r); }));
defineRoute('/start', publicPage((c, r) => (state.user ? navigate(homeFor(state.user)) : portalPage(r))));
defineRoute('/school/:slug', publicPage((c, r) => (state.user ? navigate(homeFor(state.user)) : signInPage(r, { slug: c.params.slug }, () => navigate(state.user.must_change_password ? '#/change-password' : homeFor(state.user))))));
defineRoute('/super', publicPage((c, r) => (state.user ? navigate(homeFor(state.user)) : signInPage(r, { platform: true }, () => navigate(state.user.must_change_password ? '#/change-password' : homeFor(state.user))))));
defineRoute('/super/recover', publicPage((c, r) => (state.user ? navigate(homeFor(state.user)) : ownerRecoverPage(r))));
defineRoute('/reset/:token', publicPage((c, r) => resetPasswordPage(r, c.params.token)));
defineRoute('/parent-access', publicPage((c, r) => (state.user ? navigate(homeFor(state.user)) : parentLoginPage(r, () => navigate(state.user.must_change_password ? '#/change-password' : homeFor(state.user))))));
defineRoute('/parent', authed(['parent'], parentDashboard));
defineRoute('/parents', authed(ADMIN, parentsAdminPage));
defineRoute('/parents/:id/messages', authed(ADMIN, parentThreadPage));
defineRoute('/school-life', authed(STAFF, schoolLifePage));
defineRoute('/platform/tools', authed(['platform_owner'], platformToolsPage));
defineRoute('/login', publicPage(() => navigate('#/start')));
defineRoute('/change-password', publicPage((c, r) => (state.user ? forcePasswordPage(r, () => navigate(homeFor(state.user))) : navigate('#/start'))));
defineRoute('/register', publicPage((c, r) => registerPage(r)));
defineRoute('/shops', publicPage((c, r) => schoolPickerPage(r)));
defineRoute('/shop/:slug', publicPage((c, r) => publicShopPage(r, c.params.slug)));

defineRoute('/overview', authed(['school_admin', 'teacher', 'parent', 'student'], overviewPage));
defineRoute('/students', authed(ALL, studentsPage));
defineRoute('/students/new', authed(ADMIN, (c, v) => studentFormPage(c, v, null)));
defineRoute('/students/:id/edit', authed(ADMIN, (c, v) => studentFormPage(c, v, c.params.id)));
defineRoute('/students/:id', authed(ALL, studentProfilePage));
defineRoute('/classes', authed(STAFF, classesPage));
defineRoute('/classes/:id', authed(STAFF, classDetailPage));
defineRoute('/subjects', authed(STAFF, subjectsPage));
defineRoute('/grades', authed(STAFF, gradesPage));
defineRoute('/reports', authed(['school_admin', 'parent', 'student'], reportsPage));
defineRoute('/reports/card/:sid/:tid', authed(['school_admin', 'parent', 'student'], reportCardPage));
defineRoute('/shop', authed(ALL, shopPage));
defineRoute('/products', authed(ADMIN, productsPage));
defineRoute('/scholarships', authed(ALL, scholarshipsPage));
defineRoute('/scholarships/applications/:id', authed(ALL, applicationPage));
defineRoute('/prefects', authed(['school_admin', 'teacher', 'parent'], prefectsPage));
defineRoute('/discipline', authed(STAFF, disciplinePage));
defineRoute('/discipline/incidents/new', authed(STAFF, (c, v) => incidentPage(c, v, null)));
defineRoute('/discipline/incidents/:id', authed(STAFF, (c, v) => incidentPage(c, v, c.params.id)));
defineRoute('/discipline/students/:id', authed(STAFF, studentHistoryPage));
defineRoute('/discipline/council/:id', authed(STAFF, meetingPage));
defineRoute('/discipline/cases/:id', authed(STAFF, casePage));
defineRoute('/my-convocations', authed(['parent'], myConvocationsPage));
defineRoute('/discipline/convocations/:id', authed(STAFF, convocationPage));
defineRoute('/import', authed(ADMIN, importCentrePage));
defineRoute('/settings', authed(ADMIN, settingsPage));
defineRoute('/staff', authed(ADMIN, staffManagementPage));
defineRoute('/office', authed(STAFF, officeDashboardPage));
defineRoute('/platform', authed(['platform_owner'], platformPage));
defineRoute('/account', authed(['platform_owner'], ownerAccountPage));

// Re-draw everything when the language changes.
document.addEventListener('langchange', () => { shell = null; renderRoute(); });

(async function start() {
  await loadSession();
  setLastHash();
  renderRoute();
})();
