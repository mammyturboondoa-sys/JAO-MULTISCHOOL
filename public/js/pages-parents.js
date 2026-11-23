// Parent Access portal screens: parent sign-in, parent dashboard (child switcher), administrator parent management, school-life tools.
import { state, t, h, get, post, put, del, qs, navigate, field, input, select, textarea, toast, fail, load, empty, badge, fmtDate, fmtDateTime, fcfa, confirmDialog, modal, showSecret, svgIcon, brand, langSwitch } from './ui.js';

const table = (head, rows) => (rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', head.map((x) => h('th', x)))), h('tbody', rows.map((r) => h('tr', r.map((c, i) => h('td', { 'data-label': head[i] }, c))))))) : empty(t('pa.none'), ''));
const stat = (cls, icon, num, label, href) => h(href ? 'a' : 'div', { class: `stat ${cls}`, ...(href ? { href } : {}) }, svgIcon(icon, 30), h('div', h('div', { class: 'num' }, String(num)), h('div', { class: 'lbl' }, label)));
const tabBar = (base, tabs, cur, tr) => h('div', { class: 'tabs', role: 'tablist' }, tabs.map((k) => h('a', { class: 'tab', role: 'tab', 'aria-selected': String(k === cur), href: `${base}${base.includes('?') ? '&' : '?'}tab=${k}` }, t(`${tr}${k}`))));

// ---------------------------------------------------------------- parent sign-in
export function parentLoginPage(root, onDone) {
  const code = input({ required: true, autocomplete: 'organization', maxlength: 40, placeholder: 'JAO-0001' }), id = input({ required: true, autocomplete: 'username', maxlength: 200 }), pw = input({ type: 'password', required: true, autocomplete: 'current-password' });
  const err = h('div', { class: 'error-text', role: 'alert' }), btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.sign_in'));
  const card = h('div', { class: 'auth-card' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try {
      const r = await post('/auth/login', { school_code: code.value.trim(), identifier: id.value.trim(), password: pw.value });
      state.user = r.user; state.csrf = r.csrf; const me = await get('/auth/me'); state.school = me.school; onDone();
    } catch (ex) { err.textContent = ex.code === 'invalid_credentials' ? t('err.invalid_credentials') : (ex.code === 'too_many_attempts' ? t('err.too_many_attempts') : (ex.code && t(`err.${ex.code}`) !== `err.${ex.code}` ? t(`err.${ex.code}`) : t('err.network'))); btn.disabled = false; }
  } }, field(t('pa.code'), code, { required: true, hint: t('pa.code_hint') }), field(t('pa.identifier'), id, { required: true, hint: t('pa.identifier_hint') }), field(t('auth.password'), pw, { required: true }), err, btn,
  h('p', { style: { marginTop: '1rem' } }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); forgot(code.value, id.value); } }, t('pa.forgot'))),
  h('p', { style: { marginTop: '.5rem' } }, h('a', { href: '#/start' }, t('pa.back'))));
  card.replaceChildren(brand(), h('h1', { style: { textAlign: 'center' } }, t('pa.title')), h('p', { class: 'muted', style: { textAlign: 'center' } }, t('pa.sub')), form);
  root.replaceChildren(h('div', { class: 'auth-page' }, card)); code.focus();
}
function forgot(c0, i0) {
  const code = input({ value: c0 || '' }), id = input({ value: i0 || '' });
  modal({ title: t('pa.forgot'), body: h('div', h('p', { class: 'muted' }, t('pa.forgot_text')), field(t('pa.code'), code), field(t('pa.identifier'), id)),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('pa.forgot_send'), class: 'btn-primary', onclick: async (c) => { try { await post('/auth/forgot', { school_code: code.value.trim(), identifier: id.value.trim() }); toast(t('pa.forgot_done')); c(); } catch (e) { fail(e); } } }] });
}

