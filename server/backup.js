'use strict';
// Backups and restore. A backup is a folder holding a consistent copy of the database (made with VACUUM INTO, which is
// safe while the app is running) plus a copy of the private uploads folder (student photos, logos, product images).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = 'jao-backup-';
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function listBackups(dataDir) {
  const dir = path.join(dataDir, 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.startsWith(PREFIX) && fs.statSync(path.join(dir, n)).isDirectory()).sort();
}

// db: an open DatabaseSync (the running app's, or a fresh connection from the command line).
function runBackup(db, dataDir, { keep = 14 } = {}) {
  const dest = path.join(dataDir, 'backups', PREFIX + stamp());
  fs.mkdirSync(dest, { recursive: true });
  const target = path.join(dest, 'jao.db');
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const uploads = path.join(dataDir, 'uploads');
  if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dest, 'uploads'), { recursive: true });
  // Prove the copy is readable before trusting it.
  const check = new DatabaseSync(target, { readOnly: true });
  const ok = check.prepare('PRAGMA integrity_check').get().integrity_check === 'ok';
  check.close();
  if (!ok) { fs.rmSync(dest, { recursive: true, force: true }); throw new Error('backup failed its integrity check and was removed'); }
  const all = listBackups(dataDir);
  for (const old of all.slice(0, Math.max(0, all.length - Math.max(1, keep)))) fs.rmSync(path.join(dataDir, 'backups', old), { recursive: true, force: true });
  return dest;
}

// Restore a backup folder into dataDir. The app must be STOPPED. The current data is kept as a safety copy first.
function restoreBackup(backupDir, dataDir) {
  const src = path.resolve(backupDir);
  if (!fs.existsSync(path.join(src, 'jao.db'))) throw new Error('that folder is not a JAO backup (no jao.db inside)');
  const probe = new DatabaseSync(path.join(src, 'jao.db'), { readOnly: true });
  if (probe.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') { probe.close(); throw new Error('the backup failed its integrity check; nothing was changed'); }
  probe.close();
  const safety = path.join(dataDir, 'backups', `before-restore-${stamp()}`);
  fs.mkdirSync(safety, { recursive: true });
  for (const f of ['jao.db', 'jao.db-wal', 'jao.db-shm']) if (fs.existsSync(path.join(dataDir, f))) fs.renameSync(path.join(dataDir, f), path.join(safety, f));
  if (fs.existsSync(path.join(dataDir, 'uploads'))) fs.renameSync(path.join(dataDir, 'uploads'), path.join(safety, 'uploads'));
  fs.copyFileSync(path.join(src, 'jao.db'), path.join(dataDir, 'jao.db'));
  if (fs.existsSync(path.join(src, 'uploads'))) fs.cpSync(path.join(src, 'uploads'), path.join(dataDir, 'uploads'), { recursive: true });
  return { safety };
}

module.exports = { runBackup, restoreBackup, listBackups, PREFIX };
