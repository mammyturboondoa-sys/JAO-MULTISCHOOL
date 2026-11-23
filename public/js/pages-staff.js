// Staff & department directory. This manages office assignments without changing login roles.
import { h, get, post, put, input, select, field, toast, fail, modal, badge, empty, spinner, svgIcon, t } from './ui.js';

// Text shown on these pages: key 'sd:<English>' in the dictionary gives the French; no entry = English is shown.
const L = (en, vars) => { const v = t('sd:' + en, vars); return v === 'sd:' + en ? (vars ? Object.keys(vars).reduce((x, k) => x.replaceAll(`{${k}}`, vars[k]), en) : en) : v; };

const DEFAULT_POSITIONS = [
  L('Principal'), L('Vice Principal'), L('Senior Discipline Master'), L('Discipline Master'), L('Junior Discipline Master'),
  L('Dean of Studies'), L('Dean of Students'), L('Guidance and Counselling Officer'), L('Orientation Officer'),
  L('Class Teacher'), L('Subject Teacher'), L('Examinations Officer'), L('Admissions Officer'), L('School Secretary'),
  L('Accounts Officer'), L('Scholarship Officer'), L('School Activities Officer'), L('Storekeeper'), L('Other')
];

export async function staffManagementPage(ctx, view) {
  const head = h('div', { class: 'page-head' }, h('div', h('h1', L('Staff & Departments')), h('p', L('Assign staff members to their offices and manage department leadership.'))));
  const actions = h('div', { class: 'actions', style: { marginBottom: '1rem' } });
  const seed = h('button', { class: 'btn', onclick: async () => { try { const r = await post('/staff/departments/seed-defaults'); toast(L('{n} departments added', { n: r.created })); await refresh(); } catch (e) { fail(e); } } }, svgIcon('plus', 18), ' ' + L(L('Create default departments')));
  actions.append(seed);
  const summary = h('div', { class: 'grid grid-3', style: { marginBottom: '1rem' } });
  const deptBox = h('section', { class: 'card' });
  const staffBox = h('section', { class: 'card' });
  const accessBox = h('section', { class: 'card', style: { marginBottom: '1rem' } });
  async function refresh() {
    summary.replaceChildren(spinner()); deptBox.replaceChildren(spinner()); staffBox.replaceChildren(spinner());
    const [d, s] = await Promise.all([get('/staff/departments'), get('/staff/directory')]);
    const depts = d.departments || [], staff = s.staff || [];
    summary.replaceChildren(
      h('div', { class: 'stat stat-blue' }, svgIcon('students', 30), h('div', h('div', { class: 'num' }, staff.length), h('div', { class: 'lbl' }, L('Staff accounts')))),
      h('div', { class: 'stat stat-green' }, svgIcon('classes', 30), h('div', h('div', { class: 'num' }, depts.filter(x => x.active).length), h('div', { class: 'lbl' }, L('Active departments')))),
      h('div', { class: 'stat stat-gold' }, svgIcon('check', 30), h('div', h('div', { class: 'num' }, staff.filter(x => x.assignment_id && x.assignment_active).length), h('div', { class: 'lbl' }, L('Assigned staff'))))
    );
    deptBox.replaceChildren(h('div', { class: 'section-head' }, h('h2', L('Departments')), h('button', { class: 'btn btn-sm btn-primary', onclick: () => departmentForm(null, refresh) }, svgIcon('plus', 16), ' ' + L(L('Add department')))),
      depts.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', L('Department')), h('th', L('Head')), h('th', L('Status')), h('th', ''))), h('tbody', depts.map(dep => h('tr',
        h('td', { 'data-label': L('Department') }, h('strong', L(dep.name)), dep.description ? h('div', { class: 'small muted' }, dep.description) : null),
        h('td', { 'data-label': L('Head') }, dep.head_name || L('Not assigned')),
        h('td', { 'data-label': L('Status') }, dep.active ? badge(L('Active'), 'green') : badge(L('Inactive'))),
        h('td', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm', onclick: () => departmentForm(dep, refresh) }, L('Edit')))
      ))))) : empty(L('No departments yet'), L('Create the standard departments to begin.')));
    staffBox.replaceChildren(h('div', { class: 'section-head' }, h('h2', L('Staff directory')), h('span', { class: 'muted small' }, L('Teacher accounts with office assignments'))),
      staff.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', L('Staff member')), h('th', L('Position')), h('th', L('Department')), h('th', L('Status')), h('th', ''))), h('tbody', staff.map(person => h('tr',
        h('td', { 'data-label': L('Staff member') }, h('strong', person.name), h('div', { class: 'small muted' }, person.email)),
        h('td', { 'data-label': L('Position') }, person.position_title ? L(person.position_title) : L('Not assigned')),
        h('td', { 'data-label': L('Department') }, person.department_name ? L(person.department_name) : L('Not assigned')),
        h('td', { 'data-label': L('Status') }, person.assignment_id ? (person.assignment_active ? badge(L('Assigned'), 'green') : badge(L('Inactive'))) : badge(L('Unassigned'), 'gold')),
        h('td', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm btn-primary', onclick: () => assignmentForm(person, depts, refresh) }, person.assignment_id ? L('Edit assignment') : L('Assign office')), h('button', { class: 'btn btn-sm', onclick: () => permissionsForm(person, refresh) }, L('Permissions')))
      ))))) : empty(L('No staff accounts found'), L('Create teacher/staff accounts first in the existing user management area.')));
  }
  view.replaceChildren(head, actions, summary, accessBox, deptBox, staffBox);
  loadAccess(accessBox);
  try { await refresh(); } catch (e) { view.replaceChildren(head, h('div', { class: 'empty error-box' }, L('Could not load staff management. '), e.message || '')); }
}

