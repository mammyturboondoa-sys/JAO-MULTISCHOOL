// Students module: Card View directory (default), 4-section form, tabbed profile.
import { state, t, h, get, post, put, del, qs, navigate, load, field, input, select, textarea, toast, fail, confirmDialog, modal, empty, errorBox, spinner,
  badge, statusBadge, avatar, fmtDate, fmtDateTime, fmtNum, readImage, svgIcon } from './ui.js';

import { gceTab } from './pages-import.js';

const isAdmin = () => state.user.role === 'school_admin';
const STATUS = ['active', 'transferred', 'graduated'];

// ================= Directory (Card View) =================
export async function studentsPage(ctx, view) {
  const years = await get('/academic-years');
  const classes = state.user.role === 'school_admin' || state.user.role === 'teacher' ? await get('/classes') : [];
  const q = input({ type: 'search', placeholder: t('students.search'), 'aria-label': t('students.search'), value: ctx.query.q || '' });
  const cls = select([['', t('students.all_classes')], ...classes.map((c) => [c.id, `${c.label} (${c.year_name})`])], ctx.query.class_id || '', { 'aria-label': t('students.class') });
  const yr = select([['', t('students.all_years')], ...years.map((y) => [y.id, y.name])], ctx.query.year_id || '', { 'aria-label': t('students.year') });
  const st = select([['', t('students.all_status')], ...STATUS.map((s) => [s, t(`status.${s}`)])], ctx.query.status || '', { 'aria-label': t('students.status') });
  const sort = select([['name', t('students.sort_name')], ['id', t('students.sort_id')], ['enrolled', t('students.sort_enrolled')]], 'name', { 'aria-label': t('students.sort') });
  const grid = h('div'); let page = 1, timer;
  const run = () => load(grid, () => get('/students' + qs({ q: q.value.trim(), class_id: cls.value, year_id: yr.value, status: st.value, sort: sort.value, page })), (d) => {
    if (!d.total) {
      const filtered = q.value || cls.value || yr.value || st.value;
      return empty(filtered ? t('students.no_results') : t('students.empty_title'), filtered ? t('students.no_results_text') : (isAdmin() ? t('students.empty_text') : t('students.empty_text_other')),
        !filtered && isAdmin() ? h('a', { class: 'btn btn-primary', href: '#/students/new' }, t('students.add')) : null);
    }
    return h('div', h('p', { class: 'muted small' }, t('students.count', { n: d.total })),
      h('div', { class: 'grid grid-cards' }, d.rows.map((s) => h('article', { class: 'card s-card' }, avatar(s.full_name, s.photo), h('h3', s.full_name), h('div', { class: 'meta' }, `${t('students.id')}: ${s.student_code}`),
        h('div', { class: 'meta' }, [s.class_label, s.year_name].filter(Boolean).join(' · ') || '—'), statusBadge(s.status),
        h('a', { class: 'btn btn-sm btn-primary', href: `#/students/${s.id}`, 'aria-label': `${t('students.view_profile')} — ${s.full_name}` }, t('students.view_profile'))))),
      d.pages > 1 ? h('nav', { class: 'pager', 'aria-label': 'Pagination' }, h('button', { class: 'btn btn-sm', disabled: page <= 1, onclick: () => { page--; run(); } }, t('common.prev')),
        h('span', t('common.page_of', { p: d.page, n: d.pages })), h('button', { class: 'btn btn-sm', disabled: page >= d.pages, onclick: () => { page++; run(); } }, t('common.next'))) : null);
  });
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; run(); }, 300); });
  [cls, yr, st, sort].forEach((el) => el.addEventListener('change', () => { page = 1; run(); }));
  const title = state.user.role === 'parent' ? t('students.title_parent') : state.user.role === 'student' ? t('students.title_student') : t('nav.students');
  view.replaceChildren(
    h('div', { class: 'page-head' }, h('div', h('h1', title), h('p', t('students.subtitle'))), isAdmin() ? h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/students/new' }, svgIcon('plus', 18), t('students.add'))) : null),
    state.user.role === 'student' || state.user.role === 'parent' ? null : h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, field(t('common.search'), q)), h('div', field(t('students.class'), cls)), h('div', field(t('students.year'), yr)), h('div', field(t('students.status'), st)), h('div', field(t('students.sort'), sort))),
    grid);
  run();
}

