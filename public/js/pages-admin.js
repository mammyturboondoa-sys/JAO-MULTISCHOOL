// Overview, Products & Stock, Settings (incl. School Knowledge Management), Platform owner.
import { state, t, h, get, post, put, del, qs, navigate, load, field, input, select, textarea, toast, fail, confirmDialog, modal, showSecret, empty, errorBox, spinner,
  badge, fcfa, fmtDate, fmtDateTime, fmtNum, readImage, svgIcon, errText, ApiError } from './ui.js';
import { CATEGORIES } from './pages-shop.js';
import { SCHOOL_TYPES, typeLabel } from './pages-portal.js';

const stat = (cls, icon, num, label) => h('div', { class: `stat ${cls}` }, svgIcon(icon, 34), h('div', h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, label)));
const actionLabel = (a) => t(`audit.${a}`) === `audit.${a}` ? a.replaceAll('_', ' ') : t(`audit.${a}`);

// ================= Overview =================
export async function overviewPage(ctx, view) {
  const o = await get('/overview'); const u = state.user; const admin = u.role === 'school_admin';
  const greet = admin ? t('overview.welcome_back', { name: u.name }) : t('overview.hello', { name: u.name });
  const cards = [stat('stat-blue', 'students', o.students, t(admin || u.role === 'teacher' ? 'overview.students' : 'overview.my_students'))];
  if (admin) cards.push(stat('stat-green', 'platform', o.teachers, t('overview.teachers')));
  if (o.classes !== undefined) cards.push(stat('stat-gold', 'classes', o.classes, t('overview.classes')), stat('stat-purple', 'subjects', o.subjects, t('overview.subjects')));
  const parts = [h('div', { class: 'greeting' }, h('h1', greet), h('p', `${o.school}${o.current_year ? ' · ' + o.current_year : ''}`)), h('div', { class: 'grid grid-4' }, cards)];
  if (admin) {
    const noYear = !o.current_year;
    if (noYear) parts.push(h('div', { class: 'notice', style: { marginTop: '1rem' } }, h('strong', t('overview.setup_title')), h('p', { style: { margin: '.25rem 0 .5rem' } }, t('overview.setup_text')), h('a', { class: 'btn btn-gold btn-sm', href: '#/settings' }, t('overview.setup_go'))));
    const classes = await get('/classes'); const max = Math.max(1, ...classes.map((c) => c.students));
    parts.push(h('div', { class: 'grid grid-2', style: { marginTop: '1rem' } },
      h('section', { class: 'card' }, h('h2', t('overview.quick')), h('div', { class: 'quick' }, h('a', { class: 'btn', href: '#/students/new' }, svgIcon('plus', 18), t('students.add')), h('a', { class: 'btn', href: '#/grades' }, svgIcon('grades', 18), t('overview.enter_grades')),
        h('a', { class: 'btn', href: '#/classes?new=1', onclick: (e) => { e.preventDefault(); navigate('#/classes'); } }, svgIcon('classes', 18), t('classes.add')), h('a', { class: 'btn', href: '#/products' }, svgIcon('products', 18), t('products.add')))),
      h('section', { class: 'card' }, h('h2', t('overview.shop_summary')), h('ul', { class: 'list' }, h('li', h('span', t('overview.active_products')), h('strong', o.shop.active)), h('li', h('span', t('overview.low_stock')), h('strong', o.shop.low_stock)), h('li', h('span', t('overview.out_stock')), h('strong', o.shop.out_of_stock)))),
      h('section', { class: 'card' }, h('h2', t('overview.students_per_class')), classes.length ? h('div', { class: 'bars' }, classes.slice(0, 10).map((c) => h('div', { class: 'bar-row' }, h('span', c.label), h('div', { class: 'bar' }, h('i', { style: { width: `${(c.students / max) * 100}%` } })), h('strong', c.students)))) : h('p', { class: 'muted' }, t('overview.no_classes'))),
      h('section', { class: 'card' }, h('h2', t('overview.academic')), o.recent_assessments.length ? h('ul', { class: 'list' }, o.recent_assessments.map((a) => h('li', h('span', `${a.name} — ${a.class_name}${a.section || ''} · ${a.subject_name}`), h('span', { class: 'muted small' }, `${fmtDate(a.date)} · ${a.graded}`)))) : h('p', { class: 'muted' }, t('overview.no_assessments'))),
      h('section', { class: 'card', style: { gridColumn: '1 / -1' } }, h('h2', t('overview.activity')), o.activity.length ? h('ul', { class: 'list' }, o.activity.map((a) => h('li', h('span', actionLabel(a.action)), h('span', { class: 'muted small' }, fmtDateTime(a.at))))) : h('p', { class: 'muted' }, t('overview.no_activity')))));
  } else {
    parts.push(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h2', t('overview.quick')), h('div', { class: 'quick' }, h('a', { class: 'btn btn-primary', href: '#/students' }, t('nav.students')), u.role !== 'teacher' ? h('a', { class: 'btn', href: '#/reports' }, t('nav.reports')) : h('a', { class: 'btn', href: '#/grades' }, t('nav.grades')), h('a', { class: 'btn', href: '#/shop' }, t('nav.shop')))));
  }
  view.replaceChildren(...parts);
}

// ================= Products & Stock =================
export async function productsPage(ctx, view) {
  const q = input({ type: 'search', placeholder: t('products.search'), 'aria-label': t('products.search') });
  const cat = select([['', t('shop.all_categories')], ...CATEGORIES.map((c) => [c, t(`cat.${c}`)])], '', { 'aria-label': t('shop.category') });
  const stock = select([['', t('products.all_stock')], ['low', t('avail.low_stock')], ['out', t('avail.out_of_stock')]], '', { 'aria-label': t('products.stock_filter') });
  const sumBox = h('div', { class: 'grid grid-4', style: { marginBottom: '1rem' } }), box = h('div'); let timer;
  const run = async () => {
    get('/products/summary').then((s) => sumBox.replaceChildren(stat('stat-blue', 'products', s.total, t('products.total')), stat('stat-green', 'check', s.available, t('products.available')), stat('stat-gold', 'bell', s.low_stock, t('products.low')), stat('stat-purple', 'close', s.out_of_stock, t('products.out')))).catch(() => {});
    load(box, () => get('/products' + qs({ q: q.value.trim(), category: cat.value, stock: stock.value })), (list) => list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
      h('thead', h('tr', h('th', ''), h('th', t('subjects.name')), h('th', t('subjects.code')), h('th', t('shop.category')), h('th', { class: 'num' }, t('shop.price')), h('th', { class: 'num' }, t('products.qty')), h('th', t('form.status')), h('th', ''))),
      h('tbody', list.map((p) => h('tr', h('td', { 'data-label': '' }, p.image ? h('img', { src: p.image, alt: '', style: { width: '44px', height: '44px', objectFit: 'cover', borderRadius: '8px' } }) : svgIcon('products', 28)),
        h('td', { 'data-label': t('subjects.name') }, h('strong', p.name), p.class_level ? h('div', { class: 'small muted' }, p.class_level) : null, p.variant ? h('div', { class: 'small muted' }, p.variant) : null), h('td', { 'data-label': t('subjects.code') }, h('code', p.code)), h('td', { 'data-label': t('shop.category') }, t(`cat.${p.category}`)),
        h('td', { class: 'num', 'data-label': t('shop.price') }, fcfa(p.price)), h('td', { class: 'num', 'data-label': t('products.qty') }, p.quantity),
        h('td', { 'data-label': t('form.status') }, !p.active ? badge(t('common.inactive'), 'neutral') : badge(t(`avail.${p.availability}`), { in_stock: 'green', low_stock: 'gold', out_of_stock: 'red' }[p.availability]), !p.is_public && p.active ? badge(t('products.hidden'), 'blue') : null),
        h('td', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm', onclick: () => productForm(p, run) }, t('common.edit')), h('button', { class: 'btn btn-sm btn-primary', onclick: () => stockForm(p, run) }, t('products.adjust')), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => movements(p) }, t('products.history'))))))))
      : empty(t('products.empty_title'), t('products.empty_text'), h('button', { class: 'btn btn-primary', onclick: () => productForm(null, run) }, t('products.add'))));
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); }); [cat, stock].forEach((el) => el.addEventListener('change', run));
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.products')), h('p', t('products.subtitle'))), h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => productForm(null, run) }, svgIcon('plus', 18), t('products.add')))),
    sumBox, h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, field(t('common.search'), q)), h('div', field(t('shop.category'), cat)), h('div', field(t('products.stock_filter'), stock))), box);
  run();
}
function productForm(p, done) {
  const f = { name: input({ value: p ? p.name : '', maxlength: 120 }), code: input({ value: p ? p.code : '', maxlength: 30 }), cat: select(CATEGORIES.map((c) => [c, t(`cat.${c}`)]), p ? p.category : 'school_supplies'),
    level: input({ value: p && p.class_level ? p.class_level : '', maxlength: 40 }), price: input({ type: 'number', min: 0, step: 1, value: p ? p.price : '' }), qty: input({ type: 'number', min: 0, step: 1, value: 0 }),
    low: input({ type: 'number', min: 0, step: 1, value: p ? p.low_threshold : 5 }), variant: input({ value: p && p.variant ? p.variant : '', maxlength: 80, placeholder: t('products.variant_ph') }), desc: textarea({ maxlength: 1000 }),
    active: h('input', { type: 'checkbox', id: 'pact', checked: p ? p.active : true }), pub: h('input', { type: 'checkbox', id: 'ppub', checked: p ? p.is_public : true }) };
  f.desc.value = p && p.description ? p.description : '';
  let image, removeImage = false; const prev = h('div', p && p.image ? h('img', { src: p.image, alt: '', style: { width: '90px', height: '90px', objectFit: 'cover', borderRadius: '10px' } }) : null);
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': t('products.image'), onchange: async (e) => { try { image = await readImage(e.target.files[0]); prev.replaceChildren(h('img', { src: image, alt: '', style: { width: '90px', height: '90px', objectFit: 'cover', borderRadius: '10px' } })); } catch (ex) { fail(ex); e.target.value = ''; } } });
  modal({ title: p ? t('products.edit') : t('products.add'), wide: true, body: h('form', { onsubmit: (e) => e.preventDefault() }, h('div', { class: 'form-grid' }, field(t('subjects.name'), f.name, { required: true }), field(t('subjects.code'), f.code, { required: true, hint: t('subjects.code_hint') }), field(t('shop.category'), f.cat, { required: true }),
    field(t('shop.class_level'), f.level), field(`${t('shop.price')} (FCFA)`, f.price, { required: true }), p ? null : field(t('products.initial_qty'), f.qty), field(t('products.threshold'), f.low, { hint: t('products.threshold_hint') }), field(t('shop.variant'), f.variant)),
    field(t('subjects.description'), f.desc), h('div', { class: 'photo-pick' }, prev, field(t('products.image'), file, { hint: t('form.photo_hint') }), p && p.image ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { removeImage = true; image = undefined; prev.replaceChildren(); } }, t('form.remove_photo')) : null),
    h('div', { class: 'check' }, f.active, h('label', { for: 'pact' }, t('products.active_label'))), h('div', { class: 'check' }, f.pub, h('label', { for: 'ppub' }, t('products.public_label')))),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      const body = { name: f.name.value, code: f.code.value, category: f.cat.value, class_level: f.level.value, price: Number(f.price.value), low_threshold: Number(f.low.value), variant: f.variant.value, description: f.desc.value, active: f.active.checked, is_public: f.pub.checked };
      if (image) body.image = image; if (removeImage) body.remove_image = true; if (!p) body.quantity = Number(f.qty.value || 0);
      try { p ? await put(`/products/${p.id}`, body) : await post('/products', body); toast(t('common.saved')); c(); done(); } catch (e) { fail(e); } } }] });
}
function stockForm(p, done) {
  const types = ['restock', 'sale', 'return', 'damaged', 'adjustment_in', 'adjustment_out'];
  const type = select(types.map((x) => [x, t(`move.${x}`)]), 'restock'), qty = input({ type: 'number', min: 1, step: 1, value: 1 }), reason = input({ maxlength: 200 });
  modal({ title: `${t('products.adjust')} — ${p.name}`, body: h('form', { onsubmit: (e) => e.preventDefault() }, h('p', t('products.current_qty', { n: p.quantity })), field(t('products.move_type'), type, { required: true }), field(t('products.qty'), qty, { required: true }), field(t('products.reason'), reason, { hint: t('products.reason_hint') })),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => { try { await post(`/products/${p.id}/stock`, { type: type.value, quantity: Number(qty.value), reason: reason.value }); toast(t('common.saved')); c(); done(); } catch (e) { fail(e); } } }] });
}
function movements(p) {
  const box = h('div'); modal({ title: `${t('products.history')} — ${p.name}`, wide: true, body: box, actions: [{ label: t('common.close'), class: 'btn-primary', onclick: (c) => c() }] });
  load(box, () => get(`/products/${p.id}/movements`), (list) => list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('common.date')), h('th', t('products.move_type')), h('th', { class: 'num' }, t('products.change')), h('th', { class: 'num' }, t('products.before_after')), h('th', t('products.reason')), h('th', t('products.by')))),
    h('tbody', list.map((m) => h('tr', h('td', { 'data-label': t('common.date') }, fmtDateTime(m.at)), h('td', { 'data-label': t('products.move_type') }, t(`move.${m.type}`)), h('td', { class: 'num', 'data-label': t('products.change') }, m.change > 0 ? `+${m.change}` : m.change), h('td', { class: 'num', 'data-label': t('products.before_after') }, `${m.previous_qty} → ${m.new_qty}`), h('td', { 'data-label': t('products.reason') }, m.reason || '—'), h('td', { 'data-label': t('products.by') }, m.actor || '—')))))) : empty(t('products.no_moves')));
}

