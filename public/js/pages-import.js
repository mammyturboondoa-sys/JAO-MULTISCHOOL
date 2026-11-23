// Data Import Centre: Excel/CSV imports with preview and corrections, bulk marks grid, coefficient grid,
// GCE Board results, copy of a previous academic year, import history with rollback.
// Everything the browser shows is re-checked by the server; nothing is saved until the administrator confirms.
import './i18n-import.js';
import { state, t, h, get, post, qs, navigate, toast, fail, confirmDialog, modal, field, input, select, empty, spinner, badge, svgIcon, fmtDateTime, load, errorBox, readImage, ApiError, errText } from './ui.js';

const LANG = () => (state.lang === 'fr' ? 'fr' : 'en');
const fileToB64 = (file) => new Promise((resolve, reject) => {
  if (!file) return reject(new ApiError(400, 'file_required', {}));
  if (file.size > 12 * 1024 * 1024) return reject(new ApiError(400, 'file_too_large', {}));
  const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new ApiError(400, 'invalid_file', {})); r.readAsDataURL(file);
});
const downloadText = (name, text) => { const a = h('a', { href: URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' })), download: name }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
const csvLine = (cells) => cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
const errMessage = (e) => {
  if (e instanceof ApiError && e.code === 'missing_columns' && e.data.columns) return `${errText('missing_columns')} ${e.data.columns.join('; ')}`;
  if (e instanceof ApiError && e.code === 'too_many_rows' && e.data.max) return t('err.too_many_rows', { max: e.data.max });
  return e instanceof ApiError ? errText(e.code) : t('err.generic');
};
const failMsg = (e) => toast(errMessage(e), 'error');
const catName = (k) => t(`imp.cat.${k}`);
const chip = (label, value, kind) => h('div', { class: `imp-chip imp-chip-${kind || 'n'}` }, h('strong', String(value)), h('span', label));
const numIn = (a = {}) => input({ inputmode: 'decimal', autocomplete: 'off', ...a });

// ================= the page =================
export async function importCentrePage(ctx, view) {
  const TABS = ['data', 'grades', 'coef', 'gce', 'copy', 'history'];
  let tab = TABS.includes(ctx.query.tab) ? ctx.query.tab : 'data'; let preset = ctx.query.cat || null;
  const panel = h('div', { role: 'tabpanel' });
  const bar = h('div', { class: 'tabs', role: 'tablist' }, TABS.map((k) => h('button', { role: 'tab', 'data-k': k, 'aria-selected': String(k === tab), onclick: () => { tab = k; preset = null; paint(); } }, t(`imp.tab.${k}`))));
  const paint = () => { bar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === tab))); panel.replaceChildren(spinner()); draw(); };
  const goData = (cat) => { tab = 'data'; preset = cat; paint(); };
  const draw = () => {
    if (tab === 'data') dataTab(panel, preset, () => paint());
    else if (tab === 'grades') gradesTab(panel);
    else if (tab === 'coef') coefTab(panel, goData);
    else if (tab === 'gce') gceImportTab(panel, goData, () => { tab = 'history'; paint(); });
    else if (tab === 'copy') copyTab(panel, () => { tab = 'history'; paint(); });
    else historyTab(panel);
  };
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('imp.title')), h('p', t('imp.subtitle')))), h('div', { class: 'notice notice-blue' }, t('imp.safety')), bar, panel);
  draw();
}

// ================= tab 1: import data (Excel / CSV) =================
async function dataTab(panel, preset, refresh) {
  let cats;
  try { cats = await get(`/import/categories?lang=${LANG()}`); } catch (e) { panel.replaceChildren(errorBox(e, () => dataTab(panel, preset, refresh))); return; }
  const host = h('div');
  const pick = () => {
    host.replaceChildren(h('p', { class: 'muted' }, t('imp.pick')), h('div', { class: 'grid grid-3 imp-cats' }, cats.map((c) => h('button', { class: 'card imp-cat', onclick: () => open(c) }, h('strong', c.title), h('small', { class: 'muted' }, c.columns.filter((x) => x.required).map((x) => x.label).join(' · '))))));
  };
  const open = (c) => wizard(c, host, pick, refresh);
  panel.replaceChildren(host);
  const p = preset && cats.find((c) => c.key === preset); if (p) open(p); else pick();
}

