// Shared UI toolkit: safe DOM builder, API client, router, dialogs, language.
import { DICT } from './i18n.js';

const savedLang = localStorage.getItem('jao_lang');
const browserLang = (navigator.language || 'en').slice(0, 2) === 'fr' ? 'fr' : 'en';
export const state = { user: null, school: null, csrf: '', lang: ['en', 'fr'].includes(savedLang) ? savedLang : browserLang, dirty: false };
document.documentElement.lang = state.lang;

// ---------- translation ----------
export function t(key, vars) {
  let s = (DICT[state.lang] && DICT[state.lang][key]) ?? DICT.en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}
export const errText = (code) => (DICT[state.lang][`err.${code}`] ?? DICT.en[`err.${code}`] ?? t('err.generic'));

// ---------- DOM builder (never uses innerHTML, so data can never become markup) ----------
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs !== undefined && attrs !== null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}
export const svgIcon = (name, size = 20) => {
  const paths = {
    overview: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', students: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0',
    classes: 'M3 5h18v4H3zM3 11h18v4H3zM3 17h18v3H3z', subjects: 'M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM8 8h8M8 12h8',
    grades: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h3', reports: 'M4 20V10M10 20V4M16 20v-8M22 20H2', shop: 'M3 4h2l2.5 11h11L21 7H6M9 20a1 1 0 1 0 0 .01M17 20a1 1 0 1 0 0 .01',
    products: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z',
    chat: 'M4 5h16v11H9l-5 4z', robot: 'M12 3v3M8 6h8a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM2 12v3M22 12v3M9 11v1.5M15 11v1.5M9 16h6', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4', menu: 'M3 6h18M3 12h18M3 18h18', plus: 'M12 5v14M5 12h14',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', sound: 'M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 0 1 0 8', mute: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6',
    discipline: 'M12 3v18M6 21h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
    prefects: 'M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM8.5 12.5L7 21l5-3 5 3-1.5-8.5',
    scholarship: 'M12 3l2.7 5.5 6 .9-4.4 4.2 1 6L12 16.8 6.7 19.6l1-6L3.3 9.4l6-.9z',
    platform: 'M12 2l9 5v6c0 5-4 8-9 9-5-1-9-4-9-9V7z', check: 'M5 12l5 5 9-10', close: 'M6 6l12 12M18 6L6 18',
  };
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', paths[name] || paths.overview); s.appendChild(p);
  return s;
};
export const logoMark = (size = 40) => {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  for (const [d, f] of [['M32 12 6 25l26 13 26-13z', '#f2b705'], ['M17 33v11c0 4 7 8 15 8s15-4 15-8V33l-15 7z', '#ffffff'], ['M56 27v14', '#f2b705']]) {
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', f); if (f === '#f2b705' && d.startsWith('M56')) { p.setAttribute('stroke', f); p.setAttribute('stroke-width', '3'); } s.appendChild(p);
  }
  return s;
};
// opts.school = the signed-in school: when it has a logo, that logo is shown beside "JAO" instead of the generic mark.
export const brand = (opts = {}) => h('div', { class: 'brand' + (opts.light ? ' brand-light' : '') }, opts.school && opts.school.logo
    ? h('img', { class: 'brand-school-logo', src: opts.school.logo, alt: opts.school.name || '', style: { width: `${opts.size || 38}px`, height: `${opts.size || 38}px` }, onerror: (e) => e.target.replaceWith(logoMark(opts.size || 38)) })
    : logoMark(opts.size || 38),
  h('div', { class: 'brand-text' }, h('strong', 'JAO'), opts.sub === false ? null : h('small', t('brand.sub'))));

// ---------- API ----------
export class ApiError extends Error { constructor(status, code, data) { super(code); this.status = status; this.code = code; this.data = data; } }
export async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
  let res;
  try { res = await fetch('/api' + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' }); }
  catch { throw new ApiError(0, 'network', {}); }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; state.csrf = ''; navigate('#/start'); }
    throw new ApiError(res.status, (data && data.error) || 'server_error', data || {});
  }
  return data;
}
export const get = (u) => api('GET', u); export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}) => api('PUT', u, b); export const del = (u) => api('DELETE', u);
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

// ---------- notices ----------
export function toast(msg, kind = 'ok') {
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}
export const fail = (e) => toast(e instanceof ApiError ? (e.code === 'score_out_of_range' && e.data.max ? t('err.score_out_of_range', { max: e.data.max }) : errText(e.code)) : t('err.generic'), 'error');

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const prevFocus = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); prevFocus && prevFocus.focus && prevFocus.focus(); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal' + (wide ? ' modal-wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', title), h('button', { class: 'icon-btn', 'aria-label': t('common.close'), onclick: close }, svgIcon('close'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { class: `btn ${a.class || ''}`, type: 'button', onclick: () => a.onclick(close) }, a.label))) : null);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  const first = box.querySelector('input,select,textarea,button.btn');
  (first || box).focus && (first || box).focus();
  return close;
}
export const confirmDialog = (message, confirmLabel = t('common.confirm'), danger = true) => new Promise((resolve) => {
  let answered = false;
  modal({ title: t('common.please_confirm'), body: h('p', message),
    onClose: () => { if (!answered) resolve(false); },
    actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => { answered = true; c(); resolve(false); } },
      { label: confirmLabel, class: danger ? 'btn-danger' : 'btn-primary', onclick: (c) => { answered = true; c(); resolve(true); } }] });
});
export function showSecret(title, lines) {
  return modal({ title, body: h('div', h('p', { class: 'muted' }, t('secret.once')), h('dl', { class: 'secret' }, lines.flatMap(([k, v]) => [h('dt', k), h('dd', h('code', v))]))),
    actions: [{ label: t('common.copy'), class: 'btn-ghost', onclick: () => navigator.clipboard && navigator.clipboard.writeText(lines.map(([k, v]) => `${k}: ${v}`).join('\n')).then(() => toast(t('common.copied'))) },
      { label: t('common.close'), class: 'btn-primary', onclick: (c) => c() }] });
}