function departmentForm(dep, done) {
  const name = input({ value: dep?.name || '', maxlength: 100 });
  const description = input({ value: dep?.description || '', maxlength: 500 });
  const active = h('input', { type: 'checkbox', checked: dep ? !!dep.active : true });
  modal({ title: dep ? L('Edit department') : L('Add department'), body: h('form', { onsubmit: e => e.preventDefault() }, field(L('Department name'), name, { required: true }), field(L('Description'), description), h('label', { class: 'check-row' }, active, ' ' + L(L('Active department')))),
    actions: [{ label: L('Cancel'), class: 'btn-ghost', onclick: close => close() }, { label: L('Save'), class: 'btn-primary', onclick: async close => { try { const body = { name: name.value.trim(), description: description.value.trim(), active: active.checked }; if (dep) await put(`/staff/departments/${dep.id}`, body); else await post('/staff/departments', body); toast('Department saved'); close(); done(); } catch (e) { fail(e); } } }] });
}
function assignmentForm(person, departments, done) {
  const position = select(DEFAULT_POSITIONS.map(x => [x, L(x)]), person.position_title || L('Other'), { });
  const dept = select([['', L('No department')], ...departments.filter(x => x.active).map(x => [String(x.id), L(x.name)])], person.department_id || '');
  const head = h('input', { type: 'checkbox', checked: !!person.is_department_head });
  const active = h('input', { type: 'checkbox', checked: person.assignment_id ? !!person.assignment_active : true });
  modal({ title: `${L('Assign office')} — ${person.name}`, body: h('form', { onsubmit: e => e.preventDefault() }, h('p', { class: 'muted small' }, `${person.email} · ${L('Existing login role: Teacher')}`), field(L('Official position'), position, { required: true }), field(L('Department'), dept), h('label', { class: 'check-row' }, head, ' ' + L(L('Department head'))), h('label', { class: 'check-row' }, active, ' ' + L(L('Assignment active'))), h('p', { class: 'notice notice-blue small' }, L('This assigns office information only. It does not grant new application permissions or change the staff member’s login role.'))),
    actions: [{ label: L('Cancel'), class: 'btn-ghost', onclick: close => close() }, { label: L('Save assignment'), class: 'btn-primary', onclick: async close => { try { await put(`/staff/${person.id}/assignment`, { position_title: position.value, department_id: dept.value || null, is_department_head: head.checked, active: active.checked }); toast(L('Staff assignment saved')); close(); done(); } catch (e) { fail(e); } } }] });
}


async function permissionsForm(person, done) {
  try {
    const data = await get(`/staff/${person.id}/permissions`);
    const labels = {
      manage_discipline: L('Manage discipline incidents and cases'),
      council_member: L('Participate in disciplinary council'),
      approve_decisions: L('Approve disciplinary decisions')
    };
    const checks = Object.entries(labels).map(([key, label]) => {
      const box = h('input', { type: 'checkbox', checked: (data.permissions || []).includes(key) });
      return { key, box, row: h('label', { class: 'check-row' }, box, ` ${L(label)}`) };
    });
    modal({ title: `${L('Permissions')} — ${person.name}`, body: h('div',
      h('p', { class: 'muted small' }, L('These are additional discipline permissions. Incident reporting remains available to teachers under the existing policy.')),
      ...checks.map(x => x.row),
      h('p', { class: 'notice notice-blue small' }, L('Only the School Administrator can change these permissions. Changes are recorded in the audit log.'))),
      actions: [
        { label: L('Cancel'), class: 'btn-ghost', onclick: close => close() },
        { label: L('Save permissions'), class: 'btn-primary', onclick: async close => {
          try { await put(`/staff/${person.id}/permissions`, { permissions: checks.filter(x => x.box.checked).map(x => x.key) }); toast(L('Permissions updated')); close(); done(); }
          catch (e) { fail(e); }
        } }
      ]
    });
  } catch (e) { fail(e); }
}