// ================= Settings =================
export async function settingsPage(ctx, view) {
  const tabs = ['school', 'academic', 'users', 'language', 'security', 'knowledge'];
  let tab = ctx.query.tab && tabs.includes(ctx.query.tab) ? ctx.query.tab : 'school';
  const panel = h('div', { role: 'tabpanel' });
  const bar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map((k) => h('button', { role: 'tab', 'aria-selected': String(k === tab), 'data-k': k, onclick: () => { tab = k; bar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === tab))); draw(); } }, t(`settings.tab_${k}`))));
  const draw = () => { state.dirty = false; panel.replaceChildren(); ({ school: schoolTab, academic: academicTab, users: usersTab, language: languageTab, security: securityTab, knowledge: knowledgeTab })[tab](panel); };
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.settings')), h('p', t('settings.subtitle')))), bar, panel);
  draw();
}

function schoolTab(panel) {
  load(panel, () => get('/settings/school'), (s) => {
    const f = { name: input({ value: s.name, maxlength: 200 }), motto: input({ value: s.motto || '', maxlength: 200 }), address: input({ value: s.address || '' }), location: input({ value: s.location || '' }), phone: input({ type: 'tel', value: s.phone || '' }), email: input({ type: 'email', value: s.email || '' }),
      hours: textarea({ maxlength: 1000 }), instr: textarea({ maxlength: 1000 }) };
    f.stype = select([['', '—'], ...SCHOOL_TYPES.map((v) => [v, typeLabel(v)])], s.school_type || ''); f.hours.value = s.shop_hours || ''; f.instr.value = s.shop_instructions || '';
    const logo = h('div', s.logo ? h('img', { src: s.logo, alt: '', style: { width: '90px', height: '90px', objectFit: 'contain' } }) : h('p', { class: 'muted small' }, t('settings.no_logo')));
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': t('settings.logo'), onchange: async (e) => {
      try { const img = await readImage(e.target.files[0]); const r = await post('/settings/logo', { image: img }); state.school = { ...state.school, logo: r.logo }; logo.replaceChildren(h('img', { src: r.logo, alt: '', style: { width: '90px', height: '90px', objectFit: 'contain' } })); toast(t('common.saved')); } catch (ex) { fail(ex); } } });
    return h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await put('/settings/school', { school_type: f.stype.value, name: f.name.value, motto: f.motto.value, address: f.address.value, location: f.location.value, phone: f.phone.value, email: f.email.value, shop_hours: f.hours.value, shop_instructions: f.instr.value });
      state.school = { ...state.school, name: f.name.value }; toast(t('common.saved')); } catch (ex) { fail(ex); } } },
      h('div', { class: 'photo-pick' }, logo, field(t('settings.logo'), file, { hint: t('form.photo_hint') })),
      h('div', { class: 'form-grid' }, field(t('portal.school_code'), h('div', { class: 'code-chip' }, s.code || '—'), { hint: t('portal.code_hint') }), field(t('portal.school_type'), f.stype), field(t('settings.school_name'), f.name, { required: true }), field(t('settings.motto'), f.motto), field(t('form.address'), f.address), field(t('settings.location'), f.location), field(t('settings.phone'), f.phone), field(t('auth.email'), f.email)),
      field(t('settings.shop_hours'), f.hours, { hint: t('settings.shop_hours_hint') }), field(t('settings.shop_instructions'), f.instr), h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save')));
  });
}