function wizard(cat, host, back, refresh) {
  const st = { fileName: '', images: {}, existing: cat.existing, rows: null, summary: null, page: 0, filter: 'all', edited: false, busy: false, examples: 0 };
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'aria-label': t('imp.choose_file') });
  const imgIn = cat.images ? h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, 'aria-label': t('imp.images') }) : null;
  const out = h('div');
  const opts = () => ({ existing: st.existing });
  const gather = () => ({ category: cat.key, lang: LANG(), options: opts(), images: st.images });

  const step1 = () => {
    const optBox = cat.updatable ? h('fieldset', { class: 'imp-opts' }, h('legend', t('imp.if_exists')),
      ['skip', 'update'].map((v) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'ex', value: v, checked: st.existing === v, onchange: () => { st.existing = v; if (st.rows) recheck(); } }), ' ', t(`imp.opt_${v}`)))) : null;
    return h('div', { class: 'card' },
      h('div', { class: 'page-head' }, h('div', h('h2', cat.title), h('p', cat.existing_note)), h('div', { class: 'actions' },
        h('a', { class: 'btn btn-ghost', href: `/api/import/template/${cat.key}?lang=${LANG()}`, download: '' }, t('imp.download_template')), h('button', { class: 'btn btn-ghost', onclick: back }, t('imp.all_categories')))),
      h('div', { class: 'imp-cols' }, h('strong', t('imp.columns')), ' ', cat.columns.map((c) => h('span', { class: 'badge ' + (c.required ? 'badge-blue' : 'badge-neutral'), title: c.hint || '' }, c.label + (c.required ? ' *' : '')))),
      field(t('imp.choose_file'), fileIn, { hint: t('imp.file_hint'), required: true }),
      imgIn ? field(t('imp.images'), imgIn, { hint: t('imp.images_hint') }) : null, optBox,
      h('button', { class: 'btn btn-primary', onclick: check }, t('imp.check')));
  };
  const top = h('div'); const draw = () => { top.replaceChildren(step1()); };

  async function check() {
    const f = fileIn.files[0]; if (!f) { toast(t('imp.no_file'), 'error'); return; }
    try {
      out.replaceChildren(spinner());
      st.images = {}; if (imgIn) for (const im of imgIn.files) { try { st.images[im.name] = await readImage(im); } catch { /* reported by the server as a missing image */ } }
      const data = await fileToB64(f); st.fileName = f.name;
      const r = await post('/import/preview', { ...gather(), file: { name: f.name, data } });
      st.rows = r.rows; st.summary = r.summary; st.examples = r.examples_ignored; st.page = 0; st.edited = false; st.filter = r.summary.errors ? 'errors' : 'all'; show();
    } catch (e) { out.replaceChildren(); failMsg(e); }
  }
  async function recheck() {
    try { const r = await post('/import/preview', { ...gather(), rows: st.rows.map((x) => ({ n: x.n, values: x.values })) }); st.rows = r.rows; st.summary = r.summary; st.edited = false; show(); } catch (e) { failMsg(e); }
  }
  async function save(skipInvalid) {
    const s = st.summary; const n = s.will_create + s.will_update;
    const ok = await confirmDialog(skipInvalid ? t('imp.confirm_skip', { n, bad: s.errors }) : t('imp.confirm_save', { n }), t('imp.save_now'), false); if (!ok) return;
    st.busy = true; show();
    try {
      const r = await post('/import/commit', { ...gather(), options: { ...opts(), skip_invalid: !!skipInvalid }, confirm: true, source: st.fileName, rows: st.rows.map((x) => ({ n: x.n, values: x.values })) });
      done(r);
    } catch (e) {
      st.busy = false;
      if (e instanceof ApiError && e.code === 'validation_failed' && e.data.rows) { st.rows = e.data.rows; st.summary = e.data.summary; st.edited = false; toast(errText('validation_failed'), 'error'); show(); } else { show(); failMsg(e); }
    }
  }
  function done(r) {
    const lines = [chip(t('imp.res_created'), r.inserted, 'g'), chip(t('imp.res_updated'), r.updated, 'b'), chip(t('imp.res_skipped'), r.skipped, 'n'), chip(t('imp.res_errors'), r.errors, r.errors ? 'r' : 'n')];
    const creds = r.credentials && r.credentials.length ? h('div', { class: 'notice' }, h('strong', t('imp.creds_title')), h('p', t('imp.creds_text')),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => downloadText('JAO-temporary-passwords.csv', [csvLine(['name', 'email', 'temporary_password']), ...r.credentials.map((c) => csvLine([c.name, c.email, c.password]))].join('\n')) }, t('imp.creds_download'))) : null;
    host.replaceChildren(h('div', { class: 'card' }, h('h2', t('imp.done_title')), h('div', { class: 'imp-chips' }, lines), creds,
      h('p', { class: 'muted' }, t('imp.done_text')), h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => wizard(cat, host, back, refresh) }, t('imp.import_more')), h('button', { class: 'btn btn-ghost', onclick: back }, t('imp.all_categories')),
        h('button', { class: 'btn btn-ghost', onclick: () => { location.hash = '#/import?tab=history'; refresh(); } }, t('imp.open_history')))));
  }

  function show() {
    const s = st.summary; if (!st.rows) { out.replaceChildren(); return; }
    const PAGE = 50; const filtered = st.rows.filter((r) => st.filter === 'all' || (st.filter === 'errors' && r.errors.length) || (st.filter === 'warn' && r.warnings.length) || (st.filter === 'exists' && r.exists));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE)); if (st.page >= pages) st.page = pages - 1;
    const slice = filtered.slice(st.page * PAGE, st.page * PAGE + PAGE);
    const stat = (r) => (r.errors.length ? badge(t('imp.st_error'), 'red') : r.blank ? badge(t('imp.st_blank'), 'neutral') : r.exists ? badge(t(cat.updatable && st.existing === 'update' ? 'imp.st_update' : 'imp.st_exists'), 'gold') : badge(t('imp.st_ok'), 'green'));
    const body = slice.flatMap((r) => {
      const tr = h('tr', { class: r.errors.length ? 'row-err' : '' }, h('td', String(r.n)), h('td', stat(r)),
        cat.columns.map((c) => { const bad = r.errors.some((e) => e.col === c.key); return h('td', h('input', { type: 'text', class: 'cell' + (bad ? ' cell-bad' : ''), value: r.values[c.key] ?? '', 'aria-label': c.label, 'aria-invalid': bad ? 'true' : 'false',
          oninput: (e) => { r.values[c.key] = e.target.value; if (!st.edited) { st.edited = true; paintActions(); } } })); }),
        h('td', h('button', { class: 'icon-btn', title: t('imp.remove_row'), 'aria-label': t('imp.remove_row'), onclick: () => { st.rows = st.rows.filter((x) => x !== r); st.edited = true; show(); } }, svgIcon('close', 16))));
      const msgs = [...r.errors.map((e) => ({ ...e, k: 'err' })), ...r.warnings.map((e) => ({ ...e, k: 'warn' }))];
      return msgs.length ? [tr, h('tr', { class: 'row-msg' }, h('td', { colspan: cat.columns.length + 3 }, msgs.map((m) => h('div', { class: m.k === 'err' ? 'msg-err' : 'msg-warn' }, h('strong', (cat.columns.find((c) => c.key === m.col) || { label: '' }).label + (m.col ? ': ' : '')), m.text))))] : [tr];
    });
    const actions = h('div', { class: 'imp-actions' }); const paintActions = () => {
      const n = s.will_create + s.will_update;
      actions.replaceChildren(
        st.edited ? h('button', { class: 'btn btn-primary', onclick: recheck }, t('imp.recheck')) : null,
        !st.edited && s.errors === 0 && n > 0 ? h('button', { class: 'btn btn-primary', disabled: st.busy, onclick: () => save(false) }, t('imp.save_n', { n })) : null,
        !st.edited && s.errors > 0 && n > 0 ? h('button', { class: 'btn btn-ghost', disabled: st.busy, onclick: () => save(true) }, t('imp.save_valid_only', { n, bad: s.errors })) : null,
        !st.edited && s.errors === 0 && n === 0 ? h('span', { class: 'muted' }, t('imp.nothing_new')) : null,
        !st.edited && s.errors > 0 ? h('span', { class: 'msg-err' }, t('imp.fix_first', { bad: s.errors })) : null);
    }; paintActions();
    out.replaceChildren(h('div', { class: 'card' }, h('h3', t('imp.preview')),
      st.examples ? h('p', { class: 'muted small' }, t('imp.examples_ignored', { n: st.examples })) : null,
      h('div', { class: 'imp-chips' }, chip(t('imp.sum_total'), s.total), chip(t('imp.sum_ready'), s.ok, 'g'), chip(t('imp.sum_errors'), s.errors, s.errors ? 'r' : 'n'), chip(t('imp.sum_exists'), s.exists, 'y'),
        chip(t('imp.sum_create'), s.will_create, 'g'), cat.updatable ? chip(t('imp.sum_update'), s.will_update, 'b') : null, chip(t('imp.sum_skip'), s.will_skip, 'n')),
      h('div', { class: 'tabs imp-filter' }, ['all', 'errors', 'warn', 'exists'].map((f) => h('button', { 'aria-selected': String(st.filter === f), onclick: () => { st.filter = f; st.page = 0; show(); } }, t(`imp.f_${f}`)))),
      filtered.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'imp-table' }, h('thead', h('tr', h('th', '#'), h('th', t('imp.status')), cat.columns.map((c) => h('th', c.label + (c.required ? ' *' : ''))), h('th', ''))), h('tbody', body))) : h('p', { class: 'muted' }, t('imp.no_rows_here')),
      pages > 1 ? h('div', { class: 'imp-pager' }, h('button', { class: 'btn btn-sm btn-ghost', disabled: st.page === 0, onclick: () => { st.page--; show(); } }, '‹'), h('span', t('imp.page_of', { p: st.page + 1, n: pages })), h('button', { class: 'btn btn-sm btn-ghost', disabled: st.page >= pages - 1, onclick: () => { st.page++; show(); } }, '›')) : null,
      actions));
  }
  draw(); host.replaceChildren(top, out);
}

