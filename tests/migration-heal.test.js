'use strict';
// A database that skipped one of the renumbered upgrade migrations is repaired by 0017 without touching data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../server/db/migrate');

test('migration 0017 adds missing upgrade tables to a database that already has versions 12-16 recorded', () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, ':memory:');
  db.exec('INSERT INTO schools (name, code, slug) VALUES (\'S\', \'JAO-9\', \'s\')');
  db.exec('DROP TABLE owner_recovery_codes; DROP TABLE owner_security; DROP TABLE subscription_payments; DROP TABLE school_subscriptions; DROP TABLE external_scholarship_bookmarks; DROP TABLE school_external_scholarships; DROP TABLE external_scholarships; DELETE FROM schema_migrations WHERE version = 17');
  const out = runMigrations(db, ':memory:');
  assert.deepEqual(out.applied, [17]);
  for (const t of ['owner_security', 'owner_recovery_codes', 'school_subscriptions', 'subscription_payments', 'external_scholarships', 'school_external_scholarships', 'external_scholarship_bookmarks'])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t), t);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schools').get().n, 1, 'existing data untouched');
});
