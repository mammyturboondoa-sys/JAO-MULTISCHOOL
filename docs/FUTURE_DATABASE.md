# Future database change (not part of this phase)

JAO uses **SQLite**. This file is only a note for later. Nothing here is implemented, and nothing in JAO needs PostgreSQL.

What already makes a later move possible:
- Every database call goes through one interface (`server/db/sqlite.js`): `get`, `all`, `run`, `insert`, `tx`, `audit`, `nowPlusDays`, `close`.
- Queries use `?` placeholders, `NOW_TS`, and portable `LOWER(..) LIKE LOWER(..)`.
- Every school-owned table has `school_id`, and links are composite `(school_id, id)` keys.
- Schema changes are numbered migrations (`server/migrations/sqlite/`).

What would still have to be done if you ever decide to move (each needs your approval first):
1. Write a second adapter with the same methods, and a matching set of migrations.
2. Test every route against it, and copy the data with a verified, reversible procedure.
3. Decide hosting and cost, then add database-level isolation (for example Row Level Security) and test it.

Until then, SQLite remains the active database.
