// Discipline module (phase 1: setup). Later phases add incidents, council, sanctions and convocations.
import { state, t, h, get, post, put, del, qs, navigate, load, field, input, select, textarea, toast, fail, modal, badge, empty, confirmDialog, fmtDate, fmtDateTime } from './ui.js';

const nm = (x) => (state.lang === 'fr' ? x.name_fr : x.name_en);
const PERMS = ['manage_discipline', 'council_member', 'approve_decisions'];

export async function disciplinePage(ctx, view) {
  const isAdmin = state.user.role === 'school_admin';
  const has = (...p) => isAdmin || p.some((x) => (state.user.permissions || []).includes(x));
  const tabs = ['incidents', ...(has('manage_discipline', 'council_member') ? ['council'] : []), ...(has('manage_discipline', 'approve_decisions') ? ['decisions', 'sanctions', 'convocations'] : []), ...(isAdmin ? ['lists', 'people', 'report'] : ['mine'])];
  let tab = ctx.query.tab && tabs.includes(ctx.query.tab) ? ctx.query.tab : tabs[0];
  const panel = h('div', { role: 'tabpanel' });
  const bar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map((k) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; bar.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(tabs[i] === tab))); draw(); } }, t(`disc.tab_${k}`))));
  const draw = () => { panel.replaceChildren(); ({ incidents: incidentsTab, council: councilTab, decisions: decisionsTab, sanctions: sanctionsTab, convocations: convocationsTab, lists: listsTab, people: peopleTab, report: reportTab, mine: mineTab })[tab](panel); };
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.discipline')), h('p', t('disc.subtitle')))), h('div', { class: 'notice' }, t('disc.confidential_note')), bar, panel);
  draw();
}

// ---- what the signed-in teacher may do ----
function mineTab(panel) {
  load(panel, () => get('/discipline/me'), (r) => h('section', { class: 'card' }, h('h2', t('disc.your_access')),
    h('ul', r.permissions.map((p) => h('li', t(`disc.perm_${p}`)))), h('p', { class: 'muted small' }, t('disc.access_note'))));
}

// ---- categories and sanction types ----
function listsTab(panel) {
  const draw = () => load(panel, async () => ({ cats: await get('/discipline/categories?all=1'), sanc: await get('/discipline/sanction-types?all=1') }), ({ cats, sanc }) =>
    h('div', { class: 'grid grid-2' }, listCard(t('disc.categories'), t('disc.categories_hint'), cats, 'categories', true, draw), listCard(t('disc.sanction_types'), t('disc.sanctions_hint'), sanc, 'sanction-types', false, draw)));
  draw();
}
function listCard(title, hint, rows, path, withSeverity, redraw) {
  const edit = (row) => {
    const en = input({ value: row ? row.name_en : '', maxlength: 120 }), fr = input({ value: row ? row.name_fr : '', maxlength: 120 });
    const sev = select([['minor', t('disc.minor')], ['serious', t('disc.serious')]], row ? row.severity : 'minor');
    const dur = h('input', { type: 'checkbox', id: 'dur', checked: row ? !!row.has_duration : false });
    const body = h('div', field('English', en, { required: true }), field('Français', fr, { required: true }), withSeverity ? field(t('disc.severity'), sev) : h('div', { class: 'check' }, dur, h('label', { for: 'dur' }, t('disc.has_duration'))));
    modal({ title: row ? t('common.edit') : t('common.add'), body, actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      const data = { name_en: en.value, name_fr: fr.value, ...(withSeverity ? { severity: sev.value } : { has_duration: dur.checked }) };
      try { if (row) await put(`/discipline/${path}/${row.id}`, data); else await post(`/discipline/${path}`, data); c(); redraw(); } catch (e) { fail(e); } } }] });
  };
  const toggle = async (row) => { try { await put(`/discipline/${path}/${row.id}`, { active: !row.active }); redraw(); } catch (e) { fail(e); } };
  return h('section', { class: 'card' }, h('h2', title), h('p', { class: 'small muted' }, hint),
    rows.length ? rows.map((r) => h('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--line)', padding: '.5rem 0', opacity: r.active ? 1 : 0.55 } },
      h('strong', { style: { flex: '1 1 10rem' } }, nm(r)),
      withSeverity ? badge(t(`disc.${r.severity}`), r.severity === 'serious' ? 'red' : 'blue') : (r.has_duration ? badge(t('disc.has_duration'), 'blue') : null),
      !r.active ? badge(t('disc.off'), 'neutral') : null,
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => edit(r) }, t('common.edit')),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => toggle(r) }, r.active ? t('disc.switch_off') : t('disc.switch_on')))) : empty(t('common.none')),
    h('button', { class: 'btn btn-primary', style: { marginTop: '.8rem' }, onclick: () => edit(null) }, t('common.add')));
}

// ---- who may do what ----
function peopleTab(panel) {
  load(panel, () => get('/discipline/staff'), (staff) => h('section', { class: 'card' }, h('h2', t('disc.people')), h('div', { class: 'notice' }, t('disc.people_note')),
    staff.length ? staff.map((u) => {
      const boxes = PERMS.map((p) => ({ p, el: h('input', { type: 'checkbox', id: `p${u.id}${p}`, checked: u.permissions.includes(p) }) }));
      return h('div', { style: { borderBottom: '1px solid var(--line)', padding: '.7rem 0' } }, h('strong', u.name), ' ', h('span', { class: 'muted small' }, u.email),
        h('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '.4rem 0' } }, boxes.map(({ p, el }) => h('span', { class: 'check' }, el, h('label', { for: el.id }, t(`disc.perm_${p}`))))),
        h('button', { class: 'btn btn-sm', onclick: async () => { try { await put(`/discipline/staff/${u.id}/permissions`, { permissions: boxes.filter((b) => b.el.checked).map((b) => b.p) }); toast(t('common.saved')); } catch (e) { fail(e); } } }, t('common.save')));
    }) : empty(t('disc.no_staff'))));
}

// ---- report-card switches ----
function reportTab(panel) {
  load(panel, () => get('/discipline/settings'), (s) => {
    const c = h('input', { type: 'checkbox', id: 'rc', checked: s.report_show_conduct }), d = h('input', { type: 'checkbox', id: 'rd', checked: s.report_show_decisions });
    return h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await put('/discipline/settings', { report_show_conduct: c.checked, report_show_decisions: d.checked }); toast(t('common.saved')); } catch (ex) { fail(ex); } } },
      h('h2', t('disc.report_title')), h('div', { class: 'notice' }, t('disc.report_note')),
      h('div', { class: 'check' }, c, h('label', { for: 'rc' }, t('disc.report_conduct'))), h('div', { class: 'check' }, d, h('label', { for: 'rd' }, t('disc.report_decisions'))),
      h('button', { class: 'btn btn-primary', type: 'submit', style: { marginTop: '.8rem' } }, t('common.save')));
  });
}