// ================= Add / Edit form: 4 sections =================
const blankGuardian = (primary = false) => ({ full_name: '', relationship: '', phone: '', email: '', address: '', is_primary: primary, is_emergency: false });

export async function studentFormPage(ctx, view, editId) {
  const [years, classes] = await Promise.all([get('/academic-years'), get('/classes')]);
  let existing = null;
  if (editId) existing = await get(`/students/${editId}`);
  if (!years.length || !classes.some((c) => c.active)) {
    view.replaceChildren(h('div', { class: 'page-head' }, h('h1', t('students.add'))), h('div', { class: 'notice' }, t('students.need_setup')), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/settings' }, t('nav.settings')), h('a', { class: 'btn', href: '#/classes' }, t('nav.classes'))));
    return;
  }
  const cur = years.find((y) => y.is_current) || years[0];
  const data = existing ? { ...existing, guardians: existing.guardians.map((g) => ({ ...g })), photo_data: undefined, remove_photo: false }
    : { full_name: '', dob: '', gender: '', birthplace: '', address: '', enrolled_on: new Date().toISOString().slice(0, 10), year_id: cur.id, class_id: '', stream: '', previous_school: '', status: 'active', guardians: [blankGuardian(true)], photo_data: undefined };
  let step = 0; const errors = {};
  const dirty = () => { state.dirty = true; };
  const body = h('div');
  const stepNames = [t('form.s1'), t('form.s2'), t('form.s3'), t('form.s4')];

  const bind = (el, key, tr) => { el.addEventListener('input', () => { data[key] = tr ? tr(el.value) : el.value; dirty(); }); el.addEventListener('change', () => { data[key] = tr ? tr(el.value) : el.value; dirty(); }); return el; };
  const err = (k) => errors[k];

  function s1() {
    const preview = h('div'); const paint = () => preview.replaceChildren(avatar(data.full_name || '?', data.photo_data !== undefined ? data.photo_data : (data.remove_photo ? null : data.photo), 'lg'));
    paint();
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': t('form.photo'), onchange: async (e) => { try { data.photo_data = await readImage(e.target.files[0]); data.remove_photo = false; dirty(); paint(); } catch (ex) { fail(ex); e.target.value = ''; } } });
    const gender = select([['', '—'], ['female', t('gender.female')], ['male', t('gender.male')], ['other', t('gender.other')]], data.gender || '');
    return h('div', h('div', { class: 'photo-pick' }, preview, h('div', field(t('form.photo'), file, { hint: t('form.photo_hint') }),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { data.photo_data = null; data.remove_photo = true; file.value = ''; dirty(); paint(); } }, t('form.remove_photo')))),
      h('div', { class: 'form-grid' },
        field(t('form.student_id'), input({ value: existing ? existing.student_code : t('form.auto_id'), disabled: true }), { hint: t('form.auto_id_hint') }),
        field(t('form.full_name'), bind(input({ value: data.full_name, maxlength: 120, autocomplete: 'off' }), 'full_name'), { required: true, error: err('full_name') }),
        field(t('form.dob'), bind(input({ type: 'date', value: data.dob }), 'dob'), { required: true, error: err('dob') }),
        field(t('form.gender'), bind(gender, 'gender')),
        field(t('form.birthplace'), bind(input({ value: data.birthplace || '', maxlength: 120 }), 'birthplace')),
        field(t('form.address'), bind(input({ value: data.address || '', maxlength: 300 }), 'address')),
        field(t('form.enrolled_on'), bind(input({ type: 'date', value: data.enrolled_on }), 'enrolled_on'), { required: true, error: err('enrolled_on') })));
  }
  function s2() {
    const yearSel = select(years.map((y) => [y.id, y.name]), data.year_id);
    const classSel = select([['', t('form.choose_class')]], '');
    const fill = () => { classSel.replaceChildren(...[['', t('form.choose_class')], ...classes.filter((c) => c.active && c.year_id === Number(data.year_id) || c.id === data.class_id).map((c) => [c.id, c.label])].map(([v, l]) => h('option', { value: v, selected: String(v) === String(data.class_id) }, l))); };
    fill();
    yearSel.addEventListener('change', () => { data.year_id = Number(yearSel.value); data.class_id = ''; fill(); dirty(); });
    classSel.addEventListener('change', () => { data.class_id = Number(classSel.value) || ''; dirty(); });
    const st = select(STATUS.map((s) => [s, t(`status.${s}`)]), data.status);
    return h('div', { class: 'form-grid' }, field(t('form.year'), yearSel, { required: true }), field(t('form.class'), classSel, { required: true, error: err('class_id') }),
      field(t('form.stream'), bind(input({ value: data.stream || '', maxlength: 60 }), 'stream'), { hint: t('form.stream_hint') }),
      field(t('form.status'), bind(st, 'status')), field(t('form.previous_school'), bind(input({ value: data.previous_school || '', maxlength: 120 }), 'previous_school')));
  }
  function s3() {
    const wrap = h('div');
    const paint = () => {
      wrap.replaceChildren(...data.guardians.map((g, i) => {
        const linked = !!g.id && g.full_name === undefined; void linked;
        const gb = (key) => (el) => { el.addEventListener('input', () => { g[key] = el.value; dirty(); }); return el; };
        return h('div', { class: 'guardian' }, h('div', { class: 'guardian-head' }, h('strong', t('form.guardian_n', { n: i + 1 })),
          data.guardians.length > 1 ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { data.guardians.splice(i, 1); if (!data.guardians.some((x) => x.is_primary)) data.guardians[0].is_primary = true; dirty(); paint(); } }, t('form.remove_guardian')) : null),
          h('div', { class: 'form-grid' },
            field(t('form.full_name'), gb('full_name')(input({ value: g.full_name, maxlength: 120 })), { required: true, error: err(`g${i}_full_name`) }),
            field(t('form.relationship'), gb('relationship')(input({ value: g.relationship, maxlength: 40, placeholder: t('form.relationship_ph') })), { required: true, error: err(`g${i}_relationship`) }),
            field(t('form.phone'), gb('phone')(input({ type: 'tel', value: g.phone, maxlength: 30, placeholder: '+237 …' })), { required: true, error: err(`g${i}_phone`) }),
            field(t('form.email'), gb('email')(input({ type: 'email', value: g.email || '', maxlength: 200 })), { error: err(`g${i}_email`) }),
            field(t('form.address'), gb('address')(input({ value: g.address || '', maxlength: 300 })))),
          h('div', { class: 'check' }, h('input', { type: 'radio', name: 'primary', id: `p${i}`, checked: g.is_primary, onchange: () => { data.guardians.forEach((x, j) => { x.is_primary = j === i; }); dirty(); } }), h('label', { for: `p${i}` }, t('form.primary'))),
          h('div', { class: 'check' }, h('input', { type: 'checkbox', id: `e${i}`, checked: g.is_emergency, onchange: (e) => { g.is_emergency = e.target.checked; dirty(); } }), h('label', { for: `e${i}` }, t('form.emergency'))));
      }), data.guardians.length < 6 ? h('button', { class: 'btn', type: 'button', onclick: () => { data.guardians.push(blankGuardian()); dirty(); paint(); } }, svgIcon('plus', 18), t('form.add_guardian')) : null);
    };
    paint(); return wrap;
  }
  function s4() {
    const cls = classes.find((c) => c.id === Number(data.class_id)), yr = years.find((y) => y.id === Number(data.year_id));
    const row = (k, v) => [h('dt', k), h('dd', v || '—')];
    return h('div', h('p', { class: 'muted' }, t('form.review_text')),
      h('div', { class: 'grid grid-2' },
        h('div', { class: 'card' }, h('h3', t('form.s1')), h('dl', { class: 'dl' }, row(t('form.full_name'), data.full_name), row(t('form.dob'), fmtDate(data.dob)), row(t('form.gender'), data.gender ? t(`gender.${data.gender}`) : ''), row(t('form.birthplace'), data.birthplace), row(t('form.address'), data.address), row(t('form.enrolled_on'), fmtDate(data.enrolled_on)))),
        h('div', { class: 'card' }, h('h3', t('form.s2')), h('dl', { class: 'dl' }, row(t('form.year'), yr && yr.name), row(t('form.class'), cls && cls.label), row(t('form.stream'), data.stream), row(t('form.status'), t(`status.${data.status}`)), row(t('form.previous_school'), data.previous_school)))),
      h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', t('form.s3')), data.guardians.map((g, i) => h('div', { style: { marginBottom: '.6rem' } }, h('strong', g.full_name || '—'), ` — ${g.relationship || '—'} · ${g.phone || '—'}${g.email ? ' · ' + g.email : ''} `, g.is_primary ? badge(t('form.primary'), 'blue') : null, ' ', g.is_emergency ? badge(t('form.emergency'), 'gold') : null))));
  }
  const sections = [s1, s2, s3, s4];

  function validate(upTo) {
    for (const k of Object.keys(errors)) delete errors[k];
    const need = t('err.required');
    if (upTo >= 0) { if (!data.full_name.trim()) errors.full_name = need; if (!data.dob) errors.dob = need; if (!data.enrolled_on) errors.enrolled_on = need; }
    if (upTo >= 1 && !data.class_id) errors.class_id = need;
    if (upTo >= 2) data.guardians.forEach((g, i) => {
      if (!(g.full_name || '').trim()) errors[`g${i}_full_name`] = need; if (!(g.relationship || '').trim()) errors[`g${i}_relationship`] = need;
      if (!/^[+0-9][0-9 ()\-.]{5,20}$/.test((g.phone || '').trim())) errors[`g${i}_phone`] = t('err.invalid_phone');
      if (g.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email)) errors[`g${i}_email`] = t('err.invalid_email');
    });
    return Object.keys(errors).length === 0;
  }
  async function save() {
    const payload = { full_name: data.full_name, dob: data.dob, gender: data.gender, birthplace: data.birthplace, address: data.address, enrolled_on: data.enrolled_on,
      year_id: data.year_id, class_id: data.class_id, stream: data.stream, previous_school: data.previous_school, status: data.status,
      guardians: data.guardians.map((g) => ({ ...(g.id ? { id: g.id } : {}), full_name: g.full_name, relationship: g.relationship, phone: g.phone, email: g.email, address: g.address, is_primary: g.is_primary, is_emergency: g.is_emergency })) };
    if (!existing && data.photo_data) payload.photo = data.photo_data;
    try {
      const r = existing ? await put(`/students/${existing.id}`, payload) : await post('/students', payload);
      const id = existing ? existing.id : r.id;
      if (existing && (data.photo_data || data.remove_photo)) await post(`/students/${id}/photo`, { image: data.photo_data || null });
      state.dirty = false; toast(t('form.saved')); navigate(`#/students/${id}`);
    } catch (e) { fail(e); }
  }
  function paint() {
    const last = step === 3;
    view.replaceChildren(h('div', { class: 'page-head' }, h('h1', existing ? t('students.edit') : t('students.add'))),
      h('ol', { class: 'steps', style: { listStyle: 'none', padding: 0 } }, stepNames.map((n, i) => h('li', { class: `step ${i === step ? 'on' : i < step ? 'done' : ''}`, 'aria-current': i === step ? 'step' : undefined }, h('b', i < step ? '✓' : String(i + 1)), n))),
      h('form', { class: 'card', novalidate: true, onsubmit: (e) => e.preventDefault() }, h('h2', stepNames[step]), sections[step](), h('div', { class: 'actions', style: { marginTop: '1rem', justifyContent: 'space-between' } },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { if (!state.dirty || await confirmDialog(t('common.unsaved'), t('common.leave'))) { state.dirty = false; navigate(existing ? `#/students/${existing.id}` : '#/students'); } } }, t('common.cancel')),
        h('div', { class: 'actions' }, step > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => { step--; paint(); window.scrollTo(0, 0); } }, t('common.back')) : null,
          last ? h('button', { class: 'btn btn-gold', type: 'button', id: 'save-student', onclick: async (e) => { e.target.disabled = true; if (validate(2)) await save(); else { toast(t('form.fix_errors'), 'error'); step = [0, 1, 2].find((s) => !validate(s)) ?? 0; validate(step); paint(); } e.target.disabled = false; } }, t('form.save'))
            : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { if (validate(step === 2 ? 2 : step) || (step < 2 && !Object.keys(errors).length)) { step++; paint(); window.scrollTo(0, 0); } else { paint(); } } }, t('common.next'))))));
  }
  paint();
}

