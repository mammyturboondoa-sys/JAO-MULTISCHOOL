'use strict';
// 0013: Super Administrator tools: subscription plans, school subscriptions, manually recorded payments, platform announcements. Additive only.
// Prices start at 0: the owner sets them. Payments are RECORDS made by the owner; JAO does not process money.
module.exports = {
  version: 13, name: 'platform_finance',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('currency', 'XAF');
      CREATE TABLE IF NOT EXISTS platform_plans (
        code TEXT PRIMARY KEY CHECK (code IN ('basic','standard','premium')), name TEXT NOT NULL,
        price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0), period_months INTEGER NOT NULL DEFAULT 12 CHECK (period_months BETWEEN 1 AND 60),
        max_students INTEGER, description TEXT
      );
      INSERT OR IGNORE INTO platform_plans (code, name) VALUES ('basic', 'Basic'), ('standard', 'Standard'), ('premium', 'Premium');
      CREATE TABLE IF NOT EXISTS school_subscriptions (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), plan_code TEXT NOT NULL REFERENCES platform_plans(code),
        starts_on TEXT NOT NULL, expires_on TEXT NOT NULL, amount_due INTEGER NOT NULL DEFAULT 0 CHECK (amount_due >= 0), note TEXT,
        created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), CHECK (expires_on >= starts_on)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS school_subscriptions_school_id_id ON school_subscriptions(school_id, id);
      CREATE INDEX IF NOT EXISTS school_subscriptions_school ON school_subscriptions(school_id, expires_on);
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), subscription_id INTEGER NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0), paid_on TEXT NOT NULL, method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','mobile_money','cheque','other')),
        reference TEXT, note TEXT, recorded_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, subscription_id) REFERENCES school_subscriptions(school_id, id)
      );
      CREATE INDEX IF NOT EXISTS subscription_payments_school ON subscription_payments(school_id, paid_on);
      CREATE TABLE IF NOT EXISTS platform_announcements (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL CHECK (audience IN ('all','selected')),
        recipients INTEGER NOT NULL DEFAULT 0, sent_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