function academicTab(panel) {
  const draw = () => load(panel, async () => ({ years: await get('/academic-years'), s: await get('/settings/school') }), ({ years, s }) => {
    const yname = input({ placeholder: '2026-2027', maxlength: 40 });
    const g = { scale: input({ type: 'number', min: 1, step: 'any', value: s.grade_scale }), pass: input({ type: 'number', min: 0, step: 'any', value: s.pass_mark }), round: select([[0, '0'], [1, '1'], [2, '2'], [3, '3']], s.rounding), rank: h('input', { type: 'checkbox', id: 'rk', checked: !!s.ranking_enabled }) };
    return h('div', { class: 'grid grid-2' },
      h('section', { class: 'card' }, h('h2', t('settings.years_terms')), years.length ? years.map((y) => h('div', { style: { borderBottom: '1px solid var(--line)', padding: '.6rem 0' } },
        h('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' } }, h('strong', y.name), y.is_current ? badge(t('settings.current'), 'green') : h('button', { class: 'btn btn-sm', onclick: async () => { try { await post(`/academic-years/${y.id}/current`); draw(); } catch (e) { fail(e); } } }, t('settings.make_current'))),
        h('div', { style: { margin: '.4rem 0' } }, y.terms.length ? y.terms.map((x) => h('span', { style: { display: 'inline-flex', gap: '.2rem', alignItems: 'center', marginRight: '.6rem', flexWrap: 'wrap' } }, badge(x.starts_on ? `${x.name}: ${x.starts_on} → ${x.ends_on}` : x.name, 'blue'), h('button', { class: 'btn btn-sm btn-ghost', 'aria-label': `${t('terms.dates')} — ${x.name}`, onclick: () => termDatesForm(x, draw) }, t('terms.dates')))) : h('span', { class: 'muted small' }, t('settings.no_terms')), ' ',
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { const n = input({ placeholder: 'Term 1', maxlength: 40 }); modal({ title: `${t('settings.add_term')} — ${y.name}`, body: field(t('subjects.name'), n, { required: true }), actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => { try { await post('/terms', { year_id: y.id, name: n.value }); c(); draw(); } catch (e) { fail(e); } } }] }); } }, `+ ${t('settings.add_term')}`)))) : h('p', { class: 'muted' }, t('settings.no_years')),
        h('form', { style: { marginTop: '1rem' }, onsubmit: async (e) => { e.preventDefault(); try { await post('/academic-years', { name: yname.value }); draw(); } catch (ex) { fail(ex); } } }, field(t('settings.new_year'), yname, { required: true }), h('button', { class: 'btn btn-primary', type: 'submit' }, t('settings.add_year')))),
      h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await put('/settings/school', { grade_scale: Number(g.scale.value), pass_mark: Number(g.pass.value), rounding: Number(g.round.value), ranking_enabled: g.rank.checked }); toast(t('common.saved')); } catch (ex) { fail(ex); } } },
        h('h2', t('settings.grading')), h('div', { class: 'notice' }, t('settings.grading_note')), field(t('settings.scale'), g.scale, { required: true, hint: t('settings.scale_hint') }), field(t('settings.pass_mark'), g.pass, { required: true }), field(t('settings.rounding'), g.round, { hint: t('settings.rounding_hint') }),
        h('div', { class: 'check' }, g.rank, h('label', { for: 'rk' }, t('settings.ranking'))), h('p', { class: 'small muted' }, t('settings.average_rule')), h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save'))));
  });
  draw();
}

