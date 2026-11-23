// Super Administrator: "Account & security" page (change the permanent password, recovery codes) and the public recovery page.
import './i18n-owner.js';
import { state, t, h, get, post, toast, fail, field, input, modal, badge, brand, langSwitch, fmtDateTime, load, svgIcon, errText, ApiError } from './ui.js';

const showToggle = (inputs) => h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => inputs.forEach((i) => { i.type = e.target.checked ? 'text' : 'password'; }) }), ' ', t('owner.show'));
function strength(pw) {
  let s = 0; if (pw.length >= 10) s++; if (pw.length >= 14) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++; if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) s = Math.min(s, 1);
  return s <= 1 ? ['weak', 20] : s === 2 ? ['ok', 45] : s === 3 ? ['good', 70] : ['strong', 100];
}
const meter = (getPw) => { const bar = h('div', { class: 'pw-bar' }); const label = h('span', { class: 'small muted' }); const box = h('div', { class: 'pw-meter', 'aria-live': 'polite' }, h('div', { class: 'pw-track' }, bar), label);
  return { box, update: () => { const pw = getPw(); if (!pw) { bar.style.width = '0'; label.textContent = ''; return; } const [k, w] = strength(pw); bar.style.width = w + '%'; bar.dataset.level = k; label.textContent = t(`owner.str_${k}`); } }; };
const pwInput = (ac) => input({ type: 'password', autocomplete: ac, required: true, maxlength: 200 });

export async function ownerAccountPage(ctx, view) {
  const host = h('div');
  view.replaceChildren(h('div', { class: 'page-head' }, h('div', h('h1', t('owner.title')), h('p', t('owner.subtitle')))), host);
  const render = () => load(host, () => get('/platform/account'), build);

  function build(a) {
    // ---- change password
    const cur = pwInput('current-password'), nw = pwInput('new-password'), cf = pwInput('new-password'); const m = meter(() => nw.value); nw.addEventListener('input', m.update);
    const err = h('div', { class: 'error-text', role: 'alert' }); const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, t('owner.save_pw'));
    const pwForm = h('form', { class: 'owner-form', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try { await post('/platform/account/password', { current_password: cur.value, new_password: nw.value, confirm_password: cf.value }); toast(t('owner.pw_saved')); cur.value = nw.value = cf.value = ''; render(); }
      catch (ex) { err.textContent = ex instanceof ApiError ? errText(ex.code) : t('err.generic'); btn.disabled = false; }
    } }, h('p', { class: 'muted' }, t('owner.pw_help')), field(t('owner.current'), cur, { required: true }), field(t('owner.new'), nw, { required: true, hint: t('owner.rules') }), m.box, field(t('owner.confirm'), cf, { required: true }), showToggle([cur, nw, cf]), err, btn);

    // ---- recovery codes
    const left = a.recovery_codes_left;
    const askAndGenerate = () => {
      const pw = pwInput('current-password'); const er = h('div', { class: 'error-text', role: 'alert' });
      modal({ title: t('owner.rec_generate'), body: h('div', h('p', t('owner.rec_replace')), field(t('owner.current'), pw, { required: true }), er),
        actions: [{ label: t('common.cancel'), class: 'btn-ghost', onclick: (c) => c() }, { label: t('owner.rec_generate'), class: 'btn-primary', onclick: async (c) => {
          try { const r = await post('/platform/account/recovery-codes', { current_password: pw.value }); c(); showCodes(r.codes); render(); } catch (ex) { er.textContent = ex instanceof ApiError ? errText(ex.code) : t('err.generic'); } } }] });
      setTimeout(() => pw.focus(), 50);
    };
    const recCard = h('section', { class: 'card' }, h('h2', t('owner.rec_title')), h('p', { class: 'muted' }, t('owner.rec_help')),
      h('p', left ? badge(t('owner.rec_left', { n: left }), left < 3 ? 'gold' : 'green') : badge(t('owner.rec_none'), 'red'), ' ', left > 0 && left < 3 ? h('span', { class: 'msg-warn' }, t('owner.rec_low', { n: left })) : null),
      a.recovery_codes_generated_at ? h('p', { class: 'small muted' }, fmtDateTime(a.recovery_codes_generated_at)) : null, h('button', { class: 'btn btn-ghost', onclick: askAndGenerate }, t('owner.rec_generate')));

    return h('div', { class: 'owner-grid' },
      h('section', { class: 'card' }, h('h2', t('owner.account')), h('dl', { class: 'detail-list' },
        h('dt', t('owner.email')), h('dd', a.email, ' ', h('span', { class: 'small muted' }, t('owner.email_fixed'))), h('dt', t('owner.name')), h('dd', a.name),
        h('dt', t('owner.pw_changed')), h('dd', a.password_changed_at ? fmtDateTime(a.password_changed_at) : t('owner.pw_not_recorded')), h('dt', t('owner.last_login')), h('dd', a.previous_login ? fmtDateTime(a.previous_login) : '—'))),
      h('section', { class: 'card' }, h('h2', t('owner.pw_title')), pwForm), recCard,
      h('section', { class: 'card' }, h('h2', t('owner.forgot_title')), h('p', { class: 'muted' }, t('owner.forgot_text'))));
  }
  render();
}

