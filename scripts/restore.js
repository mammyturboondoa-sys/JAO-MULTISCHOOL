'use strict';
// Usage: STOP the app first, then:  npm run restore -- data/backups/jao-backup-<date>   (add --yes to confirm)
const path = require('node:path');
const { restoreBackup, listBackups } = require('../server/backup');
const dataDir = path.resolve(process.env.JAO_DATA_DIR || path.join(__dirname, '..', 'data'));
const args = process.argv.slice(2).filter((a) => a !== '--yes');
if (!args[0]) { console.log('Available backups (newest last):'); listBackups(dataDir).forEach((b) => console.log('  ' + path.join(dataDir, 'backups', b))); console.log('\nRun: npm run restore -- <folder> --yes'); process.exit(0); }
if (!process.argv.includes('--yes')) { console.log('This replaces the current data with the backup (the current data is saved first). Add --yes to continue.'); process.exit(1); }
const r = restoreBackup(args[0], dataDir);
console.log('Restored. Your previous data was kept in:', r.safety);
