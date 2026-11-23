'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./db');
const S = require('./security');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json' };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

async function createApp({ dbFile, dataDir, secureCookies = false, env = process.env }) {
  const db = await openDatabase({ file: dbFile }); // the adapter: one small async interface (SQLite today, PostgreSQL later)
  const h = db;
  const routes = [];
  const app = { db, h, dataDir, env, routes, secureCookies };
  // Client address for rate limits and logs. Behind a hosting proxy (JAO_TRUST_PROXY=1) the proxy's own header is used
  // (its LAST entry, which the proxy added itself); otherwise the header is ignored so nobody can fake it.
  app.clientIp = (req) => {
    if (env.JAO_TRUST_PROXY === '1') { const x = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim(); if (x) return x.slice(0, 64); }
    return req.socket.remoteAddress || '';
  };

  // route('GET', '/students/:id', 'user' | 'public' | ['school_admin', ...], handler)
  app.route = (method, pattern, auth, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const entry = { method, re, keys, auth, handler, pattern };
    routes.push(entry);
    return entry;
  };

  require('./routes-core')(app);
  require('./routes-academic')(app);
  require('./routes-shop')(app);
  require('./routes-dudus')(app);
  require('./routes-notifications')(app);
  require('./routes-discipline')(app);
  require('./routes-prefects')(app);
  require('./routes-scholarships')(app);
  require('./routes-convocations')(app);
  require('./routes-import')(app);
  require('./routes-platform')(app);
  require('./routes-staff')(app);
  require('./routes-parents')(app);
  require('./routes-finder')(app);
  require('./routes-owner')(app);

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...(secureCookies ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}), ...headers });
    res.end(body);
  }
  const json = (res, status, obj, headers = {}) =>
    send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new S.HttpError(413, 'too_large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(S.bad('invalid_json')); }
      });
      req.on('error', reject);
    });
  }

  async function loadUser(token) {
    const sess = await S.readSession(h, token);
    if (!sess) return {};
    const user = await h.get('SELECT id, school_id, email, name, initials, role, student_id, language, active, must_change_password FROM users WHERE id = ?', sess.user_id);
    if (!user || !user.active) return {};
    let school = null;
    if (user.school_id) {
      school = await h.get('SELECT * FROM schools WHERE id = ?', user.school_id);
      if (!school || school.status !== 'active' || school.approval !== 'approved') return {};
    }
    return { user, school, session: sess };
  }

  async function handleApi(req, res, url) {
    const apiPath = url.pathname.slice(4) || '/';
    const route = routes.find((r) => r.method === req.method && r.re.test(apiPath));
    if (!route) {
      if (routes.some((r) => r.re.test(apiPath))) throw new S.HttpError(405, 'method_not_allowed');
      throw S.notFound();
    }
    req.routePattern = route.pattern; // for safe logging (the pattern, never the real path, which may hold a secret link)
    const m = route.re.exec(apiPath);
    const params = {};
    route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

    const token = S.parseCookies(req).jao_sid;
    const { user, school, session } = await loadUser(token);

    if (route.auth !== 'public') {
      if (!user) throw new S.HttpError(401, 'unauthenticated');
      if (Array.isArray(route.auth) && !route.auth.includes(user.role)) throw S.forbidden();
      if (user.must_change_password && !route.allowWhenMustChange) throw new S.HttpError(403, 'password_change_required');
      if (user.role === 'teacher') await require('./departments').gate(h, user, req.method, apiPath); // department-based access (off unless the school switches it on)
    }
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw S.forbidden();
      if (session && req.headers['x-csrf-token'] !== session.csrf) throw S.forbidden();
    }
    const body = req.method === 'GET' ? {} : await readBody(req, route.bodyLimit || 64 * 1024);
    const query = Object.fromEntries(url.searchParams);
    // schoolId ALWAYS comes from the verified session, never from the browser.
    const c = { app, h, req, res, user, school, schoolId: user ? user.school_id : null, session, params, query, body, token };
    const out = await route.handler(c);
    if (out && out.__raw) { send(res, out.status || 200, out.body, out.headers); return; }
    if (out && out.__cookie) { json(res, 200, out.data, { 'Set-Cookie': out.__cookie }); return; }
    json(res, 200, out === undefined ? { ok: true } : out);
  }

  function serveStatic(req, res, url) {
    const publicDir = path.join(__dirname, '..', 'public');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // single-page app fallback
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep)) return send(res, 403, 'Forbidden');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') { await h.get('SELECT 1 AS ok'); return json(res, 200, { ok: true }); } // for the host's uptime checks; reveals nothing
      if (env.JAO_FORCE_HTTPS === '1' && env.JAO_TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'http') { res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` }); return res.end(); }
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
      else send(res, 405, 'Method not allowed');
    } catch (e) {
      if (e instanceof S.HttpError) {
        if ([401, 403, 429].includes(e.status)) console.warn(JSON.stringify({ t: new Date().toISOString(), event: 'access_refused', status: e.status, code: e.code, method: req.method, route: req.routePattern || 'unknown', ip: app.clientIp(req) }));
        return json(res, e.status, { error: e.code, ...(e.extra || {}) });
      }
      if (/cross_school_reference|UNIQUE|CHECK|FOREIGN KEY|NOT NULL/.test(String(e.message))) {
        return json(res, 400, { error: /UNIQUE/.test(e.message) ? 'duplicate' : 'invalid_data' });
      }
      console.error('Server error:', e); // details stay in the server log only
      json(res, 500, { error: 'server_error' });
    }
  });

  app.server = server;
  app.cookie = (token) => S.cookieHeader(token, secureCookies);
  return app;
}

module.exports = { createApp };
