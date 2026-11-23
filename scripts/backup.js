'use strict';
// Usage: npm run backup        (safe to run while the app is running)
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runBackup } = require('../server/backup');
const dataDir = path.resolve(process.env.JAO_DATA_DIR || path.join(__dirname, '..', 'data'));
const db = new DatabaseSync(path.join(dataDir, 'jao.db'));
console.log('Backup saved to:', runBackup(db, dataDir, { keep: Number(process.env.JAO_BACKUP_KEEP) || 14 }));
db.close();