// =====================================================================================================
// Incidents (phase 2)
// =====================================================================================================
const STATUSES = ['reported', 'under_review', 'action_taken', 'closed', 'dismissed'];
const statusKind = { reported: 'gold', under_review: 'blue', action_taken: 'red', closed: 'green', dismissed: 'neutral' };
const statusBadge = (st) => badge(t(`disc.status_${st}`), statusKind[st] || 'neutral');
// created_at values are stored in UTC; show them in the viewer's own time so they line up with incident times
const fmtUtc = (s) => { if (!s) return '—'; const d = new Date(`${String(s).replace(' ', 'T')}Z`); if (Number.isNaN(d.getTime())) return fmtDateTime(s); const p = (n) => String(n).padStart(2, '0'); return fmtDateTime(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`); };
const seesAll = () => state.user.role === 'school_admin' || (state.user.permissions || []).some((p) => p === 'manage_discipline' || p === 'approve_decisions');

function incidentRow(i, showStudent = true) {
  return h('a', { href: `#/discipline/incidents/${i.id}`, class: 'card', style: { display: 'block', textDecoration: 'none', color: 'inherit', margin: '.5rem 0', padding: '.8rem 1rem' } },
    h('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' } },
      showStudent ? h('strong', { style: { flex: '1 1 12rem' } }, i.student.full_name, h('span', { class: 'muted small' }, ` · ${[i.student.student_code, i.class_label].filter(Boolean).join(' · ')}`)) : h('strong', { style: { flex: '1 1 12rem' } }, nm({ name_en: i.category.name_en, name_fr: i.category.name_fr })),
      showStudent ? badge(nm({ name_en: i.category.name_en, name_fr: i.category.name_fr }), i.category.severity === 'serious' ? 'red' : 'blue') : null, statusBadge(i.status)),
    h('div', { class: 'muted small', style: { marginTop: '.25rem' } }, `${fmtDateTime(i.occurred_at)} · ${t('disc.reported_by')}: ${i.reporter}`));
}

function incidentsTab(panel) {
  const wide = seesAll();
  const f = { q: '', status: '', category_id: '', class_id: '', year_id: '', from: '', to: '', page: 1 };
  const list = h('div');
  const run = () => load(list, () => get(`/discipline/incidents${qs({ ...f, page_size: 20 })}`), (r) => h('div',
    h('p', { class: 'muted small' }, t('disc.count', { n: r.total })),
    r.items.length ? r.items.map((i) => incidentRow(i)) : empty(t('disc.no_incidents')),
    r.total > r.page * r.page_size || r.page > 1 ? h('div', { class: 'actions', style: { justifyContent: 'center', marginTop: '.5rem' } },
      h('button', { class: 'btn btn-sm', disabled: r.page <= 1, onclick: () => { f.page--; run(); } }, t('common.prev')),
      h('button', { class: 'btn btn-sm', disabled: r.total <= r.page * r.page_size, onclick: () => { f.page++; run(); } }, t('common.next'))) : null));
  const bar = h('div', { class: 'card' });
  load(bar, async () => ({ cats: await get('/discipline/categories?all=1').catch(() => get('/discipline/categories')), years: await get('/academic-years'), classes: wide ? await get('/discipline/classes') : [] }), ({ cats, years, classes }) => {
    const mk = (key, el) => { el.addEventListener('change', () => { f[key] = el.value; f.page = 1; run(); }); return el; };
    const q = input({ placeholder: t('disc.search_ph'), 'aria-label': t('disc.search_ph') });
    let timer; q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { f.q = q.value; f.page = 1; run(); }, 300); });
    return h('div', h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'end', marginBottom: '.6rem' } },
      h('div', { style: { flex: '1 1 14rem' } }, q), h('a', { class: 'btn btn-primary', href: '#/discipline/incidents/new' }, t('disc.new_incident'))),
      h('div', { class: 'grid grid-3', style: { gap: '.5rem' } },
        field(t('disc.status'), mk('status', select([['', t('common.all')], ...STATUSES.map((x) => [x, t(`disc.status_${x}`)])], ''))),
        field(t('disc.category'), mk('category_id', select([['', t('common.all')], ...cats.map((x) => [x.id, nm(x)])], ''))),
        field(t('form.year'), mk('year_id', select([['', t('common.all')], ...years.map((x) => [x.id, x.name])], ''))),
        wide ? field(t('form.class'), mk('class_id', select([['', t('common.all')], ...classes.map((x) => [x.id, `${x.label} (${x.year_name || ''})`])], ''))) : null,
        field(t('disc.from'), mk('from', input({ type: 'date' }))), field(t('disc.to'), mk('to', input({ type: 'date' })))));
  });
  panel.append(bar, list); run();
}

// ---- student picker: type to search, click to choose ----
function studentPicker(onPick, initial) {
  let chosen = initial || null;
  const out = h('div'), results = h('div'), box = input({ placeholder: t('disc.find_student'), 'aria-label': t('disc.find_student'), autocomplete: 'off' });
  const paint = () => {
    out.replaceChildren(chosen ? h('div', { class: 'notice notice-blue', style: { display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center' } },
      h('span', h('strong', chosen.full_name), ` · ${[chosen.student_code, chosen.class_label].filter(Boolean).join(' · ')}`),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { chosen = null; onPick(null); paint(); } }, t('common.change'))) : null);
    box.style.display = chosen ? 'none' : ''; if (chosen) results.replaceChildren();
  };
  let timer;
  box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (box.value.trim().length < 2) return results.replaceChildren();
    try { const rows = await get(`/discipline/students${qs({ q: box.value.trim() })}`);
      results.replaceChildren(rows.length ? h('div', { class: 'card', style: { padding: '.3rem' } }, rows.map((r) => h('button', { type: 'button', class: 'btn btn-ghost', style: { display: 'block', width: '100%', textAlign: 'left' }, onclick: () => { chosen = r; onPick(r); paint(); box.value = ''; } },
        h('strong', r.full_name), ` · ${[r.student_code, r.class_label].filter(Boolean).join(' · ')}`))) : h('p', { class: 'muted small' }, t('disc.no_student_found'))); } catch (e) { fail(e); } }, 250); });
  paint();
  return h('div', out, box, results);
}

const readDoc = (file) => new Promise((resolve, reject) => {
  if (file.size > 3 * 1024 * 1024) return reject(new Error('file_too_large'));
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('invalid_file')); r.readAsDataURL(file);
});

