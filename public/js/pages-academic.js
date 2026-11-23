// Classes, Subjects, Grades, Results & Reports.
import { state, t, h, get, post, put, del, qs, navigate, load, field, input, select, textarea, toast, fail, confirmDialog, modal, empty, badge, statusBadge, avatar, fmtDate, fmtNum, svgIcon, spinner, errorBox } from './ui.js';

const isAdmin = () => state.user.role === 'school_admin';
const ASSESSMENT_TYPES = ['quiz', 'test', 'assignment', 'oral', 'project', 'exam'];
const activeBadge = (a) => badge(a ? t('common.active') : t('common.inactive'), a ? 'green' : 'neutral');

// ================= Classes =================
export async function classesPage(ctx, view) {
  const years = await get('/academic-years');
  const q = input({ type: 'search', placeholder: t('classes.search'), 'aria-label': t('classes.search') });
  const yr = select([['', t('students.all_years')], ...years.map((y) => [y.id, y.name])], '', { 'aria-label': t('students.year') });
  const grid = h('div'); let timer;
  const run = () => load(grid, () => get('/classes' + qs({ q: q.value.trim(), year_id: yr.value })), (list) => list.length
    ? h('div', { class: 'grid grid-cards' }, list.map((c) => h('article', { class: 'card' }, h('h3', c.label), h('p', { class: 'muted small', style: { margin: 0 } }, c.year_name), h('p', { style: { margin: '.4rem 0' } }, t('classes.students_n', { n: c.students }), c.capacity ? ` / ${c.capacity}` : ''),
      h('p', { class: 'small muted' }, c.teacher_name ? `${t('classes.teacher')}: ${c.teacher_name}` : ''), activeBadge(c.active), h('div', { style: { marginTop: '.7rem' } }, h('a', { class: 'btn btn-sm btn-primary', href: `#/classes/${c.id}` }, t('common.open'))))))
    : empty(t('classes.empty_title'), isAdmin() ? t('classes.empty_text') : t('classes.empty_text_teacher'), isAdmin() ? h('button', { class: 'btn btn-primary', onclick: () => classForm(null, years, run) }, t('classes.add')) : null));
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); }); yr.addEventListener('change', run);
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.classes')), h('p', t('classes.subtitle'))), isAdmin() ? h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => classForm(null, years, run) }, svgIcon('plus', 18), t('classes.add'))) : null),
    h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, field(t('common.search'), q)), h('div', field(t('students.year'), yr))), grid);
  run();
}
async function classForm(cls, years, done) {
  if (!years.length) { toast(t('classes.need_year'), 'error'); return navigate('#/settings'); }
  const teachers = await get('/teachers');
  const f = { name: input({ value: cls ? cls.name : '', maxlength: 60, placeholder: 'Form 1' }), section: input({ value: cls ? cls.section : '', maxlength: 20, placeholder: 'A' }),
    year: select(years.map((y) => [y.id, y.name]), cls ? cls.year_id : (years.find((y) => y.is_current) || years[0]).id), teacher: select([['', '—'], ...teachers.map((x) => [x.id, x.name])], cls ? cls.teacher_id || '' : ''),
    cap: input({ type: 'number', min: 1, max: 500, value: cls && cls.capacity ? cls.capacity : '' }), active: h('input', { type: 'checkbox', checked: cls ? cls.active : true, id: 'cactive' }) };
  modal({ title: cls ? t('classes.edit') : t('classes.add'), body: h('form', { onsubmit: (e) => e.preventDefault() }, field(t('classes.name'), f.name, { required: true }), field(t('classes.section'), f.section), field(t('form.year'), f.year, { required: true }),
    field(t('classes.teacher'), f.teacher), field(t('classes.capacity'), f.cap), h('div', { class: 'check' }, f.active, h('label', { for: 'cactive' }, t('common.active')))),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      const body = { name: f.name.value, section: f.section.value, year_id: Number(f.year.value), teacher_id: f.teacher.value ? Number(f.teacher.value) : null, capacity: f.cap.value ? Number(f.cap.value) : null, active: f.active.checked };
      try { cls ? await put(`/classes/${cls.id}`, body) : await post('/classes', body); toast(t('common.saved')); c(); done(); } catch (e) { fail(e); } } }] });
}
export async function classDetailPage(ctx, view) {
  const c = await get(`/classes/${ctx.params.id}`);
  const years = await get('/academic-years');
  const subjTable = c.subjects.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('acad.subject')), h('th', t('subjects.code')), h('th', { class: 'num' }, t('acad.coef')), h('th', t('classes.teacher')))),
    h('tbody', c.subjects.map((s) => h('tr', h('td', { 'data-label': t('acad.subject') }, s.name), h('td', { 'data-label': t('subjects.code') }, s.code), h('td', { class: 'num', 'data-label': t('acad.coef') }, fmtNum(s.coefficient)), h('td', { 'data-label': t('classes.teacher') }, s.teacher_name || '—')))))) : empty(t('classes.no_subjects'));
  view.replaceChildren(h('a', { href: '#/classes', class: 'small' }, `← ${t('nav.classes')}`),
    h('div', { class: 'page-head', style: { marginTop: '.5rem' } }, h('div', h('h1', c.label), h('p', `${c.year_name} · ${t('classes.students_n', { n: c.students })}${c.teacher_name ? ' · ' + c.teacher_name : ''}`), activeBadge(c.active)),
      isAdmin() ? h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => classForm(c, years, () => navigate(`#/classes/${c.id}`)) }, t('common.edit')), h('button', { class: 'btn btn-primary', onclick: () => assignSubjects(c) }, t('classes.assign_subjects')),
        c.active ? h('button', { class: 'btn btn-danger', onclick: async () => { if (await confirmDialog(t('classes.deactivate_confirm'), t('common.deactivate'))) { try { await del(`/classes/${c.id}`); toast(t('common.saved')); navigate('#/classes'); } catch (e) { fail(e); } } } }, t('common.deactivate')) : null) : null),
    h('h2', t('nav.subjects')), subjTable, h('h2', { style: { marginTop: '1.5rem' } }, t('nav.students')),
    c.students_list.length ? h('div', { class: 'grid grid-cards' }, c.students_list.map((s) => h('a', { class: 'card s-card', href: `#/students/${s.id}`, style: { textDecoration: 'none', color: 'inherit' } }, avatar(s.full_name, s.photo, 'sm'), h('strong', s.full_name), h('span', { class: 'meta' }, s.student_code), statusBadge(s.status)))) : empty(t('classes.no_students')));
}
async function assignSubjects(c) {
  const [subjects, teachers] = await Promise.all([get('/subjects'), get('/teachers')]);
  const active = subjects.filter((s) => s.active || c.subjects.some((x) => x.subject_id === s.id));
  if (!active.length) { toast(t('classes.need_subjects'), 'error'); return navigate('#/subjects'); }
  const rows = active.map((s) => { const cur = c.subjects.find((x) => x.subject_id === s.id);
    return { s, on: h('input', { type: 'checkbox', checked: !!cur, 'aria-label': s.name }), coef: h('input', { type: 'number', min: '0.1', step: '0.1', value: cur ? (cur.coefficient ?? '') : (s.default_coefficient ?? ''), placeholder: t('acad.coef_ph'), 'aria-label': t('acad.coef') }),
      teacher: select([['', '—'], ...teachers.map((x) => [x.id, x.name])], cur ? cur.teacher_id || '' : '', { 'aria-label': t('classes.teacher') }) }; });
  modal({ title: `${t('classes.assign_subjects')} — ${c.label}`, wide: true, body: h('div', h('p', { class: 'muted' }, t('classes.assign_help')), h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', ''), h('th', t('acad.subject')), h('th', t('acad.coef')), h('th', t('classes.teacher')))),
    h('tbody', rows.map((r) => h('tr', h('td', { 'data-label': t('common.use') }, r.on), h('td', { 'data-label': t('acad.subject') }, `${r.s.name} (${r.s.code})`), h('td', { 'data-label': t('acad.coef') }, r.coef), h('td', { 'data-label': t('classes.teacher') }, r.teacher))))))),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (x) => x() }, { label: t('common.save'), class: 'btn-primary', onclick: async (x) => {
      try { await put(`/classes/${c.id}/subjects`, { subjects: rows.filter((r) => r.on.checked).map((r) => ({ subject_id: r.s.id, coefficient: r.coef.value === '' ? null : Number(r.coef.value), teacher_id: r.teacher.value ? Number(r.teacher.value) : null })) }); toast(t('common.saved')); x(); navigate(`#/classes/${c.id}`); } catch (e) { fail(e); } } }] });
}