export async function officeDashboardPage(ctx, view) {
  const root = h('div', { class: 'stack' }, spinner());
  view.replaceChildren(root);
  try {
    const data = await get('/staff/my-office');
    const a = data.assignment || {};
    const allLinks = [
      [L('Discipline Office'), L('Discipline'), '#/discipline'],
      [L('Academic Office'), L('Classes and subjects'), '#/classes'],
      [L('Examinations Office'), L('Grades and reports'), '#/grades'],
      [L('Student Affairs'), L('Students and school life'), '#/students'],
      [L('Guidance and Counselling'), L('Student records and follow-up'), '#/students'],
      [L('Admissions Office'), L('Student registration'), '#/students'],
      [L('School Administration'), L('School overview'), '#/overview']
    ];
    const HASH_MODULE = { '#/discipline': 'discipline', '#/classes': 'teaching', '#/grades': 'teaching', '#/students': 'students' };
    const allowed = Array.isArray(data.modules) ? data.modules : null; // only offer modules the server will let this person open
    const links = allLinks.filter(x => !allowed || !HASH_MODULE[x[2]] || allowed.includes(HASH_MODULE[x[2]]));
    const match = links.find(x => (a.department_name || data.office || '').toLowerCase().includes(x[0].toLowerCase())) || links.find(x => x[0] === L('School Administration'));
    const cards = [match, ...links.filter(x => x !== match && x[0] !== L('School Administration'))].map(x =>
      h('a', { class: 'card', href: x[2], style: { display: 'block', textDecoration: 'none' } }, h('strong', L(x[1])), h('div', { class: 'small muted' }, L(x[0]))));
    root.replaceChildren(
      h('div', { class: 'page-head' }, h('div', h('h1', L('My Office')), h('p', L('Your assigned school office and the modules available to your existing account permissions.')))),
      h('section', { class: 'card' }, h('h2', a.position_title ? L(a.position_title) : L('School Administrator')), h('p', { class: 'muted' }, (a.department_name || data.office) ? L(a.department_name || data.office) : L('No department assigned')), a.is_department_head ? badge(L('Department head'), 'green') : null,
        h('p', { class: 'small muted' }, L('Your office assignment organises your work. Access to sensitive actions is still controlled by the existing server-side permissions.'))),
      h('div', { class: 'grid grid-3' }, ...cards)
    );
  } catch (e) { root.replaceChildren(h('div', { class: 'empty error-box' }, L('Could not load your office dashboard. '), e.message || '')); }
}

// ---- Department access: switch + the modules each department may use ----
async function loadAccess(box) {
  box.replaceChildren(spinner());
  try {
    const a = await get('/staff/access-settings');
    const sw = h('input', { type: 'checkbox', checked: !!a.enforce, onchange: async () => {
      try { await put('/staff/access-settings', { enforce: sw.checked }); toast(t(sw.checked ? 'da.enabled' : 'da.disabled')); loadAccess(box); } catch (e) { sw.checked = !sw.checked; fail(e); }
    } });
    const names = (mods) => mods.length ? mods.map(m => t(`da.mod.${m}`)).join(' · ') : t('da.none');
    box.replaceChildren(
      h('div', { class: 'section-head' }, h('h2', t('da.title'))),
      h('p', { class: 'muted small' }, t('da.intro')),
      h('label', { class: 'check-row' }, sw, ' ', h('strong', t('da.enforce'))),
      h('p', { class: a.enforce ? 'notice notice-blue small' : 'muted small' }, t(a.enforce ? 'da.on_note' : 'da.off_note')),
      a.departments.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' }, h('thead', h('tr', h('th', t('staff.department') === 'staff.department' ? L('Department') : t('staff.department')), h('th', t('da.modules')), h('th', ''))),
        h('tbody', a.departments.filter(d => d.active).map(d => h('tr',
          h('td', { 'data-label': L('Department') }, h('strong', L(d.name)), ' ', badge(t(d.custom ? 'da.custom' : 'da.standard'), d.custom ? 'gold' : 'neutral')),
          h('td', { 'data-label': t('da.modules'), class: 'small' }, names(d.modules)),
          h('td', { class: 'actions-cell' }, h('button', { class: 'btn btn-sm', onclick: () => accessForm(d, a.all_modules, () => loadAccess(box)) }, t('da.edit')))
        )))) ) : null
    );
  } catch (e) { box.replaceChildren(h('div', { class: 'empty error-box' }, e.message || '')); }
}
function accessForm(dep, all, done) {
  const boxes = all.map(m => ({ m, el: h('input', { type: 'checkbox', checked: dep.modules.includes(m) }) }));
  modal({ title: t('da.edit_title', { name: L(dep.name) }), body: h('div', ...boxes.map(x => h('label', { class: 'check-row' }, x.el, ' ', t(`da.mod.${x.m}`)))),
    actions: [
      { label: t('da.reset'), class: 'btn-ghost', onclick: async close => { try { await put(`/staff/departments/${dep.id}/modules`, { modules: null }); toast(t('da.saved')); close(); done(); } catch (e) { fail(e); } } },
      { label: t('common.save') === 'common.save' ? L('Save') : t('common.save'), class: 'btn-primary', onclick: async close => { try { await put(`/staff/departments/${dep.id}/modules`, { modules: boxes.filter(x => x.el.checked).map(x => x.m) }); toast(t('da.saved')); close(); done(); } catch (e) { fail(e); } } }
    ] });
}