export async function incidentPage(ctx, view, id) {
  const back = h('a', { href: '#/discipline', class: 'small' }, `← ${t('nav.discipline')}`);
  const [cats] = await Promise.all([get('/discipline/categories')]);
  const d = id ? await get(`/discipline/incidents/${id}`) : null;
  const editable = !d || d.can_edit;
  let student = d ? d.student : null;
  const now = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const date = input({ type: 'date', value: d ? d.occurred_date : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, max: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, disabled: !editable });
  const time = input({ type: 'time', value: d ? d.occurred_time : `${pad(now.getHours())}:${pad(now.getMinutes())}`, disabled: !editable });
  const catSel = select(cats.map((c) => [c.id, nm(c)]), d ? d.category.id : (cats[0] && cats[0].id), { disabled: !editable });
  if (d && !cats.some((c) => c.id === d.category.id)) catSel.prepend(h('option', { value: d.category.id, selected: true }, nm(d.category)));
  const desc = textarea({ rows: 6, maxlength: 4000, value: d ? d.description : '', disabled: !editable }); desc.value = d ? d.description : '';
  let witnesses = d ? d.witnesses.map((w) => ({ name: w.name, note: w.note || '' })) : [];
  const wbox = h('div');
  const paintW = () => wbox.replaceChildren(...witnesses.map((w, i) => h('div', { style: { display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.4rem' } },
    input({ value: w.name, placeholder: t('disc.witness_name'), 'aria-label': t('disc.witness_name'), disabled: !editable, style: { flex: '1 1 10rem' }, oninput: (e) => { w.name = e.target.value; } }),
    input({ value: w.note, placeholder: t('disc.witness_note'), 'aria-label': t('disc.witness_note'), disabled: !editable, style: { flex: '2 1 12rem' }, oninput: (e) => { w.note = e.target.value; } }),
    editable ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { witnesses.splice(i, 1); paintW(); } }, t('common.remove')) : null)));
  paintW();
  const status = d && d.can_change_status ? select(STATUSES.map((x) => [x, t(`disc.status_${x}`)]), d.status) : null;
  const save = async (e) => {
    e.preventDefault();
    if (!student) return toast(t('disc.choose_student'), 'error');
    const body = { category_id: catSel.value, occurred_date: date.value, occurred_time: time.value, description: desc.value, witnesses: witnesses.filter((w) => w.name.trim()) };
    try {
      if (d) { if (status) body.status = status.value; await put(`/discipline/incidents/${d.id}`, body); toast(t('common.saved')); navigate(`#/discipline/incidents/${d.id}`); ctxReload(); }
      else { const r = await post('/discipline/incidents', { ...body, student_id: student.id }); toast(t('disc.incident_saved')); navigate(`#/discipline/incidents/${r.id}`); }
    } catch (ex) { fail(ex); }
  };
  const ctxReload = () => incidentPage(ctx, view, id);
  const docs = h('div');
  const paintDocs = (list) => docs.replaceChildren(
    list.length ? h('ul', { style: { listStyle: 'none', padding: 0 } }, list.map((x) => h('li', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.35rem 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' } },
      h('a', { href: `/api/discipline/incidents/${d.id}/documents/${x.id}`, download: x.original_name, style: { flex: 1 } }, x.original_name), h('span', { class: 'muted small' }, `${Math.ceil(x.size / 1024)} KB`),
      d.can_edit ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => { if (await confirmDialog(t('disc.remove_doc'), t('common.remove'))) { try { await del(`/discipline/incidents/${d.id}/documents/${x.id}`); ctxReload(); } catch (ex) { fail(ex); } } } }, t('common.remove')) : null))) : h('p', { class: 'muted small' }, t('disc.no_documents')),
    d.can_add_documents ? h('div', { style: { marginTop: '.5rem' } }, h('input', { type: 'file', accept: 'application/pdf,image/jpeg,image/png,image/webp', 'aria-label': t('disc.add_document'), onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { await post(`/discipline/incidents/${d.id}/documents`, { name: file.name, data: await readDoc(file) }); toast(t('common.saved')); ctxReload(); } catch (ex) { fail(ex.message === 'file_too_large' ? { code: 'file_too_large' } : ex); } } }),
      h('p', { class: 'muted small' }, t('disc.doc_hint'))) : null);
  if (d) paintDocs(d.documents);
  const picker = d ? h('div', h('strong', d.student.full_name), ` · ${[d.student.student_code, d.class_label, d.year_name].filter(Boolean).join(' · ')}`, ' ',
    d.can_view_history ? h('a', { class: 'small', href: `#/discipline/students/${d.student.id}` }, t('disc.history')) : null) : studentPicker((s) => { student = s; });
  view.replaceChildren(back, h('div', { class: 'page-head' }, h('div', h('h1', d ? t('disc.incident_no', { n: d.id }) : t('disc.new_incident')), d ? h('p', { class: 'muted' }, `${t('disc.reported_by')}: ${d.reporter}`) : null), d ? statusBadge(d.status) : null),
    h('div', { class: 'notice' }, t('disc.confidential_note')),
    h('form', { class: 'card', onsubmit: save, novalidate: true },
      h('h2', t('disc.student')), picker,
      h('div', { class: 'grid grid-3', style: { marginTop: '.8rem' } }, field(t('disc.date'), date, { required: true }), field(t('disc.time'), time, { required: true }), field(t('disc.category'), catSel, { required: true })),
      status ? field(t('disc.status'), status) : null,
      field(t('disc.description'), desc, { required: true, hint: t('disc.description_hint') }),
      h('h3', t('disc.witnesses')), wbox, editable ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { witnesses.push({ name: '', note: '' }); paintW(); } }, t('disc.add_witness')) : null,
      editable ? h('div', { class: 'actions', style: { marginTop: '1rem' } }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save'))) : h('p', { class: 'muted small' }, t('disc.locked'))),
    d ? h('section', { class: 'card' }, h('h2', t('disc.documents')), docs) : h('p', { class: 'muted small' }, t('disc.docs_after_save')));
}