// ================= history =================
async function historyTab(panel) {
  const render = async () => {
    await load(panel, () => get('/import/history'), (list) => {
      if (!list.length) return empty(t('imp.hist_empty'), t('imp.hist_empty_text'));
      const kind = { applied: 'green', rolled_back: 'neutral', partly_rolled_back: 'gold' };
      return h('div', h('p', { class: 'muted' }, t('imp.hist_help')), h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', ['imp.h_when', 'imp.h_category', 'imp.h_source', 'imp.h_imported', 'imp.h_errors', 'imp.h_admin', 'imp.status', ''].map((k) => h('th', k ? t(k) : '')))),
        h('tbody', list.map((b) => h('tr', h('td', { 'data-label': t('imp.h_when') }, fmtDateTime(b.created_at)), h('td', { 'data-label': t('imp.h_category') }, catName(b.category)), h('td', { 'data-label': t('imp.h_source') }, b.source_name || '—'),
          h('td', { 'data-label': t('imp.h_imported') }, `${b.imported_rows} / ${b.total_rows}`), h('td', { 'data-label': t('imp.h_errors') }, String(b.error_rows)), h('td', { 'data-label': t('imp.h_admin') }, b.admin_name || '—'),
          h('td', { 'data-label': t('imp.status') }, badge(t(`imp.hs_${b.status}`), kind[b.status]), b.rollback_note ? h('div', { class: 'muted small' }, b.rollback_note) : null),
          h('td', b.status !== 'rolled_back' ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => undo(b) }, t('imp.rollback')) : null)))))));
    });
  };
  const undo = async (b) => {
    if (!await confirmDialog(t('imp.rollback_confirm', { what: catName(b.category), n: b.imported_rows }), t('imp.rollback'), true)) return;
    try { const r = await post(`/import/history/${b.id}/rollback`, { confirm: true }); toast(t('imp.rollback_done', { r: r.reverted, k: r.kept })); render(); } catch (e) { failMsg(e); }
  };
  render();
}

// ================= tab 2: bulk marks grid =================
const today = () => new Date().toISOString().slice(0, 10);
const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cleanMark = (v) => { v = String(v ?? '').trim().replace(',', '.'); const u = v.toUpperCase(); if (['ABS', 'ABSENT', 'A'].includes(u)) return 'ABS'; if (['EXC', 'EXCUSED', 'EXCUSE', 'E'].includes(u)) return 'EXC'; return v; };

