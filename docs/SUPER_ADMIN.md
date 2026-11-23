# Super Administrator account — permanent password and recovery

There is exactly **one** Super Administrator account (`platform_owner`). It is created once, the very first time the
application starts, with a **random temporary password** printed once in the server console. It is never created again,
and no update, restart or setting can replace or reset it.

## Choosing your own permanent password
1. Sign in at `#/super` with the e-mail and the temporary password shown at first start.
2. You are asked to choose a new password immediately. The temporary password cannot be kept as the new one, and it stops
   working the moment you save.
3. Later, change it any time in **Account & security** (menu, Super Administrator): you must type the **current** password,
   then the new one twice. Every other device is signed out when you change it.

## Where and how it is stored
* In the database (`data/jao.db`), only as a **scrypt hash** with a random salt. Never as readable text, never in the
  source code, never in logs, never in API answers.
* Because it lives in the database, it survives restarts, updates (migrations only add tables/columns) and backups.
  A restored backup signs in with the password you had when the backup was made.
* `JAO_OWNER_EMAIL` / `JAO_OWNER_PASSWORD` are only read when **no** Super Administrator exists yet. Once the account
  exists they are ignored, so a forgotten or leaked variable cannot take the account over.

## If you forget the password
1. **Recovery codes (recommended).** In **Account & security**, generate 10 single-use recovery codes and keep them
   somewhere safe (print or download them: they are shown only once; only their hashes are stored). If you forget the
   password: sign-in page → *Forgot your password? Use a recovery code* → e-mail + one code + new password. The code is
   then used up, and you are signed out everywhere. Generate a new set when few remain.
2. **Server command (break-glass).** Whoever controls the server can run, with the application stopped or running:

   ```
   npm run reset-owner                  # you type a new permanent password (hidden, twice)
   npm run reset-owner -- --generate    # prints a one-time temporary password you must replace at the next sign-in
   ```
   It changes only the existing Super Administrator's password. It never creates an account, never changes the e-mail,
   never touches schools or records, takes a safety backup first (`--no-backup` to skip), signs the account out everywhere
   and writes an audit entry. If there is no Super Administrator, or more than one, it refuses and changes nothing.

## Safety measures
* Wrong guesses of the current password are limited to 5 per 15 minutes; recovery attempts are limited per address and per
  e-mail; every failure of the recovery form looks identical (nothing reveals whether the e-mail exists).
* Password changes, recovery and command-line resets are written to the audit log (never the password).
* Only the signed-in Super Administrator can use these routes; school administrators, teachers, parents and students
  receive "forbidden", and no one can change this password on your behalf.