// Prefect posts shown on the profile (the parent of the student sees them too).
const prefectRow = (s) => {
  const list = s.prefect_posts || [];
  if (!list.length) return [];
  const nameOf = (p) => (state.lang === 'fr' ? p.post_fr : p.post_en);
  return [h('dt', t('profile.prefect')), h('dd', list.map((p) => h('div', nameOf(p), ' ', h('span', { class: 'small muted' }, `(${p.year_name}${p.current ? '' : ' · ' + t('profile.prefect_past')})`))))];
};

// ================= Profile: Profile / Academic Records / Guardians / History =================
export async function studentProfilePage(ctx, view) {
  const s = await get(`/students/${ctx.params.id}`);
  const tabs = ['profile', 'academics', ...(state.user.role !== 'teacher' ? ['gce'] : []), ...(s.guardians ? ['guardians'] : []), 'history'];
  let tab = ctx.query.tab && tabs.includes(ctx.query.tab) ? ctx.query.tab : 'profile';
  const panel = h('div', { role: 'tabpanel' });
  const tabBar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map((k) => h('button', { role: 'tab', 'aria-selected': String(k === tab), 'data-k': k, onclick: () => { tab = k; paintTabs(); render(); } }, t(`profile.${k}`))));
  const paintTabs = () => tabBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === tab)));
  const row = (k, v) => [h('dt', k), h('dd', v || '—')];
  function render() {
    panel.replaceChildren();
    if (tab === 'profile') panel.append(h('div', { class: 'card' }, h('dl', { class: 'dl' }, row(t('form.student_id'), s.student_code), row(t('form.full_name'), s.full_name), row(t('form.dob'), fmtDate(s.dob)), row(t('form.gender'), s.gender ? t(`gender.${s.gender}`) : ''),
      row(t('form.birthplace'), s.birthplace), row(t('form.address'), s.address), row(t('form.class'), s.class_label), row(t('form.year'), s.year_name), row(t('form.stream'), s.stream), row(t('form.enrolled_on'), fmtDate(s.enrolled_on)), row(t('form.previous_school'), s.previous_school), row(t('form.status'), statusBadge(s.status)), prefectRow(s))));
    else if (tab === 'academics') academics();
    else if (tab === 'gce') gceTab(panel, s);
    else if (tab === 'guardians') guardians();
    else history();
  }
  async function academics() {
    const box = h('div'); panel.append(box);
    const draw = (termId) => load(box, () => get(`/students/${s.id}/academics${qs({ term_id: termId })}`), (d) => {
      if (!d.terms.length) return empty(t('acad.none_title'), state.user.role === 'parent' || state.user.role === 'student' ? t('acad.none_approved') : t('acad.none_text'));
      const sel = select(d.terms.map((x) => [x.id, `${x.name} — ${x.year_name}`]), d.selected, { 'aria-label': t('acad.term'), onchange: (e) => draw(e.target.value) });
      return h('div', h('div', { class: 'toolbar' }, h('div', field(t('acad.term'), sel)),
        d.can_open_report_card ? h('a', { class: 'btn btn-gold', href: `#/reports/card/${s.id}/${d.selected}` }, t('reports.report_card')) : null),
        d.partial ? h('div', { class: 'notice notice-blue' }, t('acad.partial')) : null,
        d.subjects.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('acad.subject')), h('th', { class: 'num' }, t('acad.coef')), h('th', t('acad.assessments')), h('th', { class: 'num' }, t('acad.average', { n: d.scale })))),
          h('tbody', d.subjects.map((sb) => h('tr', h('td', { 'data-label': t('acad.subject') }, h('strong', sb.name), ` (${sb.code})`), h('td', { class: 'num', 'data-label': t('acad.coef') }, sb.coefficient == null ? badge(t('acad.coef_missing'), 'gold') : fmtNum(sb.coefficient)),
            h('td', { 'data-label': t('acad.assessments') }, sb.entries.map((e) => h('div', { class: 'small' }, `${e.name}: `, e.status === 'graded' ? `${fmtNum(e.score)}/${fmtNum(e.max_score)}` : badge(t(`gstatus.${e.status}`), e.status === 'missing' ? 'neutral' : 'gold')))),
            h('td', { class: 'num', 'data-label': t('acad.average', { n: d.scale }) }, h('strong', sb.average == null ? '—' : fmtNum(sb.average)))))))) : empty(t('acad.no_grades')),
        d.missing_coefficients && d.missing_coefficients.length ? h('div', { class: 'notice notice-gold' }, t('acad.coefs_missing_notice', { subjects: d.missing_coefficients.map((m) => m.name).join(', ') })) : null,
        d.overall != null ? h('div', { class: 'card', style: { marginTop: '1rem' } }, h('strong', `${t('acad.overall')}: ${fmtNum(d.overall)} / ${fmtNum(d.scale)} `), badge(d.passed ? t('acad.passed') : t('acad.not_passed'), d.passed ? 'green' : 'red'),
          d.rank ? h('p', { style: { margin: '.4rem 0 0' } }, `${t('acad.rank')}: ${d.rank}`) : null, h('p', { class: 'small muted', style: { margin: '.4rem 0 0' } }, t('acad.rule_note', { pass: fmtNum(d.pass_mark) }))) : null,
        d.report && isAdmin() ? h('p', { class: 'small muted' }, `${t('reports.status')}: ${t(`rstatus.${d.report.status}`)}`) : null);
    });
    draw('');
  }
  function guardians() {
    panel.append(h('div', { class: 'grid grid-2' }, s.guardians.map((g) => h('div', { class: 'card' }, h('h3', g.full_name), h('div', { style: { display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.5rem' } }, g.is_primary ? badge(t('form.primary'), 'blue') : null, g.is_emergency ? badge(t('form.emergency'), 'gold') : null),
      h('dl', { class: 'dl' }, row(t('form.relationship'), g.relationship), row(t('form.phone'), g.phone), row(t('form.email'), g.email), row(t('form.address'), g.address)),
      isAdmin() ? h('div', { style: { marginTop: '.75rem' } }, h('button', { class: 'btn btn-sm', onclick: () => linkAccount(g) }, g.user_id ? t('guardian.change_account') : t('guardian.link_account')), g.user_id ? badge(t('guardian.linked'), 'green') : null) : null))));
  }
  async function linkAccount(g) {
    let users; try { users = (await get('/users')).filter((u) => u.role === 'parent' && u.active); } catch (e) { return fail(e); }
    const sel = select([['', t('guardian.no_account')], ...users.map((u) => [u.id, `${u.name} (${u.email})`])], g.user_id || '');
    modal({ title: t('guardian.link_account'), body: h('div', h('p', { class: 'muted' }, t('guardian.link_help')), field(t('guardian.parent_account'), sel)),
      actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => { try { await put(`/guardians/${g.id}/account`, { user_id: sel.value ? Number(sel.value) : null }); toast(t('common.saved')); c(); navigate(`#/students/${s.id}?tab=guardians`); } catch (e) { fail(e); } } }] });
  }
  function history() {
    const box = h('div', { class: 'card' }); panel.append(box);
    load(box, () => get(`/students/${s.id}/history`), (list) => list.length ? h('ul', { class: 'timeline' }, list.map((e) => h('li', h('strong', t(`hist.${e.event}`)), h('div', { class: 'small muted' }, fmtDateTime(e.at), e.actor ? ` · ${e.actor}` : '')))) : empty(t('hist.none')));
  }
  async function archive() {
    if (!(await confirmDialog(t('students.archive_confirm', { name: s.full_name }), t('students.archive')))) return;
    try { await del(`/students/${s.id}`); toast(t('students.archived')); navigate('#/students'); } catch (e) { fail(e); }
  }
  view.replaceChildren(h('a', { href: '#/students', class: 'small' }, `← ${t('nav.students')}`),
    h('div', { class: 'card', style: { display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap', margin: '.5rem 0 1rem' } }, avatar(s.full_name, s.photo, 'lg'),
      h('div', { style: { flex: 1, minWidth: '200px' } }, h('h1', { style: { marginBottom: '.2rem' } }, s.full_name), h('p', { class: 'muted', style: { margin: 0 } }, `${t('students.id')}: ${s.student_code} · ${[s.class_label, s.year_name].filter(Boolean).join(' · ')}`), h('div', { style: { marginTop: '.4rem' } }, statusBadge(s.status))),
      s.can_edit ? h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: `#/students/${s.id}/edit` }, t('common.edit')), h('button', { class: 'btn btn-danger', onclick: archive }, t('students.archive'))) : null,
      (state.user.role === 'school_admin' || (state.user.permissions || []).some((p) => p === 'manage_discipline' || p === 'approve_decisions')) ? h('a', { class: 'btn', href: `#/discipline/students/${s.id}` }, t('disc.history')) : null),
    tabBar, panel);
  render();
}
void spinner; void errorBox; void textarea;