// ---------------------------------------------------------------- parent dashboard
const TABS = ['results', 'attendance', 'fees', 'homework', 'announcements', 'discipline', 'messages'];
export async function parentDashboard(ctx, view) {
  const kids = await get('/parent/children');
  if (!kids.length) { view.replaceChildren(h('div', { class: 'page-head' }, h('h1', t('pa.my_children'))), empty(t('pa.no_children'), '')); return; }
  let cur = Number(ctx.query.child || sessionStorage.getItem('jao_child'));
  if (!kids.some((k) => k.id === cur)) cur = kids[0].id;
  try { sessionStorage.setItem('jao_child', String(cur)); } catch { /* ok */ }
  const tab = TABS.includes(ctx.query.tab) ? ctx.query.tab : 'results', kid = kids.find((k) => k.id === cur);
  const base = `#/parent?child=${cur}`;
  const switcher = kids.length > 1 ? h('div', { class: 'child-switch', role: 'group', 'aria-label': t('pa.child'), style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', margin: '.5rem 0' } },
    kids.map((k) => h('a', { class: `btn btn-sm ${k.id === cur ? 'btn-primary' : 'btn-ghost'}`, href: `#/parent?child=${k.id}&tab=${tab}`, 'aria-pressed': String(k.id === cur) }, k.full_name))) : null;
  const sum = h('div', { class: 'stat-row' }), body = h('div');
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', kid.full_name), h('p', [kid.class_label, kid.student_code].filter(Boolean).join(' · ')))), switcher, sum, tabBar(base, TABS, tab, 'pa.t_'), body, h('p', { class: 'small muted', style: { marginTop: '1.5rem' } }, t('pa.notify_note')));
  get(`/parent/children/${cur}/summary`).then((s) => sum.replaceChildren(
    stat('stat-red', 'close', s.absences, t('pa.s_absences'), `${base}&tab=attendance`), stat('stat-gold', 'bell', s.lates, t('pa.s_lates'), `${base}&tab=attendance`), stat(s.balance ? 'stat-red' : 'stat-green', 'check', fcfa(s.balance), t('pa.s_balance'), `${base}&tab=fees`),
    stat('stat-blue', 'grades', s.homework_due, t('pa.s_homework'), `${base}&tab=homework`), stat('stat-gold', 'discipline', s.warnings, t('pa.s_warnings'), `${base}&tab=discipline`), stat('stat-blue', 'discipline', s.meetings, t('pa.s_meetings'), '#/my-convocations'))).catch(() => {});
  await ({ results, attendance, fees, homework, announcements, discipline, messages }[tab])(body, cur, kid);
}
const results = (body, sid) => load(body, () => get('/reports/terms'), (all) => { const list = all.filter((r) => r.student_id === sid);
  return list.length ? h('div', { class: 'grid grid-cards' }, list.map((r) => h('div', { class: 'card' }, h('h3', `${r.term_name}`), h('p', { class: 'muted' }, r.year_name), h('a', { class: 'btn btn-primary', href: `#/reports/card/${r.student_id}/${r.term_id}` }, t('pa.open_card'))))) : empty(t('pa.no_results'), ''); });
const attendance = (body, sid) => load(body, () => get(`/students/${sid}/attendance`), (d) => h('div', h('div', { class: 'grid grid-3' }, stat('stat-red', 'close', d.absences, t('pa.s_absences')), stat('stat-gold', 'bell', d.lates, t('pa.s_lates')), stat('stat-green', 'check', d.excused, t('pa.status_excused'))),
  h('div', { style: { marginTop: '1rem' } }, table([t('common.date'), t('form.status'), t('pf.note')], d.rows.map((r) => [fmtDate(r.day), badge(t(`pa.status_${r.status}`) + (r.minutes_late ? ` · ${t('pa.minutes', { n: r.minutes_late })}` : ''), r.status === 'absent' ? 'red' : r.status === 'late' ? 'gold' : 'green'), r.note || '—'])))));
const fees = (body, sid) => load(body, () => get(`/students/${sid}/fees`), (d) => h('div', h('div', { class: 'grid grid-3' }, stat('stat-blue', 'check', fcfa(d.total), t('pa.total')), stat('stat-green', 'check', fcfa(d.paid), t('pa.paid')), stat(d.balance ? 'stat-red' : 'stat-green', 'close', fcfa(d.balance), t('pa.balance'))),
  h('h2', { style: { marginTop: '1rem' } }, t('pa.fee')), table([t('pa.fee'), t('pa.due'), t('pa.total'), t('pa.paid'), t('pa.balance')], d.charges.map((f) => [f.title, h('span', fmtDate(f.due_date), f.overdue ? [' ', badge(t('pa.overdue'), 'red')] : null), fcfa(f.amount), fcfa(f.paid), fcfa(f.balance)])),
  h('h2', { style: { marginTop: '1rem' } }, t('pa.payments')), table([t('common.date'), t('pa.receipt'), t('pa.total'), t('pa.method'), ''], d.payments.map((p) => [fmtDate(p.paid_on), p.receipt_no || '—', fcfa(p.amount), t(`pf.m_${p.method}`), h('a', { class: 'btn btn-sm btn-ghost', href: `/api/fees/payments/${p.id}/receipt?lang=${state.lang}`, download: '' }, t('pa.receipt'))]))));
const homework = (body, sid) => load(body, () => get(`/students/${sid}/homework`), (rows) => table([t('pa.due_date'), t('pa.subject'), t('sl.hw_title'), t('sl.hw_desc')], rows.map((r) => [fmtDate(r.due_date), r.subject || '—', h('strong', r.title), r.description || '—'])));
const announcements = (body) => load(body, () => get('/announcements'), (rows) => rows.length ? h('div', rows.map((a) => h('article', { class: 'card', style: { marginBottom: '.75rem' } }, h('h3', a.title, a.important ? [' ', badge(t('pa.important'), 'red')] : null), h('p', { class: 'small muted' }, fmtDateTime(a.created_at)), h('p', { style: { whiteSpace: 'pre-wrap' } }, a.body)))) : empty(t('pa.none'), ''));
const discipline = (body, sid) => load(body, () => get(`/students/${sid}/warnings`), (rows) => h('div', h('p', h('a', { class: 'btn btn-primary', href: '#/my-convocations' }, t('pa.meetings_link'))), h('h2', t('pa.warnings')),
  rows.length ? rows.map((w) => h('article', { class: 'card', style: { marginBottom: '.75rem' } }, h('h3', w.title), h('p', { class: 'small muted' }, fmtDate(w.issued_on)), h('p', { style: { whiteSpace: 'pre-wrap' } }, w.message))) : empty(t('pa.none'), '')));
function messages(body, sid) {
  const box = h('div'), text = textarea({ rows: 3, maxlength: 2000, placeholder: t('pa.msg_placeholder'), required: true });
  const paint = () => load(box, () => get('/messages'), (rows) => rows.length ? h('div', rows.map((m) => h('div', { class: 'card', style: { marginBottom: '.5rem', marginLeft: m.from_parent ? '2rem' : '0', borderLeft: m.from_parent ? '' : '4px solid var(--gold, #c9a227)' } }, h('div', { class: 'small muted' }, `${m.from_parent ? t('pa.you') : t('pa.school')} · ${fmtDateTime(m.created_at)}${m.student ? ` · ${m.student}` : ''}`), h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, m.body)))) : empty(t('pa.none'), ''));
  body.replaceChildren(h('p', { class: 'muted' }, t('pa.msg_hint')), h('form', { onsubmit: async (e) => { e.preventDefault(); try { await post('/messages', { body: text.value, student_id: sid }); text.value = ''; toast(t('pa.sent')); paint(); } catch (x) { fail(x); } } }, text, h('button', { class: 'btn btn-primary', type: 'submit', style: { marginTop: '.5rem' } }, t('pa.msg_send'))), h('div', { style: { marginTop: '1rem' } }, box));
  paint();
}