// ---- confidential disciplinary history of one student ----
export async function studentHistoryPage(ctx, view) {
  const id = ctx.params.id;
  const f = { year_id: '', from: '', to: '' };
  const years = await get('/academic-years');
  const box = h('div');
  const draw = () => load(box, () => get(`/discipline/students/${id}/history${qs(f)}`), (d) => {
    const note = textarea({ rows: 3, maxlength: 2000, placeholder: t('disc.followup_ph'), 'aria-label': t('disc.followup_ph') });
    const trend = select([['', t('disc.trend_none')], ['improving', t('disc.trend_improving')], ['stable', t('disc.trend_stable')], ['concerning', t('disc.trend_concerning')]], '');
    const inc = select([['', t('disc.no_link')], ...d.incidents.map((i) => [i.id, `#${i.id} · ${fmtDate(i.occurred_at)} · ${nm({ name_en: i.category.name_en, name_fr: i.category.name_fr })}`])], '');
    const trendKind = { improving: 'green', stable: 'blue', concerning: 'red' };
    return h('div',
      h('div', { class: 'card', style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' } }, h('div', { style: { flex: '1 1 14rem' } }, h('h1', { style: { marginBottom: '.2rem' } }, d.student.full_name), h('p', { class: 'muted', style: { margin: 0 } }, [d.student.student_code, d.student.class_label, d.student.year_name].filter(Boolean).join(' · '))),
        badge(t('disc.n_incidents', { n: d.summary.incidents }), 'blue'), d.summary.serious ? badge(t('disc.n_serious', { n: d.summary.serious }), 'red') : null, d.summary.latest_trend ? badge(t(`disc.trend_${d.summary.latest_trend}`), trendKind[d.summary.latest_trend]) : null),
      h('h2', t('disc.incidents')), d.incidents.length ? d.incidents.map((i) => incidentRow(i, false)) : empty(t('disc.no_incidents')),
      d.decisions.length ? h('div', h('h2', t('disc.council_decisions')), d.decisions.map((x) => h('div', { class: 'card', style: { margin: '.5rem 0', padding: '.8rem 1rem' } },
        h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' } }, h('strong', x.meeting.title), h('span', { class: 'muted small' }, fmtDate(x.decided_on)), decisionBadge(x.status)),
        h('p', { style: { margin: '.3rem 0 0', whiteSpace: 'pre-wrap' } }, x.decision_text)))) : null,
      d.sanctions.length ? h('div', h('h2', t('disc.sanctions')), d.sanctions.map((x) => sanctionCard(x, null))) : null,
      d.convocations && d.convocations.length ? h('div', h('h2', t('disc.convocations')), d.convocations.map((x) => h('a', { class: 'card', href: `#/discipline/convocations/${x.id}`, style: { display: 'block', margin: '.5rem 0', padding: '.7rem 1rem' } }, h('strong', x.reference), ` · ${fmtDate(x.meet_date)} ${x.meet_time} `, badge(t(`disc.cv_${x.status}`), cvKind[x.status])))) : null,
      h('h2', t('disc.followups')), d.followups.length ? d.followups.map((x) => h('div', { class: 'card', style: { margin: '.5rem 0', padding: '.8rem 1rem' } },
        h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' } }, h('span', { class: 'muted small' }, `${fmtUtc(x.created_at)} · ${x.recorded_by}`), x.trend ? badge(t(`disc.trend_${x.trend}`), trendKind[x.trend]) : null, x.incident_id ? h('a', { class: 'small', href: `#/discipline/incidents/${x.incident_id}` }, `#${x.incident_id}`) : null),
        h('p', { style: { margin: '.3rem 0 0', whiteSpace: 'pre-wrap' } }, x.note))) : empty(t('disc.no_followups')),
      d.can_record_followup ? h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await post(`/discipline/students/${id}/followups`, { note: note.value, trend: trend.value, incident_id: inc.value }); toast(t('common.saved')); draw(); } catch (ex) { fail(ex); } } },
        h('h3', t('disc.add_followup')), field(t('disc.followup'), note, { required: true }), h('div', { class: 'grid grid-2' }, field(t('disc.trend'), trend), field(t('disc.linked_incident'), inc)),
        h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save'))) : null);
  });
  const yearSel = select([['', t('common.all')], ...years.map((y) => [y.id, y.name])], '', { onchange: (e) => { f.year_id = e.target.value; draw(); } });
  const from = input({ type: 'date', onchange: (e) => { f.from = e.target.value; draw(); } }), to = input({ type: 'date', onchange: (e) => { f.to = e.target.value; draw(); } });
  view.replaceChildren(h('a', { href: `#/students/${id}`, class: 'small' }, `← ${t('disc.back_student')}`), h('div', { class: 'notice' }, t('disc.confidential_note')),
    h('div', { class: 'card' }, h('div', { class: 'grid grid-3', style: { gap: '.5rem' } }, field(t('form.year'), yearSel), field(t('disc.from'), from), field(t('disc.to'), to))), box);
  draw();
}

// =====================================================================================================
// Council, decisions and sanctions (phase 3)
// =====================================================================================================
const decisionKind = { draft: 'gold', approved: 'green', rejected: 'red' };
const decisionBadge = (st) => badge(t(`disc.dec_${st}`), decisionKind[st]);
const sanctionKind = { proposed: 'gold', approved: 'green', rejected: 'red', withdrawn: 'neutral' };
const mayRun = () => state.user.role === 'school_admin' || (state.user.permissions || []).includes('manage_discipline');

// A small dialog that asks for a note (required when rejecting, withdrawing…).
function askNote(title, required) {
  return new Promise((resolve) => {
    const note = textarea({ rows: 3, maxlength: 1000, 'aria-label': title });
    let done = false; const finish = (v, close) => { done = true; close(); resolve(v); };
    modal({ title, onClose: () => { if (!done) resolve(null); }, body: h('div', field(t('disc.comment'), note, { required })), actions: [
      { label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => finish(null, c) },
      { label: t('common.confirm'), class: 'btn-primary', onclick: (c) => { if (required && !note.value.trim()) return toast(t('err.comment_required'), 'error'); finish(note.value.trim(), c); } }] });
  });
}

// ---- council: meetings list ----
function councilTab(panel) {
  const run = mayRun();
  load(panel, () => get('/discipline/council/meetings'), (rows) => h('div',
    run ? h('div', { class: 'actions', style: { margin: '.5rem 0' } }, h('button', { class: 'btn btn-primary', onclick: () => meetingDialog(null, () => councilTab(panel.replaceChildren() || panel)) }, t('disc.new_meeting'))) : null,
    rows.length ? rows.map((m) => h('a', { href: `#/discipline/council/${m.id}`, class: 'card', style: { display: 'block', textDecoration: 'none', color: 'inherit', margin: '.5rem 0', padding: '.8rem 1rem' } },
      h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' } }, h('strong', { style: { flex: '1 1 12rem' } }, m.title), badge(t(`disc.meeting_${m.status}`), { scheduled: 'blue', held: 'green', cancelled: 'neutral' }[m.status])),
      h('div', { class: 'muted small' }, `${fmtDateTime(m.meeting_at)} · ${m.location} · ${t('disc.n_members', { n: m.members })} · ${t('disc.n_cases', { n: m.cases })}`))) : empty(t('disc.no_meetings'))));
}

async function meetingDialog(m, done) {
  const people = await get('/discipline/council/people');
  const title = input({ value: m ? m.title : '', maxlength: 160 }), where = input({ value: m ? m.location : '', maxlength: 160 });
  const [d0, t0] = m ? m.meeting_at.split(' ') : ['', '09:00'];
  const date = input({ type: 'date', value: d0 }), time = input({ type: 'time', value: t0 });
  const chosen = new Map((m ? m.members : []).map((x) => [x.user_id, x.council_role]));
  const rows = people.members.length ? people.members.map((p) => {
    const cb = h('input', { type: 'checkbox', id: `m${p.id}`, checked: chosen.has(p.id), onchange: () => { if (cb.checked) chosen.set(p.id, role.value); else chosen.delete(p.id); } });
    const role = select([['member', t('disc.role_member')], ['chair', t('disc.role_chair')], ['secretary', t('disc.role_secretary')]], chosen.get(p.id) || 'member', { onchange: () => { if (cb.checked) chosen.set(p.id, role.value); } });
    return h('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', margin: '.3rem 0', flexWrap: 'wrap' } }, h('span', { class: 'check', style: { flex: '1 1 10rem' } }, cb, h('label', { for: `m${p.id}` }, p.name)), role);
  }) : [h('p', { class: 'notice' }, t('disc.no_members_available'))];
  modal({ title: m ? t('disc.edit_meeting') : t('disc.new_meeting'), wide: true, body: h('div', field(t('disc.meeting_title'), title, { required: true }), h('div', { class: 'grid grid-3' }, field(t('disc.date'), date, { required: true }), field(t('disc.time'), time, { required: true }), field(t('disc.location'), where, { required: true })), h('h3', t('disc.members')), ...rows),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      const body = { title: title.value, meeting_date: date.value, meeting_time: time.value, location: where.value, members: [...chosen].map(([user_id, council_role]) => ({ user_id, council_role })) };
      try { if (m) await put(`/discipline/council/meetings/${m.id}`, body); else { const r = await post('/discipline/council/meetings', body); c(); return navigate(`#/discipline/council/${r.id}`); } c(); done(); } catch (e) { fail(e); } } }] });
}