// ================= Subjects =================
export async function subjectsPage(ctx, view) {
  const box = h('div');
  const run = () => load(box, () => get('/subjects'), (list) => list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
    h('thead', h('tr', h('th', t('subjects.name')), h('th', t('subjects.code')), h('th', t('subjects.classes')), h('th', { class: 'num' }, t('subjects.default_coef')), h('th', t('form.status')), isAdmin() ? h('th', '') : null)),
    h('tbody', list.map((s) => h('tr', h('td', { 'data-label': t('subjects.name') }, h('strong', s.name), s.description ? h('div', { class: 'small muted' }, s.description) : null), h('td', { 'data-label': t('subjects.code') }, h('code', s.code)),
      h('td', { 'data-label': t('subjects.classes') }, s.classes.length ? s.classes.map((c) => `${c.label} (${c.coefficient == null ? t('acad.coef_missing') : '×' + fmtNum(c.coefficient)})`).join(', ') : '—'), h('td', { class: 'num', 'data-label': t('subjects.default_coef') }, fmtNum(s.default_coefficient)),
      h('td', { 'data-label': t('form.status') }, activeBadge(s.active)),
      isAdmin() ? h('td', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm', onclick: () => subjectForm(s, run) }, t('common.edit')), s.active ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await confirmDialog(t('subjects.deactivate_confirm'), t('common.deactivate'))) { try { await del(`/subjects/${s.id}`); toast(t('common.saved')); run(); } catch (e) { fail(e); } } } }, t('common.deactivate')) : null) : null)))))
    : empty(t('subjects.empty_title'), isAdmin() ? t('subjects.empty_text') : t('subjects.empty_text_teacher'), isAdmin() ? h('button', { class: 'btn btn-primary', onclick: () => subjectForm(null, run) }, t('subjects.add')) : null));
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.subjects')), h('p', t('subjects.subtitle'))), isAdmin() ? h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => subjectForm(null, run) }, svgIcon('plus', 18), t('subjects.add'))) : null), box);
  run();
}
function subjectForm(s, done) {
  const f = { name: input({ value: s ? s.name : '', maxlength: 80 }), code: input({ value: s ? s.code : '', maxlength: 20, placeholder: 'MATH' }), desc: textarea({ maxlength: 300 }), coef: input({ type: 'number', min: '0.1', step: '0.1', value: s && s.default_coefficient != null ? s.default_coefficient : '' }), active: h('input', { type: 'checkbox', id: 'sact', checked: s ? s.active : true }) };
  f.desc.value = s && s.description ? s.description : '';
  modal({ title: s ? t('subjects.edit') : t('subjects.add'), body: h('form', { onsubmit: (e) => e.preventDefault() }, field(t('subjects.name'), f.name, { required: true }), field(t('subjects.code'), f.code, { required: true, hint: t('subjects.code_hint') }), field(t('subjects.default_coef'), f.coef, { hint: t('subjects.default_coef_hint') }),
    field(t('subjects.description'), f.desc), h('div', { class: 'check' }, f.active, h('label', { for: 'sact' }, t('common.active')))),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      const body = { name: f.name.value, code: f.code.value, description: f.desc.value, default_coefficient: f.coef.value === '' ? null : Number(f.coef.value), active: f.active.checked };
      try { s ? await put(`/subjects/${s.id}`, body) : await post('/subjects', body); toast(t('common.saved')); c(); done(); } catch (e) { fail(e); } } }] });
}

// ================= Grades =================
export async function gradesPage(ctx, view) {
  const [years, classes, subjects] = await Promise.all([get('/academic-years'), get('/classes'), get('/subjects')]);
  const terms = years.flatMap((y) => y.terms.map((x) => ({ ...x, year_name: y.name })));
  if (!years.length || !terms.length || !classes.length || !subjects.length) {
    view.replaceChildren(h('div', { class: 'page-head' }, h('h1', t('nav.grades'))), h('div', { class: 'notice' }, isAdmin() ? t('grades.need_setup') : t('grades.nothing_assigned')), isAdmin() ? h('a', { class: 'btn btn-primary', href: '#/settings' }, t('nav.settings')) : null);
    return;
  }
  const cur = years.find((y) => y.is_current) || years[0];
  const yr = select(years.map((y) => [y.id, y.name]), cur.id, { 'aria-label': t('form.year') });
  const term = select([], '', { 'aria-label': t('acad.term') }); const cls = select([], '', { 'aria-label': t('form.class') }); const sub = select([], '', { 'aria-label': t('acad.subject') });
  const fill = (el, opts) => { const keep = el.value; el.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l))); if ([...el.options].some((o) => o.value === keep)) el.value = keep; };
  const refill = () => { const y = Number(yr.value); fill(term, terms.filter((x) => x.year_id === y).map((x) => [x.id, x.name])); fill(cls, classes.filter((c) => c.year_id === y).map((c) => [c.id, c.label])); };
  const refillSubjects = () => { const c = classes.find((x) => x.id === Number(cls.value)); fill(sub, subjects.filter((s) => s.classes.some((k) => k.label === (c && c.label)) ).map((s) => [s.id, s.name])); };
  const list = h('div'), sheet = h('div');
  const run = () => {
    sheet.replaceChildren();
    if (!term.value || !cls.value || !sub.value) { list.replaceChildren(empty(t('grades.pick'), t('grades.pick_text'))); return; }
    load(list, () => get('/assessments' + qs({ class_id: cls.value, subject_id: sub.value, term_id: term.value })), (items) => h('div', h('div', { class: 'page-head' }, h('h2', t('grades.assessments')),
      isAdmin() ? h('button', { class: 'btn btn-primary', onclick: () => assessmentForm({ class_id: cls.value, subject_id: sub.value, term_id: term.value }, (id) => { run(); openSheet(id); }) }, svgIcon('plus', 18), t('grades.new_assessment')) : null),
      items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('subjects.name')), h('th', t('grades.type')), h('th', t('common.date')), h('th', { class: 'num' }, t('grades.max')), h('th', { class: 'num' }, t('grades.graded')), h('th', ''))),
        h('tbody', items.map((a) => h('tr', h('td', { 'data-label': t('subjects.name') }, h('strong', a.name)), h('td', { 'data-label': t('grades.type') }, t(`atype.${a.type}`)), h('td', { 'data-label': t('common.date') }, fmtDate(a.date)), h('td', { class: 'num', 'data-label': t('grades.max') }, fmtNum(a.max_score)), h('td', { class: 'num', 'data-label': t('grades.graded') }, a.graded),
          h('td', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm btn-primary', onclick: () => openSheet(a.id) }, isAdmin() ? t('grades.enter') : t('common.open')),
            isAdmin() && !a.graded ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await confirmDialog(t('grades.delete_assessment_confirm'), t('common.delete'))) { try { await del(`/assessments/${a.id}`); run(); } catch (e) { fail(e); } } } }, t('common.delete')) : null)))))) : empty(t('grades.no_assessments'), isAdmin() ? t('grades.no_assessments_text') : null)));
  };
  async function openSheet(id) {
    sheet.replaceChildren(spinner());
    try {
      const d = await get(`/assessments/${id}/sheet`); const a = d.assessment;
      const rows = d.students.map((s) => ({ s, score: h('input', { type: 'number', min: 0, max: a.max_score, step: 'any', value: s.score ?? '', disabled: !d.editable || s.status === 'absent' || s.status === 'excused', 'aria-label': `${t('grades.score')} ${s.full_name}` }),
        status: select([['graded', t('gstatus.graded')], ['absent', t('gstatus.absent')], ['excused', t('gstatus.excused')]], s.status || 'graded', { disabled: !d.editable, 'aria-label': `${t('grades.status')} ${s.full_name}` }), comment: h('input', { type: 'text', maxlength: 300, value: s.comment || '', disabled: !d.editable, 'aria-label': `${t('grades.comment')} ${s.full_name}` }) }));
      rows.forEach((r) => r.status.addEventListener('change', () => { const off = r.status.value !== 'graded'; r.score.disabled = off; if (off) r.score.value = ''; }));
      sheet.replaceChildren(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h2', `${a.name} — ${t('grades.max')}: ${fmtNum(a.max_score)} — ${fmtDate(a.date)}`),
        !d.editable ? h('div', { class: 'notice notice-blue' }, t('grades.read_only')) : h('p', { class: 'muted small' }, t('grades.missing_rule')),
        d.students.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('students.id')), h('th', t('form.full_name')), h('th', t('grades.score')), h('th', t('grades.status')), h('th', t('grades.comment')))),
          h('tbody', rows.map((r) => h('tr', h('td', { 'data-label': t('students.id') }, r.s.student_code), h('td', { 'data-label': t('form.full_name') }, r.s.full_name), h('td', { 'data-label': t('grades.score') }, r.score, ` / ${fmtNum(a.max_score)}`), h('td', { 'data-label': t('grades.status') }, r.status), h('td', { 'data-label': t('grades.comment') }, r.comment)))))) : empty(t('classes.no_students')),
        d.editable && d.students.length ? h('div', { class: 'actions', style: { marginTop: '1rem' } }, h('button', { class: 'btn btn-gold', id: 'save-grades', onclick: async (e) => {
          e.target.disabled = true;
          try {
            const entries = rows.filter((r) => r.status.value !== 'graded' || r.score.value !== '' || r.s.status).map((r) => (r.status.value === 'graded' && r.score.value === '' ? { student_id: r.s.id, clear: true } : { student_id: r.s.id, status: r.status.value, score: r.score.value === '' ? null : Number(r.score.value), comment: r.comment.value }));
            const r = await put(`/assessments/${a.id}/grades`, { entries }); toast(t('grades.saved', { n: r.saved })); run(); openSheet(a.id);
          } catch (ex) { fail(ex); } e.target.disabled = false; } }, t('grades.save'))) : null));
      sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { sheet.replaceChildren(errorBox(e)); }
  }
  yr.addEventListener('change', () => { refill(); refillSubjects(); run(); }); cls.addEventListener('change', () => { refillSubjects(); run(); }); [term, sub].forEach((el) => el.addEventListener('change', run));
  refill(); refillSubjects();
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.grades')), h('p', t('grades.subtitle')))),
    h('div', { class: 'toolbar' }, h('div', field(t('form.year'), yr)), h('div', field(t('acad.term'), term)), h('div', field(t('form.class'), cls)), h('div', field(t('acad.subject'), sub))), list, sheet);
  run();
}
function assessmentForm(base, done) {
  const f = { name: input({ maxlength: 80 }), type: select(ASSESSMENT_TYPES.map((x) => [x, t(`atype.${x}`)]), 'test'), max: input({ type: 'number', min: 1, step: 'any', value: 20 }), date: input({ type: 'date', value: new Date().toISOString().slice(0, 10) }) };
  modal({ title: t('grades.new_assessment'), body: h('form', { onsubmit: (e) => e.preventDefault() }, field(t('subjects.name'), f.name, { required: true }), field(t('grades.type'), f.type, { required: true }), field(t('grades.max'), f.max, { required: true }), field(t('common.date'), f.date, { required: true })),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      try { const r = await post('/assessments', { class_id: Number(base.class_id), subject_id: Number(base.subject_id), term_id: Number(base.term_id), name: f.name.value, type: f.type.value, max_score: Number(f.max.value), date: f.date.value }); c(); done(r.id); } catch (e) { fail(e); } } }] });
}