// ---------------------------------------------------------------- student picker (search by name / ID)
function studentPicker(onPick) {
  const q = input({ type: 'search', placeholder: t('pr.search_student'), 'aria-label': t('pr.search_student') }), out = h('div', { style: { maxHeight: '160px', overflow: 'auto' } });
  let timer; q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => { if (q.value.trim().length < 2) return out.replaceChildren();
    try { const r = await get(`/students${qs({ q: q.value.trim(), page_size: 8 })}`); out.replaceChildren(...r.rows.map((s) => h('button', { type: 'button', class: 'btn btn-sm btn-ghost', style: { display: 'block', width: '100%', textAlign: 'left' }, onclick: () => { onPick(s); q.value = ''; out.replaceChildren(); } }, `${s.full_name} — ${s.class_label || ''} (${s.student_code})`))); } catch { /* ok */ } }, 250); });
  return h('div', q, out);
}
const credentials = (d) => showSecret(t('pr.login_info'), [[t('pa.code'), d.school_code], ...(d.login_phone ? [[t('pr.phone'), d.login_phone]] : []), ...(d.login_email ? [['Email', d.login_email]] : []), [t('pr.temp_pw'), d.temporary_password]]);

// ---------------------------------------------------------------- administrator: parent accounts
export async function parentsAdminPage(ctx, view) {
  const list = h('div'); const run = () => load(list, () => get('/parents'), (rows) => rows.length ? table([t('pr.name'), t('pr.contact'), t('pr.children'), t('pf.last_login'), t('form.status'), ''], rows.map((p) => [h('strong', p.name),
    h('div', p.phone || '—', p.email ? h('div', { class: 'small muted' }, p.email) : null), h('div', p.children.length ? p.children.map((k) => h('div', { class: 'small' }, `${k.full_name} (${k.relationship}) `, h('a', { href: '#', title: t('pr.remove'), onclick: async (e) => { e.preventDefault(); if (!(await confirmDialog(t('pr.remove') + ': ' + k.full_name, t('pr.remove')))) return; try { await del(`/parents/${p.id}/children/${k.student_id}`); run(); } catch (x) { fail(x); } } }, '✕'))) : '—'),
    p.last_login ? fmtDate(p.last_login) : t('pf.never'), badge(p.active ? t('pf.active') : t('pf.inactive'), p.active ? 'green' : 'red'),
    h('div', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm', onclick: () => linkModal(p, run) }, t('pr.add_child')),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (!(await confirmDialog(t('pr.reset_confirm', { name: p.name }), t('pr.reset'), false))) return; try { credentials(await post(`/parents/${p.id}/reset-password`)); } catch (x) { fail(x); } } }, t('pr.reset')),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (p.active && !(await confirmDialog(t('pr.deact_confirm', { name: p.name }), t('pf.admin_deact')))) return; try { await put(`/parents/${p.id}`, { active: !p.active }); run(); } catch (x) { fail(x); } } }, p.active ? t('pf.admin_deact') : t('pf.admin_act')))])) : empty(t('pr.none'), ''));
  const inbox = h('div');
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('pr.title')), h('p', t('pr.sub'))), h('button', { class: 'btn btn-primary', onclick: () => registerModal(run) }, t('pr.register'))), list, h('h2', { style: { marginTop: '1.5rem' } }, t('pr.inbox')), inbox);
  run();
  load(inbox, () => get('/messages/threads'), (rows) => table([t('pr.name'), t('pr.messages'), t('common.date'), ''], rows.map((r) => [h('strong', r.name), r.last_body.slice(0, 80), fmtDateTime(r.last_at), h('a', { class: `btn btn-sm ${r.unread ? 'btn-primary' : 'btn-ghost'}`, href: `#/parents/${r.parent_id}/messages` }, r.unread ? `${t('pr.reply')} (${r.unread})` : t('pr.reply'))])));
}
function registerModal(done) {
  const name = input({ required: true, maxlength: 120 }), phone = input({ type: 'tel', maxlength: 24, placeholder: '+237 6xx xx xx xx' }), email = input({ type: 'email', maxlength: 200 }); const kids = [], chosen = h('div');
  const paint = () => chosen.replaceChildren(...kids.map((k, i) => h('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', margin: '.25rem 0' } }, h('span', { class: 'grow' }, k.full_name), k.rel, h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { kids.splice(i, 1); paint(); } }, '✕'))));
  modal({ title: t('pr.register'), body: h('form', { onsubmit: (e) => e.preventDefault() }, field(t('pr.name'), name, { required: true }), field(t('pr.phone'), phone), field(t('pr.email'), email), h('h3', t('pr.children')), chosen,
    studentPicker((s) => { if (kids.some((k) => k.id === s.id)) return; const rel = input({ value: state.lang === 'fr' ? 'Mère' : 'Mother', maxlength: 40, 'aria-label': t('pr.relationship'), style: { width: '8rem' } }); kids.push({ id: s.id, full_name: s.full_name, rel, el: rel }); paint(); })),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      if (!kids.length) return toast(t('pr.pick_one'), 'error');
      try { const r = await post('/parents', { name: name.value, phone: phone.value, email: email.value, children: kids.map((k) => ({ student_id: k.id, relationship: k.rel.value })) });
        c(); done(); if (r.created) credentials(r); else toast(t('pr.existing')); } catch (e) { fail(e); } } }] });
}
function linkModal(p, done) {
  const rel = input({ value: state.lang === 'fr' ? 'Mère' : 'Mother', maxlength: 40 }); let pick = null; const label = h('strong');
  modal({ title: `${t('pr.add_child')}: ${p.name}`, body: h('div', studentPicker((s) => { pick = s; label.textContent = s.full_name; }), h('p', label), field(t('pr.relationship'), rel)),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => { if (!pick) return toast(t('pr.pick_one'), 'error'); try { await post(`/parents/${p.id}/children`, { student_id: pick.id, relationship: rel.value }); c(); done(); } catch (e) { fail(e); } } }] });
}
export async function parentThreadPage(ctx, view) {
  const id = ctx.params.id, box = h('div'), text = textarea({ rows: 3, maxlength: 2000, required: true });
  const paint = () => load(box, () => get(`/messages/threads/${id}`), (d) => h('div', h('h2', d.parent.name), d.messages.map((m) => h('div', { class: 'card', style: { marginBottom: '.5rem', marginLeft: m.from_parent ? '0' : '2rem' } }, h('div', { class: 'small muted' }, `${m.from_parent ? d.parent.name : t('pa.school')} · ${fmtDateTime(m.created_at)}${m.student ? ` · ${m.student}` : ''}`), h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, m.body)))));
  view.replaceChildren(h('div', { class: 'page-head' }, h('h1', t('pr.messages')), h('a', { class: 'btn btn-ghost', href: '#/parents' }, t('common.back'))), box, h('form', { onsubmit: async (e) => { e.preventDefault(); try { await post(`/messages/threads/${id}`, { body: text.value }); text.value = ''; paint(); } catch (x) { fail(x); } } }, text, h('button', { class: 'btn btn-primary', type: 'submit', style: { marginTop: '.5rem' } }, t('pr.reply'))));
  paint();
}

