// Prefects: board of prefects per academic year, appointments (administrator) and the list of posts.
import { state, t, h, get, post, put, load, field, input, select, toast, fail, modal, badge, empty, confirmDialog, avatar, fmtDate } from './ui.js';
import './i18n-prefects.js';

const nm = (x) => (state.lang === 'fr' ? x.name_fr : x.name_en);
const postName = (r) => (state.lang === 'fr' ? r.post_fr : r.post_en);

export async function prefectsPage(ctx, view) {
  const isAdmin = state.user.role === 'school_admin';
  const tabs = isAdmin ? ['board', 'posts'] : ['board'];
  let tab = 'board';
  const panel = h('div', { role: 'tabpanel' });
  const bar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map((k) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => {
    tab = k; bar.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(tabs[i] === k))); draw(); } }, t(`pf.tab_${k}`))));
  const draw = () => { panel.replaceChildren(); (tab === 'posts' ? postsTab : boardTab)(panel, isAdmin); };
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('nav.prefects')), h('p', t('pf.subtitle')))), h('div', { class: 'notice' }, t('pf.rule')), isAdmin ? bar : null, panel);
  draw();
}

function boardTab(panel, isAdmin) {
  let yearId = '';
  const draw = () => load(panel, async () => ({ years: await get('/academic-years'), data: await get(`/prefects${yearId ? `?year_id=${yearId}` : ''}`) }), ({ years, data }) => {
    if (!yearId && data.year) yearId = String(data.year.id);
    const yearSel = select(years.map((y) => [y.id, y.name]), yearId, { 'aria-label': t('pf.year'), onchange: (e) => { yearId = e.target.value; draw(); } });
    const rows = data.rows;
    const groups = new Map();
    for (const r of rows) { if (!groups.has(r.post_id)) groups.set(r.post_id, []); groups.get(r.post_id).push(r); }
    return h('div',
      h('div', { class: 'actions', style: { display: 'flex', gap: '.75rem', alignItems: 'end', flexWrap: 'wrap', marginBottom: '1rem' } },
        field(t('pf.year'), yearSel),
        isAdmin && data.year ? h('button', { class: 'btn btn-primary', onclick: () => appoint(data.year.id, draw) }, t('pf.appoint')) : null),
      rows.length ? [...groups.values()].map((list) => h('section', { class: 'card', style: { marginBottom: '1rem' } }, h('h2', { class: 'prefect-post-title' }, postName(list[0])),
        h('div', { class: 'grid grid-cards' }, list.map((r) => h('article', { class: `card s-card prefect-card${r.status === 'ended' ? ' is-ended' : ''}`, style: { opacity: r.status === 'ended' ? 0.7 : 1 } },
          isAdmin ? avatar(r.name, r.photo) : null, h('h3', r.name), h('div', { class: 'meta' }, r.class_label || ''),
          r.status === 'ended' ? h('div', badge(t('pf.ended'), 'neutral'), ' ', h('span', { class: 'small muted' }, [r.ended_on ? t('pf.ended_on', { d: fmtDate(r.ended_on) }) : '', r.ended_reason === 'no_longer_eligible' ? t('pf.reason_no_longer_eligible') : ''].filter(Boolean).join(' · '))) : null,
          isAdmin ? h('div', { style: { marginTop: '.5rem' } }, r.status === 'ended'
            ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => act(r, 'restore', draw) }, t('pf.restore'))
            : h('button', { class: 'btn btn-sm btn-ghost', onclick: () => act(r, 'end', draw) }, t('pf.end'))) : null))))) : empty(t('pf.none')));
  });
  draw();
}

async function act(r, action, redraw) {
  try {
    if (action === 'end' && !await confirmDialog(t('pf.end_confirm'), t('common.confirm'), true)) return;
    await put(`/prefects/${r.id}`, { action }); redraw();
  } catch (e) { fail(e); }
}

async function appoint(yearId, redraw) {
  let posts = [];
  try { posts = await get('/prefects/posts'); } catch (e) { return fail(e); }
  const q = input({ placeholder: t('pf.search_student'), maxlength: 80, 'aria-label': t('pf.search_student') });
  const list = h('div', { style: { maxHeight: '14rem', overflowY: 'auto', margin: '.5rem 0' } });
  const postSel = select([['', t('pf.choose_post')], ...posts.map((p) => [p.id, nm(p)])], '');
  let chosen = null;
  const paint = (rows) => {
    list.replaceChildren(...(rows.length ? rows.map((s) => h('button', { type: 'button', class: 'btn btn-ghost', style: { display: 'flex', gap: '.6rem', alignItems: 'center', width: '100%', textAlign: 'left', background: chosen === s.id ? 'var(--gold-soft, #fff3cd)' : '' },
      onclick: () => { chosen = s.id; paint(rows); } }, avatar(s.name, s.photo, 'sm'), h('span', h('strong', s.name), h('br'), h('span', { class: 'small muted' }, `${s.code} · ${s.class_label}`)))) : [h('p', { class: 'muted' }, t('pf.no_eligible'))]));
  };
  const search = async () => { try { paint(await get(`/prefects/eligible?q=${encodeURIComponent(q.value)}`)); } catch (e) { fail(e); } };
  let timer; q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  modal({ title: t('pf.appoint'), body: h('div', field(t('pf.student'), q), list, field(t('pf.post'), postSel)),
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
      if (!chosen) return toast(t('pf.choose_student'), 'error');
      if (!postSel.value) return toast(t('pf.choose_post'), 'error');
      try { await post('/prefects', { student_id: chosen, post_id: Number(postSel.value), year_id: yearId }); c(); toast(t('pf.appointed')); redraw(); } catch (e) { fail(e); } } }] });
  search();
}

function postsTab(panel) {
  const edit = (row, redraw) => {
    const en = input({ value: row ? row.name_en : '', maxlength: 120 }), fr = input({ value: row ? row.name_fr : '', maxlength: 120 });
    modal({ title: row ? t('common.edit') : t('common.add'), body: h('div', field('English', en, { required: true }), field('Français', fr, { required: true })),
      actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('common.save'), class: 'btn-primary', onclick: async (c) => {
        const data = { name_en: en.value, name_fr: fr.value };
        try { if (row) await put(`/prefects/posts/${row.id}`, data); else await post('/prefects/posts', data); c(); redraw(); } catch (e) { fail(e); } } }] });
  };
  const draw = () => load(panel, () => get('/prefects/posts?all=1'), (rows) => h('section', { class: 'card' }, h('h2', t('pf.tab_posts')), h('p', { class: 'small muted' }, t('pf.posts_hint')),
    rows.map((r) => h('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--line)', padding: '.5rem 0', opacity: r.active ? 1 : 0.55 } },
      h('strong', { style: { flex: '1 1 10rem' } }, nm(r)), !r.active ? badge(t('pf.off'), 'neutral') : null,
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => edit(r, draw) }, t('common.edit')),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { try { await put(`/prefects/posts/${r.id}`, { active: !r.active }); draw(); } catch (e) { fail(e); } } }, r.active ? t('pf.switch_off') : t('pf.switch_on')))),
    h('button', { class: 'btn btn-primary', style: { marginTop: '.8rem' }, onclick: () => edit(null, draw) }, t('common.add'))));
  draw();
}