// ---- one meeting ----
export async function meetingPage(ctx, view) {
  const draw = () => load(view, () => get(`/discipline/council/meetings/${ctx.params.id}`), (m) => {
    const removeCase = async (k) => { if (await confirmDialog(t('disc.remove_case'), t('common.remove'))) { try { await del(`/discipline/council/cases/${k.id}`); draw(); } catch (e) { fail(e); } } };
    const addCase = async () => {
      let student = null; const list = h('div');
      const picker = studentPicker(async (s) => { student = s; list.replaceChildren(); if (!s) return;
        const inc = await get(`/discipline/incidents${qs({ student_id: s.id, page_size: 50 })}`);
        list.replaceChildren(h('h3', t('disc.incidents')), ...(inc.items.length ? inc.items.map((i) => h('div', { class: 'check', style: { margin: '.3rem 0' } }, h('input', { type: 'checkbox', id: `ci${i.id}`, value: i.id, checked: true }), h('label', { for: `ci${i.id}` }, `${fmtDateTime(i.occurred_at)} · ${nm({ name_en: i.category.name_en, name_fr: i.category.name_fr })}`))) : [h('p', { class: 'muted small' }, t('disc.no_incidents'))])); });
      modal({ title: t('disc.add_case'), wide: true, body: h('div', picker, list), actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
        if (!student) return toast(t('disc.choose_student'), 'error');
        try { const ids = [...list.querySelectorAll('input[type=checkbox]:checked')].map((x) => Number(x.value)); const r = await post(`/discipline/council/meetings/${m.id}/cases`, { student_id: student.id, incident_ids: ids }); c(); navigate(`#/discipline/cases/${r.id}`); } catch (e) { fail(e); } } }] });
    };
    const status = m.can_run ? select(['scheduled', 'held', 'cancelled'].map((x) => [x, t(`disc.meeting_${x}`)]), m.status, { 'aria-label': t('disc.status'), onchange: async (e) => { try { await put(`/discipline/council/meetings/${m.id}`, { status: e.target.value }); toast(t('common.saved')); draw(); } catch (ex) { fail(ex); } } }) : badge(t(`disc.meeting_${m.status}`), 'blue');
    return h('div', h('a', { href: '#/discipline?tab=council', class: 'small' }, `← ${t('disc.tab_council')}`),
      h('div', { class: 'page-head' }, h('div', h('h1', m.title), h('p', { class: 'muted' }, `${fmtDateTime(m.meeting_at)} · ${m.location}`)), status),
      h('div', { class: 'notice' }, t('disc.council_confidential')),
      h('section', { class: 'card' }, h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('h2', t('disc.members')), m.can_run ? h('button', { class: 'btn btn-sm', onclick: () => meetingDialog(m, draw) }, t('common.edit')) : null),
        m.members.length ? h('ul', m.members.map((x) => h('li', `${x.name} — ${t(`disc.role_${x.council_role}`)}`))) : h('p', { class: 'muted' }, t('disc.no_members'))),
      h('section', { class: 'card' }, h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('h2', t('disc.cases')), m.can_run && m.status !== 'cancelled' ? h('button', { class: 'btn btn-sm btn-primary', onclick: addCase }, t('disc.add_case')) : null),
        m.cases.length ? m.cases.map((k) => h('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.5rem 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' } },
          h('a', { href: `#/discipline/cases/${k.id}`, style: { flex: '1 1 12rem', fontWeight: 700 } }, k.full_name, h('span', { class: 'muted small' }, ` · ${k.student_code}`)), k.decision_status ? decisionBadge(k.decision_status) : badge(t('disc.no_decision'), 'neutral'),
          m.can_run && !k.decision_status ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => removeCase(k) }, t('common.remove')) : null)) : empty(t('disc.no_cases'))));
  });
  draw();
}

// ---- one case: facts, confidential record, decision ----
export async function casePage(ctx, view) {
  const draw = () => load(view, async () => ({ k: await get(`/discipline/council/cases/${ctx.params.id}`), approvers: await get('/discipline/council/approvers').catch(() => []) }), ({ k, approvers }) => {
    const rec = 'discussion' in k, locked = k.locked;
    const disc = textarea({ rows: 8, maxlength: 20000, disabled: !k.can_record || locked }), find = textarea({ rows: 5, maxlength: 20000, disabled: !k.can_record || locked });
    disc.value = k.discussion || ''; find.value = k.findings || '';
    const dec = k.decision;
    const dtext = textarea({ rows: 4, maxlength: 5000, disabled: !k.can_record || locked }); dtext.value = dec ? dec.decision_text : '';
    const ddate = input({ type: 'date', value: dec ? dec.decided_on : new Date().toISOString().slice(0, 10), disabled: !k.can_record || locked });
    const follow = textarea({ rows: 3, maxlength: 3000, disabled: !k.can_record || locked }); follow.value = dec && dec.follow_up ? dec.follow_up : '';
    const appr = select(approvers.map((a) => [a.id, a.name]), dec ? dec.approver_id : (approvers[0] && approvers[0].id), { disabled: !k.can_record || locked });
    return h('div', h('a', { href: `#/discipline/council/${k.meeting.id}`, class: 'small' }, `← ${k.meeting.title}`),
      h('div', { class: 'page-head' }, h('div', h('h1', k.student.full_name), h('p', { class: 'muted' }, [k.student.student_code, k.student.class_label, fmtDateTime(k.meeting.meeting_at)].filter(Boolean).join(' · '))), dec ? decisionBadge(dec.status) : badge(t('disc.no_decision'), 'neutral')),
      h('section', { class: 'card' }, h('h2', t('disc.facts')), k.incidents.length ? k.incidents.map((i) => h('div', { style: { borderBottom: '1px solid var(--line)', padding: '.5rem 0' } }, h('strong', nm({ name_en: i.category_en, name_fr: i.category_fr })), h('span', { class: 'muted small' }, ` · ${fmtDateTime(i.occurred_at)} · #${i.id}`), h('p', { style: { margin: '.2rem 0 0', whiteSpace: 'pre-wrap' } }, i.description))) : h('p', { class: 'muted' }, t('disc.no_incidents'))),
      rec ? h('form', { class: 'card', style: { borderLeft: '4px solid var(--gold)' }, onsubmit: async (e) => { e.preventDefault(); try { await put(`/discipline/council/cases/${k.id}`, { discussion: disc.value, findings: find.value }); toast(t('common.saved')); } catch (ex) { fail(ex); } } },
        h('h2', t('disc.record')), h('div', { class: 'notice' }, t('disc.record_confidential')), field(t('disc.discussion'), disc), field(t('disc.findings'), find),
        k.can_record && !locked ? h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save')) : (locked ? h('p', { class: 'muted small' }, t('disc.locked_decision')) : null)) : h('div', { class: 'notice notice-blue' }, t('disc.record_hidden')),
      h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await put(`/discipline/council/cases/${k.id}/decision`, { decision_text: dtext.value, decided_on: ddate.value, approver_id: appr.value, follow_up: follow.value }); toast(t('common.saved')); draw(); } catch (ex) { fail(ex); } } },
        h('h2', t('disc.decision')), dec && dec.status === 'approved' ? h('p', { class: 'muted small' }, t('disc.approved_by', { name: dec.approved_by_name || '', date: fmtDate(dec.approved_at) })) : null,
        dec && dec.status === 'rejected' ? h('div', { class: 'notice' }, `${t('disc.rejected_reason')}: ${dec.approval_comment || ''}`) : null,
        field(t('disc.decision_text'), dtext, { required: true }), h('div', { class: 'grid grid-2' }, field(t('disc.decided_on'), ddate, { required: true }), field(t('disc.approver'), appr, { required: true, hint: t('disc.approver_hint') })), field(t('disc.follow_up'), follow),
        k.can_record && !locked ? h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save')) : null));
  });
  draw();
}