function showCodes(codes) {
  const text = `${t('owner.rec_sheet')}\n${t('owner.rec_sheet_note')}\n\n${codes.map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`).join('\n')}\n`;
  const saved = h('input', { type: 'checkbox' });
  const download = () => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: 'JAO-recovery-codes.txt' }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
  const print = () => { const sheet = h('div', { class: 'gce-sheet' }, h('h1', t('owner.rec_sheet')), h('p', t('owner.rec_sheet_note')), h('ol', codes.map((c) => h('li', { style: { fontFamily: 'monospace', fontSize: '1.3rem', margin: '.4rem 0' } }, c))));
    document.body.appendChild(sheet); document.body.classList.add('printing-gce'); const done = () => { document.body.classList.remove('printing-gce'); sheet.remove(); window.removeEventListener('afterprint', done); }; window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50); setTimeout(done, 60000); };
  modal({ title: t('owner.rec_generated_title'), wide: true, body: h('div', h('div', { class: 'notice notice-gold' }, t('owner.rec_once')), h('ol', { class: 'rec-codes' }, codes.map((c) => h('li', h('code', c)))),
    h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', onclick: async () => { try { await navigator.clipboard.writeText(text); toast(t('owner.rec_copied')); } catch { /* the user can still download */ } } }, t('owner.rec_copy')), h('button', { class: 'btn btn-ghost', onclick: download }, t('owner.rec_download')), h('button', { class: 'btn btn-ghost', onclick: print }, t('owner.rec_print'))),
    h('label', { class: 'check', style: { marginTop: '1rem' } }, saved, ' ', t('owner.rec_saved'))),
    actions: [{ label: t('owner.rec_done'), class: 'btn-primary', onclick: (c) => { if (!saved.checked) { toast(t('owner.rec_confirm_first'), 'error'); return; } c(); } }] });
}

// ---------- public: set a new password with a recovery code ----------
export function ownerRecoverPage(root) {
  const card = h('div', { class: 'auth-card' }); root.replaceChildren(h('div', { class: 'auth-page' }, card));
  const email = input({ type: 'email', autocomplete: 'username', required: true }), code = input({ type: 'text', autocomplete: 'off', required: true, maxlength: 30, placeholder: 'XXXX-XXXX-XXXX', spellcheck: 'false' });
  const nw = pwInput('new-password'), cf = pwInput('new-password'); const m = meter(() => nw.value); nw.addEventListener('input', m.update);
  const err = h('div', { class: 'error-text', role: 'alert' }); const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('owner.recover_btn'));
  card.replaceChildren(brand(), h('h1', { style: { textAlign: 'center' } }, t('owner.recover_title')), h('p', { class: 'muted', style: { textAlign: 'center' } }, t('owner.recover_text')),
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try { const r = await post('/auth/owner-recover', { email: email.value, recovery_code: code.value, new_password: nw.value, confirm_password: cf.value });
        card.replaceChildren(brand(), h('div', { class: 'notice notice-green' }, t('owner.recover_done')), r.codes_left < 3 ? h('p', { class: 'msg-warn' }, t('owner.recover_left', { n: r.codes_left })) : null, h('a', { class: 'btn btn-primary btn-block', href: '#/super' }, t('owner.back_signin'))); }
      catch (ex) { err.textContent = ex instanceof ApiError ? errText(ex.code) : t('err.generic'); btn.disabled = false; }
    } }, field(t('auth.email'), email, { required: true }), field(t('owner.recover_code'), code, { required: true }), field(t('owner.new'), nw, { required: true, hint: t('owner.rules') }), m.box, field(t('owner.confirm'), cf, { required: true }), showToggle([nw, cf]), err, btn),
    h('p', { style: { marginTop: '1rem' } }, h('a', { href: '#/super' }, t('owner.back_signin'))));
  email.focus();
}
