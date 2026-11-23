'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const S = require('./security');
const A = require('./access');
const { newSchoolCode } = require('./db');
const { seedDiscipline } = require('./discipline-defaults');
const { seedPrefects } = require('./prefect-defaults');

const ADMIN = ['school_admin'];
const OWNER = ['platform_owner'];
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'school';

// A user row is identified by id AND school (the platform owner has no school).
const ownerFilter = (u) => (u.school_id == null ? { sql: 'school_id IS NULL', params: [] } : { sql: 'school_id = ?', params: [u.school_id] });

module.exports = function (app) {
  const { h, route } = app;

  // ---------- private file storage (outside the public folder) ----------
  app.saveImage = async (schoolId, kind, base64, actorId) => {
    if (typeof base64 !== 'string') throw S.bad('invalid_image');
    const buf = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64');
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) throw S.bad('image_too_large');
    const mime = S.sniffImage(buf);
    if (!mime) throw S.bad('invalid_image_type');
    const dir = path.join(app.dataDir, 'uploads', String(schoolId));
    fs.mkdirSync(dir, { recursive: true });
    const name = crypto.randomBytes(16).toString('hex'); // not guessable, not user-supplied
    const file = path.join(dir, name);
    fs.writeFileSync(file, buf);
    const r = await h.insert('INSERT INTO files (school_id, kind, mime, size, path, created_by) VALUES (?,?,?,?,?,?)', schoolId, kind, mime, buf.length, file, actorId);
    return r;
  };
  const sendFile = (f, cache) => ({ __raw: true, body: fs.readFileSync(f.path),
    headers: { 'Content-Type': f.mime, 'Cache-Control': cache, 'Content-Disposition': 'inline' } });

  // ---------- auth ----------
  // School-scoped sign-in: the portal sends school_slug (a school's own sign-in page) or scope:'platform'
  // (super administrator page). Credentials only work in their own context; every miss looks identical.
  const isUsable = (school) => !!school && school.status === 'active' && school.approval === 'approved';
  route('POST', '/auth/login', 'public', async (c) => {
    // Parent Access: school code + (phone or email). `identifier` is used by the parent page; `email` keeps working for every other sign-in.
    const identifier = S.str(c.body.identifier, 200).toLowerCase();
    const email = identifier && identifier.includes('@') ? identifier : S.str(c.body.email, 200).toLowerCase();
    const password = typeof c.body.password === 'string' ? c.body.password : '';
    const slug = S.str(c.body.school_slug, 60);
    const code = S.str(c.body.school_code, 40);
    const rawPhone = identifier && !identifier.includes('@') ? identifier.replace(/[ ().-]/g, '') : '';
    const platformScope = c.body.scope === 'platform';
    const ip = app.clientIp(c.req);
    if (!S.rateLimit(`login:${ip}:${email || rawPhone}`)) throw new S.HttpError(429, 'too_many_attempts');
    // The same email may exist in several schools (a separate account in each), so the sign-in page decides which one.
    let u = null;
    if (code) { // parent sign-in by school code: only parent accounts, phone or email, in that one school
      const target = await h.get('SELECT id FROM schools WHERE LOWER(code) = LOWER(?)', code);
      if (target) u = rawPhone ? (/^\+?\d{6,16}$/.test(rawPhone) ? await h.get("SELECT u.* FROM users u JOIN user_phones p ON p.user_id = u.id AND p.school_id = u.school_id WHERE u.school_id = ? AND p.phone = ? AND u.role = 'parent'", target.id, rawPhone) : null)
        : await h.get("SELECT * FROM users WHERE school_id = ? AND email = ? AND role = 'parent'", target.id, email);
    } else if (platformScope) u = await h.get("SELECT * FROM users WHERE email = ? AND school_id IS NULL AND role = 'platform_owner'", email);
    else if (slug) {
      const target = await h.get('SELECT id FROM schools WHERE slug = ?', slug);
      u = target ? await h.get('SELECT * FROM users WHERE email = ? AND school_id = ?', email, target.id) : null;
    } else { // no page context (API clients): only when the email belongs to exactly one account
      const rows = await h.all('SELECT * FROM users WHERE email = ? LIMIT 2', email);
      u = rows.length === 1 ? rows[0] : null;
    }
    const school = u && u.school_id ? await h.get('SELECT id, status, approval FROM schools WHERE id = ?', u.school_id) : null;
    const contextOk = true;
    const credsOk = !!(u && u.active && contextOk && S.verifyPassword(password, u.password_hash));
    const ok = credsOk && (!u.school_id || isUsable(school));
    await h.run('INSERT INTO login_log (user_id, school_id, email, ok) VALUES (?,?,?,?)', u ? u.id : null, u ? u.school_id : null, (email || rawPhone).slice(0, 100), ok ? 1 : 0);
    if (!ok) {
      // Only someone who proved the right password learns WHY their school is locked.
      if (credsOk && school) throw new S.HttpError(403, school.approval === 'pending' ? 'school_pending' : school.approval === 'rejected' ? 'school_rejected' : 'school_suspended');
      throw new S.HttpError(401, 'invalid_credentials');
    }
    S.resetRate(`login:${ip}:${email || rawPhone}`);
    const mine = ownerFilter(u);
    await h.run(`UPDATE users SET previous_login = last_login, last_login = NOW_TS WHERE id = ? AND ${mine.sql}`, u.id, ...mine.params);
    const { token, csrf } = await S.createSession(h, u.id);
    return { __cookie: app.cookie(token), data: { csrf, user: { ...publicUser(u), permissions: [...await A.permissionsOf(h, u)] } } };
  });

  const publicUser = (u) => ({ id: u.id, name: u.name, initials: u.initials, role: u.role, language: u.language, student_id: u.student_id, must_change_password: !!u.must_change_password });

  route('POST', '/auth/logout', 'user', async (c) => {
    await S.destroySession(h, c.token);
    return { __cookie: 'jao_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0', data: { ok: true } };
  }).allowWhenMustChange = true;

  route('GET', '/auth/me', 'user', async (c) => {
    const school = c.school ? { id: c.school.id, name: c.school.name, slug: c.school.slug, code: c.school.code, school_type: c.school.school_type, motto: c.school.motto, logo: c.school.logo_file_id ? `/api/public/image/${c.school.logo_file_id}` : null,
      pass_mark: c.school.pass_mark, grade_scale: c.school.grade_scale, ranking_enabled: !!c.school.ranking_enabled, date_format: c.school.date_format } : null;
    return { csrf: c.session.csrf, user: { ...publicUser(c.user), permissions: [...await A.permissionsOf(h, c.user)] }, school };
  });
  app.routes.at(-1).allowWhenMustChange = true;

  route('POST', '/auth/change-password', 'user', async (c) => {
    if (!S.rateLimit(`chpw:${c.user.id}`, 8)) throw new S.HttpError(429, 'too_many_attempts'); // guesses of the current password are limited
    const row = await h.get('SELECT password_hash FROM users WHERE id = ?', c.user.id);
    if (!S.verifyPassword(String(c.body.current_password || ''), row.password_hash)) throw new S.HttpError(400, 'wrong_password');
    const problem = S.passwordProblem(c.body.new_password);
    if (problem) throw S.bad(problem);
    if (S.verifyPassword(String(c.body.new_password), row.password_hash)) throw S.bad('password_same'); // the new password must differ from the current (temporary) one
    { const mine = ownerFilter(c.user); await h.run(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND ${mine.sql}`, S.hashPassword(c.body.new_password), c.user.id, ...mine.params); }
    await h.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', c.user.id, require('node:crypto').createHash('sha256').update(c.token).digest('hex'));
    S.resetRate(`chpw:${c.user.id}`);
    if (c.user.role === 'platform_owner') await h.run("INSERT INTO owner_security (user_id, password_changed_at) VALUES (?, NOW_TS) ON CONFLICT(user_id) DO UPDATE SET password_changed_at = excluded.password_changed_at", c.user.id);
    await h.audit(c.schoolId, c.user.id, 'password_changed', `user:${c.user.id}`);
    return { ok: true };
  });
  app.routes.at(-1).allowWhenMustChange = true;

  route('POST', '/auth/language', 'user', async (c) => {
    if (!['en', 'fr'].includes(c.body.language)) throw S.bad('invalid_language');
    { const mine = ownerFilter(c.user); await h.run(`UPDATE users SET language = ? WHERE id = ? AND ${mine.sql}`, c.body.language, c.user.id, ...mine.params); }
    return { ok: true };
  });

  // ---------- Multi-School Portal (public: no login) ----------
  const logoUrl = (s) => (s.logo_file_id ? `/api/public/image/${s.logo_file_id}` : null);
  const portalSchool = (s) => ({ name: s.name, slug: s.slug, code: s.code, school_type: s.school_type, location: s.location, motto: s.motto, logo: logoUrl(s) });
  const LIVE = "status = 'active' AND approval = 'approved'";

  // Find an existing school by (part of) its name or by its unique school code.
  route('GET', '/public/schools/search', 'public', async (c) => {
    const ip = app.clientIp(c.req);
    if (!S.rateLimit(`search:${ip}`, 120, 60 * 1000)) throw new S.HttpError(429, 'too_many_attempts');
    const q = S.str(c.query.q, 80);
    if (q.length < 2) return [];
    const byCode = await h.all(`SELECT * FROM schools WHERE ${LIVE} AND code = ?`, q.toUpperCase().replace(/\s+/g, ''));
    if (byCode.length) return byCode.map(portalSchool);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    return (await h.all(`SELECT * FROM schools WHERE ${LIVE} AND LOWER(name) LIKE LOWER(?) ESCAPE '\\' ORDER BY name LIMIT 10`, like)).map(portalSchool);
  });
  // One school's public sign-in page. Schools that are not live only reveal their name and state.
  route('GET', '/public/schools/:slug', 'public', async (c) => {
    const s = await h.get('SELECT * FROM schools WHERE slug = ?', c.params.slug);
    if (!s) throw S.notFound();
    if (!isUsable(s)) return { name: s.name, slug: s.slug, state: s.approval === 'pending' ? 'pending' : s.approval === 'rejected' ? 'rejected' : 'suspended' };
    return { ...portalSchool(s), state: 'active' };
  });
  route('GET', '/public/schools', 'public', async () =>
    await h.all(`SELECT name, slug, motto, code FROM schools WHERE ${LIVE} ORDER BY name`));

  // Create a New School: builds the school and its administrator immediately. The school stays LOCKED
  // until the super administrator approves it (unless JAO_AUTO_APPROVE_SCHOOLS=1 is set).
  route('POST', '/public/register-school', 'public', async (c) => {
    const ip = app.clientIp(c.req);
    if (!S.rateLimit(`reg:${ip}`, Number(app.env.JAO_REGISTER_LIMIT) || 5, 3600 * 1000)) throw new S.HttpError(429, 'too_many_attempts');
    const b = c.body;
    const name = S.req(b.school_name, 'school_name_required', 120);
    if (!app.SCHOOL_TYPES.includes(b.school_type)) throw S.bad('invalid_school_type');
    const address = S.req(b.address, 'address_required', 200), location = S.req(b.location, 'location_required', 120);
    const schoolEmail = S.str(b.email, 200).toLowerCase(), phone = S.str(b.phone, 30);
    if (!S.isEmail(schoolEmail)) throw S.bad('invalid_email');
    if (!S.isPhone(phone)) throw S.bad('invalid_phone');
    const adminName = S.req(b.admin_name, 'name_required', 120);
    const adminEmail = S.str(b.admin_email, 200).toLowerCase();
    if (!S.isEmail(adminEmail)) throw S.bad('invalid_email');
    const problem = S.passwordProblem(b.password);
    if (problem) throw S.bad(problem);
    if (b.password !== b.password_confirm) throw S.bad('password_mismatch');
    // A school may not reuse an existing school's name (stops one school impersonating another).
    if (await h.get('SELECT 1 FROM schools WHERE lower(name) = lower(?)', name)) throw S.bad('school_name_taken');
    const auto = app.env.JAO_AUTO_APPROVE_SCHOOLS === '1';
    return await h.tx(async () => {
      const out = await app.createSchool({ name, adminName, adminEmail, adminPassword: b.password, mustChange: false, schoolType: b.school_type, address, location, email: schoolEmail, phone,
        logo: b.logo || null, status: auto ? 'active' : 'suspended', approval: auto ? 'approved' : 'pending' });
      await h.run('INSERT INTO registration_requests (school_name, admin_name, admin_email, phone, message, status, school_id, decided_at) VALUES (?,?,?,?,?,?,?,?)',
        name, adminName, adminEmail, phone, null, auto ? 'approved' : 'pending', out.schoolId, auto ? new Date().toISOString() : null);
      return { ok: true, school_name: name, school_code: out.code, slug: out.slug, state: auto ? 'active' : 'pending' };
    });
  }).bodyLimit = 4 * 1024 * 1024;

  route('GET', '/public/image/:id', 'public', async (c) => {
    const f = await h.get(`SELECT f.* FROM files f WHERE f.id = ? AND (
      (f.kind = 'product_image' AND EXISTS (SELECT 1 FROM products p JOIN schools s ON s.id = p.school_id WHERE p.image_file_id = f.id AND p.active = 1 AND p.is_public = 1 AND s.status = 'active' AND s.approval = 'approved'))
      OR (f.kind = 'school_logo' AND EXISTS (SELECT 1 FROM schools s WHERE s.logo_file_id = f.id AND s.status = 'active' AND s.approval = 'approved')))`, Number(c.params.id));
    if (!f) throw S.notFound();
    return sendFile(f, 'public, max-age=300');
  });

  // Private files (student photos): served only after the same checks as the student record.
  route('GET', '/files/:id', 'user', async (c) => {
    const f = await h.get('SELECT * FROM files WHERE id = ? AND school_id = ?', Number(c.params.id), c.schoolId);
    if (!f || f.kind !== 'student_photo') throw S.notFound();
    const sc = A.studentScope(c.user);
    const ok = await h.get(`SELECT 1 FROM students s WHERE ${sc.where} AND s.photo_file_id = ?`, ...sc.params, f.id);
    if (!ok) throw S.notFound();
    return sendFile(f, 'private, max-age=60');
  });

  // ---------- Super administrator (internal role name: platform_owner) ----------
  // Manages schools and registrations. Never receives student, guardian, grade or report records.
  route('GET', '/platform/stats', OWNER, async () => ({
    schools: (await h.get('SELECT COUNT(*) n FROM schools')).n,
    active: (await h.get("SELECT COUNT(*) n FROM schools WHERE status = 'active' AND approval = 'approved'")).n,
    suspended: (await h.get("SELECT COUNT(*) n FROM schools WHERE status = 'suspended' AND approval = 'approved'")).n,
    pending_requests: (await h.get("SELECT COUNT(*) n FROM registration_requests WHERE status = 'pending'")).n,
  }));
  route('GET', '/platform/schools', OWNER, async () =>
    await h.all(`SELECT s.id, s.name, s.slug, s.code, s.school_type, s.location, s.status, s.approval, s.email, s.phone, s.created_at,
      (SELECT u.name FROM users u WHERE u.school_id = s.id AND u.role = 'school_admin') AS admin_name
      FROM schools s ORDER BY s.name`));
  route('GET', '/platform/schools/:id', OWNER, async (c) => {
    const id = S.toInt(c.params.id);
    const s = id === null ? null : await h.get('SELECT * FROM schools WHERE id = ?', id);
    if (!s) throw S.notFound();
    const admin = await h.get("SELECT name, email, last_login FROM users WHERE school_id = ? AND role = 'school_admin'", s.id);
    return { id: s.id, name: s.name, slug: s.slug, code: s.code, school_type: s.school_type, address: s.address, location: s.location, email: s.email, phone: s.phone, motto: s.motto,
      status: s.status, approval: s.approval, created_at: s.created_at, logo: s.logo_file_id ? `/api/platform/schools/${s.id}/logo` : null, admin,
      // Totals only. Never any individual student, guardian or grade record.
      counts: { students: (await h.get('SELECT COUNT(*) n FROM students WHERE school_id = ? AND archived_at IS NULL', s.id)).n,
        teachers: (await h.get("SELECT COUNT(*) n FROM users WHERE school_id = ? AND role = 'teacher'", s.id)).n, classes: (await h.get('SELECT COUNT(*) n FROM classes WHERE school_id = ?', s.id)).n } };
  });
  // Lets the super administrator see a registering school's logo before approval.
  route('GET', '/platform/schools/:id/logo', OWNER, async (c) => {
    const s = await h.get('SELECT logo_file_id FROM schools WHERE id = ?', S.toInt(c.params.id));
    const f = s && s.logo_file_id ? await h.get("SELECT * FROM files WHERE id = ? AND kind = 'school_logo'", s.logo_file_id) : null;
    if (!f) throw S.notFound();
    return sendFile(f, 'private, max-age=60');
  });
  route('GET', '/platform/requests', OWNER, async () =>
    await h.all(`SELECT r.*, s.code AS school_code, s.school_type, s.location, s.approval FROM registration_requests r LEFT JOIN schools s ON s.id = r.school_id
      ORDER BY (r.status = 'pending') DESC, r.id DESC`));
  route('POST', '/platform/requests/:id/approve', OWNER, async (c) => {
    const r = await h.get("SELECT * FROM registration_requests WHERE id = ? AND status = 'pending'", Number(c.params.id));
    if (!r) throw S.notFound();
    if (r.school_id) { // new-style request: the school and its administrator already exist, just unlock them
      await h.tx(async () => {
        await h.run("UPDATE schools SET status = 'active', approval = 'approved' WHERE id = ?", r.school_id);
        await h.run("UPDATE registration_requests SET status = 'approved', decided_at = NOW_TS WHERE id = ?", r.id);
        await h.audit(r.school_id, c.user.id, 'school_approved', `school:${r.school_id}`);
      });
      return { school_id: r.school_id, admin_email: r.admin_email };
    }
    const temp = S.randomPassword(); // old-style request (no password was given): create the school now
    const out = await h.tx(async () => await app.createSchool({ name: r.school_name, adminName: r.admin_name, adminEmail: r.admin_email, adminPassword: temp, phone: r.phone, actor: c.user.id }, true, r.id));
    return { school_id: out.schoolId, admin_email: r.admin_email, temporary_password: temp }; // shown once to the super administrator
  });
  route('POST', '/platform/requests/:id/reject', OWNER, async (c) => {
    const r = await h.get("SELECT * FROM registration_requests WHERE id = ? AND status = 'pending'", Number(c.params.id));
    if (!r) throw S.notFound();
    await h.tx(async () => {
      await h.run("UPDATE registration_requests SET status = 'rejected', decided_at = NOW_TS WHERE id = ?", r.id);
      if (r.school_id) { await h.run("UPDATE schools SET approval = 'rejected', status = 'suspended' WHERE id = ?", r.school_id); await h.audit(r.school_id, c.user.id, 'school_rejected', `school:${r.school_id}`); }
      else await h.audit(null, c.user.id, 'registration_rejected', `request:${r.id}`);
    });
  });
  route('POST', '/platform/schools', OWNER, async (c) => {
    const email = S.str(c.body.admin_email, 200).toLowerCase();
    if (!S.isEmail(email)) throw S.bad('invalid_email');
    const name = S.req(c.body.school_name, 'school_name_required', 120);
    if (await h.get('SELECT 1 FROM schools WHERE lower(name) = lower(?)', name)) throw S.bad('school_name_taken');
    const type = c.body.school_type ? c.body.school_type : null;
    if (type && !app.SCHOOL_TYPES.includes(type)) throw S.bad('invalid_school_type');
    const temp = S.randomPassword();
    const out = await h.tx(async () => await app.createSchool({ name, adminName: S.req(c.body.admin_name, 'name_required', 120), adminEmail: email, adminPassword: temp, actor: c.user.id, schoolType: type }, true));
    return { school_id: out.schoolId, school_code: out.code, admin_email: email, temporary_password: temp };
  });
  // Activate / deactivate a school. Activating a school that was waiting for approval also approves it.
  route('POST', '/platform/schools/:id/status', OWNER, async (c) => {
    if (!['active', 'suspended'].includes(c.body.status)) throw S.bad('invalid_status');
    const id = Number(c.params.id);
    const r = c.body.status === 'active' ? await h.run("UPDATE schools SET status = 'active', approval = 'approved' WHERE id = ?", id) : await h.run("UPDATE schools SET status = 'suspended' WHERE id = ?", id);
    if (!r.changes) throw S.notFound();
    if (c.body.status === 'active') await h.run("UPDATE registration_requests SET status = 'approved', decided_at = NOW_TS WHERE school_id = ? AND status <> 'approved'", id);
    if (c.body.status === 'suspended') await h.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE school_id = ?)', id);
    await h.audit(id, c.user.id, `school_${c.body.status}`, `school:${id}`);
  });


  // ---------- Password reset (initiated by the super administrator) ----------
  // The super administrator never sees or chooses the new password. They only create a ONE-TIME, 24-hour link
  // and pass it to the school administrator, who then chooses their own password. Only a hash of the link's
  // secret is stored. Using the link signs the administrator out everywhere else.
  const sha = (x) => require('node:crypto').createHash('sha256').update(x).digest('hex');
  const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, '$1•••$2');
  const resetRow = async (token) => await h.get(`SELECT r.id, r.user_id, u.email, u.name, u.school_id, sc.name AS school_name, sc.status, sc.approval
    FROM password_resets r JOIN users u ON u.id = r.user_id JOIN schools sc ON sc.id = u.school_id
    WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW_TS AND u.active = 1 AND u.role = 'school_admin'`, sha(String(token)));
  route('POST', '/platform/schools/:id/password-reset', OWNER, async (c) => {
    const id = S.toInt(c.params.id);
    const admin = id === null ? null : await h.get("SELECT id, email, name FROM users WHERE school_id = ? AND role = 'school_admin' AND active = 1", id);
    if (!admin) throw S.notFound();
    const token = require('node:crypto').randomBytes(32).toString('base64url');
    await h.tx(async () => {
      await h.run("UPDATE password_resets SET used_at = NOW_TS WHERE user_id = ? AND used_at IS NULL", admin.id); // older links stop working
      await h.run("INSERT INTO password_resets (user_id, school_id, token_hash, created_by, expires_at) VALUES (?,?,?,?, ?)", admin.id, id, sha(token), c.user.id, h.nowPlusDays(1));
      await h.audit(id, c.user.id, 'password_reset_issued', `user:${admin.id}`);
    });
    return { path: `/#/reset/${token}`, admin_name: admin.name, admin_email: admin.email, hours: 24 };
  });
  route('GET', '/public/password-reset/:token', 'public', async (c) => {
    if (!S.rateLimit(`rst:${app.clientIp(c.req)}`, 30, 15 * 60 * 1000)) throw new S.HttpError(429, 'too_many_attempts');
    const r = await resetRow(c.params.token);
    if (!r) throw new S.HttpError(404, 'reset_invalid');
    return { school_name: r.school_name, email: maskEmail(r.email) };
  });
  route('POST', '/public/password-reset/:token', 'public', async (c) => {
    if (!S.rateLimit(`rst:${app.clientIp(c.req)}`, 30, 15 * 60 * 1000)) throw new S.HttpError(429, 'too_many_attempts');
    const r = await resetRow(c.params.token);
    if (!r) throw new S.HttpError(404, 'reset_invalid');
    const problem = S.passwordProblem(c.body.password);
    if (problem) throw S.bad(problem);
    if (c.body.password !== c.body.password_confirm) throw S.bad('password_mismatch');
    await h.tx(async () => {
      await h.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND school_id = ?', S.hashPassword(c.body.password), r.user_id, r.school_id);
      await h.run("UPDATE password_resets SET used_at = NOW_TS WHERE user_id = ? AND school_id = ? AND used_at IS NULL", r.user_id, r.school_id);
      await h.run('DELETE FROM sessions WHERE user_id = ?', r.user_id);
      await h.audit(r.school_id, r.user_id, 'password_reset_completed', `user:${r.user_id}`);
    });
    return { ok: true };
  });

  app.SCHOOL_TYPES = ['nursery', 'primary', 'nursery_primary', 'secondary_general', 'secondary_technical', 'vocational', 'higher_education', 'other'];

  // Create a school + its single administrator. Used by registration, the super administrator and first-run setup.
  // Every record the school owns later carries this school's id (school_id).
  app.createSchool = async ({ name, adminName, adminEmail, adminPassword, phone, actor, mustChange = true, slug, code, schoolType, address, location, email, logo, status = 'active', approval = 'approved' }, _x, requestId) => {
    let base = slug || slugify(name), s = base, i = 2;
    while (await h.get('SELECT 1 FROM schools WHERE slug = ?', s)) s = `${base}-${i++}`;
    const schoolCode = code || await newSchoolCode(h);
    const sid = await h.insert('INSERT INTO schools (name, slug, code, school_type, address, location, email, phone, status, approval) VALUES (?,?,?,?,?,?,?,?,?,?)',
      name, s, schoolCode, schoolType || null, address || null, location || null, email || null, phone || null, status, approval);
    const initials = adminName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    await h.run("INSERT INTO users (school_id, email, password_hash, name, initials, role, must_change_password) VALUES (?,?,?,?,?, 'school_admin', ?)",
      sid, adminEmail.toLowerCase(), S.hashPassword(adminPassword), adminName, initials, mustChange ? 1 : 0);
    if (requestId) await h.run("UPDATE registration_requests SET status = 'approved', decided_at = NOW_TS WHERE id = ?", requestId);
    await seedDiscipline(h, sid);
    await seedPrefects(h, sid);
    await h.audit(sid, actor ?? null, 'school_created', `school:${sid}`);
    if (logo) await h.run('UPDATE schools SET logo_file_id = ? WHERE id = ?', await app.saveImage(sid, 'school_logo', logo, null), sid);
    return { schoolId: sid, code: schoolCode, slug: s };
  };

  // ---------- Overview ----------
  route('GET', '/overview', ['school_admin', 'teacher', 'parent', 'student'], async (c) => {
    const sc = A.studentScope(c.user);
    const out = { school: c.school.name, role: c.user.role };
    out.students = (await h.get(`SELECT COUNT(*) n FROM students s WHERE ${sc.where}`, ...sc.params)).n;
    if (c.user.role === 'school_admin' || c.user.role === 'teacher') {
      out.classes = (await h.get('SELECT COUNT(*) n FROM classes WHERE school_id = ? AND active = 1', c.schoolId)).n;
      out.subjects = (await h.get('SELECT COUNT(*) n FROM subjects WHERE school_id = ? AND active = 1', c.schoolId)).n;
    }
    if (c.user.role === 'school_admin') {
      out.teachers = (await h.get("SELECT COUNT(*) n FROM users WHERE school_id = ? AND role = 'teacher' AND active = 1", c.schoolId)).n;
      out.shop = {
        active: (await h.get('SELECT COUNT(*) n FROM products WHERE school_id = ? AND active = 1', c.schoolId)).n,
        low_stock: (await h.get('SELECT COUNT(*) n FROM products WHERE school_id = ? AND active = 1 AND quantity > 0 AND quantity <= low_threshold', c.schoolId)).n,
        out_of_stock: (await h.get('SELECT COUNT(*) n FROM products WHERE school_id = ? AND active = 1 AND quantity = 0', c.schoolId)).n,
      };
      out.activity = await h.all('SELECT action, record, at FROM audit_log WHERE school_id = ? ORDER BY id DESC LIMIT 8', c.schoolId);
      out.recent_assessments = await h.all(`SELECT a.id, a.name, a.date, c.name AS class_name, c.section, sb.name AS subject_name,
        (SELECT COUNT(*) FROM grades g WHERE g.assessment_id = a.id) AS graded
        FROM assessments a JOIN classes c ON c.id = a.class_id JOIN subjects sb ON sb.id = a.subject_id
        WHERE a.school_id = ? ORDER BY a.date DESC, a.id DESC LIMIT 5`, c.schoolId);
      const year = await h.get('SELECT id, name FROM academic_years WHERE school_id = ? AND is_current = 1', c.schoolId);
      out.current_year = year ? year.name : null;
    }
    return out;
  });

  // ---------- Settings (administrator only) ----------
  const SCHOOL_FIELDS = ['name', 'motto', 'address', 'location', 'phone', 'email', 'shop_hours', 'shop_instructions'];
  route('GET', '/settings/school', ADMIN, (c) => c.school && ({ ...c.school, logo: c.school.logo_file_id ? `/api/public/image/${c.school.logo_file_id}` : null }));
  route('PUT', '/settings/school', ADMIN, async (c) => {
    const b = c.body, cur = c.school;
    const v = {};
    for (const f of SCHOOL_FIELDS) v[f] = f in b ? S.str(b[f], f.startsWith('shop_') ? 1000 : 200) : cur[f];
    if (!v.name) throw S.bad('school_name_required');
    if (v.email && !S.isEmail(v.email)) throw S.bad('invalid_email');
    const pass = b.pass_mark !== undefined ? Number(b.pass_mark) : cur.pass_mark;
    const scale = b.grade_scale !== undefined ? Number(b.grade_scale) : cur.grade_scale;
    const rounding = b.rounding !== undefined ? Number(b.rounding) : cur.rounding;
    if (!(scale > 0 && scale <= 1000) || !(pass >= 0 && pass <= scale) || ![0, 1, 2, 3].includes(rounding)) throw S.bad('invalid_grading_settings');
    let schoolType = cur.school_type;
    if (b.school_type !== undefined) { if (b.school_type && !app.SCHOOL_TYPES.includes(b.school_type)) throw S.bad('invalid_school_type'); schoolType = b.school_type || null; }
    const ranking = b.ranking_enabled !== undefined ? (b.ranking_enabled ? 1 : 0) : cur.ranking_enabled;
    const df = ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'].includes(b.date_format) ? b.date_format : cur.date_format;
    await h.run(`UPDATE schools SET name=?, motto=?, address=?, location=?, phone=?, email=?, shop_hours=?, shop_instructions=?,
      pass_mark=?, grade_scale=?, rounding=?, ranking_enabled=?, date_format=?, school_type=? WHERE id=?`,
      v.name, v.motto, v.address, v.location, v.phone, v.email, v.shop_hours, v.shop_instructions, pass, scale, rounding, ranking, df, schoolType, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'settings_updated', `school:${c.schoolId}`, { fields: Object.keys(b) });
  });
  route('POST', '/settings/logo', ADMIN, async (c) => {
    const id = await app.saveImage(c.schoolId, 'school_logo', c.body.image, c.user.id);
    await h.run('UPDATE schools SET logo_file_id = ? WHERE id = ?', id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'logo_updated', `file:${id}`);
    return { logo: `/api/public/image/${id}` };
  });
  app.routes.at(-1).bodyLimit = 4 * 1024 * 1024;

  // academic years & terms
  route('GET', '/academic-years', ['school_admin', 'teacher', 'parent', 'student'], async (c) => {
    const years = await h.all('SELECT * FROM academic_years WHERE school_id = ? ORDER BY name DESC', c.schoolId);
    const terms = await h.all('SELECT * FROM terms WHERE school_id = ? ORDER BY year_id, position', c.schoolId);
    const dates = new Map((await h.all('SELECT term_id, starts_on, ends_on FROM term_dates WHERE school_id = ?', c.schoolId)).map((d) => [d.term_id, d]));
    return years.map((y) => ({ ...y, is_current: !!y.is_current, terms: terms.filter((t) => t.year_id === y.id).map((t) => ({ ...t, starts_on: dates.get(t.id)?.starts_on || null, ends_on: dates.get(t.id)?.ends_on || null })) }));
  });
  route('POST', '/academic-years', ADMIN, async (c) => {
    const name = S.req(c.body.name, 'name_required', 40);
    const id = await h.tx(async () => {
      const n = (await h.get('SELECT COUNT(*) n FROM academic_years WHERE school_id = ?', c.schoolId)).n;
      const r = await h.insert('INSERT INTO academic_years (school_id, name, is_current) VALUES (?,?,?)', c.schoolId, name, n === 0 ? 1 : 0);
      return r;
    });
    await h.audit(c.schoolId, c.user.id, 'year_created', `year:${id}`);
    return { id };
  });
  route('POST', '/academic-years/:id/current', ADMIN, async (c) => {
    const id = Number(c.params.id);
    if (!await h.get('SELECT 1 FROM academic_years WHERE id = ? AND school_id = ?', id, c.schoolId)) throw S.notFound();
    await h.tx(async () => { await h.run('UPDATE academic_years SET is_current = 0 WHERE school_id = ?', c.schoolId); await h.run('UPDATE academic_years SET is_current = 1 WHERE id = ? AND school_id = ?', id, c.schoolId); });
    await h.audit(c.schoolId, c.user.id, 'year_set_current', `year:${id}`);
  });
  // Start and end dates of a term (YYYY-MM-DD). Send both empty to remove them. Terms of one year may not overlap.
  route('PUT', '/terms/:id/dates', ADMIN, async (c) => {
    const id = S.toInt(c.params.id);
    const term = id === null ? null : await h.get('SELECT id, year_id FROM terms WHERE id = ? AND school_id = ?', id, c.schoolId);
    if (!term) throw S.notFound();
    const a = S.str(c.body.starts_on, 10), b = S.str(c.body.ends_on, 10);
    if (!a && !b) { await h.run('DELETE FROM term_dates WHERE term_id = ? AND school_id = ?', id, c.schoolId); await h.audit(c.schoolId, c.user.id, 'term_dates_cleared', `term:${id}`); return { ok: true, starts_on: null, ends_on: null }; }
    if (!S.isDate(a) || !S.isDate(b)) throw S.bad('invalid_date');
    if (a > b) throw S.bad('term_dates_order');
    const clash = await h.get(`SELECT 1 FROM term_dates d JOIN terms t ON t.id = d.term_id AND t.school_id = d.school_id
      WHERE d.school_id = ? AND t.year_id = ? AND d.term_id <> ? AND d.starts_on <= ? AND d.ends_on >= ?`, c.schoolId, term.year_id, id, b, a);
    if (clash) throw S.bad('term_dates_overlap');
    const had = await h.get('SELECT 1 FROM term_dates WHERE term_id = ? AND school_id = ?', id, c.schoolId);
    if (had) await h.run("UPDATE term_dates SET starts_on = ?, ends_on = ?, updated_by = ?, updated_at = datetime('now') WHERE term_id = ? AND school_id = ?", a, b, c.user.id, id, c.schoolId);
    else await h.run("INSERT INTO term_dates (school_id, term_id, starts_on, ends_on, updated_by, updated_at) VALUES (?,?,?,?,?,datetime('now'))", c.schoolId, id, a, b, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'term_dates_set', `term:${id}`, { starts_on: a, ends_on: b });
    return { ok: true, starts_on: a, ends_on: b };
  });
  route('POST', '/terms', ADMIN, async (c) => {
    const yid = S.toInt(c.body.year_id);
    if (!await h.get('SELECT 1 FROM academic_years WHERE id = ? AND school_id = ?', yid, c.schoolId)) throw S.bad('invalid_year');
    const pos = (await h.get('SELECT COALESCE(MAX(position),0)+1 p FROM terms WHERE year_id = ?', yid)).p;
    const r = await h.insert('INSERT INTO terms (school_id, year_id, name, position) VALUES (?,?,?,?)', c.schoolId, yid, S.req(c.body.name, 'name_required', 40), pos);
    await h.audit(c.schoolId, c.user.id, 'term_created', `term:${r}`);
    return { id: r };
  });

  // users & permissions
  route('GET', '/users', ADMIN, async (c) => await h.all(
    'SELECT id, email, name, role, student_id, active, last_login FROM users WHERE school_id = ? ORDER BY role, name', c.schoolId));
  route('POST', '/users', ADMIN, async (c) => {
    const role = c.body.role;
    if (!['teacher', 'parent', 'student'].includes(role)) throw S.bad('invalid_role'); // nobody can create another administrator
    const email = S.str(c.body.email, 200).toLowerCase();
    if (!S.isEmail(email)) throw S.bad('invalid_email');
    if (await h.get('SELECT 1 FROM users WHERE email = ? AND school_id = ?', email, c.schoolId)) throw S.bad('email_in_use');
    const name = S.req(c.body.name, 'name_required', 120);
    let studentId = null;
    if (role === 'student') {
      studentId = S.toInt(c.body.student_id);
      if (!await h.get('SELECT 1 FROM students WHERE id = ? AND school_id = ?', studentId, c.schoolId)) throw S.bad('invalid_student');
    }
    const temp = S.randomPassword();
    const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const r = await h.insert('INSERT INTO users (school_id, email, password_hash, name, initials, role, student_id, must_change_password) VALUES (?,?,?,?,?,?,?,1)',
      c.schoolId, email, S.hashPassword(temp), name, initials, role, studentId);
    await h.audit(c.schoolId, c.user.id, 'user_created', `user:${r}`, { role });
    return { id: r, temporary_password: temp };
  });
  route('PUT', '/users/:id', ADMIN, async (c) => {
    const u = await h.get('SELECT * FROM users WHERE id = ? AND school_id = ?', Number(c.params.id), c.schoolId);
    if (!u || u.role === 'school_admin') throw S.notFound();
    const name = c.body.name !== undefined ? S.req(c.body.name, 'name_required', 120) : u.name;
    const active = c.body.active !== undefined ? (c.body.active ? 1 : 0) : u.active;
    await h.run('UPDATE users SET name = ?, active = ? WHERE id = ? AND school_id = ?', name, active, u.id, c.schoolId);
    if (!active) await h.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await h.audit(c.schoolId, c.user.id, 'user_updated', `user:${u.id}`, { active });
  });
  route('POST', '/users/:id/reset-password', ADMIN, async (c) => {
    const u = await h.get('SELECT * FROM users WHERE id = ? AND school_id = ?', Number(c.params.id), c.schoolId);
    if (!u || u.role === 'school_admin') throw S.notFound();
    const temp = S.randomPassword();
    await h.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ? AND school_id = ?', S.hashPassword(temp), u.id, c.schoolId);
    await h.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await h.audit(c.schoolId, c.user.id, 'password_reset', `user:${u.id}`);
    return { temporary_password: temp };
  });
  route('GET', '/audit-log', ADMIN, async (c) => {
    const page = Math.max(1, Number(c.query.page) || 1);
    const rows = await h.all(`SELECT a.id, a.action, a.record, a.meta, a.at, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.school_id = ? ORDER BY a.id DESC LIMIT 25 OFFSET ?`, c.schoolId, (page - 1) * 25);
    return { rows, page };
  });
  route('GET', '/login-history', ADMIN, async (c) => await h.all(
    'SELECT ok, at FROM login_log WHERE user_id = ? ORDER BY id DESC LIMIT 10', c.user.id));
};
