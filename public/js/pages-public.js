// Pages anyone can open: welcome screen, entry screen, login, school registration, public shop.
import { state, setLang, t, h, get, post, navigate, brand, langSwitch, svgIcon, field, input, textarea, toast, fail, load, empty, errorBox, spinner, logoMark } from './ui.js';
import { catalogue } from './pages-shop.js';
import { mountDudus } from './dudus.js';

// ---- Welcome announcement. Change the wording here; the default is the approved text. ----
export const ANNOUNCEMENT = 'Welcome to JAO!';
const ANNOUNCEMENT_FR = 'Bienvenue à JAO !';
const HERO_URL = '/img/welcome.jpg';

function pickVoice(pref) {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
  if (pref === 'female') return voices.find((v) => /female|woman|zira|samantha|susan|hazel|karen|victoria|aria|jenny|serena/i.test(v.name)) || null;
  if (pref === 'male') return voices.find((v) => /(?<!fe)male|\bman\b|david|daniel|mark|george|alex|thomas|guy|ryan/i.test(v.name)) || null;
  return null;
}

export function welcomePage(root) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = (c) => (reduce ? '' : ` fade-in ${c}`);
  let timer, spoke = false, done = false;
  const go = () => { if (done) return; done = true; clearTimeout(timer); window.speechSynthesis && speechSynthesis.cancel(); sessionStorage.setItem('jao_welcomed', '1'); navigate('#/start'); };
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let muted = localStorage.getItem('jao_mute') === '1';
  const playBtn = h('button', { class: 'btn btn-gold', hidden: true, onclick: () => speak(true) }, svgIcon('sound', 18), t('welcome.play'));
  const muteBtn = h('button', { class: 'btn btn-ghost', style: { color: '#fff', borderColor: 'rgba(255,255,255,.4)' }, 'aria-pressed': String(muted), onclick: () => {
    muted = !muted; localStorage.setItem('jao_mute', muted ? '1' : '0'); muteBtn.setAttribute('aria-pressed', String(muted)); paintMute();
    if (muted) speechSynthesis.cancel(); else speak(true); } });
  const paintMute = () => muteBtn.replaceChildren(svgIcon(muted ? 'mute' : 'sound', 18), muted ? t('welcome.sound_on') : t('welcome.sound_off'));
  paintMute();
  const voiceSel = h('select', { 'aria-label': t('welcome.voice'), onchange: (e) => { localStorage.setItem('jao_voice', e.target.value); } },
    [['default', t('welcome.voice_default')], ['female', t('welcome.voice_woman')], ['male', t('welcome.voice_man')]].map(([v, l]) => h('option', { value: v, selected: (localStorage.getItem('jao_voice') || 'default') === v }, l)));
  function speak(manual) {
    if (!supported || (muted && !manual)) return;
    if (manual && muted) { muted = false; localStorage.setItem('jao_mute', '0'); paintMute(); }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(ANNOUNCEMENT); u.lang = 'en-US'; u.rate = 0.9;
    const v = pickVoice(localStorage.getItem('jao_voice') || 'default'); if (v) u.voice = v;
    u.onstart = () => { spoke = true; playBtn.hidden = true; sessionStorage.setItem('jao_announced', '1'); };
    const f = new SpeechSynthesisUtterance(ANNOUNCEMENT_FR); f.lang = 'fr-FR'; f.rate = 0.9; // the French half is read with a French voice
    f.onend = () => { clearTimeout(timer); timer = setTimeout(go, 1200); };
    u.onend = () => speechSynthesis.speak(f);
    speechSynthesis.speak(u);
    setTimeout(() => { if (!spoke && !done) playBtn.hidden = false; }, 1200); // browser blocked autoplay: offer a button
  }
  // The picture already shows the JAO logo, the greeting bubble, the Login button and the FR/EN chip.
  // Real buttons sit exactly on top of those spots, so the screen works with keyboard and screen readers.
  const spot = (cls, label, onclick, extra = {}) => h('button', { class: `hero-spot ${cls}`, 'aria-label': label, onclick, ...extra });
  const pick = (l) => () => { if (state.lang !== l) setLang(l); };
  root.replaceChildren(h('div', { class: 'welcome welcome-hero' },
    h('img', { class: 'hero-bg', src: HERO_URL, alt: '', 'aria-hidden': 'true' }),
    h('div', { class: 'hero-wrap' + anim('') },
      h('img', { class: 'hero-img', src: HERO_URL, alt: t('welcome.hero_alt'), width: 933, height: 537 }),
      spot('hero-fr', 'Français', pick('fr'), { 'aria-pressed': String(state.lang === 'fr') }),
      spot('hero-en', 'English', pick('en'), { 'aria-pressed': String(state.lang === 'en') }),
      spot('hero-speak', t('welcome.play'), () => speak(true)),
      spot('hero-login', t('welcome.login'), go)),
    h('div', { class: 'cta' }, h('button', { class: 'btn btn-gold', onclick: go }, t('welcome.login')), playBtn),
    supported ? h('div', { class: 'sound' }, muteBtn, h('span', t('welcome.voice') + ':'), voiceSel) : null));
  if (supported) {
    // voices load asynchronously in some browsers
    const start = () => speak(false);
    if (speechSynthesis.getVoices().length) start(); else { speechSynthesis.onvoiceschanged = () => { speechSynthesis.onvoiceschanged = null; start(); }; setTimeout(() => { if (!spoke) start(); }, 600); }
  }
  timer = setTimeout(go, reduce ? 6000 : 9000); // never hold the visitor back for long
}
function placeholderAvatar() {
  const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('width', '100%'); s.setAttribute('height', '100%'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', t('welcome.portrait_placeholder'));
  const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', 50); c.setAttribute('cy', 38); c.setAttribute('r', 18); c.setAttribute('fill', '#cfe0ff');
  const b = document.createElementNS(ns, 'path'); b.setAttribute('d', 'M14 100c2-26 18-38 36-38s34 12 36 38z'); b.setAttribute('fill', '#cfe0ff');
  s.append(c, b); return s;
}

export function forcePasswordPage(root, onDone) {
  const cur = input({ type: 'password', autocomplete: 'current-password' }), nw = input({ type: 'password', autocomplete: 'new-password' }), nw2 = input({ type: 'password', autocomplete: 'new-password' });
  root.replaceChildren(h('div', { class: 'auth-page' }, h('div', { class: 'auth-card' }, brand(), h('h1', { style: { textAlign: 'center' } }, t('auth.choose_password')), h('p', { class: 'muted' }, t('auth.choose_password_text')),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (nw.value !== nw2.value) return toast(t('err.password_mismatch'), 'error');
      try { await post('/auth/change-password', { current_password: cur.value, new_password: nw.value }); state.user.must_change_password = false; toast(t('auth.password_changed')); onDone(); } catch (ex) { fail(ex); } } },
    field(t('auth.temp_password'), cur, { required: true }), field(t('auth.new_password'), nw, { required: true, hint: t('auth.password_rules') }), field(t('auth.confirm_password'), nw2, { required: true }),
    h('button', { class: 'btn btn-primary', type: 'submit', style: { width: '100%' } }, t('common.save'))))));
}