function usersTab(panel) {
  const draw = () => load(panel, () => get('/users'), (users) => h('div', h('div', { class: 'page-head' }, h('div', h('h2', t('settings.users')), h('p', t('settings.users_help'))), h('button', { class: 'btn btn-primary', onclick: () => userForm(draw) }, svgIcon('plus', 18), t('settings.add_user'))),
    h('div', { class: 'notice notice-blue' }, t('settings.sole_admin')),
    users.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('subjects.name')), h('th', t('auth.email')), h('th', t('settings.role')), h('th', t('settings.last_login')), h('th', t('form.status')), h('th', ''))),
      h('tbody', users.map((u) => h('tr', h('td', { 'data-label': t('subjects.name') }, h('strong', u.name)), h('td', { 'data-label': t('auth.email') }, u.email), h('td', { 'data-label': t('settings.role') }, t(`role.${u.role}`)), h('td', { 'data-label': t('settings.last_login') }, u.last_login ? fmtDateTime(u.last_login) : '—'), h('td', { 'data-label': t('form.status') }, badge(u.active ? t('common.active') : t('common.inactive'), u.active ? 'green' : 'neutral')),
        h('td', { class: 'actions-cell' }, u.role === 'school_admin' ? badge(t('settings.you'), 'blue') : [
          h('button', { class: 'btn btn-sm', onclick: async () => { if (!(await confirmDialog(t('settings.reset_confirm', { name: u.name }), t('settings.reset'), false))) return; try { const r = await post(`/users/${u.id}/reset-password`); showSecret(t('settings.reset'), [[t('auth.email'), u.email], [t('auth.temp_password'), r.temporary_password]]); } catch (e) { fail(e); } } }, t('settings.reset')),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { try { await put(`/users/${u.id}`, { active: !u.active }); draw(); } catch (e) { fail(e); } } }, u.active ? t('common.deactivate') : t('common.activate'))])))))) : empty(t('settings.no_users'))));
  draw();
}
async function userForm(done) {
  const role = select([['teacher', t('role.teacher')], ['parent', t('role.parent')], ['student', t('role.student')]], 'teacher');
  const name = input({ maxlength: 120 }), email = input({ type: 'email' });
  const students = (await get('/students?page_size=60&sort=name')).rows; const stu = select([['', '—'], ...students.map((s) => [s.id, `${s.full_name} (${s.student_code})`])], '');
  const stuField = field(t('settings.linked_student'), stu, { hint: t('settings.linked_student_hint') }); const sync = () => { stuField.hidden = role.value !== 'student'; }; role.addEventListener('change', sync); sync();
  modal({ title: t('settings.add_user'), body: h('form', { onsubmit: (e) => e.preventDefault() }, field(t('settings.role'), role, { required: true }), field(t('subjects.name'), name, { required: true }), field(t('auth.email'), email, { required: true }), stuField, h('p', { class: 'small muted' }, t('settings.temp_note'))),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      try { const r = await post('/users', { role: role.value, name: name.value, email: email.value, student_id: role.value === 'student' ? Number(stu.value) : undefined }); c(); showSecret(t('settings.user_created'), [[t('auth.email'), email.value.toLowerCase()], [t('auth.temp_password'), r.temporary_password]]); done(); } catch (e) { fail(e); } } }] });
}

