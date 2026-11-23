'use strict';
// 0017: safety net for upgraded installations. Migrations 0012-0016 were renumbered while merging two upgrade lines, so a database that already
// holds a version number 12-16 from an earlier build may have SKIPPED one of them. Every one of these migrations only uses CREATE ... IF NOT EXISTS,
// so running them all again is harmless: it adds whatever is missing and never changes or removes existing data.
module.exports = {
  version: 17, name: 'ensure_upgrade_tables',
  up(db) {
    for (const f of ['0012_owner_security', '0013_platform_finance', '0014_parent_portal', '0015_scholarship_awards', '0016_scholarship_finder']) require(`./${f}.js`).up(db);
  },
};