// ---- decisions awaiting / given approval ----
function decisionsTab(panel) {
  const f = { status: '' };
  const list = h('div');
  const run = () => load(list, () => get(`/discipline/decisions${qs(f)}`), (rows) => rows.length ? h('div', rows.map((d) => h('div', { class: 'card', style: { margin: '.5rem 0', padding: '.8rem 1rem' } },
    h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' } }, h('strong', { style: { flex: '1 1 12rem' } }, d.student.full_name, h('span', { class: 'muted small' }, ` · ${d.student.student_code}`)), decisionBadge(d.status)),
    h('div', { class: 'muted small' }, `${d.meeting.title} · ${fmtDate(d.decided_on)} · ${t('disc.approver')}: ${d.approver_name}`), h('p', { style: { whiteSpace: 'pre-wrap', margin: '.4rem 0' } }, d.decision_text),
    d.status === 'rejected' && d.approval_comment ? h('p', { class: 'small', style: { color: 'var(--red)' } }, d.approval_comment) : null,
    d.can_approve && d.status === 'draft' ? h('div', { class: 'actions' },
      h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { const n = await askNote(t('disc.approve_decision'), false); if (n === null) return; try { await post(`/discipline/council/decisions/${d.id}/approve`, { approve: true, comment: n }); toast(t('common.saved')); run(); } catch (e) { fail(e); } } }, t('disc.approve')),
      h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { const n = await askNote(t('disc.reject_decision'), true); if (!n) return; try { await post(`/discipline/council/decisions/${d.id}/approve`, { approve: false, comment: n }); toast(t('common.saved')); run(); } catch (e) { fail(e); } } }, t('disc.reject'))) : null))) : empty(t('disc.no_decisions')));
  panel.append(h('div', { class: 'card' }, field(t('disc.status'), select([['', t('common.all')], ['draft', t('disc.dec_draft')], ['approved', t('disc.dec_approved')], ['rejected', t('disc.dec_rejected')]], '', { onchange: (e) => { f.status = e.target.value; run(); } }))), list);
  run();
}

// ---- sanctions ----
function sanctionCard(x, refresh) {
  const act = async (path, title, required, ok) => { const n = await askNote(title, required); if (n === null) return; try { await post(`/discipline/sanctions/${x.id}/${path}`, ok === undefined ? { comment: n } : { approve: ok, comment: n }); toast(t('common.saved')); refresh(); } catch (e) { fail(e); } };
  return h('div', { class: 'card', style: { margin: '.5rem 0', padding: '.8rem 1rem' } },
    h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' } }, h('strong', { style: { flex: '1 1 12rem' } }, nm({ name_en: x.type.name_en, name_fr: x.type.name_fr }), x.duration_days ? ` — ${t('disc.n_days', { n: x.duration_days })}` : '', refresh ? h('span', { class: 'muted small' }, ` · ${x.student.full_name}`) : null),
      badge(t(`disc.san_${x.status}`), sanctionKind[x.status]), badge(t(`disc.notif_${x.notification_status}`), x.notification_status === 'notified' ? 'green' : 'neutral')),
    h('div', { class: 'muted small' }, `${fmtDate(x.imposed_on)} · ${t('disc.proposed_by')}: ${x.proposed_by}${x.authorized_by ? ` · ${t('disc.authorized_by')}: ${x.authorized_by}` : ''}`),
    h('p', { style: { whiteSpace: 'pre-wrap', margin: '.4rem 0' } }, x.reason), x.decision_comment ? h('p', { class: 'small muted' }, x.decision_comment) : null,
    refresh && x.can_approve ? h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm btn-primary', onclick: () => act('approve', t('disc.approve_sanction'), false, true) }, t('disc.approve')), h('button', { class: 'btn btn-sm btn-danger', onclick: () => act('approve', t('disc.reject_sanction'), true, false) }, t('disc.reject'))) : null,
    refresh && x.can_withdraw ? h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm btn-danger', onclick: () => act('withdraw', t('disc.withdraw_sanction'), true) }, t('disc.withdraw'))) : null);
}
function sanctionsTab(panel) {
  const list = h('div'); const f = { status: '' };
  const run = () => load(list, () => get(`/discipline/sanctions${qs(f)}`), (rows) => rows.length ? h('div', rows.map((x) => sanctionCard(x, run))) : empty(t('disc.no_sanctions')));
  const propose = async () => {
    const [types] = await Promise.all([get('/discipline/sanction-types')]);
    let student = null; const extra = h('div');
    const typeSel = select(types.map((x) => [x.id, nm(x)]), types[0] && types[0].id), days = input({ type: 'number', min: 1, max: 365, value: 1 });
    const needDays = () => types.find((x) => String(x.id) === String(typeSel.value)).has_duration; const dayField = field(t('disc.duration_days'), days);
    const showDays = () => { dayField.style.display = needDays() ? '' : 'none'; }; typeSel.addEventListener('change', showDays); showDays();
    const reason = textarea({ rows: 3, maxlength: 2000 }), date = input({ type: 'date', value: new Date().toISOString().slice(0, 10) });
    const incSel = select([['', t('disc.no_link')]], ''), decSel = select([['', t('disc.no_link')]], '');
    const picker = studentPicker(async (s) => { student = s; incSel.replaceChildren(h('option', { value: '' }, t('disc.no_link'))); decSel.replaceChildren(h('option', { value: '' }, t('disc.no_link'))); if (!s) return;
      const inc = await get(`/discipline/incidents${qs({ student_id: s.id, page_size: 50 })}`); inc.items.forEach((i) => incSel.append(h('option', { value: i.id }, `#${i.id} · ${fmtDate(i.occurred_at)} · ${nm({ name_en: i.category.name_en, name_fr: i.category.name_fr })}`)));
      const dec = await get('/discipline/decisions?status=approved'); dec.filter((d) => d.student.id === s.id).forEach((d) => decSel.append(h('option', { value: d.id }, `${d.meeting.title} · ${fmtDate(d.decided_on)}`))); });
    extra.append(h('div', { class: 'notice notice-blue' }, t('disc.sanction_needs_approval')));
    modal({ title: t('disc.propose_sanction'), wide: true, body: h('div', extra, picker, h('div', { class: 'grid grid-2', style: { marginTop: '.6rem' } }, field(t('disc.sanction'), typeSel, { required: true }), dayField), field(t('disc.reason'), reason, { required: true }), h('div', { class: 'grid grid-3' }, field(t('disc.date'), date, { required: true }), field(t('disc.linked_incident'), incSel), field(t('disc.linked_decision'), decSel))),
      actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('disc.propose'), class: 'btn-primary', onclick: async (c) => {
        if (!student) return toast(t('disc.choose_student'), 'error');
        try { await post('/discipline/sanctions', { student_id: student.id, sanction_type_id: typeSel.value, reason: reason.value, imposed_on: date.value, duration_days: needDays() ? Number(days.value) : undefined, incident_id: incSel.value || undefined, decision_id: decSel.value || undefined }); c(); toast(t('disc.sanction_proposed')); run(); } catch (e) { fail(e); } } }] });
  };
  panel.append(h('div', { class: 'card', style: { display: 'flex', gap: '.5rem', alignItems: 'end', flexWrap: 'wrap' } }, h('div', { style: { flex: '1 1 12rem' } }, field(t('disc.status'), select([['', t('common.all')], ...['proposed', 'approved', 'rejected', 'withdrawn'].map((x) => [x, t(`disc.san_${x}`)])], '', { onchange: (e) => { f.status = e.target.value; run(); } }))),
    mayRun() ? h('button', { class: 'btn btn-primary', onclick: propose }, t('disc.propose_sanction')) : null), list);
  run();
}

