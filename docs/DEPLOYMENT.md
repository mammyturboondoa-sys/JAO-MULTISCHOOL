# JAO — Hosting and operating guide

**Status: NOT deployed and NOT approved for real schools.** Nothing in this guide has been created online. No account, server
or paid service exists. This file explains what is ready, what is missing, what it costs, and what you must decide.

## 1. What the hosting PDFs ask for, and where JAO stands

| Requirement (from your PDFs) | Status |
|---|---|
| Multi-school data (`school_id` on every record, server-side checks, no trusting the browser) | **Done and tested** (SQLite) |
| PostgreSQL **with Row Level Security** | **NOT done.** JAO uses SQLite. Isolation is enforced by server checks + composite `(school_id, id)` database keys, not by PostgreSQL RLS |
| Managed database (Supabase) and private file storage | **NOT done.** Data and private files are on the server's disk |
| Vercel/Render hosting | **Prepared, not deployed** (`Dockerfile`, `render.yaml`) |
| HTTPS | **Ready in the code** (secure cookies, HSTS, redirect, proxy address) but only real once a host provides HTTPS. **Not tested online** |
| Automatic backups + restore | **Done and tested locally** (database + private files). Off-site copies and restore drills on the real host are still to do |
| Monitoring and alerts | **Partly:** `/healthz` for uptime checks and a log line for refused access (401/403/429). No alert service connected |
| Separate staging and production | **Not set up** |
| Password reset, sessions | Done (super administrator creates a one-time link) |
| Doudous² never sends private data to the AI | Done (only approved knowledge is used) |

### The big decision: SQLite or PostgreSQL?
- **Option A — keep SQLite on one paid server with a disk (small, simple).** Fine for a handful of schools. One server, one disk: a
  server problem means downtime, and the database is not managed for you. This is what `render.yaml` prepares.
- **Option B — move to PostgreSQL (+ RLS) on Supabase, as your PDFs describe.** More robust and matches the PDFs, but it means
  rewriting the database layer and re-testing everything. I cannot install the PostgreSQL driver in my current environment (package
  installs are blocked), so this must be done later in an environment that allows it.

## 2. Estimated costs (checked 8 Nov 2026 — confirm on the providers' sites before paying)
- **Render** (workspace Hobby $0/month): web service from **$7/month** (small instance); persistent disk **$0.25 per GB/month**
  (5 GB ≈ $1.25). Free web services normally do not keep files between restarts (please confirm on Render's site), so JAO needs a paid instance with a disk. Source: [Render pricing](https://render-www.onrender.com/pricing).
- **Supabase** (if Option B): Free plan = 500 MB database, 1 GB files, **pauses after 7 days of inactivity, no daily backups listed**
  — not suitable for real schools. Pro = **$25/month**, 8 GB database, 100 GB files, daily backups kept 7 days. Source: [Supabase pricing summary](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/).
- **Domain name:** about $10–20 per year (not included above). **OpenAI** (optional) is billed by use.
- Rough monthly total: **Option A about $8–10**, **Option B about $32+** before the domain.

## 3. Accounts you (the owner) must own
Domain, hosting, database, code repository and billing must all be in **your** name, with a trusted adult helping with registration
and payment. Developers get only the access they need. Never share passwords in documents; set secrets in the host's
"environment variables" screen.

## 4. If you approve Option A (steps for later; do not start before approval)
1. Put the project in a private code repository that you own.
2. Create a Render account, then a Web Service from the repository using `render.yaml` (this starts billing).
3. Type the secret values in Render's dashboard (`JAO_OWNER_EMAIL`, `JAO_OWNER_PASSWORD`, `JAO_ADMIN_EMAIL`, `JAO_ADMIN_PASSWORD`).
4. Attach your domain; Render provides HTTPS. Check that `https://your-domain/healthz` answers `{"ok":true}`.
5. Sign in as the super administrator immediately and change the password.
6. Run the **acceptance checklist** below on the live site.

## 5. Backups and recovery
- JAO saves a backup (database + private files) automatically every 24 hours into `data/backups/` and keeps the newest 14.
  Change with `JAO_BACKUP_EVERY_HOURS` and `JAO_BACKUP_KEEP`. Manual backup any time: `npm run backup`.
- **These backups are on the same disk as the data.** If the disk is lost, they are lost too. Before real use you must also copy
  them off the server regularly (for example download the newest backup folder, or use the host's disk snapshots). Not yet automated.
- **Restore (app stopped):** `npm run restore` lists backups; `npm run restore -- data/backups/jao-backup-<date> --yes`. The current
  data is saved first in `data/backups/before-restore-…`. Restore was tested automatically on a copy: data and private files came back
  and the files stayed private.
- Do a restore drill before launch and every few months.

## 6. What the provider does vs. what still needs maintenance
- **Provider:** data-centre hardware, power, network, HTTPS certificates, restarting a crashed server (with the health check).
- **You / a developer:** every JAO bug fix and new feature, dependency and Node.js updates, copying backups off-site, watching the
  logs for `access_refused` lines, testing restores, rotating passwords, and paying the bills.

## 7. Acceptance checklist (from your PDFs) — to run ONLINE before any launch
- [ ] Users of two schools can sign in from different places and devices.
- [ ] School A cannot read or change School B data (change IDs and URLs; list, search, detail, update, delete, reports, files).
- [ ] Public visitors see only the public shop and approved public information.
- [ ] Backups are enabled **and a restore test succeeds on the live setup**.
- [ ] You own the accounts and could change developers without losing the app or data.
- [ ] HTTPS everywhere; mobile check on a real phone.
Already proven **locally** by automated tests: the first, second (two-school isolation), third and parts of the fourth point.