async function gradesTab(panel) {
  let years; try { years = await get('/academic-years'); } catch (e) { panel.replaceChildren(errorBox(e, () => gradesTab(panel))); return; }
  const cur = years.find((y) => y.is_current) || years[0]; if (!cur) { panel.replaceChildren(empty(t('imp.g_no_year'))); return; }
  const G = { yearId: cur.id, classes: [], clsId: '', subjects: [], subId: '', termId: (cur.terms[0] || {}).id || '', data: null, aid: 'new', newA: { name: '', type: 'exam', max: '20', date: today() }, marks: {}, busy: false };
  const top = h('div', { class: 'card' }); const gridHost = h('div'); panel.replaceChildren(top, gridHost);
  const yearObj = () => years.find((y) => y.id === Number(G.yearId));
  const maxNow = () => (G.aid === 'new' ? Number(G.newA.max) : ((G.data && G.data.assessments.find((a) => a.id === Number(G.aid))) || {}).max_score);

  async function loadClasses() { G.classes = await get(`/classes?year_id=${G.yearId}`); G.clsId = ''; G.subjects = []; G.subId = ''; G.data = null; }
  async function loadSubjects() { if (!G.clsId) { G.subjects = []; return; } G.subjects = (await get(`/classes/${G.clsId}`)).subjects; G.subId = G.subjects.length === 1 ? String(G.subjects[0].subject_id) : ''; }
  async function loadGrid(keepMarks) {
    G.data = null; gridHost.replaceChildren();
    if (!G.clsId || !G.subId || !G.termId) { drawTop(); return; }
    try {
      gridHost.replaceChildren(spinner());
      const q = { class_id: G.clsId, subject_id: G.subId, term_id: G.termId }; if (G.aid !== 'new') q.assessment_id = G.aid;
      const d = await get(`/import/grid${qs(q)}`); G.data = d;
      if (!keepMarks) { G.marks = {}; for (const s of d.students) { const m = d.marks[s.id]; G.marks[s.id] = m ? (m.status === 'absent' ? 'ABS' : m.status === 'excused' ? 'EXC' : String(m.score ?? '')) : ''; } }
      if (G.aid !== 'new' && !d.assessments.find((a) => a.id === Number(G.aid))) G.aid = 'new';
      drawTop(); drawGrid();
    } catch (e) { gridHost.replaceChildren(errorBox(e, () => loadGrid())); }
  }
  const sel = (opts, val, on, label) => field(label, select(opts, val, { onchange: (e) => on(e.target.value) }));
  function drawTop() {
    const d = G.data;
    top.replaceChildren(h('h2', t('imp.g_title')), h('p', { class: 'muted' }, t('imp.g_help')),
      h('div', { class: 'toolbar' },
        sel(years.map((y) => [y.id, y.name]), G.yearId, async (v) => { G.yearId = Number(v); const y = yearObj(); G.termId = (y.terms[0] || {}).id || ''; G.aid = 'new'; await loadClasses(); drawTop(); gridHost.replaceChildren(); }, t('imp.g_year')),
        sel([['', '—'], ...G.classes.map((c) => [c.id, `${c.name}${c.section ? ' ' + c.section : ''}`])], G.clsId, async (v) => { G.clsId = v; G.aid = 'new'; await loadSubjects(); await loadGrid(); drawTop(); }, t('imp.g_class')),
        sel([['', '—'], ...G.subjects.map((s) => [s.subject_id, `${s.name} (${s.code})`])], G.subId, (v) => { G.subId = v; G.aid = 'new'; loadGrid(); }, t('imp.g_subject')),
        sel((yearObj().terms || []).map((x) => [x.id, x.name]), G.termId, (v) => { G.termId = v; G.aid = 'new'; loadGrid(); }, t('imp.g_term')),
        d ? sel([...d.assessments.map((a) => [a.id, `${a.name} (/${a.max_score})`]), ['new', t('imp.g_new_assessment')]], G.aid, (v) => { G.aid = v; loadGrid(); }, t('imp.g_assessment')) : null),
      d && G.aid === 'new' ? h('div', { class: 'toolbar' },
        field(t('imp.g_a_name'), input({ value: G.newA.name, placeholder: 'Sequence 1', maxlength: 80, oninput: (e) => { G.newA.name = e.target.value; } }), { required: true }),
        field(t('imp.g_a_type'), select(['quiz', 'test', 'assignment', 'oral', 'project', 'exam'].map((x) => [x, t(`atype.${x}`)]), G.newA.type, { onchange: (e) => { G.newA.type = e.target.value; } })),
        field(t('imp.g_a_max'), numIn({ value: G.newA.max, onchange: (e) => { G.newA.max = e.target.value; if (G.data) paintValidity(); } }), { required: true }),
        field(t('imp.g_a_date'), input({ type: 'date', value: G.newA.date, onchange: (e) => { G.newA.date = e.target.value; } }))) : null);
  }
  let inputs = [];
  function paintValidity() {
    let bad = 0, filled = 0; const max = maxNow();
    G.data.students.forEach((s, i) => { const v = cleanMark(G.marks[s.id]); const el = inputs[i]; let ok = true;
      if (v !== '') { filled++; if (v !== 'ABS' && v !== 'EXC') { const n = Number(v); ok = Number.isFinite(n) && n >= 0 && (!max || n <= max) && /^\d+(\.\d+)?$/.test(v); } }
      if (el) { el.classList.toggle('cell-bad', !ok); el.setAttribute('aria-invalid', String(!ok)); } if (!ok) bad++; });
    const c = gridHost.querySelector('.g-count'); if (c) c.textContent = t('imp.g_count', { f: filled, n: G.data.students.length, bad });
    return bad;
  }
  function applyPaste(rows, start) {
    const st = G.data.students; const byCode = new Map(st.map((s) => [s.code.toUpperCase(), s])); const byName = new Map(st.map((s) => [normName(s.name), s])); let applied = 0, unmatched = 0;
    rows.forEach((cells, k) => {
      cells = cells.map((x) => String(x).trim());
      if (cells.length === 1) { const s = st[start + k]; if (s) { G.marks[s.id] = cleanMark(cells[0]); applied++; } else unmatched++; return; }
      const stu = cells.slice(0, -1).map((c) => byCode.get(c.toUpperCase()) || byName.get(normName(c))).find(Boolean); const lastMark = cleanMark(cells[cells.length - 1]);
      if (stu && lastMark !== '' && !/^(\d+(\.\d+)?|ABS|EXC)$/.test(lastMark)) { unmatched++; return; }
      if (stu) { G.marks[stu.id] = cleanMark(cells[cells.length - 1]); applied++; } else unmatched++;
    });
    drawGrid(); toast(t('imp.g_pasted', { n: applied, u: unmatched }), unmatched ? 'error' : 'ok');
  }
  async function uploadFile(f) {
    try {
      const r = await post('/import/parse', { file: { name: f.name, data: await fileToB64(f) } }); const MARK = /^(mark|marks|note|notes|score|grade)\b/i;
      const hi = r.rows.slice(0, 6).findIndex((x) => x.some((c) => MARK.test(String(c).trim()))); const markIdx = hi >= 0 ? r.rows[hi].findIndex((c) => MARK.test(String(c).trim())) : -1;
      const pasted = [];
      for (const x of r.rows.slice(hi + 1)) { const cells = x.map((c) => String(c).trim()); if (cells.every((c) => c === '')) continue;
        if (markIdx >= 0) pasted.push([...cells.filter((c, i) => i !== markIdx && c !== ''), cells[markIdx]]); else pasted.push(cells.filter((c) => c !== '')); }
      applyPaste(pasted, 0);
    } catch (e) { failMsg(e); }
  }
  function drawGrid() {
    const d = G.data; if (!d) return; inputs = [];
    const rowsEl = d.students.map((s, i) => { const el = h('input', { type: 'text', class: 'cell mark', inputmode: 'decimal', autocomplete: 'off', value: G.marks[s.id] || '', 'aria-label': `${s.name} — ${t('imp.g_mark')}`,
      oninput: (e) => { G.marks[s.id] = e.target.value; paintValidity(); },
      onblur: (e) => { const v = cleanMark(e.target.value); if (v !== e.target.value) { e.target.value = v; G.marks[s.id] = v; paintValidity(); } },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); (inputs[i + 1] || el).focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); (inputs[i - 1] || el).focus(); } },
      onpaste: (e) => { const txt = (e.clipboardData || window.clipboardData).getData('text'); const lines = txt.replace(/\r/g, '').split('\n'); while (lines.length && lines[lines.length - 1] === '') lines.pop(); if (lines.length > 1 || (lines[0] || '').includes('\t')) { e.preventDefault(); applyPaste(lines.map((l) => l.split('\t')), i); } } });
      inputs.push(el); return h('tr', h('td', String(i + 1)), h('td', s.code), h('td', s.name), h('td', el)); });
    const up = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true, onchange: (e) => { if (e.target.files[0]) uploadFile(e.target.files[0]); e.target.value = ''; } });
    gridHost.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'page-head' }, h('div', h('h3', `${d.class.name}${d.class.section ? ' ' + d.class.section : ''} · ${d.subject.name} · ${d.term.name}`), h('p', { class: 'muted g-count' }, '')),
        h('div', { class: 'actions' }, up, h('button', { class: 'btn btn-ghost', onclick: () => up.click() }, t('imp.g_upload')), h('button', { class: 'btn btn-primary', disabled: G.busy, onclick: review }, t('imp.g_review')))),
      h('p', { class: 'muted small' }, t('imp.g_paste_hint')),
      d.students.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'imp-table' }, h('thead', h('tr', h('th', '#'), h('th', t('imp.g_code')), h('th', t('imp.g_student')), h('th', t('imp.g_mark')))), h('tbody', rowsEl))) : empty(t('imp.g_no_students'))));
    paintValidity();
  }
  async function review() {
    const d = G.data; if (paintValidity() > 0) { toast(t('imp.g_fix_marks'), 'error'); return; }
    let aName, aMax = '', aType = '', aDate = '';
    if (G.aid === 'new') { aName = G.newA.name.trim(); if (!aName) { toast(t('imp.g_need_name'), 'error'); return; } if (!(Number(G.newA.max) > 0)) { toast(t('imp.g_need_max'), 'error'); return; } aMax = G.newA.max; aType = G.newA.type; aDate = G.newA.date; }
    else aName = d.assessments.find((a) => a.id === Number(G.aid)).name;
    const list = d.students.filter((s) => cleanMark(G.marks[s.id]) !== '');
    if (!list.length) { toast(t('imp.g_nothing'), 'error'); return; }
    const rows = list.map((s, i) => ({ n: i + 1, values: { academic_year: yearObj().name, term: d.term.name, subject_code: d.subject.code, assessment: aName, student_code: s.code, score: cleanMark(G.marks[s.id]), max_score: aMax, type: aType, date: aDate } }));
    try {
      const r = await post('/import/preview', { category: 'grades', lang: LANG(), options: { existing: 'update' }, rows });
      const bad = r.rows.filter((x) => x.errors.length); const sum = r.summary;
      modal({ title: t('imp.g_review_title'), wide: true, body: h('div', h('div', { class: 'imp-chips' }, chip(t('imp.sum_ready'), sum.ok, 'g'), chip(t('imp.res_updated'), sum.exists, 'b'), chip(t('imp.sum_errors'), sum.errors, sum.errors ? 'r' : 'n')),
        bad.length ? h('ul', { class: 'msg-list' }, bad.slice(0, 20).map((x) => h('li', h('strong', list[x.n - 1].name + ': '), x.errors.map((e) => e.text).join(' ')))) : h('p', t('imp.g_all_valid', { n: sum.ok }))),
        actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, ...(sum.errors === 0 ? [{ label: t('imp.g_save_all'), class: 'btn-primary', onclick: async (c) => {
          try { const res = await post('/import/commit', { category: 'grades', lang: LANG(), options: { existing: 'update' }, confirm: true, rows, source: 'marks grid' }); c(); toast(t('imp.g_saved', { n: res.inserted + res.updated })); if (G.aid === 'new') { G.newA.name = ''; } await loadGrid(); if (G.aid === 'new' && G.data) { const a = G.data.assessments.find((x) => x.name === aName); if (a) { G.aid = a.id; await loadGrid(); } } } catch (e) { failMsg(e); } } }] : [])] });
    } catch (e) { failMsg(e); }
  }
  try { await loadClasses(); drawTop(); } catch (e) { panel.replaceChildren(errorBox(e, () => gradesTab(panel))); }
}