function languageTab(panel) {
  const df = select([['DD/MM/YYYY', 'DD/MM/YYYY'], ['YYYY-MM-DD', 'YYYY-MM-DD'], ['MM/DD/YYYY', 'MM/DD/YYYY']], (state.school && state.school.date_format) || 'DD/MM/YYYY');
  const lang = select([['en', 'English'], ['fr', 'Français']], state.lang);
  panel.append(h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await put('/settings/school', { date_format: df.value }); state.school = { ...state.school, date_format: df.value };
    if (lang.value !== state.lang) { const { setLang } = await import('./ui.js'); await setLang(lang.value); return; } toast(t('common.saved')); } catch (ex) { fail(ex); } } },
    h('h2', t('settings.tab_language')), field(t('common.language'), lang), field(t('settings.date_format'), df), h('dl', { class: 'dl' }, h('dt', t('settings.currency')), h('dd', 'FCFA (XAF)'), h('dt', t('settings.theme')), h('dd', t('settings.theme_value'))), h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save'))));
}

function securityTab(panel) {
  const logins = h('div'), audit = h('div'); let page = 1;
  const drawAudit = () => load(audit, () => get(`/audit-log?page=${page}`), (d) => h('div', d.rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('common.date')), h('th', t('audit.who')), h('th', t('audit.action')), h('th', t('audit.record')))),
    h('tbody', d.rows.map((r) => h('tr', h('td', { 'data-label': t('common.date') }, fmtDateTime(r.at)), h('td', { 'data-label': t('audit.who') }, r.actor || '—'), h('td', { 'data-label': t('audit.action') }, actionLabel(r.action)), h('td', { 'data-label': t('audit.record') }, h('code', r.record || '—'))))))) : empty(t('audit.none')),
    h('div', { class: 'pager' }, h('button', { class: 'btn btn-sm', disabled: page <= 1, onclick: () => { page--; drawAudit(); } }, t('common.prev')), h('span', page), h('button', { class: 'btn btn-sm', disabled: d.rows.length < 25, onclick: () => { page++; drawAudit(); } }, t('common.next')))));
  load(logins, () => get('/login-history'), (l) => h('ul', { class: 'list' }, l.map((x) => h('li', h('span', x.ok ? t('security.login_ok') : t('security.login_failed')), h('span', { class: 'muted small' }, fmtDateTime(x.at))))));
  drawAudit();
  panel.append(h('div', { class: 'grid grid-2' }, h('section', { class: 'card' }, h('h2', t('security.admin_profile')), h('p', `${state.user.name} — ${t(`role.${state.user.role}`)}`), h('button', { class: 'btn btn-primary', onclick: async () => { const m = await import('./app.js'); m.changePasswordModal(); } }, t('auth.change_password')), h('h3', { style: { marginTop: '1rem' } }, t('security.login_history')), logins),
    h('section', { class: 'card' }, h('h2', t('security.backup')), h('p', t('security.backup_text')), h('p', { class: 'small muted' }, t('security.session_text')))),
    h('section', { class: 'card', style: { marginTop: '1rem' } }, h('h2', t('security.audit')), audit));
}

