'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('./app');
const S = require('./security');

// Load .env (simple KEY=VALUE lines) without any extra package.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const dataDir = path.resolve(process.env.JAO_DATA_DIR || path.join(__dirname, '..', 'data'));

async function main() {
  const app = await createApp({ dbFile: path.join(dataDir, 'jao.db'), dataDir, secureCookies: process.env.JAO_SECURE_COOKIES === '1' });
  // First run: create the platform owner and the Seraphim International school with its administrator.
  // Passwords are generated randomly and printed ONCE here. They are never stored in the project files.
  async function firstRun(app) {
    const { h } = app;
    const lines = [];
    if (!await h.get("SELECT 1 FROM users WHERE role = 'platform_owner'")) {
      const email = (process.env.JAO_OWNER_EMAIL || 'owner@jao.local').toLowerCase();
      const pw = process.env.JAO_OWNER_PASSWORD || S.randomPassword();
      await h.run("INSERT INTO users (school_id, email, password_hash, name, initials, role, must_change_password) VALUES (NULL,?,?, 'JAO Platform Owner', 'JO', 'platform_owner', ?)", email, S.hashPassword(pw), process.env.JAO_OWNER_PASSWORD ? 0 : 1);
      lines.push(`Platform owner   email: ${email}   temporary password: ${pw}`);
    }
    if (!await h.get('SELECT 1 FROM schools')) {
      const email = (process.env.JAO_ADMIN_EMAIL || 'jao@seraphim.local').toLowerCase();
      const pw = process.env.JAO_ADMIN_PASSWORD || S.randomPassword();
      await h.tx(async () => await app.createSchool({ name: 'Seraphim International', adminName: 'Jao Jao', adminEmail: email, adminPassword: pw, slug: 'seraphim-international', code: 'JAO-0001', mustChange: !process.env.JAO_ADMIN_PASSWORD }, true));
      lines.push(`School admin     email: ${email}   temporary password: ${pw}   (Jao Jao, Seraphim International)`);
    }
    if (lines.length) {
      console.log('\n=== FIRST RUN: save these sign-in details now. They are shown only once. ===');
      lines.forEach((l) => console.log(l));
      console.log('You will be asked to choose a new password at first sign-in.\n');
    }
  }
  await firstRun(app);

  // Automatic backups (database + uploads). Default: every 24 hours, keeping the newest 14.
  const { runBackup, listBackups } = require('./backup');
  const everyH = process.env.JAO_BACKUP_EVERY_HOURS === undefined ? 24 : Number(process.env.JAO_BACKUP_EVERY_HOURS);
  if (everyH > 0) {
    const keep = Number(process.env.JAO_BACKUP_KEEP) || 14;
    const doBackup = () => { try { console.log('Automatic backup saved:', runBackup(app.db.raw, dataDir, { keep })); } catch (e) { console.error('BACKUP FAILED:', e.message); } };
    const last = listBackups(dataDir).pop();
    const lastTime = last ? fs.statSync(path.join(dataDir, 'backups', last)).mtimeMs : 0;
    setTimeout(doBackup, Date.now() - lastTime > everyH * 3600e3 ? 15e3 : 60e3).unref();
    setInterval(doBackup, everyH * 3600e3).unref();
  }

  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`JAO is running:  http://localhost:${port}`);
    console.log(`DOUDOUS² mode: ${process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL ? 'AI model configured' : 'approved knowledge base only (no AI key configured)'}`);
  });
}
main().catch((e) => { console.error('JAO could not start:', e.message); process.exit(1); });
