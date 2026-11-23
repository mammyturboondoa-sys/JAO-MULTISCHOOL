# JAO — Multi-School Management System (first school: Seraphim International)

A working multi-school management web application (many schools, each fully private): login, roles, students, classes, subjects, grades,
report cards, a public school shop catalogue with stock control, settings, and the DOUDOUS²
assistant. English and French. Works on computers, tablets and phones.

## 1. How to run it (beginner steps)

You need **Node.js 22.5 or newer** (https://nodejs.org). Nothing else to install: the project has
no extra packages.

1. Open a terminal in this `jao` folder.
2. Run: `npm start`
3. The **first time**, the terminal prints sign-in details for the super administrator and for Jao
   (the school administrator). **Write them down — they are shown only once.** You will be asked
   to choose a new password at first sign-in.
4. Open http://localhost:3000 in your browser.

Optional: `npm run demo-data` adds a few clearly fictional "Demo …" records so you can try the
screens. Do not run it on a real school's data.

Run the automated tests with `npm test` (103 tests, SQLite only).

Optional settings: copy `.env.example` to `.env` and edit it (port, DOUDOUS² AI key, etc.).

## 1b. Multi-School (new)

- **First page** = "JAO – MULTI-SCHOOL MANAGEMENT SYSTEM" with two options:
  **Enter an Existing School** (search by school name or unique code such as `JAO-0001`, then sign in on
  that school's own page) and **Create a New School** (full registration form with logo).
- Every school has its own students, classes, subjects, users, grades, report cards, products and stock,
  settings and Dudus Square knowledge. The server decides the school from your signed-in session, never from
  the browser, and the database refuses links between schools. Changing a URL or request cannot reveal another
  school's records (it answers "not found").
- **Seraphim International is school number 1 (code `JAO-0001`).**
- **Super Administrator** (sign in from the small link "JAO super administrator" on the first page, or `#/super`):
  sees all schools, approves/rejects registrations, activates/deactivates schools and sees basic school information
  and totals only. It can never see students, guardians or grades. Each school keeps its own single administrator.
- **New schools wait for approval.** When someone registers, the school and its administrator account are created
  but locked until the super administrator approves it (this follows the earlier rule that self-registration needs
  approval). To let schools activate instantly instead, set `JAO_AUTO_APPROVE_SCHOOLS=1` in `.env`.
- **Upgrading an existing installation:** keep your `data/` folder and start the new version. On first start it
  adds the new columns, gives Seraphim the code `JAO-0001`, changes no existing record, and first saves a copy of
  your database in `data/backups/`. It only does this once.
- **Forgotten administrator password:** the super administrator opens Platform → the school → **Reset password**. This
  creates a ONE-TIME link (valid 24 hours, one use, shown only once). The super administrator gives the link to the
  school administrator, who opens it and chooses their own new password. The super administrator never sees or
  chooses the password. Using the link signs the administrator out everywhere, and a newer link cancels older ones.
  (There is no e-mail sending, so the link must be passed on by hand, for example by phone or WhatsApp.)
- **Super administrator password:** choose your own permanent password at first sign-in and change it any time under *Account & security*; it is stored only as a hash in the database (so it survives restarts, updates and backups). Forgot it? Use a one-time recovery code on the sign-in page, or run `npm run reset-owner` on the server. Full details: `docs/SUPER_ADMIN.md`.
- Known limit: an e-mail address can belong to only one account on the whole platform.

## 1c. Prefects (new)

- Menu **Prefects**. The school administrator appoints prefects for an academic year; teachers and parents can see the list (name, class and post only).
- **Only students of Form 5, Lower Sixth and Upper Sixth** can be appointed (Terminale / Première also count). The server checks this, not only the screen.
- Every school gets a starting list of 19 posts (Head Prefect, Senior Prefect, Discipline Prefect, Sports Prefect...). Under **Prefects > Posts** a school can rename, add or switch off posts.
- The prefect post also appears on the **student's profile** (Profile tab, row "Prefect"), so the student's parent sees it for their own child.
- A post can be ended by the administrator. If a prefect of the current year graduates, transfers or leaves Form 5 - Upper Sixth, the post ends by itself. Records are kept, never deleted.
- Upgrading: replace the files, keep `data/`. One new migration (0021) adds two new tables and changes nothing existing; a safety copy is saved first.

- **Look and feel:** `public/css/polish.css` adds smooth motion and colour (cards rise in and lift on hover, shining buttons, colour glow in the background, animated gold-and-blue frame on prefect cards). It is pure CSS and stops for people who ask their device for reduced motion. To switch it off, remove its `<link>` line from `public/index.html`.

## 2. What is where

| Folder / file | What it is |
|---|---|
| `server/` | Backend (Node). `db.js` = database tables, `security.js` = passwords/sessions, `access.js` = who may see which student, `routes-*.js` = the features, `calc.js` = grade maths, `help.js` = what DOUDOUS² knows about the app |
| `public/` | Frontend. `index.html`, `css/app.css` (navy/gold/white design), `js/` = screens, `js/i18n.js` = **all English and French text** |
| `data/` | Created on first run: the database (`jao.db`) and private uploads. **This is what you back up.** |
| `tests/` | Automated tests |
| `scripts/demo-data.js` | Optional demo records |

## 3. The 10 modules

Overview · Students · Classes · Subjects · Grades · Results & Reports · School Shop ·
Products & Stock · Settings (incl. School Knowledge Management) · DOUDOUS².
There is also the Welcome screen, the Multi-School first page, school sign-in, and a Platform page for the JAO
super administrator (approves new schools; cannot see any student, guardian or grade data).

## 4. Who can do what

- **Administrator (Jao)** — the only person who can create or change school records and settings.
  Only one administrator per school (enforced by the database).
- **Teacher** — read-only; only sees assigned classes, and only the grades of the subject they teach.
- **Parent** — only their own linked children. **Student** — only themselves.
- Parents and students see grades only **after the administrator approves** the term's report card.
- The public (not signed in) sees only the shop catalogue and public DOUDOUS² answers.
- All of this is checked **on the server**, not just hidden in the screen. Several tests try
  changing IDs in requests to prove one school or family cannot see another.

## 5. Things you can change easily

- **Welcome announcement text:** `ANNOUNCEMENT` at the top of `public/js/pages-public.js`
  (default is exactly "School Management Project.").
- **Portrait:** put the approved image at `public/assets/portrait.jpg`. Until then a placeholder shows.
  (I did not invent or download any photograph.)
- **Voice:** the visitor can choose Default / Woman / Man on the welcome screen. Default is used until
  Jao confirms a preference. The voices come from the visitor's browser and device.
- **Any wording:** `public/js/i18n.js` (English and French side by side).
- **DOUDOUS² AI:** put `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`. Without them DOUDOUS²
  answers only from approved help topics and *published* School Knowledge entries, and says so.
  Either way it never shows private records and says "I do not have confirmed information" when it
  has nothing approved to use. Update `server/help.js` whenever you change screens or buttons.

## 6. Decisions still waiting for Jao (nothing was guessed)

1. **Subject coefficients (decided: start EMPTY).** No coefficient values are pre-loaded and none are ever assumed.
   Jao enters them in Classes → Open a class → Assign subjects (each class and each school has its own values; all
   editable). While a graded subject has no coefficient, that student's overall average is **not shown**, the report card
   cannot be approved, and a yellow notice names the subject. Old installations keep whatever coefficients were
   already saved; please review them.
2. **Grading rules (pending Jao's final school-policy confirmation).** Starting values are /20 scale, pass mark 10, 2 decimals, ranking off. Change them in
   Settings → Academic Settings to match school rules. Subject average = mean of assessment
   percentages; overall = weighted by coefficients; absent/excused/missing are never counted as zero.
3. **Approved portrait** and **voice preference** (section 5).

## 7. Backup and going online

> **NOT ready for real schools online yet.** The code now has HTTPS settings, health check, automatic backups and a tested restore,
> and deployment files are prepared, but nothing is deployed, the PDFs' PostgreSQL/RLS design is NOT implemented (JAO uses SQLite),
> and no online test or independent security review has been done. See `docs/DEPLOYMENT.md`. Until they are, use the app only on your own computer or for testing.

- **Backup:** the app now saves an automatic backup (database + private files) every 24 hours in `data/backups/`
  (keeps 14). Run one any time with `npm run backup`. Restore with `npm run restore` (app stopped). **Also copy backups
  off the computer/server regularly**: they sit next to the data. Full guide, costs and checklist: `docs/DEPLOYMENT.md`.
- **Report cards as PDF:** open a report card → "Print / Save as PDF" → choose "Save as PDF".
- **Going online (not done yet):** the cloud-server/hosting PDFs are **not yet implemented**. Before
  real use online you still need: HTTPS (set `JAO_SECURE_COOKIES=1`), a reverse proxy, a managed
  backup routine, and a decision about hosting. The current setup (SQLite, one server) suits a single
  school; every record is tagged with its school, so it already serves many schools.
- There is no e-mail sending, so password resets are done by the administrator, who gives the person a
  temporary password.

## 8. Test status

- `npm test`: 168 passing (login, CSRF, rate limit, school isolation, database upgrades, one email in several schools, roles, privacy, grade maths,
  approval flow, shop, stock, DOUDOUS², and the whole Discipline module). All tests use SQLite only.
- Browser checks run on desktop, tablet (768px) and phone (390px): no sideways scrolling and no
  JavaScript errors on the administrator pages; parent flow checked on a phone.
- Not yet checked in a real browser: the teacher and student screens (their server rules are tested),
  and every French screen visually (all texts exist in French).


## How the database is organised (for developers)

- **SQLite is the only database.** Nothing else is needed to run JAO.
- All database access goes through one small interface in `server/db/sqlite.js` (`get`, `all`, `run`, `insert`, `tx`). Route code does not use SQLite-only features, so a different database could be added later without rewriting the screens. See `docs/FUTURE_DATABASE.md`.
- **Migrations** live in `server/migrations/sqlite/` and are numbered. The table `schema_migrations` records which have run. On start-up, an older database is upgraded automatically after a full safety backup in `data/backups/`. If an upgrade fails, it is rolled back.
- **School isolation in the database:** every school-owned record has `school_id`, and links between records are composite keys `(school_id, id)`, so the database itself refuses to link a record to another school's record. Tests: `tests/isolation.test.js` (attacks the database directly, and scans the server code for queries without a school filter) and `tests/migrations.test.js` (upgrades frozen old databases and checks no data is lost).

## One email, several schools

The same person can use one email address in several schools. Each school has its **own account** for that email, with its own password, role and permissions (for example, a teacher in one school and a parent in another). The person signs in on the page of the school they want (*Enter an Existing School*). A password for one school never works in another, and changing or resetting one account never changes the other. Inside one school an email can only be used once. (Migration `0003_email_per_school`.)

## Grading and coefficients

Every school starts with a scale of 20 and a pass mark of 10/20, and can change both (and rounding and ranking) in *Settings*. Coefficients start empty and are set by each school for each class and subject; no school can see or change another school's settings.

## Discipline module (complete)

Found under **Discipline** in the menu (administrator and authorised teachers). Incidents, disciplinary council, decisions, sanctions and **parent convocations** are all private to each school and only visible to the people the administrator authorises.

**Convocations (phase 4):** an officer writes a convocation, a principal or the administrator approves it, then anyone allowed can download the official A4 letter in English or French (PDF), print it, sign it and stamp it. Staff then record by hand how it reached the parent and what the parent answered. JAO does **not** send messages yet and never claims that a letter was delivered. The letter only shows the reason written for the parent; confidential council notes are never copied into it. Letters are generated on request, are not stored publicly, and each download is logged. The school logo is printed on the letter only if it is a JPEG.

**Notifications and messages (phase 5):** every user has an in-app notification list (the bell). When a convocation is approved, postponed or cancelled, the linked parent accounts get a notice, and parents have a **Convocations** page showing only their own children's issued letters (with PDF download). Staff can also open a ready-made short message in WhatsApp, email or SMS using the parent's saved contact. JAO only *prepares* it: you press send in your own app, JAO cannot know whether it arrived, and the message never contains the reason. Real automatic sending needs a paid provider and is not connected; it will only be added with your approval.

**Report cards (phase 6):** in Discipline > Report card, the administrator can switch on two optional items, both **off by default**: (1) the number of *confirmed* incidents this academic year, and (2) approved council decisions with their approved sanctions. Descriptions, reporter names, follow-up notes, council discussion and findings, dismissed or still-open incidents, and unapproved decisions are never shown. Parents and students only see it on a report card the administrator has approved. Report cards are per term but the school year is the period used, because terms have no dates yet.

### Installing and updating the Discipline build

**New install:** unzip, open a terminal in the `jao` folder, run `npm start` (Node.js 22 or newer, no other software). The database is created automatically.

**Updating an existing JAO:** (1) stop JAO; (2) copy your `data` folder somewhere safe (JAO also makes its own backup before upgrading); (3) unzip the new version over the old `jao` folder but **keep your `data` folder**; (4) start JAO again. The database upgrades itself (migrations 0004 to 0008 are additive: they only add tables and columns, nothing is deleted). If an upgrade fails, JAO rolls it back and tells you; put the `data` copy back and ask for help.

**Not done yet (honest list):** automatic WhatsApp/email/SMS sending (needs a paid provider, only prepared messages exist), PNG logos on the PDF letter, term dates, and everything on the hosting side: JAO is still **not ready for real schools online** until hosting, HTTPS, off-site backups and a security review are done and tested.

## Scholarships module (in progress — phases 1 and 2)

Menu entry **Scholarships**. Phase 1 gives each school its own scholarship opportunities: the administrator creates them (categories Academic Merit, Talent and Excellence, Social Support, External Scholarships), sets benefits, places, minimum average, eligible classes, open and closing dates, then publishes, suspends or closes them. Drafts are visible only to the administrator; staff, parents and students see published ones; a closed scholarship cannot be edited. The administrator also names which teachers may act as **reviewers** (they will only see applications assigned to them, from phase 2). Applications, eligibility checks, decisions, the external Scholarship Finder and DOUDOUS² answers come in the next phases.

**Applications (phase 2):** students apply for themselves and parents for a linked child. The server checks eligibility from the school's own data: scholarship open, student active, class eligible, and the minimum average taken **only from approved report cards** (if nothing is approved yet, the condition is reported as not confirmed, never guessed). Applicants write a motivation statement, attach PDF or image documents (private, 3 MB each, 8 at most), then submit; after submitting the application is locked. The administrator assigns reviewers (teachers named on the Scholarships page); a reviewer sees only the applications assigned to them and gives a private recommendation; only the administrator decides (approved, waiting list, or not selected, with a reason that the family sees). Approvals cannot exceed the number of places. Students and parents receive in-app notices. Reviewer notes are never shown to families.

**Welcome screen:** the first screen now uses the supplied JAO picture, with real clickable Login and FR/EN buttons placed over it, and a spoken "Welcome to JAO / Bienvenue à JAO".

## Super Administrator tools (platform owner only)
Sign in at `/#/super` (the "JAO super administrator" link on the first page). The owner menu has two entries:
- **Platform**: approve/reject school registrations, create schools, activate/suspend/reactivate, reset a school administrator's password link (existing screen, unchanged).
- **Subscriptions & finance**: Overview (schools active/suspended, total students, teachers, parents, revenue, outstanding), Subscriptions (Basic/Standard/Premium plans, prices you set, expiry dates, record payments, search/filter), Finance (12-month revenue, outstanding, expiring), Announcements (in-app notice to school administrators), School administrators (deactivate/reactivate, reset link), Activity & security (sign-in failures, sensitive actions, audit log), My settings (change your own password), and CSV exports (schools, subscriptions, payments, activity).
- Payments are **records you enter** (cash, bank transfer, mobile money, cheque). JAO does not collect money online. Plan prices start at 0 until you set them. The currency is XAF.
- The owner sees totals and school-level facts only, never students, grades, report cards or parents' details. School administrators get "403" on every `/platform/*` route.

### Forgotten Super Administrator password
Stop the app, then on the server run: `npm run reset-owner`. It finds your existing owner account (it never creates another), makes a backup copy of the database first, sets a strong random password that works immediately, prints the username and password **once** in the terminal, and ends all owner sessions. Sign in at `/#/super`, then change it in *Subscriptions & finance → My settings*. Sign-in stays password-only (no SMS, no 2FA). If you run more than one database file, set `JAO_DATA_DIR` or `JAO_DB_FILE` first.

## Parent Access portal
**How a parent gets an account** (administrator: menu *Parents*): *Register a parent* → name, phone with country code and/or email, then search and add each child with the relationship. The screen then shows the **school code, login phone/email and a temporary password once**; give them to the parent. If the same phone or email is registered again, the new children are added to the **same** account (one account for all children in that school). A parent must change the temporary password at first sign-in.

**How a parent signs in**: first page → **PARENT ACCESS** → school code (for example JAO-0001) + phone or email + password. Parents never create or register a school. Forgot password: the parent enters the school code and phone/email; the school administrators get a notification and use *Parents → New password* (JAO has no SMS/email provider, so nothing is sent outside JAO and it never says so).

**What the parent sees** (dashboard with a child switcher; only their own linked children): approved report cards and results history (marks, averages, rankings, teacher comments), attendance (absences, lateness), fees/payments/balances with downloadable PDF receipts, homework, announcements, official warning notices, convocations/meeting notices, and messages to the administration.

**School side** (*School life*): attendance (administrators and class teachers mark absent/late/excused), homework (teachers for their classes), announcements and fees (administrator), warning notices (administrator or a user with the "manage discipline" permission). Incident details stay private; parents only see the notice the school chooses to send.

**Automatic notifications** (bell, in-app): report card approved, child absent/late, new fee and fee reminders ("Send reminders to parents"), payment received, warning notice, important announcement, convocation scheduled (existing), reply from the school. **No SMS, WhatsApp or email is sent** unless a provider is connected in the future, and JAO never reports a message as delivered when it was not.

## Upgrading an existing installation
1. Stop the app and copy your `data/` folder somewhere safe (migrations also make an automatic backup in `data/backups/`).
2. Replace the project files with the new ones (keep your `data/` folder).
3. Start the app. Migrations 0012 (platform finance) and 0013 (parent portal) are applied automatically; they only add tables. No existing table or record is changed.
4. If you forgot the owner password: `npm run reset-owner` (app stopped).
Online use for real schools still requires hosting, HTTPS, off-site backups and a security review (section 7).

## Scholarships — phase 3 (recipients, renewals, reports)
When an application is **approved**, a recipient record (award) is created automatically. *Scholarships → Recipients*: the administrator sees every recipient, can open one to change dates, suspend/resume, end the scholarship (a reason is required) or record a **renewal review** (renewed with a new end date, or not renewed with a reason, which ends it). Families see only their own child's awards and are notified in-app. *Scholarships → Reports* (administrator): applications, approved, pending, active awards per scholarship, and CSV downloads of applications and recipients. Database migration 0014 only adds tables.
Still to come: phase 4 (external Scholarship Finder with a shared catalogue) and phase 5 (DOUDOUS² answers about scholarships).

## Scholarships — phase 4 (Scholarship Finder) and phase 5 (DOUDOUS² answers)
**Finder** (*Scholarships → Finder*): a catalogue of **external** scholarships (other organisations) shared by all schools and kept by the platform owner in *Subscriptions & finance → Scholarship catalogue*. The owner adds entries (official https page required, "last verified" date required, a deadline only if the official page states it) or loads the **starter list** that ships with JAO (Chevening, Erasmus Mundus Joint Masters, Mastercard Foundation Scholars, France Excellence Eiffel, DAAD), each read on its official page on 15 Nov 2026. Each school administrator chooses which published entries their school shows (*Choose what my school shows*); students, parents and staff see only those and can save favourites. JAO only lists information and links to the official page; it never applies on anyone's behalf, and the details can change, so users must check the official page. Drafts and archived entries are never shown.
**DOUDOUS²** answers scholarship questions (open scholarships, the school's approved external scholarships with their official links and stated dates, and a parent's/student's own application status) from real records only, per school and per asker, in English and French. Database migration 0015 only adds tables.

## Merged: two Super Administrator password tools
The project has both: (1) `npm run reset-owner` (the permanent-password tool: you type a new password, or `-- --generate` for a one-time temporary one) with recovery codes and the *Account & security* page, see `docs/SUPER_ADMIN.md`; and (2) `npm run reset-owner:generated`, which always prints a strong generated password once. Both change only the existing Super Administrator and never create another. Database migrations are numbered 0012 (owner security), 0013 (platform finance), 0014 (parent portal), 0015 (scholarship awards), 0016 (scholarship finder).
Migration 0017 re-checks the tables added by 0012–0016 and creates any that an earlier build skipped (it only adds, never changes data). If the Account & security page shows "Server error" after an update, restart the app once so 0017 can run.

## Staff office dashboards and discipline permissions

The Staff area now includes per-staff discipline permission assignment. School administrators can grant or revoke `manage_discipline`, `council_member`, and `approve_decisions` for individual teacher accounts. These grants are school-scoped and recorded in the audit log. Existing teacher incident-reporting access and existing login roles remain unchanged.

Staff accounts can open **My Office** (`#/office`) to see their assigned position, department and links to the relevant existing school modules. Office assignment is organizational metadata; it does not itself grant access to confidential records or change the account's login role.

## Department access (staff)

The Staff & Departments page has a **Department access** panel. It is **off by default**: nothing changes for any school until the administrator switches it on.

When it is on, the **server** (not just the menu) limits each teacher-role staff member to the modules their department allows:

| Department | Modules |
|---|---|
| School Administration | everything |
| Discipline Office | student records, discipline, school life |
| Academic Office | classes/grades/reports, student records, school life |
| Student Affairs | student records, school life, discipline, scholarships |
| Guidance and Counselling | student records, discipline, scholarships |
| Examinations Office | classes/grades/reports, student records |
| Admissions Office / Accounts Office | student records |
| Scholarships Office | student records, scholarships |
| School Activities | school life |

- Positions "Class Teacher" and "Subject Teacher", and staff with no active department, keep the ordinary teacher tools (classes, student records, school life, discipline reporting).
- The administrator can change any department's module list (button **Access**) or go back to the standard list. Changes are recorded in the audit log.
- A department opens a module; it does **not** grant extra discipline powers. The per-person permissions on the same page still apply.
- The school administrator, parents, students and the platform owner are never limited by this.
- A blocked request answers `403 department_access_denied`. Migration `0019_department_access.js` adds two new tables and changes nothing existing.

## Small improvements

- **PNG logos on PDFs.** A school's PNG logo (with or without a transparent background) now appears on the convocation PDF and on payment receipts, like JPEG logos already did. Decoded with Node's built-in `zlib`; nothing to install. Interlaced PNGs are not embedded (the PDF is simply made without a logo).
- **Term dates.** In Settings → academic years, every term has a **Dates** button (start and end). Terms of the same year cannot overlap; teachers and parents can read the dates. Stored in a new table (migration `0020_term_dates.js`); the `terms` table is unchanged.
- **French.** The Staff & Departments and My Office pages are now fully translated, including department names and positions. The stored values stay in English so existing data and rules keep working.
- **School logo in the system.** Once a school has uploaded its logo (Settings → School), it appears beside "JAO" at the top of the side menu and the mobile header for everyone in that school, and at the top of every report card (larger, and kept when printing). Schools without a logo keep the JAO mark.