// ---------------------------------------------------------------- staff: school life (attendance, homework, announcements, fees, warnings)
export async function schoolLifePage(ctx, view) {
  const admin = state.user.role === 'school_admin';
  const TB = admin ? ['attendance', 'homework', 'announcements', 'fees', 'warnings'] : ['attendance', 'homework', 'warnings'];
  const tab = TB.includes(ctx.query.tab) ? ctx.query.tab : 'attendance', body = h('div');
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('sl.title')), h('p', t('sl.sub')))), tabBar('#/school-life', TB, tab, 'sl.t_'), body);
  await ({ attendance: slAttendance, homework: slHomework, announcements: slAnnouncements, fees: slFees, warnings: slWarnings }[tab])(body);
}
async function classSelect(withAll) { const cl = await get('/classes'); const rows = Array.isArray(cl) ? cl : (cl.rows || []); return select([...(withAll ? [['', t('sl.all_classes')]] : []), ...rows.map((c) => [c.id, c.label || c.class_label || `${c.name}${c.section ? ' ' + c.section : ''}`])]); }
async function slAttendance(body) {
  const cls = await classSelect(false), day = input({ type: 'date', value: new Date().toISOString().slice(0, 10), max: new Date().toISOString().slice(0, 10) }), box = h('div');
  const mark = async (s, status) => { try { if (status === 'clear') { if (s.attendance_id) await del(`/attendance/${s.attendance_id}`); } else { const r = await post('/attendance', { student_id: s.id, day: day.value, status, minutes_late: undefined }); if (r.notified) toast(t('pf.saved')); } paint(); } catch (e) { fail(e); } };
  const paint = () => cls.value ? load(box, () => get(`/classes/${cls.value}/attendance?day=${day.value}`), (d) => table([t('pr.name'), t('form.status'), ''], d.rows.map((s) => [h('div', h('strong', s.full_name), h('div', { class: 'small muted' }, s.student_code)), s.status ? badge(t(`sl.${s.status}`), s.status === 'absent' ? 'red' : s.status === 'late' ? 'gold' : 'green') : '—',
    h('div', { class: 'actions-cell' }, ['absent', 'late', 'excused'].map((k) => h('button', { class: `btn btn-sm ${s.status === k ? 'btn-primary' : 'btn-ghost'}`, onclick: () => mark(s, k) }, t(`sl.${k}`))), s.status ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => mark(s, 'clear') }, t('sl.clear')) : null)]))) : box.replaceChildren();
  cls.addEventListener('change', paint); day.addEventListener('change', paint);
  body.replaceChildren(h('p', { class: 'muted' }, t('sl.att_hint')), h('div', { class: 'toolbar' }, field(t('sl.class'), cls), field(t('sl.day'), day)), box); paint();
}
async function slHomework(body) {
  const cls = await classSelect(false), box = h('div'), title = input({ maxlength: 160, required: true }), desc = textarea({ rows: 2, maxlength: 2000 }), due = input({ type: 'date', required: true }), subj = select([['', '—']]);
  try { const sj = await get('/subjects'); for (const s of (Array.isArray(sj) ? sj : sj.rows || [])) subj.append(h('option', { value: s.id }, s.name)); } catch { /* ok */ }
  const paint = () => cls.value ? load(box, () => get(`/classes/${cls.value}/homework`), (rows) => table([t('pa.due_date'), t('pa.subject'), t('sl.hw_title'), ''], rows.map((r) => [fmtDate(r.due_date), r.subject || '—', h('div', h('strong', r.title), r.description ? h('div', { class: 'small muted' }, r.description) : null), h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { try { await del(`/homework/${r.id}`); paint(); } catch (e) { fail(e); } } }, t('common.delete'))]))) : box.replaceChildren();
  cls.addEventListener('change', paint);
  body.replaceChildren(h('div', { class: 'toolbar' }, field(t('sl.class'), cls)), h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await post('/homework', { class_id: cls.value, title: title.value, description: desc.value, due_date: due.value, subject_id: subj.value || undefined }); title.value = desc.value = ''; toast(t('pf.saved')); paint(); } catch (x) { fail(x); } } },
    field(t('sl.hw_title'), title, { required: true }), field(t('sl.hw_desc'), desc), field(t('sl.hw_due'), due, { required: true }), field(t('sl.subject'), subj), h('button', { class: 'btn btn-primary', type: 'submit' }, t('sl.hw_add'))), h('div', { style: { marginTop: '1rem' } }, box)); paint();
}
async function slAnnouncements(body) {
  const title = input({ maxlength: 120, required: true }), text = textarea({ rows: 4, maxlength: 3000, required: true }), aud = select([['all', t('sl.an_all')], ['parents', t('sl.an_parents')]]), imp = h('input', { type: 'checkbox' }), box = h('div');
  const paint = () => load(box, () => get('/announcements'), (rows) => table([t('common.date'), t('sl.an_title'), t('sl.an_aud'), ''], rows.map((a) => [fmtDate(a.created_at), h('div', h('strong', a.title), a.important ? [' ', badge(t('pa.important'), 'red')] : null, h('div', { class: 'small muted' }, a.body.slice(0, 120))), t(`sl.an_${a.audience}`),
    h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (!(await confirmDialog(a.title, t('common.delete')))) return; try { await del(`/announcements/${a.id}`); paint(); } catch (e) { fail(e); } } }, t('common.delete'))])));
  body.replaceChildren(h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { const r = await post('/announcements', { title: title.value, body: text.value, audience: aud.value, important: imp.checked }); toast(t('sl.an_done', { n: r.notified })); title.value = text.value = ''; paint(); } catch (x) { fail(x); } } },
    field(t('sl.an_title'), title, { required: true }), field(t('sl.an_body'), text, { required: true }), field(t('sl.an_aud'), aud), h('label', { style: { display: 'block', margin: '.5rem 0' } }, imp, ` ${t('sl.an_important')}`), h('button', { class: 'btn btn-primary', type: 'submit' }, t('sl.an_publish'))), h('div', { style: { marginTop: '1rem' } }, box)); paint();
}
async function slFees(body) {
  const cls = await classSelect(true), owing = h('input', { type: 'checkbox' }), box = h('div'), sum = h('div');
  const paint = () => load(box, () => get(`/fees/overview?class_id=${cls.value}&owing=${owing.checked ? 1 : 0}`), (d) => { sum.replaceChildren(h('div', { class: 'grid grid-3' }, stat('stat-blue', 'check', fcfa(d.total), t('pa.total')), stat('stat-green', 'check', fcfa(d.paid), t('pa.paid')), stat('stat-red', 'close', fcfa(d.balance), t('pa.balance'))));
    return table([t('pr.name'), t('sl.class'), t('pa.total'), t('pa.paid'), t('pa.balance'), ''], d.rows.map((s) => [h('strong', s.full_name), s.class_label || '—', fcfa(s.total), fcfa(s.paid), h('span', fcfa(s.balance), s.overdue ? [' ', badge(t('pa.overdue'), 'red')] : null), h('button', { class: 'btn btn-sm', onclick: () => studentFees(s, paint) }, t('sl.fee_open'))])); });
  [cls, owing].forEach((x) => x.addEventListener('change', paint));
  const title = input({ maxlength: 120, required: true }), amount = input({ type: 'number', min: 1, required: true }), due = input({ type: 'date', required: true }), cls2 = await classSelect(false);
  body.replaceChildren(h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { const r = await post('/fees/charges', { title: title.value, amount: amount.value, due_date: due.value, class_id: cls2.value }); toast(t('sl.fee_done', { n: r.students })); title.value = ''; paint(); } catch (x) { fail(x); } } },
    h('h3', t('sl.fee_new')), field(t('sl.fee_title'), title, { required: true }), field(t('sl.fee_amount'), amount, { required: true }), field(t('sl.fee_due'), due, { required: true }), field(t('sl.fee_class'), cls2), h('button', { class: 'btn btn-primary', type: 'submit' }, t('sl.fee_add'))),
    h('div', { class: 'toolbar', style: { marginTop: '1rem' } }, field(t('sl.class'), cls), h('label', { class: 'small' }, owing, ` ${t('sl.fee_owing')}`), h('button', { class: 'btn btn-ghost', onclick: async () => { try { const r = await post('/fees/remind'); toast(t('sl.fee_reminded', { n: r.students })); } catch (x) { fail(x); } } }, t('sl.fee_remind'))), sum, box); paint();
}
async function studentFees(s, done) {
  const d = await get(`/students/${s.id}/fees`);
  const forms = d.charges.filter((f) => f.balance > 0).map((f) => { const amt = input({ type: 'number', min: 1, max: f.balance, value: f.balance }), m = select(['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'].map((k) => [k, t(`pf.m_${k}`)])), ref = input({ maxlength: 80, placeholder: t('pf.reference') });
    return h('form', { class: 'card', style: { marginBottom: '.5rem' }, onsubmit: async (e) => { e.preventDefault(); try { const r = await post(`/fees/charges/${f.id}/payments`, { amount: amt.value, method: m.value, reference: ref.value }); toast(t('sl.fee_paid_ok', { r: r.receipt_no })); closeIt(); done(); } catch (x) { fail(x); } } },
      h('strong', `${f.title} — ${t('pa.balance')}: ${fcfa(f.balance)}`), amt, m, ref, h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, t('sl.fee_pay'))); });
  let closeIt = () => {};
  closeIt = modal({ title: s.full_name, wide: true, body: h('div', forms.length ? forms : h('p', t('pa.none')), h('h3', t('pa.payments')), table([t('common.date'), t('pa.receipt'), t('pa.total'), ''], d.payments.map((p) => [fmtDate(p.paid_on), p.receipt_no, fcfa(p.amount), h('a', { class: 'btn btn-sm btn-ghost', href: `/api/fees/payments/${p.id}/receipt?lang=${state.lang}`, download: '' }, t('pa.receipt'))]))), actions: [{ label: t('common.close'), class: 'btn-primary', onclick: (c) => c() }] });
}
async function slWarnings(body) {
  let pick = null; const label = h('strong'), title = input({ maxlength: 120, required: true }), msg = textarea({ rows: 4, maxlength: 2000, required: true });
  body.replaceChildren(h('p', { class: 'muted' }, t('sl.w_hint')), h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); if (!pick) return toast(t('pr.pick_one'), 'error'); try { const r = await post(`/students/${pick.id}/warnings`, { title: title.value, message: msg.value }); toast(t('sl.w_done', { n: r.notified })); title.value = msg.value = ''; } catch (x) { fail(x); } } },
    field(t('sl.w_student'), h('div', studentPicker((s) => { pick = s; label.textContent = s.full_name; }), h('p', label))), field(t('sl.w_title'), title, { required: true }), field(t('sl.w_message'), msg, { required: true }), h('button', { class: 'btn btn-primary', type: 'submit' }, t('sl.w_send'))));
}
void navigate;
