'use strict';
// 0008: in-app notification centre (shared by all modules) and a log of prepared convocation messages. Additive only.
module.exports = {
  version: 8, name: 'notifications',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), user_id INTEGER NOT NULL,
        kind TEXT NOT NULL, data TEXT, link TEXT, read_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id)
      );
      CREATE INDEX IF NOT EXISTS notifications_user ON notifications(school_id, user_id, read_at, id);
      CREATE TABLE IF NOT EXISTS convocation_dispatches (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), convocation_id INTEGER NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email','sms')),
        status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared')),   -- no delivery status exists until a real provider is connected
        actor_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, convocation_id) REFERENCES convocations(school_id, id),
        FOREIGN KEY (school_id, actor_id) REFERENCES users(school_id, id)
      );
    `);
  },
};
