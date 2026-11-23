// School Shop: a public PRODUCT CATALOGUE only. No cart, no orders, no online payment.
import { state, t, h, get, qs, load, input, select, field, modal, badge, fcfa, svgIcon, empty, spinner, errorBox } from './ui.js';

export const CATEGORIES = ['textbooks', 'notebooks', 'reading_books', 'school_supplies', 'school_uniforms'];
const availKind = { in_stock: 'green', low_stock: 'gold', out_of_stock: 'red' };

export function productCard(p) {
  return h('article', { class: 'card product' },
    h('div', { class: 'img' }, p.image ? h('img', { src: p.image, alt: p.name, loading: 'lazy' }) : svgIcon('products', 44)),
    h('div', { class: 'body' }, h('h3', p.name), badge(t(`cat.${p.category}`), 'blue'),
      p.class_level ? h('small', { class: 'muted' }, `${t('shop.class_level')}: ${p.class_level}`) : null,
      p.description ? h('p', { class: 'small muted' }, p.description.length > 90 ? p.description.slice(0, 90) + '…' : p.description) : null,
      h('div', { class: 'row' }, h('span', { class: 'price' }, fcfa(p.price)), badge(t(`avail.${p.availability}`), availKind[p.availability])),
      h('button', { class: 'btn btn-sm', onclick: () => productDetail(p) }, t('shop.details'))));
}
function productDetail(p) {
  modal({ title: p.name, body: h('div', p.image ? h('img', { src: p.image, alt: p.name, style: { width: '100%', maxHeight: '260px', objectFit: 'cover', borderRadius: '12px', marginBottom: '.75rem' } }) : null,
    h('dl', { class: 'dl' }, h('dt', t('shop.category')), h('dd', t(`cat.${p.category}`)), p.class_level ? [h('dt', t('shop.class_level')), h('dd', p.class_level)] : null,
      p.variant ? [h('dt', t('shop.variant')), h('dd', p.variant)] : null, h('dt', t('shop.price')), h('dd', h('strong', fcfa(p.price))),
      h('dt', t('shop.availability')), h('dd', badge(t(`avail.${p.availability}`), availKind[p.availability]))),
    p.description ? h('p', { style: { marginTop: '.75rem' } }, p.description) : null,
    h('div', { class: 'notice notice-blue' }, t('shop.in_person'))), actions: [{ label: t('common.close'), class: 'btn-primary', onclick: (c) => c() }] });
}

// slug: the school whose catalogue to show. Works for visitors and signed-in users (same public data).
export function catalogue(slug) {
  const root = h('div'); const grid = h('div'); let info = null;
  const q = input({ type: 'search', placeholder: t('shop.search'), 'aria-label': t('shop.search') });
  const cat = select([['', t('shop.all_categories')], ...CATEGORIES.map((c) => [c, t(`cat.${c}`)])], '', { 'aria-label': t('shop.category') });
  const lvl = input({ type: 'text', placeholder: t('shop.class_level'), 'aria-label': t('shop.class_level') });
  let timer; const refresh = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
  q.addEventListener('input', refresh); lvl.addEventListener('input', refresh); cat.addEventListener('change', run);
  async function run() {
    await load(grid, () => get(`/public/shop/${encodeURIComponent(slug)}/products${qs({ q: q.value, category: cat.value, class_level: lvl.value.trim() })}`), (list) =>
      list.length ? h('div', { class: 'grid grid-cards' }, list.map(productCard)) : empty(t('shop.empty_title'), t('shop.empty_text')));
  }
  (async () => {
    root.replaceChildren(spinner());
    try {
      info = await get(`/public/shop/${encodeURIComponent(slug)}`);
      const s = info.school;
      root.replaceChildren(
        h('div', { class: 'hero-shop' }, h('h1', `${t('nav.shop')} — ${s.name}`), h('p', t('shop.catalogue_only'))),
        h('div', { class: 'notice notice-blue' }, h('strong', t('shop.how_to_buy')), h('p', { style: { margin: '.25rem 0 0' } }, t('shop.in_person')),
          s.shop_hours ? h('p', { style: { margin: '.25rem 0 0' } }, `${t('shop.hours')}: ${s.shop_hours}`) : null,
          s.shop_instructions ? h('p', { style: { margin: '.25rem 0 0', whiteSpace: 'pre-wrap' } }, s.shop_instructions) : null,
          s.address || s.phone ? h('p', { class: 'small', style: { margin: '.25rem 0 0' } }, [s.address, s.phone].filter(Boolean).join(' · ')) : null),
        h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, field(t('common.search'), q)), h('div', field(t('shop.category'), cat)), h('div', field(t('shop.class_level'), lvl))), grid);
      run();
    } catch (e) { root.replaceChildren(errorBox(e)); }
  })();
  return root;
}

export function shopPage(ctx, view) {
  view.replaceChildren(catalogue(state.school.slug));
}