const KCATS = ['history', 'identity', 'development', 'achievements', 'leadership', 'traditions', 'general'];
function knowledgeTab(panel) {
  const list = h('div');
  const draw = () => load(list, () => get('/knowledge'), (items) => items.length ? h('div', { class: 'grid grid-2' }, items.map((k) => h('article', { class: 'card' }, h('h3', k.title), h('div', { style: { display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.5rem' } }, badge(t(`kcat.${k.category}`), 'blue'), badge(k.language.toUpperCase(), 'neutral'), badge(t(`kstatus.${k.status}`), { published: 'green', draft: 'gold', archived: 'neutral' }[k.status]), k.period ? badge(k.period, 'neutral') : null),
    h('p', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, k.body.length > 220 ? k.body.slice(0, 220) + '…' : k.body), k.source_note ? h('p', { class: 'small muted' }, `${t('knowledge.source')}: ${k.source_note}`) : null, h('p', { class: 'small muted' }, `${fmtDateTime(k.updated_at)}${k.author ? ' · ' + k.author : ''} · v${k.version}`),
    h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm', onclick: () => knowledgeForm(k, draw) }, t('common.edit')),
      k.status !== 'published' ? h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { try { await post(`/knowledge/${k.id}/status`, { status: 'published' }); draw(); } catch (e) { fail(e); } } }, t('knowledge.publish')) : h('button', { class: 'btn btn-sm', onclick: async () => { try { await post(`/knowledge/${k.id}/status`, { status: 'draft' }); draw(); } catch (e) { fail(e); } } }, t('knowledge.unpublish')),
      k.status !== 'archived' ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { try { await post(`/knowledge/${k.id}/status`, { status: 'archived' }); draw(); } catch (e) { fail(e); } } }, t('knowledge.archive')) : null,
      h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await confirmDialog(t('knowledge.delete_confirm'), t('common.delete'))) { try { await del(`/knowledge/${k.id}`); draw(); } catch (e) { fail(e); } } } }, t('common.delete'))))))
    : empty(t('knowledge.empty_title'), t('knowledge.empty_text')));
  const pq = input({ maxlength: 300, placeholder: t('knowledge.preview_ph'), 'aria-label': t('knowledge.preview') }); const out = h('div');
  panel.append(h('div', { class: 'page-head' }, h('div', h('h2', t('settings.tab_knowledge')), h('p', t('knowledge.help'))), h('button', { class: 'btn btn-primary', onclick: () => knowledgeForm(null, draw) }, svgIcon('plus', 18), t('knowledge.add'))),
    h('div', { class: 'card', style: { marginBottom: '1rem' } }, h('h3', t('knowledge.preview')), h('p', { class: 'small muted' }, t('knowledge.preview_help')), h('form', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap' }, onsubmit: async (e) => { e.preventDefault(); if (!pq.value.trim()) return; out.replaceChildren(spinner());
      try { const r = await post('/knowledge/preview', { message: pq.value, language: state.lang }); out.replaceChildren(h('div', { class: 'msg bot', style: { maxWidth: '100%', marginTop: '.6rem' } }, r.text)); } catch (ex) { out.replaceChildren(errorBox(ex)); } } }, h('div', { style: { flex: 1, minWidth: '200px' } }, pq), h('button', { class: 'btn', type: 'submit' }, t('knowledge.test'))), out), list);
  draw();
}
function knowledgeForm(k, done) {
  const f = { title: input({ value: k ? k.title : '', maxlength: 150 }), cat: select(KCATS.map((c) => [c, t(`kcat.${c}`)]), k ? k.category : 'history'), lang: select([['en', 'English'], ['fr', 'Français']], k ? k.language : state.lang), period: input({ value: k && k.period ? k.period : '', maxlength: 60, placeholder: t('knowledge.period_ph') }), body: textarea({ rows: 8, maxlength: 5000 }), src: input({ value: k && k.source_note ? k.source_note : '', maxlength: 300 }) };
  f.body.value = k ? k.body : '';
  modal({ title: k ? t('knowledge.edit') : t('knowledge.add'), wide: true, body: h('form', { onsubmit: (e) => e.preventDefault() }, field(t('knowledge.title'), f.title, { required: true }), h('div', { class: 'form-grid' }, field(t('knowledge.category'), f.cat, { required: true }), field(t('knowledge.language'), f.lang, { required: true }), field(t('knowledge.period'), f.period)),
    field(t('knowledge.text'), f.body, { required: true, hint: t('knowledge.text_hint') }), field(t('knowledge.source'), f.src, { hint: t('knowledge.source_hint') }), h('p', { class: 'small muted' }, t('knowledge.draft_note'))),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      const body = { title: f.title.value, category: f.cat.value, language: f.lang.value, period: f.period.value, body: f.body.value, source_note: f.src.value };
      try { k ? await put(`/knowledge/${k.id}`, body) : await post('/knowledge', body); toast(t('common.saved')); c(); done(); } catch (e) { fail(e); } } }] });
}

// ================= Platform owner (no student data is ever shown here) =================
void errText; void ApiError; void fmtNum; void qs;

// Start and end dates of a term (empty = no dates).
function termDatesForm(term, done) {
  const a = input({ type: 'date', value: term.starts_on || '' }), b = input({ type: 'date', value: term.ends_on || '' });
  modal({ title: `${t('terms.dates')} — ${term.name}`, body: h('div', field(t('terms.starts'), a), field(t('terms.ends'), b), h('p', { class: 'muted small' }, t('terms.hint'))),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() },
      { label: t('common.save'), class: 'btn-primary', onclick: async (c) => { try { await put(`/terms/${term.id}/dates`, { starts_on: a.value, ends_on: b.value }); toast(t('common.saved')); c(); done(); } catch (e) { fail(e); } } }] });
}