// ================= tab 3: coefficients grid =================
async function coefTab(panel, goData) {
  let years; try { years = await get('/academic-years'); } catch (e) { panel.replaceChildren(errorBox(e, () => coefTab(panel, goData))); return; }
  const cur = years.find((y) => y.is_current) || years[0]; if (!cur) { panel.replaceChildren(empty(t('imp.g_no_year'))); return; }
  let yearId = cur.id; let data = null; const vals = {}; const orig = {};
  const top = h('div', { class: 'card' }); const host = h('div'); panel.replaceChildren(top, host);
  const key = (c, s) => `${c}|${s}`; const valid = (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 100);
  async function loadGrid() {
    host.replaceChildren(spinner());
    try { data = await get(`/import/coef-grid?year_id=${yearId}`); for (const k of Object.keys(vals)) delete vals[k]; for (const c of data.classes) for (const s of data.subjects) { const v = data.cells[key(c.id, s.id)]; vals[key(c.id, s.id)] = v == null ? '' : String(v); orig[key(c.id, s.id)] = vals[key(c.id, s.id)]; } draw(); }
    catch (e) { host.replaceChildren(errorBox(e, loadGrid)); }
  }
  const changed = () => Object.keys(vals).filter((k) => vals[k] !== orig[k]);
  function draw() {
    const head = h('tr', h('th', t('imp.c_class')), data.subjects.map((s) => h('th', { title: s.name }, s.code)));
    const body = data.classes.map((c) => h('tr', h('th', { scope: 'row' }, c.label), data.subjects.map((s) => { const k = key(c.id, s.id);
      return h('td', h('input', { type: 'text', class: 'cell coef', inputmode: 'decimal', value: vals[k], 'aria-label': `${c.label} — ${s.name}`, oninput: (e) => { vals[k] = e.target.value.replace(',', '.'); e.target.classList.toggle('cell-bad', !valid(vals[k])); e.target.classList.toggle('cell-changed', vals[k] !== orig[k]); count(); } })); })));
    host.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('p', { class: 'muted c-count' }, ''), h('div', { class: 'actions' },
      h('button', { class: 'btn btn-ghost', onclick: exportCsv }, t('imp.c_export')), h('button', { class: 'btn btn-ghost', onclick: () => goData('coefficients') }, t('imp.c_from_excel')), h('button', { class: 'btn btn-primary', onclick: review }, t('imp.c_review')))),
      data.classes.length && data.subjects.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'imp-table coef-table' }, h('thead', head), h('tbody', body))) : empty(t('imp.c_empty'))));
    count();
  }
  const count = () => { const el = host.querySelector('.c-count'); if (el) el.textContent = t('imp.c_count', { n: changed().length }); };
  function exportCsv() { const rows = [csvLine(['academic_year', 'class', 'section', 'subject_code', 'coefficient'])]; for (const c of data.classes) for (const s of data.subjects) { const v = vals[key(c.id, s.id)]; if (v !== '') rows.push(csvLine([data.year.name, c.name, c.section, s.code, v])); } downloadText(`coefficients-${data.year.name}.csv`, rows.join('\n')); }
  async function review() {
    if (Object.values(vals).some((v) => !valid(v))) { toast(t('imp.c_invalid'), 'error'); return; }
    const rows = []; let cleared = 0;
    for (const k of changed()) { const [cid, sid] = k.split('|').map(Number); const c = data.classes.find((x) => x.id === cid); const s = data.subjects.find((x) => x.id === sid); if (vals[k] === '') { cleared++; continue; }
      rows.push({ n: rows.length + 1, values: { academic_year: data.year.name, class_name: c.name, section: c.section || '', subject_code: s.code, coefficient: vals[k] } }); }
    if (!rows.length) { toast(t('imp.c_nothing'), 'error'); return; }
    try {
      const r = await post('/import/preview', { category: 'coefficients', lang: LANG(), options: { existing: 'update' }, rows }); const bad = r.rows.filter((x) => x.errors.length);
      modal({ title: t('imp.c_review_title'), body: h('div', h('div', { class: 'imp-chips' }, chip(t('imp.sum_create'), r.summary.will_create, 'g'), chip(t('imp.res_updated'), r.summary.exists, 'b'), chip(t('imp.sum_errors'), r.summary.errors, r.summary.errors ? 'r' : 'n')),
        cleared ? h('p', { class: 'muted' }, t('imp.c_cleared', { n: cleared })) : null, bad.length ? h('ul', { class: 'msg-list' }, bad.slice(0, 15).map((x) => h('li', x.errors.map((e) => e.text).join(' ')))) : null),
        actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, ...(r.summary.errors === 0 ? [{ label: t('imp.c_save'), class: 'btn-primary', onclick: async (c) => { try { const res = await post('/import/commit', { category: 'coefficients', lang: LANG(), options: { existing: 'update' }, confirm: true, rows, source: 'coefficients grid' }); c(); toast(t('imp.c_saved', { n: res.inserted + res.updated })); loadGrid(); } catch (e) { failMsg(e); } } }] : [])] });
    } catch (e) { failMsg(e); }
  }
  top.replaceChildren(h('h2', t('imp.c_title')), h('p', { class: 'muted' }, t('imp.c_help')), h('div', { class: 'toolbar' }, field(t('imp.g_year'), select(years.map((y) => [y.id, y.name]), yearId, { onchange: (e) => { yearId = Number(e.target.value); loadGrid(); } }))));
  loadGrid();
}

