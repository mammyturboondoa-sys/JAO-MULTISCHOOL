'use strict';
// In-app notification centre. Each person only ever sees their own notifications (user_id comes from the session).
const S = require('./security');

module.exports = function (app) {
  const { h, route } = app;
  const ALL = ['school_admin', 'teacher', 'parent', 'student'];
  // Other modules call app.notify(...). Stored as a kind + small data object; the screen translates it.
  app.notify = (schoolId, userId, kind, data, link) => h.run('INSERT INTO notifications (school_id, user_id, kind, data, link) VALUES (?,?,?,?,?)', schoolId, userId, kind, JSON.stringify(data || {}), link || null);

  route('GET', '/notifications', ALL, async (c) => {
    const rows = await h.all('SELECT id, kind, data, link, read_at, created_at FROM notifications WHERE school_id = ? AND user_id = ? ORDER BY id DESC LIMIT 30', c.schoolId, c.user.id);
    const unread = (await h.get('SELECT COUNT(*) n FROM notifications WHERE school_id = ? AND user_id = ? AND read_at IS NULL', c.schoolId, c.user.id)).n;
    return { unread, items: rows.map((r) => ({ id: r.id, kind: r.kind, data: JSON.parse(r.data || '{}'), link: r.link, read: !!r.read_at, created_at: r.created_at })) };
  });
  route('POST', '/notifications/read-all', ALL, async (c) => {
    await h.run('UPDATE notifications SET read_at = NOW_TS WHERE school_id = ? AND user_id = ? AND read_at IS NULL', c.schoolId, c.user.id);
  });
  route('POST', '/notifications/:id/read', ALL, async (c) => {
    const id = S.toInt(c.params.id);
    if (id === null) throw S.notFound();
    await h.run('UPDATE notifications SET read_at = NOW_TS WHERE id = ? AND school_id = ? AND user_id = ? AND read_at IS NULL', id, c.schoolId, c.user.id);
  });
};
