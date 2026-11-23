'use strict';
// Scholarship Finder: a shared catalogue of external scholarships maintained by the platform owner. Each school's administrator chooses which published
// entries their school shows. JAO only lists information and links to the OFFICIAL page; it never applies on anyone's behalf and never invents dates.
const fs = require('node:fs');
const path = require('node:path');
const S = require('./security');

const OWNER = ['platform_owner'], ADMIN = ['school_admin'], FAMILY_AND_STAFF = ['school_admin', 'teacher', 'student', 'parent'];
const today = () => new Date().toISOString().slice(0, 10);
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

module.exports = function (app) {
  const { h, route } = app;
  const shape = (e) => ({ id: e.id, title: e.title, provider: e.provider, country: e.country, levels: e.levels, eligibility: e.eligibility, coverage: e.coverage, how_to_apply: e.how_to_apply, official_url: e.official_url,
    deadline: e.deadline, deadline_note: e.deadline_note, last_verified_on: e.last_verified_on, status: e.status, deadline_passed: !!(e.deadline && e.deadline < today()) });
  function fields(b, prev = {}) {
    const get = (k) => (b[k] === undefined ? prev[k] : b[k]);
    const title = S.req(get('title'), 'title_required', 160), provider = S.req(get('provider'), 'provider_required', 160);
    const url = S.str(get('official_url'), 500); if (!isHttps(url)) throw S.bad('invalid_url');
    const verified = get('last_verified_on'); if (!S.isDate(verified) || verified > today()) throw S.bad('invalid_date');
    const deadline = get('deadline') || null; if (deadline !== null && !S.isDate(deadline)) throw S.bad('invalid_date');
    const status = get('status') || 'draft'; if (!['draft', 'published', 'archived'].includes(status)) throw S.bad('invalid_status');
    return { title, provider, country: S.str(get('country'), 120) || null, levels: S.str(get('levels'), 160) || null, eligibility: S.str(get('eligibility'), 3000) || null, coverage: S.str(get('coverage'), 2000) || null,
      how_to_apply: S.str(get('how_to_apply'), 2000) || null, official_url: url, deadline, deadline_note: S.str(get('deadline_note'), 600) || null, last_verified_on: verified, status };
  }
  const cols = ['title', 'provider', 'country', 'levels', 'eligibility', 'coverage', 'how_to_apply', 'official_url', 'deadline', 'deadline_note', 'last_verified_on', 'status'];

  // ---------- platform owner: maintain the shared catalogue ----------
  route('GET', '/platform/external-scholarships', OWNER, async () => (await h.all("SELECT e.*, (SELECT COUNT(*) FROM school_external_scholarships s WHERE s.external_id = e.id) schools FROM external_scholarships e ORDER BY e.status = 'archived', e.title")).map((e) => ({ ...shape(e), schools: e.schools })));
  route('POST', '/platform/external-scholarships', OWNER, async (c) => {
    const f = fields(c.body);
    if (await h.get('SELECT 1 FROM external_scholarships WHERE official_url = ?', f.official_url)) throw S.bad('url_in_use');
    const id = await h.insert(`INSERT INTO external_scholarships (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((k) => f[k]));
    await h.audit(null, c.user.id, 'external_scholarship_created', `external_scholarship:${id}`); return { id };
  });
  route('PUT', '/platform/external-scholarships/:id', OWNER, async (c) => {
    const id = S.toInt(c.params.id); const e = id === null ? null : await h.get('SELECT * FROM external_scholarships WHERE id = ?', id); if (!e) throw S.notFound();
    const f = fields(c.body, e);
    if (f.official_url !== e.official_url && await h.get('SELECT 1 FROM external_scholarships WHERE official_url = ? AND id <> ?', f.official_url, id)) throw S.bad('url_in_use');
    await h.run(`UPDATE external_scholarships SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = NOW_TS WHERE id = ?`, ...cols.map((k) => f[k]), id);
    await h.audit(null, c.user.id, 'external_scholarship_updated', `external_scholarship:${id}`);
  });
  // Loads the starter list that ships with JAO (read from official pages, dated). Safe to run again: entries already present are skipped.
  route('POST', '/platform/external-scholarships/starter', OWNER, async (c) => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'external-scholarships-starter.json'), 'utf8')); let added = 0;
    for (const e of data.entries) {
      if (await h.get('SELECT 1 FROM external_scholarships WHERE official_url = ?', e.official_url)) continue;
      const f = fields({ ...e, status: 'published' });
      await h.insert(`INSERT INTO external_scholarships (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((k) => f[k])); added++;
    }
    await h.audit(null, c.user.id, 'external_scholarships_starter_loaded', 'catalogue', { added }); return { added, total: data.entries.length };
  });

  // ---------- school administrator: choose what the school shows ----------
  route('GET', '/finder/catalogue', ADMIN, async (c) => (await h.all(`SELECT e.*, (SELECT 1 FROM school_external_scholarships s WHERE s.external_id = e.id AND s.school_id = ?) approved FROM external_scholarships e WHERE e.status = 'published' ORDER BY e.title`, c.schoolId)).map((e) => ({ ...shape(e), approved: !!e.approved })));
  route('POST', '/finder/catalogue/:id/approve', ADMIN, async (c) => {
    const id = S.toInt(c.params.id); const e = id === null ? null : await h.get("SELECT id FROM external_scholarships WHERE id = ? AND status = 'published'", id); if (!e) throw S.notFound();
    if (typeof c.body.approved !== 'boolean') throw S.bad('invalid_data');
    if (c.body.approved) await h.run('INSERT OR IGNORE INTO school_external_scholarships (school_id, external_id, approved_by) VALUES (?,?,?)', c.schoolId, id, c.user.id);
    else await h.run('DELETE FROM school_external_scholarships WHERE school_id = ? AND external_id = ?', c.schoolId, id);
    await h.audit(c.schoolId, c.user.id, c.body.approved ? 'external_scholarship_approved' : 'external_scholarship_withdrawn', `external_scholarship:${id}`);
  });

  // ---------- everyone in the school: browse what the school approved ----------
  route('GET', '/finder', FAMILY_AND_STAFF, async (c) => {
    const where = ["e.status = 'published'", 'EXISTS (SELECT 1 FROM school_external_scholarships s WHERE s.external_id = e.id AND s.school_id = ?)'], p = [c.schoolId];
    const q = S.str(c.query.q, 80);
    if (q) { where.push("(LOWER(e.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(e.provider) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(e.country,'')) LIKE LOWER(?) ESCAPE '\\')"); const l = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(l, l, l); }
    const level = S.str(c.query.level, 40); if (level) { where.push("LOWER(COALESCE(e.levels,'')) LIKE LOWER(?) ESCAPE '\\'"); p.push(`%${level.replace(/[\\%_]/g, '\\$&')}%`); }
    const rows = await h.all(`SELECT e.*, (SELECT 1 FROM external_scholarship_bookmarks b WHERE b.external_id = e.id AND b.user_id = ?) saved FROM external_scholarships e WHERE ${where.join(' AND ')} ORDER BY e.title`, c.user.id, ...p);
    return rows.map((e) => ({ ...shape(e), saved: !!e.saved }));
  });
  route('POST', '/finder/:id/bookmark', FAMILY_AND_STAFF, async (c) => {
    const id = S.toInt(c.params.id); const e = id === null ? null : await h.get("SELECT e.id FROM external_scholarships e WHERE e.id = ? AND e.status = 'published' AND EXISTS (SELECT 1 FROM school_external_scholarships s WHERE s.external_id = e.id AND s.school_id = ?)", id, c.schoolId); if (!e) throw S.notFound();
    if (typeof c.body.saved !== 'boolean') throw S.bad('invalid_data');
    if (c.body.saved) await h.run('INSERT OR IGNORE INTO external_scholarship_bookmarks (school_id, user_id, external_id) VALUES (?,?,?)', c.schoolId, c.user.id, id);
    else await h.run('DELETE FROM external_scholarship_bookmarks WHERE school_id = ? AND user_id = ? AND external_id = ?', c.schoolId, c.user.id, id);
  });
};