// ---------- form helpers ----------
export function field(label, input, { hint, required, error } = {}) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  if (required) input.setAttribute('aria-required', 'true');
  return h('div', { class: 'field' }, h('label', { for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : h('span', { class: 'opt' }, ` (${t('common.optional')})`)),
    input, hint ? h('small', { class: 'hint' }, hint) : null, error ? h('small', { class: 'error-text' }, error) : null);
}
export const input = (a = {}) => h('input', { type: 'text', ...a });
export const select = (options, value, a = {}) => h('select', a, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
export const textarea = (a = {}) => h('textarea', { rows: 3, ...a });
export const spinner = () => h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spin' }), t('common.loading'));
export const empty = (title, text, action) => h('div', { class: 'empty' }, h('h3', title), text ? h('p', text) : null, action || null);
export const errorBox = (e, retry) => h('div', { class: 'empty error-box', role: 'alert' }, h('h3', t('common.error_title')), h('p', e instanceof ApiError ? errText(e.code) : t('err.generic')),
  retry ? h('button', { class: 'btn btn-primary', onclick: retry }, t('common.retry')) : null);

// Run a loader into a container with loading / error states.
export async function load(container, fn, render) {
  container.replaceChildren(spinner());
  try { const data = await fn(); container.replaceChildren(render(data)); }
  catch (e) { container.replaceChildren(errorBox(e, () => load(container, fn, render))); }
}
export const badge = (text, kind = 'neutral') => h('span', { class: `badge badge-${kind}` }, text);
export const statusBadge = (s) => badge(t(`status.${s}`), { active: 'green', transferred: 'gold', graduated: 'blue' }[s] || 'neutral');
export const avatar = (name, photo, size = 'md') => photo ? h('img', { class: `avatar avatar-${size}`, src: photo, alt: '' }) : h('div', { class: `avatar avatar-${size} avatar-fallback`, 'aria-hidden': 'true' }, name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());

export const fcfa = (n) => `${new Intl.NumberFormat(state.lang === 'fr' ? 'fr-FR' : 'en-US').format(n)} FCFA`;
export function fmtDate(s) {
  if (!s) return '—';
  const d = String(s).slice(0, 10).split('-'); if (d.length !== 3) return s;
  const f = (state.school && state.school.date_format) || 'DD/MM/YYYY';
  return f === 'YYYY-MM-DD' ? `${d[0]}-${d[1]}-${d[2]}` : f === 'MM/DD/YYYY' ? `${d[1]}/${d[2]}/${d[0]}` : `${d[2]}/${d[1]}/${d[0]}`;
}
export const fmtDateTime = (s) => (s ? `${fmtDate(s)} ${String(s).slice(11, 16)}` : '—');
export const fmtNum = (n) => (n == null ? '—' : new Intl.NumberFormat(state.lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 }).format(n));

export function readImage(file) { // validates type and size in the browser (the server checks again)
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return reject(new ApiError(400, 'invalid_image_type', {}));
    if (file.size > 2 * 1024 * 1024) return reject(new ApiError(400, 'image_too_large', {}));
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new ApiError(400, 'invalid_image', {})); r.readAsDataURL(file);
  });
}

// ---------- router ----------
const routes = [];
export const defineRoute = (pattern, handler, opts = {}) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, handler, opts });
};
export const navigate = (hash) => { if (location.hash === hash) renderRoute(); else location.hash = hash; };
export async function renderRoute() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  for (const r of routes) {
    const m = r.re.exec(path); if (!m) continue;
    const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    state.dirty = false;
    return r.handler({ params, query, path });
  }
  navigate('#/');
}
// Warn before leaving a form with unsaved changes.
let lastHash = location.hash;
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', (e) => {
  if (state.dirty && !confirm(t('common.unsaved'))) { history.replaceState(null, '', lastHash || '#/'); return; }
  state.dirty = false; lastHash = location.hash; renderRoute();
});
export const setLastHash = () => { lastHash = location.hash; };

export async function setLang(l) {
  state.lang = l; localStorage.setItem('jao_lang', l); document.documentElement.lang = l;
  if (state.user) post('/auth/language', { language: l }).catch(() => {});
  document.dispatchEvent(new CustomEvent('langchange'));
}
export const langSwitch = () => h('div', { class: 'lang-switch', role: 'group', 'aria-label': t('common.language') },
  ['en', 'fr'].map((l) => h('button', { class: state.lang === l ? 'on' : '', 'aria-pressed': String(state.lang === l), onclick: () => setLang(l) }, l.toUpperCase())));