// ================= tab 5: copy a previous academic year =================
async function copyTab(panel, toHistory) {
  let years; try { years = await get('/academic-years'); } catch (e) { panel.replaceChildren(errorBox(e, () => copyTab(panel, toHistory))); return; }
  if (years.length < 2) { panel.replaceChildren(empty(t('imp.cp_need_two'), t('imp.cp_need_two_text'))); return; }
  const S = { from: years[1].id, to: years[0].id, items: { terms: true, classes: true, coefficients: true }, teachers: false };
  const out = h('div'); const card = h('div', { class: 'card' }); panel.replaceChildren(card, out);
  const body = () => ({ from_year_id: S.from, to_year_id: S.to, items: Object.keys(S.items).filter((k) => S.items[k]), copy_teachers: S.teachers, lang: LANG() });
  const yr = (id, on) => select(years.map((y) => [y.id, y.name]), id, { onchange: (e) => on(Number(e.target.value)) });
  const chk = (label, get2, set) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: get2(), onchange: (e) => set(e.target.checked) }), ' ', label);
  card.replaceChildren(h('h2', t('imp.cp_title')), h('p', { class: 'muted' }, t('imp.cp_help')), h('div', { class: 'notice notice-blue' }, t('imp.cp_never')),
    h('div', { class: 'toolbar' }, field(t('imp.cp_from'), yr(S.from, (v) => { S.from = v; })), field(t('imp.cp_to'), yr(S.to, (v) => { S.to = v; }))),
    h('div', { class: 'imp-opts' }, chk(t('imp.cp_terms'), () => S.items.terms, (v) => { S.items.terms = v; }), chk(t('imp.cp_classes'), () => S.items.classes, (v) => { S.items.classes = v; }), chk(t('imp.cp_coef'), () => S.items.coefficients, (v) => { S.items.coefficients = v; }), chk(t('imp.cp_teachers'), () => S.teachers, (v) => { S.teachers = v; })),
    h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', onclick: preview }, t('imp.cp_preview')), h('button', { class: 'btn btn-primary', onclick: run }, t('imp.cp_run'))));
  const counts = (r) => h('div', { class: 'imp-chips' }, chip(t('imp.cp_terms'), r.terms, 'g'), chip(t('imp.cp_classes'), r.classes, 'g'), chip(t('imp.cp_coef'), r.coefficients, 'g'), chip(t('imp.res_skipped'), r.skipped, 'n'));
  async function preview() { if (S.from === S.to) { toast(t('err.invalid_year'), 'error'); return; } try { const r = await post('/import/copy-year', { ...body(), dry_run: true }); out.replaceChildren(h('div', { class: 'card' }, h('h3', t('imp.cp_would')), counts(r))); } catch (e) { failMsg(e); } }
  async function run() {
    if (S.from === S.to) { toast(t('err.invalid_year'), 'error'); return; }
    if (!await confirmDialog(t('imp.cp_confirm'), t('imp.cp_run'), false)) return;
    try { const r = await post('/import/copy-year', body()); out.replaceChildren(h('div', { class: 'card' }, h('h3', t('imp.cp_done')), counts(r), h('button', { class: 'btn btn-ghost', onclick: toHistory }, t('imp.open_history')))); } catch (e) { failMsg(e); }
  }
}

