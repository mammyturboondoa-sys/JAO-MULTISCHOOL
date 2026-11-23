// DOUDOUS²: floating chat button + panel. Answers come from the server (approved knowledge only).
import { state, t, h, get, post, del, svgIcon, toast, ApiError, errText } from './ui.js';

export function mountDudus(host, { mode, slug }) {
  if (!host) return;
  let panel = null, aiConfigured = false;
  const fab = h('button', { class: 'chat-fab', 'aria-label': t('dudus.open'), 'aria-expanded': 'false', onclick: toggle }, svgIcon('robot', 32));
  host.replaceChildren(fab);

  function bubble(role, text) { return h('div', { class: `msg ${role === 'user' ? 'user' : 'bot'}` }, text); }

  async function toggle() {
    if (panel) { panel.remove(); panel = null; fab.setAttribute('aria-expanded', 'false'); return; }
    fab.setAttribute('aria-expanded', 'true');
    const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
    const msg = h('input', { type: 'text', maxlength: '1000', placeholder: t('dudus.placeholder'), 'aria-label': t('dudus.placeholder') });
    const send = h('button', { class: 'btn btn-primary', type: 'submit' }, t('dudus.send'));
    const status = h('div', { class: 'chat-note' });
    const clear = h('button', { class: 'icon-btn', style: { color: '#fff', width: '36px', height: '36px' }, title: t('dudus.clear'), 'aria-label': t('dudus.clear'), hidden: mode !== 'private', onclick: async () => {
      try { await del('/dudus/history'); log.replaceChildren(greeting()); } catch { toast(t('err.generic'), 'error'); } } }, svgIcon('close', 18));
    const greeting = () => h('div', { class: 'msg bot' }, t('dudus.greeting'), mode === 'private' ? '' : '');
    const chips = h('div', { style: { display: 'flex', gap: '.4rem', flexWrap: 'wrap', padding: '0 .9rem .6rem', background: 'var(--bg)' } },
      (mode === 'public' ? ['dudus.q_shop', 'dudus.q_hist'] : state.user && state.user.role === 'school_admin' ? ['dudus.q_register', 'dudus.q_grades', 'dudus.q_hist'] : ['dudus.q_report', 'dudus.q_shop', 'dudus.q_hist'])
        .map((k) => h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ask(t(k)) }, t(k))));
    async function ask(text, retryNode) {
      text = text.trim(); if (!text) return;
      if (!retryNode) log.append(bubble('user', text));
      msg.value = ''; send.disabled = true;
      const wait = h('div', { class: 'msg bot', 'aria-busy': 'true' }, t('dudus.thinking'));
      log.append(wait); log.scrollTop = log.scrollHeight;
      try {
        const r = mode === 'public' ? await post(`/public/dudus/${encodeURIComponent(slug)}`, { message: text, language: state.lang }) : await post('/dudus/chat', { message: text, language: state.lang });
        wait.replaceWith(bubble('bot', r.text));
      } catch (e) {
        const text2 = e instanceof ApiError ? (e.status === 429 ? t('err.too_many_attempts') : errText(e.code)) : t('err.generic');
        wait.replaceWith(h('div', { class: 'msg bot' }, text2, h('div', h('button', { class: 'btn btn-sm', style: { marginTop: '.4rem' }, onclick: (ev) => { ev.target.closest('.msg').remove(); ask(text, true); } }, t('common.retry')))));
      }
      send.disabled = false; log.scrollTop = log.scrollHeight; msg.focus();
    }
    panel = h('section', { class: 'chat', 'aria-label': 'DOUDOUS²' },
      h('div', { class: 'chat-head' }, svgIcon('robot', 24), h('strong', 'DOUDOUS²'), clear, h('button', { class: 'icon-btn', style: { color: '#fff', width: '36px', height: '36px' }, 'aria-label': t('common.close'), onclick: toggle }, svgIcon('close', 18))),
      log, chips, h('form', { class: 'chat-form', onsubmit: (e) => { e.preventDefault(); ask(msg.value); } }, msg, send),
      status, h('div', { class: 'chat-note' }, t('dudus.disclaimer')));
    host.append(panel);
    log.append(greeting());
    msg.focus();
    if (mode === 'private') {
      try {
        const [hist, st] = await Promise.all([get('/dudus/history'), get('/dudus/status')]);
        aiConfigured = st.ai_configured;
        hist.forEach((m) => log.append(bubble(m.role, m.content)));
        log.scrollTop = log.scrollHeight;
      } catch { /* history is optional */ }
      status.textContent = aiConfigured ? t('dudus.mode_ai') : t('dudus.mode_kb');
    } else status.textContent = t('dudus.mode_public');
  }
}