// ================= Results & Reports =================
export async function reportsPage(ctx, view) {
  if (!isAdmin()) {
    const box = h('div');
    view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.reports')), h('p', t('reports.subtitle_family')))), box);
    return load(box, () => get('/reports/terms'), (list) => list.length ? h('div', { class: 'grid grid-cards' }, list.map((r) => h('div', { class: 'card' }, h('h3', r.full_name), h('p', { class: 'muted' }, `${r.term_name} — ${r.year_name}`), h('a', { class: 'btn btn-primary', href: `#/reports/card/${r.student_id}/${r.term_id}` }, t('reports.report_card')))))
      : empty(t('reports.none_title'), t('acad.none_approved')));
  }
  const [years, classes] = await Promise.all([get('/academic-years'), get('/classes')]);
  const terms = years.flatMap((y) => y.terms.map((x) => ({ ...x, year_name: y.name })));
  if (!terms.length || !classes.length) { view.replaceChildren(h('div', { class: 'page-head' }, h('h1', t('nav.reports'))), h('div', { class: 'notice' }, t('grades.need_setup')), h('a', { class: 'btn btn-primary', href: '#/settings' }, t('nav.settings'))); return; }
  const cur = years.find((y) => y.is_current) || years[0];
  const yr = select(years.map((y) => [y.id, y.name]), cur.id), term = select([], ''), cls = select([], '');
  const fill = (el, opts) => el.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)));
  const refill = () => { const y = Number(yr.value); fill(term, terms.filter((x) => x.year_id === y).map((x) => [x.id, x.name])); fill(cls, classes.filter((c) => c.year_id === y).map((c) => [c.id, c.label])); };
  const box = h('div');
  const run = () => {
    if (!term.value || !cls.value) { box.replaceChildren(empty(t('reports.no_class'))); return; }
    load(box, () => get(`/reports/class${qs({ class_id: cls.value, term_id: term.value })}`), (d) => {
      const codes = [...new Set(d.students.flatMap((s) => s.subjects.map((x) => x.code)))];
      return h('div', h('div', { class: 'page-head' }, h('div', h('h2', `${d.class_label} — ${d.term.name}`), h('p', `${t('reports.class_average')}: ${d.class_average == null ? '—' : fmtNum(d.class_average)} · ${t('reports.pass_mark')}: ${fmtNum(d.pass_mark)}`)),
        h('div', { class: 'actions no-print' }, h('button', { class: 'btn', onclick: () => window.print() }, t('reports.print')), h('button', { class: 'btn btn-gold', onclick: async () => {
          if (!(await confirmDialog(t('reports.approve_class_confirm'), t('reports.approve'), false))) return;
          try { const r = await post('/reports/approve-class', { class_id: Number(cls.value), term_id: Number(term.value) }); toast(t('reports.approved_n', { n: r.approved }) + (r.skipped ? ' ' + t('reports.skipped_n', { n: r.skipped }) : '')); run(); } catch (e) { fail(e); } } }, t('reports.approve_class')))),
        d.students.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('form.full_name')), codes.map((c) => h('th', { class: 'num' }, c)), h('th', { class: 'num' }, t('reports.overall')), d.students.some((s) => s.rank) ? h('th', { class: 'num' }, t('acad.rank')) : null, h('th', t('reports.status')), h('th', { class: 'no-print' }, ''))),
          h('tbody', d.students.map((s) => h('tr', h('td', { 'data-label': t('form.full_name') }, s.name), codes.map((c) => { const x = s.subjects.find((y) => y.code === c); return h('td', { class: 'num', 'data-label': c }, x && x.average != null ? fmtNum(x.average) : '—'); }),
            h('td', { class: 'num', 'data-label': t('reports.overall') }, h('strong', s.average == null ? '—' : fmtNum(s.average)), s.missing_coefficients.length ? h('div', { class: 'small' }, badge(t('acad.coef_missing'), 'gold')) : null), d.students.some((x) => x.rank) ? h('td', { class: 'num', 'data-label': t('acad.rank') }, s.rank ?? '—') : null,
            h('td', { 'data-label': t('reports.status') }, badge(t(`rstatus.${s.status}`), s.status === 'approved' ? 'green' : 'neutral')),
            h('td', { class: 'actions-cell no-print' }, h('a', { class: 'btn btn-sm btn-primary', href: `#/reports/card/${s.id}/${d.term.id}` }, t('reports.report_card')))))))) : empty(t('classes.no_students')));
    });
  };
  yr.addEventListener('change', () => { refill(); run(); }); [term, cls].forEach((el) => el.addEventListener('change', run)); refill();
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.reports')), h('p', t('reports.subtitle')))), h('div', { class: 'toolbar no-print' }, h('div', field(t('form.year'), yr)), h('div', field(t('acad.term'), term)), h('div', field(t('form.class'), cls))), box);
  run();
}