// ================= tab 4: GCE Board results import =================
function gceImportTab(panel, goData, toHistory) {
  const G = { year: String(new Date().getFullYear()), level: 'ordinary', text: '', cands: null, summary: null, source: 'paste', page: 0, only: false, busy: false };
  const form = h('div', { class: 'card' }); const out = h('div'); panel.replaceChildren(form, out);
  const ta = h('textarea', { rows: 10, class: 'gce-text', placeholder: t('imp.gce_placeholder'), 'aria-label': t('imp.gce_paste'), oninput: (e) => { G.text = e.target.value; } });
  const fileIn = h('input', { type: 'file', accept: '.pdf,.xlsx,.csv,text/csv,application/pdf', 'aria-label': t('imp.gce_file') });
  const yearIn = numIn({ value: G.year, maxlength: 4, oninput: (e) => { G.year = e.target.value; } });
  const levelSel = select([['ordinary', t('imp.gce_ordinary')], ['advanced', t('imp.gce_advanced')]], G.level, { onchange: (e) => { G.level = e.target.value; } });
  form.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h2', t('imp.gce_title')), h('p', t('imp.gce_help'))), h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', onclick: () => goData('gce_candidates') }, t('imp.gce_register')))),
    h('div', { class: 'notice notice-blue' }, t('imp.gce_rules')),
    h('div', { class: 'toolbar' }, field(t('imp.gce_year'), yearIn, { required: true }), field(t('imp.gce_level'), levelSel, { required: true })),
    field(t('imp.gce_paste'), ta, { hint: t('imp.gce_paste_hint') }), field(t('imp.gce_file'), fileIn, { hint: t('imp.gce_file_hint') }),
    h('button', { class: 'btn btn-primary', onclick: parse }, t('imp.gce_read')));

  const meta = () => ({ exam_year: Number(G.year), level: G.level, lang: LANG() });
  const strip = (c) => ({ candidate_number: c.candidate_number, centre_number: c.centre_number, name: c.name, raw: c.raw, subjects: c.subjects, student_id: c.student_id, confirm_match: c.confirm_match });
  async function parse() {
    if (!/^\d{4}$/.test(String(G.year).trim())) { toast(t('err.bad_year_num'), 'error'); return; }
    const f = fileIn.files[0]; if (!f && G.text.trim().length < 5) { toast(t('imp.gce_nothing_to_read'), 'error'); return; }
    out.replaceChildren(spinner());
    try {
      const r = await post('/import/gce/parse', { ...meta(), ...(f ? { file: { name: f.name, data: await fileToB64(f) } } : { text: G.text }) });
      G.cands = r.candidates; G.summary = r.summary; G.source = r.source; G.page = 0; G.only = false; draw();
    } catch (e) { out.replaceChildren(); failMsg(e); }
  }
  async function recheck(quiet) {
    try { const r = await post('/import/gce/check', { ...meta(), candidates: G.cands.map(strip) }); G.cands = r.candidates; G.summary = r.summary; draw(); return r.summary; } catch (e) { if (!quiet) failMsg(e); return null; }
  }
  async function save() {
    const s = await recheck(true); if (!s) return;
    if (s.problems > 0) { toast(t('imp.gce_fix_first', { n: s.problems }), 'error'); return; }
    if (!await confirmDialog(t('imp.gce_confirm', { n: s.total, y: G.year, l: t(`imp.gce_${G.level}`) }), t('imp.save_now'), false)) return;
    G.busy = true; draw();
    try { const r = await post('/import/gce/commit', { ...meta(), confirm: true, source: G.source, candidates: G.cands.map(strip) });
      out.replaceChildren(h('div', { class: 'card' }, h('h2', t('imp.done_title')), h('div', { class: 'imp-chips' }, chip(t('imp.gce_saved'), r.inserted, 'g')), h('p', { class: 'muted' }, t('imp.gce_done_text')),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => gceImportTab(panel, goData, toHistory) }, t('imp.import_more')), h('button', { class: 'btn btn-ghost', onclick: toHistory }, t('imp.open_history'))))); G.cands = null; }
    catch (e) { G.busy = false; if (e instanceof ApiError && e.code === 'validation_failed' && e.data.candidates) { G.cands = e.data.candidates; G.summary = e.data.summary; draw(); } failMsg(e); }
  }
  function matchBox(c, i) {
    const box = h('div', { class: 'gce-match' });
    const choose = (s) => { c.student_id = s.id; c.student = s; c.how = 'manual'; c.confirm_match = false; recheck(true); };
    if (c.student) {
      box.append(h('span', badge(t(`imp.how_${c.how}`), c.how === 'manual' ? 'gold' : 'green')), ' ', h('strong', c.student.name), ` (${c.student.code}) `, h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { c.student_id = null; c.student = null; c.confirm_match = false; recheck(true); } }, t('imp.gce_change')));
      if (c.errors.some((e) => e.code === 'confirm_needed') || c.confirm_match) box.append(h('label', { class: 'check gce-confirm' }, h('input', { type: 'checkbox', checked: c.confirm_match, onchange: (e) => { c.confirm_match = e.target.checked; recheck(true); } }), ' ', t('imp.gce_confirm_match')));
    } else {
      const res = h('div', { class: 'gce-results' }); let timer;
      const q = input({ type: 'search', placeholder: t('imp.gce_search'), 'aria-label': t('imp.gce_search'), oninput: (e) => { clearTimeout(timer); const v = e.target.value.trim(); timer = setTimeout(async () => { if (v.length < 2) { res.replaceChildren(); return; } try { const list = await get(`/import/gce/students?q=${encodeURIComponent(v)}`); res.replaceChildren(...list.map((s) => h('button', { class: 'btn btn-sm btn-ghost', onclick: () => choose(s) }, `${s.name} · ${s.code}${s.class_label ? ' · ' + s.class_label : ''}`)), list.length ? '' : h('span', { class: 'muted' }, t('imp.gce_none'))); } catch { /* ignore */ } }, 300); } });
      box.append(...[c.suggestions.length ? h('div', h('small', { class: 'muted' }, t('imp.gce_suggest')), h('div', { class: 'gce-results' }, c.suggestions.map((s) => h('button', { class: 'btn btn-sm btn-ghost', onclick: () => choose({ id: s.id, code: s.code, name: s.name }) }, `${s.name} · ${s.code} (${s.sim}%)`)))) : null, q, res].filter(Boolean));
    }
    return box;
  }
  function card(c, i) {
    const dirty = () => { G.dirty = true; };
    const subj = c.subjects.map((s, k) => h('tr', h('td', h('input', { class: 'cell', value: s.name, 'aria-label': t('imp.gce_subject'), oninput: (e) => { s.name = e.target.value; dirty(); } })), h('td', h('input', { class: 'cell grade', value: s.grade, maxlength: 12, 'aria-label': t('imp.gce_grade'), oninput: (e) => { s.grade = e.target.value; dirty(); } })),
      h('td', h('button', { class: 'icon-btn', 'aria-label': t('imp.remove_row'), onclick: () => { c.subjects.splice(k, 1); recheck(true); } }, svgIcon('close', 16)))));
    return h('article', { class: 'card gce-card' + (c.errors.length ? ' gce-bad' : '') },
      h('div', { class: 'toolbar' }, field(t('imp.gce_cand_no'), input({ value: c.candidate_number, oninput: (e) => { c.candidate_number = e.target.value; dirty(); }, onchange: () => recheck(true) }), { required: true }), field(t('imp.gce_centre'), input({ value: c.centre_number, oninput: (e) => { c.centre_number = e.target.value; dirty(); } })),
        field(t('imp.gce_name_supplied'), input({ value: c.name, oninput: (e) => { c.name = e.target.value; dirty(); }, onchange: () => recheck(true) }), { required: true }),
        h('button', { class: 'btn btn-sm btn-ghost', title: t('imp.remove_row'), onclick: () => { G.cands.splice(i, 1); recheck(true); } }, t('imp.gce_drop'))),
      matchBox(c, i),
      h('div', { class: 'table-wrap' }, h('table', { class: 'imp-table' }, h('thead', h('tr', h('th', t('imp.gce_subject')), h('th', t('imp.gce_grade')), h('th', ''))), h('tbody', subj))),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { c.subjects.push({ code: '', name: '', grade: '' }); draw(); } }, t('imp.gce_add_subject')),
      c.errors.length ? h('div', { class: 'msg-list' }, c.errors.map((e) => h('div', { class: e.code === 'no_student' || e.code === 'confirm_needed' ? 'msg-warn' : 'msg-err' }, e.text))) : h('div', { class: 'msg-ok' }, t('imp.gce_ready')),
      c.raw ? h('details', { class: 'gce-raw' }, h('summary', t('imp.gce_original')), h('pre', c.raw)) : null);
  }
  function draw() {
    if (!G.cands) { out.replaceChildren(); return; }
    const s = G.summary; const list = G.cands.map((c, i) => [c, i]).filter(([c]) => !G.only || c.errors.length); const PAGE = 20; const pages = Math.max(1, Math.ceil(list.length / PAGE)); if (G.page >= pages) G.page = pages - 1;
    out.replaceChildren(h('div', { class: 'card' }, h('h3', t('imp.gce_review')), h('p', { class: 'muted' }, t('imp.gce_review_help')),
      h('div', { class: 'imp-chips' }, chip(t('imp.sum_total'), s.total), chip(t('imp.gce_ready_n'), s.ready, 'g'), chip(t('imp.gce_problems'), s.problems, s.problems ? 'r' : 'n'), chip(t('imp.gce_unmatched'), s.unmatched, s.unmatched ? 'y' : 'n')),
      h('div', { class: 'actions' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: G.only, onchange: (e) => { G.only = e.target.checked; G.page = 0; draw(); } }), ' ', t('imp.gce_only_problems')),
        h('button', { class: 'btn btn-ghost', onclick: () => recheck() }, t('imp.recheck')), h('button', { class: 'btn btn-primary', disabled: G.busy, onclick: save }, t('imp.gce_save', { n: s.total })))),
      ...list.slice(G.page * PAGE, G.page * PAGE + PAGE).map(([c, i]) => card(c, i)),
      ...(pages > 1 ? [h('div', { class: 'imp-pager' }, h('button', { class: 'btn btn-sm btn-ghost', disabled: G.page === 0, onclick: () => { G.page--; draw(); } }, '‹'), h('span', t('imp.page_of', { p: G.page + 1, n: pages })), h('button', { class: 'btn btn-sm btn-ghost', disabled: G.page >= pages - 1, onclick: () => { G.page++; draw(); } }, '›'))] : []));
  }
}