// =====================================================================================================
// Parent convocations (phase 4)
// =====================================================================================================
const cvKind = { draft: 'neutral', approved: 'green', rejected: 'red', postponed: 'blue', cancelled: 'neutral', completed: 'green' };
function convocationsTab(panel) {
  const list = h('div'); const f = { status: '' };
  const canCreate = state.user.role === 'school_admin' || (state.user.permissions || []).includes('manage_discipline');
  const run = () => load(list, () => get(`/discipline/convocations${qs(f)}`), (rows) => rows.length ? h('div', rows.map((x) => h('a', { class: 'card', href: `#/discipline/convocations/${x.id}`, style: { display: 'block', margin: '.5rem 0', padding: '.7rem 1rem' } },
    h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' } }, h('strong', { style: { flex: '1 1 12rem' } }, `${x.reference} · ${x.student_name}`), badge(t(`disc.cv_${x.status}`), cvKind[x.status])),
    h('div', { class: 'muted small' }, `${fmtDate(x.meet_date)} ${x.meet_time} · ${x.location}`)))) : empty(t('disc.no_convocations')));
  const create = () => {
    let student = null;
    const rec = input({ maxlength: 120 }), guard = select([['', t('disc.other_recipient')]], ''), date = input({ type: 'date' }), time = input({ type: 'time', value: '09:00' }), loc = input({ maxlength: 200 });
    const reason = textarea({ rows: 3, maxlength: 1500 }), instr = textarea({ rows: 2, maxlength: 800 });
    const picker = studentPicker(async (s) => { student = s; guard.replaceChildren(h('option', { value: '' }, t('disc.other_recipient'))); if (!s) return;
      try { const g = await get(`/students/${s.id}`); (g.guardians || []).forEach((x) => guard.append(h('option', { value: x.id }, `${x.full_name} (${x.relationship || ''})`))); } catch { /* the guardian can be typed instead */ } });
    modal({ title: t('disc.new_convocation'), wide: true, body: h('div', h('div', { class: 'notice notice-blue' }, t('disc.cv_reason_note')), picker,
      h('div', { class: 'grid grid-2', style: { marginTop: '.6rem' } }, field(t('disc.guardian'), guard), field(t('disc.recipient_name'), rec)),
      h('div', { class: 'grid grid-3' }, field(t('disc.cv_date'), date, { required: true }), field(t('disc.time'), time, { required: true }), field(t('disc.location'), loc, { required: true })),
      field(t('disc.reason_for_parent'), reason, { required: true }), field(t('disc.instructions'), instr)),
      actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
        if (!student) return toast(t('disc.choose_student'), 'error');
        try { const r = await post('/discipline/convocations', { student_id: student.id, guardian_id: guard.value || undefined, recipient_name: rec.value, meet_date: date.value, meet_time: time.value, location: loc.value, reason_for_parent: reason.value, instructions: instr.value }); c(); navigate(`/discipline/convocations/${r.id}`); } catch (e) { fail(e); } } }] });
  };
  panel.append(h('div', { class: 'card', style: { display: 'flex', gap: '.5rem', alignItems: 'end', flexWrap: 'wrap' } }, h('div', { style: { flex: '1 1 12rem' } }, field(t('disc.status'), select([['', t('common.all')], ...Object.keys(cvKind).map((x) => [x, t(`disc.cv_${x}`)])], '', { onchange: (e) => { f.status = e.target.value; run(); } }))),
    canCreate ? h('button', { class: 'btn btn-primary', onclick: create }, t('disc.new_convocation')) : null), list);
  run();
}