function publicHeader(title) {
  return h('header', { class: 'public-head' }, brand({ light: true, size: 32, sub: false }), h('strong', title || ''), h('div', { class: 'spacer' }), langSwitch(),
    h('a', { class: 'btn btn-sm', href: state.user ? '#/overview' : '#/start' }, state.user ? t('nav.overview') : t('auth.sign_in')),
    h('a', { class: 'btn btn-sm', href: '#/start' }, t('common.home')));
}

export async function schoolPickerPage(root) {
  const box = h('div', { class: 'public-wrap' });
  root.replaceChildren(publicHeader(t('nav.shop')), box);
  await load(box, () => get('/public/schools'), (list) => {
    if (list.length === 1) { setTimeout(() => navigate(`#/shop/${list[0].slug}`), 0); return spinner(); }
    return list.length ? h('div', h('h1', t('shops.choose')), h('div', { class: 'grid grid-cards' }, list.map((s) => h('a', { class: 'card', href: `#/shop/${s.slug}`, style: { textDecoration: 'none', color: 'inherit' } }, h('h3', s.name), s.motto ? h('p', { class: 'muted' }, s.motto) : null, h('span', { class: 'btn btn-sm btn-primary' }, t('shop.open')))))) : empty(t('shops.none'));
  });
}

export function publicShopPage(root, slug) {
  const wrap = h('div', { class: 'public-wrap' }, catalogue(slug), h('p', { class: 'small muted', style: { marginTop: '1rem' } }, t('shop.public_note')));
  root.replaceChildren(publicHeader(t('nav.shop')), wrap, h('div', { id: 'dudus-host' }));
  mountDudus(document.getElementById('dudus-host'), { mode: 'public', slug });
}
void logoMark; void errorBox;
