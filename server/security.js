'use strict';
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
const bad = (code, extra) => new HttpError(400, code, extra);
const forbidden = () => new HttpError(403, 'forbidden');
// Used for "not allowed to see" AND "does not exist" so nothing leaks about other records.
const notFound = () => new HttpError(404, 'not_found');

// ---- passwords (scrypt, built into Node) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'password_too_short';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'password_weak';
  return null;
}
const randomPassword = () => crypto.randomBytes(9).toString('base64url') + '7a';

// ---- sessions ----
const SESSION_MS = 8 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function createSession(h, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(16).toString('base64url');
  await h.run('INSERT INTO sessions (token_hash, user_id, school_id, csrf, expires_at, created_at) VALUES (?,?,(SELECT school_id FROM users WHERE id = ?),?,?,?)',
    sha(token), userId, userId, csrf, Date.now() + SESSION_MS, Date.now());
  return { token, csrf };
}
async function readSession(h, token) {
  if (!token) return null;
  const s = await h.get('SELECT * FROM sessions WHERE token_hash = ?', sha(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) { await h.run('DELETE FROM sessions WHERE token_hash = ?', s.token_hash); return null; }
  await h.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', Date.now() + SESSION_MS, s.token_hash); // sliding expiry
  return s;
}
async function destroySession(h, token) { if (token) await h.run('DELETE FROM sessions WHERE token_hash = ?', sha(token)); }

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookieHeader(token, secure) {
  return `jao_sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
}

// ---- login rate limit (in memory) ----
const attempts = new Map();
function rateLimit(key, max = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const rec = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  rec.push(now);
  attempts.set(key, rec);
  return rec.length <= max;
}
function resetRate(key) { attempts.delete(key); }

// ---- input checks ----
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function req(v, code, max = 200) { const s = str(v, max); if (!s) throw bad(code); return s; }
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isPhone = (s) => /^[+0-9][0-9 ()\-.]{5,20}$/.test(s);
const toInt = (v) => (Number.isInteger(Number(v)) && v !== '' && v !== null ? Number(v) : null);

// ---- image uploads: type is detected from file bytes, not trusted from the browser ----
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

module.exports = {
  HttpError, bad, forbidden, notFound, hashPassword, verifyPassword, passwordProblem, randomPassword,
  createSession, readSession, destroySession, parseCookies, cookieHeader, rateLimit, resetRate,
  str, req, isDate, isEmail, isPhone, toInt, sniffImage,
};