// ================= student profile: GCE history + print =================
export async function gceTab(panel, student) {
  panel.replaceChildren(spinner());
  try {
    const d = await get(`/students/${student.id}/gce`); const admin = state.user.role === 'school_admin';
    if (!d.results.length) { panel.replaceChildren(empty(t('gce.none'), t('gce.none_text'))); return; }
    panel.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h3', t('gce.title')), h('p', { class: 'muted' }, t('gce.separate'))), h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => printGce(d) }, t('gce.print')))),
      ...d.results.map((r) => h('article', { class: 'card gce-result' }, h('h4', `${t(`imp.gce_${r.level}`)} — ${r.exam_year}`),
        h('p', { class: 'muted' }, `${t('gce.cand_no')}: `, h('strong', r.candidate_number), r.centre_number ? ` · ${t('gce.centre')}: ${r.centre_number}` : '', r.candidate_name ? ` · ${t('gce.name_board')}: ${r.candidate_name}` : ''),
        h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', h('th', t('imp.gce_subject')), h('th', t('imp.gce_grade')))), h('tbody', r.subjects.map((s) => h('tr', h('td', (s.subject_code ? s.subject_code + ' ' : '') + s.subject_name), h('td', h('strong', s.grade))))))),
        admin ? h('p', { class: 'muted small' }, t('gce.imported_by', { who: r.imported_by_name || '—', when: fmtDateTime(r.imported_at) }), r.source ? ` · ${r.source}` : '') : null,
        admin && r.raw_text ? h('details', { class: 'gce-raw' }, h('summary', t('imp.gce_original')), h('pre', r.raw_text)) : null)));
  } catch (e) { panel.replaceChildren(errorBox(e, () => gceTab(panel, student))); }
}
function printGce(d) {
  const sheet = h('div', { class: 'gce-sheet' }, h('h1', d.school.name), h('h2', t('gce.print_title')), h('p', h('strong', d.student.full_name), ` — ${t('form.student_id')}: ${d.student.student_code}`),
    d.results.map((r) => h('section', h('h3', `${t(`imp.gce_${r.level}`)} — ${r.exam_year}`), h('p', `${t('gce.cand_no')}: ${r.candidate_number}${r.centre_number ? ` · ${t('gce.centre')}: ${r.centre_number}` : ''}`),
      h('table', h('thead', h('tr', h('th', t('imp.gce_subject')), h('th', t('imp.gce_grade')))), h('tbody', r.subjects.map((s) => h('tr', h('td', (s.subject_code ? s.subject_code + ' ' : '') + s.subject_name), h('td', s.grade))))))),
    h('p', { class: 'small' }, t('gce.print_note')), h('p', { class: 'small' }, `${t('gce.printed')}: ${fmtDateTime(new Date().toISOString())}`));
  document.body.appendChild(sheet); document.body.classList.add('printing-gce');
  const cleanup = () => { document.body.classList.remove('printing-gce'); sheet.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup); setTimeout(() => window.print(), 50); setTimeout(cleanup, 60000);
}