export async function convocationPage(ctx, view) {
  const id = ctx.params.id;
  const box = h('div');
  const run = () => load(box, () => get(`/discipline/convocations/${id}`), (d) => {
    const act = async (path, body) => { try { await post(`/discipline/convocations/${id}/${path}`, body); toast(t('common.saved')); run(); } catch (e) { fail(e); } };
    const issued = ['approved', 'postponed', 'completed'].includes(d.status);
    const pdfLink = (lang) => h('a', { class: 'btn btn-sm', href: `/api/discipline/convocations/${id}/pdf?lang=${lang}`, download: `${d.reference}-${lang}.pdf` }, `PDF ${lang.toUpperCase()}`);
    const postpone = () => { const date = input({ type: 'date' }), time = input({ type: 'time', value: d.meet_time }), note = textarea({ rows: 2, maxlength: 1000 });
      modal({ title: t('disc.cv_postpone'), body: h('div', h('div', { class: 'grid grid-2' }, field(t('disc.cv_date'), date, { required: true }), field(t('disc.time'), time, { required: true })), field(t('disc.comment'), note, { required: true })),
        actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.confirm'), class: 'btn-primary', onclick: (c) => { c(); act('status', { status: 'postponed', meet_date: date.value, meet_time: time.value, comment: note.value }); } }] }); };
    const respond = () => { const sel = select([['none', t('disc.cv_resp_none')], ['attending', t('disc.cv_resp_attending')], ['unable', t('disc.cv_resp_unable')]], d.parent_response), att = select([['', '—'], ['1', t('disc.cv_yes')], ['0', t('disc.cv_no')]], d.attended === null ? '' : d.attended ? '1' : '0'), note = textarea({ rows: 2, maxlength: 1000, value: d.response_note || '' }), out = textarea({ rows: 3, maxlength: 1500, value: d.outcome || '' });
      note.value = d.response_note || ''; out.value = d.outcome || '';
      modal({ title: t('disc.cv_record_response'), body: h('div', field(t('disc.cv_parent_response'), sel), field(t('disc.cv_attended'), att), field(t('disc.comment'), note), field(t('disc.cv_outcome'), out)),
        actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: (c) => { c(); act('response', { parent_response: sel.value, attended: att.value === '' ? null : att.value === '1', response_note: note.value, outcome: out.value }); } }] }); };
    const handover = () => { const m = select([['hand_delivered', t('disc.cv_hand_delivered')], ['printed', t('disc.cv_printed')], ['downloaded', t('disc.cv_downloaded')]], 'hand_delivered');
      modal({ title: t('disc.cv_record_handover'), body: h('div', h('div', { class: 'notice' }, t('disc.cv_handover_note')), field(t('disc.cv_method'), m)),
        actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: (c) => { c(); act('handover', { method: m.value }); } }] }); };
    const withNote = async (title, required, fn) => { const n = await askNote(title, required); if (n === null) return; fn(n); };
    return h('div',
      h('div', { class: 'card', style: { display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' } },
        h('div', { style: { flex: '1 1 14rem' } }, h('h1', { style: { marginBottom: '.2rem' } }, d.reference), h('p', { class: 'muted', style: { margin: 0 } }, `${d.student_name} · ${[d.student_code, d.class_label].filter(Boolean).join(' · ')}`)), badge(t(`disc.cv_${d.status}`), cvKind[d.status])),
      h('div', { class: 'card' }, h('p', h('strong', `${t('disc.recipient_name')}: `), d.recipient_name), h('p', h('strong', `${t('disc.cv_date')}: `), `${fmtDate(d.meet_date)} ${d.meet_time}`), h('p', h('strong', `${t('disc.location')}: `), d.location),
        h('p', h('strong', `${t('disc.reason_for_parent')}: `)), h('p', { style: { whiteSpace: 'pre-wrap' } }, d.reason_for_parent), d.instructions ? h('p', { style: { whiteSpace: 'pre-wrap' } }, h('strong', `${t('disc.instructions')}: `), d.instructions) : null,
        d.decision_comment ? h('p', { class: 'muted small' }, `${d.approved_by_name || ''}: ${d.decision_comment}`) : null),
      h('div', { class: 'card' }, h('h2', t('disc.cv_letter')), h('div', { class: 'actions' }, pdfLink('en'), pdfLink('fr')), h('p', { class: 'muted small' }, t('disc.cv_letter_note')),
        issued && d.can_manage ? h('div', { class: 'actions' }, ['whatsapp', 'email', 'sms'].map((ch) => h('button', { class: 'btn btn-sm', onclick: async () => { try { const r = await post(`/discipline/convocations/${id}/prepare`, { channel: ch, lang: state.lang }); window.open(r.url, ch === 'email' || ch === 'sms' ? '_self' : '_blank', 'noopener'); toast(t('disc.cv_prepared')); run(); } catch (e) { fail(e); } } }, t(`disc.cv_ch_${ch}`)))) : null,
        issued && d.can_manage ? h('p', { class: 'muted small' }, t('disc.cv_prepare_note')) : null,
        d.dispatches && d.dispatches.length ? h('p', { class: 'small' }, d.dispatches.map((x) => badge(`${t(`disc.cv_ch_${x.channel}`)}: ${t('disc.cv_status_prepared')}`, 'neutral'))) : null,
        d.handed_over_on ? h('p', badge(`${t('disc.cv_handed')}: ${t(`disc.cv_${d.handed_over_method}`)} · ${fmtDate(d.handed_over_on)}`, 'blue')) : null,
        d.parent_response !== 'none' || d.attended !== null || d.outcome ? h('div', h('p', `${t('disc.cv_parent_response')}: ${t(`disc.cv_resp_${d.parent_response}`)}${d.attended === null ? '' : ` · ${t('disc.cv_attended')}: ${d.attended ? t('disc.cv_yes') : t('disc.cv_no')}`}`), d.response_note ? h('p', { class: 'small' }, d.response_note) : null, d.outcome ? h('p', { style: { whiteSpace: 'pre-wrap' } }, h('strong', `${t('disc.cv_outcome')}: `), d.outcome) : null) : null),
      h('div', { class: 'actions' },
        d.can_approve ? h('button', { class: 'btn btn-primary', onclick: () => withNote(t('disc.cv_approve'), false, (n) => act('approve', { approve: true, comment: n })) }, t('disc.approve')) : null,
        d.can_approve ? h('button', { class: 'btn btn-danger', onclick: () => withNote(t('disc.cv_reject'), true, (n) => act('approve', { approve: false, comment: n })) }, t('disc.reject')) : null,
        issued && d.can_manage ? h('button', { class: 'btn', onclick: handover }, t('disc.cv_record_handover')) : null,
        issued && d.can_manage ? h('button', { class: 'btn', onclick: respond }, t('disc.cv_record_response')) : null,
        ['approved', 'postponed'].includes(d.status) && d.can_manage ? h('button', { class: 'btn', onclick: postpone }, t('disc.cv_postpone')) : null,
        ['approved', 'postponed'].includes(d.status) && d.can_manage ? h('button', { class: 'btn', onclick: () => act('status', { status: 'completed' }) }, t('disc.cv_complete')) : null,
        ['approved', 'postponed'].includes(d.status) && d.can_manage ? h('button', { class: 'btn btn-danger', onclick: () => withNote(t('disc.cv_cancel'), true, (n) => act('status', { status: 'cancelled', comment: n })) }, t('disc.cv_cancel')) : null),
      h('h2', t('disc.cv_history')), d.events.map((e) => h('div', { class: 'muted small', style: { padding: '.2rem 0' } }, `${fmtUtc(e.created_at)} · ${e.actor} · ${t(`disc.cv_ev_${e.event}`) || e.event}${e.note ? ` — ${e.note}` : ''}`)));
  });
  view.replaceChildren(h('a', { href: '#/discipline?tab=convocations', class: 'small' }, `← ${t('disc.convocations')}`), h('div', { class: 'notice' }, t('disc.confidential_note')), box);
  run();
}

// ---- parent portal: my children's convocations ----
export async function myConvocationsPage(ctx, view) {
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.my-convocations')), h('p', t('disc.my_cv_sub')))), h('div', { class: 'notice' }, t('disc.confidential_note')));
  const box = h('div'); view.append(box);
  load(box, () => get('/parent/convocations'), (rows) => rows.length ? h('div', rows.map((x) => h('div', { class: 'card', style: { margin: '.5rem 0', padding: '.8rem 1rem' } },
    h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' } }, h('strong', { style: { flex: '1 1 12rem' } }, `${x.reference} · ${x.student_name}`), badge(t(`disc.cv_${x.status}`), cvKind[x.status])),
    h('p', { class: 'muted small' }, `${fmtDate(x.meet_date)} ${x.meet_time} · ${x.location}`), h('p', { style: { whiteSpace: 'pre-wrap' } }, x.reason_for_parent), x.instructions ? h('p', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, x.instructions) : null,
    h('div', { class: 'actions' }, ['en', 'fr'].map((l) => h('a', { class: 'btn btn-sm', href: `/api/parent/convocations/${x.id}/pdf?lang=${l}`, download: `${x.reference}-${l}.pdf` }, `PDF ${l.toUpperCase()}`)))))) : empty(t('disc.no_convocations')));
}