export async function reportCardPage(ctx, view) {
  const sid = ctx.params.sid;
  const draw = async (tid) => {
    view.replaceChildren(spinner());
    try {
      const r = await get(`/reports/card${qs({ student_id: sid, term_id: tid })}`);
      const acad = await get(`/students/${sid}/academics`);
      const sel = select(acad.terms.map((x) => [x.id, `${x.name} — ${x.year_name}`]), tid, { 'aria-label': t('acad.term'), onchange: (e) => navigate(`#/reports/card/${sid}/${e.target.value}`) });
      const approve = isAdmin() ? h('div', { class: 'no-print', style: { marginBottom: '1rem' } }, h('div', { class: 'card' }, h('h3', t('reports.admin_actions')), (() => {
        const comment = textarea({ maxlength: 500, placeholder: t('reports.comment_ph') }); comment.value = r.report.comment || '';
        return h('div', field(t('reports.comment'), comment), h('div', { class: 'actions' }, h('button', { class: 'btn btn-gold', onclick: async () => { try { await post('/reports/approve', { student_id: Number(sid), term_id: Number(tid), comment: comment.value }); toast(t('reports.approved')); draw(tid); } catch (e) { fail(e); } } }, r.report.status === 'approved' ? t('reports.update_approved') : t('reports.approve')),
          r.report.status === 'approved' ? h('button', { class: 'btn', onclick: async () => { try { await post('/reports/approve', { student_id: Number(sid), term_id: Number(tid), approve: false, comment: comment.value }); draw(tid); } catch (e) { fail(e); } } }, t('reports.unapprove')) : null));
      })())) : null;
      view.replaceChildren(h('div', { class: 'no-print' }, h('a', { href: isAdmin() ? '#/reports' : '#/reports', class: 'small' }, `← ${t('nav.reports')}`),
        h('div', { class: 'toolbar', style: { marginTop: '.5rem' } }, h('div', field(t('acad.term'), sel)), h('button', { class: 'btn btn-primary', onclick: () => window.print() }, t('reports.print')))), approve,
        h('article', { class: 'report' }, h('div', { class: 'report-head' }, r.school.logo ? h('img', { class: 'logo', src: r.school.logo, alt: r.school.name || '' }) : null, h('div', { style: { flex: 1 } }, h('h1', r.school.name), r.school.motto ? h('div', { class: 'muted' }, r.school.motto) : null, h('div', { class: 'small muted' }, [r.school.address, r.school.phone].filter(Boolean).join(' · '))),
          avatar(r.student.full_name, r.student.photo, 'md')),
          h('h2', { style: { textAlign: 'center' } }, `${t('reports.report_card')} — ${r.term.name} — ${r.term.year_name}`),
          h('div', { class: 'report-meta' }, h('div', h('strong', `${t('form.full_name')}: `), r.student.full_name), h('div', h('strong', `${t('students.id')}: `), r.student.student_code), h('div', h('strong', `${t('form.class')}: `), r.student.class_label || '—'), h('div', h('strong', `${t('common.date')}: `), fmtDate(r.generated_on))),
          r.subjects.length ? h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', h('th', t('acad.subject')), h('th', { class: 'num' }, t('acad.coef')), h('th', t('acad.assessments')), h('th', { class: 'num' }, t('acad.average', { n: r.scale })))),
            h('tbody', r.subjects.map((s) => h('tr', h('td', h('strong', s.name)), h('td', { class: 'num' }, s.coefficient == null ? t('acad.coef_missing') : fmtNum(s.coefficient)), h('td', s.entries.map((e) => h('div', { class: 'small' }, `${e.name}: `, e.status === 'graded' ? `${fmtNum(e.score)}/${fmtNum(e.max_score)}` : t(`gstatus.${e.status}`)))), h('td', { class: 'num' }, h('strong', s.average == null ? '—' : fmtNum(s.average)))))))) : empty(t('acad.no_grades')),
          r.missing_coefficients && r.missing_coefficients.length ? h('div', { class: 'notice notice-gold' }, t('acad.coefs_missing_notice', { subjects: r.missing_coefficients.map((m) => m.name).join(', ') })) : null,
          h('p', { style: { marginTop: '1rem', fontSize: '1.1rem' } }, h('strong', `${t('acad.overall')}: ${r.overall == null ? '—' : fmtNum(r.overall) + ' / ' + fmtNum(r.scale)}`), r.passed != null ? ` — ${r.passed ? t('acad.passed') : t('acad.not_passed')}` : '', r.rank ? ` — ${t('acad.rank')}: ${r.rank}/${r.class_size}` : ''),
          h('p', { class: 'small muted' }, t('acad.rule_note', { pass: fmtNum(r.pass_mark) })),
          r.discipline ? h('div', { class: 'card', style: { margin: '1rem 0' } }, h('h3', t('reports.discipline')),
            r.discipline.conduct ? h('p', t(r.discipline.conduct.incidents ? 'reports.conduct_n' : 'reports.conduct_none', { n: r.discipline.conduct.incidents, s: r.discipline.conduct.serious })) : null,
            r.discipline.decisions ? (r.discipline.decisions.length ? r.discipline.decisions.map((d) => h('p', h('strong', `${fmtDate(d.decided_on)}: `), d.decision_text, d.sanctions.length ? ` (${d.sanctions.map((x) => `${state.lang === 'fr' ? x.name_fr : x.name_en}${x.duration_days ? ` — ${t('disc.n_days', { n: x.duration_days })}` : ''}`).join(', ')})` : '')) : h('p', { class: 'muted' }, t('reports.no_decisions'))) : null) : null,
          r.report.comment ? h('p', h('strong', `${t('reports.comment')}: `), r.report.comment) : null,
          h('p', { class: 'small' }, `${t('reports.status')}: `, h('strong', t(`rstatus.${r.report.status}`)), r.report.approved_at ? ` (${fmtDate(r.report.approved_at)})` : ''),
          h('div', { class: 'sign' }, h('div', t('reports.sign_admin')), h('div', t('reports.sign_parent')))));
    } catch (e) { view.replaceChildren(errorBox(e, () => draw(tid))); }
  };
  draw(ctx.params.tid);
}
