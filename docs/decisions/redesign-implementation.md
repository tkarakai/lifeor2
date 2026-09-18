# Redesign implementation decisions and verification

Started 2026-09-16. User authorized implementing the committed redesign, preserving and migrating existing data, migrating the UI, and making reasonable implementation decisions without waiting for answers.

Specification commit: `1c1f897` (`docs/design/redesign-spec.md`). This log records implementation choices and evidence; it does not silently change confirmed product decisions.

## Ownership and decisions

- Backend worker owns schema, APIs, invariant tests, and resumable migration code. UI worker owns migrated pages and navigation. Git worker owns document storage/routes/editor. Coordinator owns integration, backup, migration execution, validation, and commits.
- Existing local backend data is the migration source. No restart from an empty database, dependency upgrade, new framework, or hosted deployment is included.
- Stop the backend and back up its entire state plus `.env.local` before migration. Rehearse against a complete copy on separate ports with **no source watcher**; deployment is explicit so partial worker edits cannot migrate data accidentally.
- Private runtime snapshots and reports live under ignored `.convex/`. Never commit credentials, real user documents, raw data exports, or the content repository into application source.
- UI work exposes the redesigned records and updates existing finance pages. It does not add a forecasting engine, new analytics dashboard, bank import, or notification system.
- Git details use a separate **bare** local content repository at `.convex/details-content.git` by default, branch `main`, no remote. This avoids a second working-tree state while the app writes Git objects. Future external editing can use a clone/worktree and explicit merge workflow. The repository was initialized empty; no user content was fabricated.

Component decisions: [backend](backend-redesign.md), [UI](ui-redesign.md), [Git details](git-details.md). These worker reports are created during implementation.

## Backup evidence

- Source backend stopped with `bun run convex:stop`.
- Complete state and private environment backup stored under ignored `.convex/backups/`.
- Backup SQLite `PRAGMA integrity_check`: `ok`.
- The backup preserves the pre-redesign database, file storage, configuration, and authentication settings. It is a rollback source, not the live runtime.
- Full Convex snapshot export also saved privately beside the backup as `export.zip`.
- Source inventory and auth state were verified privately. All existing business rows reference an existing auth owner; no owner reassignment is needed.
- Rehearsal copy: `.convex/redesign-rehearsal`, ports 3250/3251. `scripts/redesign_admin.py` starts the copied backend without a source watcher and provides explicit CLI access using its own private environment file. The original `.env.local` is unchanged by rehearsal.

## Migration and verification

Completed September 16, 2026. The separate workers completed backend, UI and Git-detail implementation; a fourth audit task produced concrete regressions, and a follow-up backend task fixed planning integration. All reports were accepted and worker terminals released or transferred to the completed follow-up tasks; no reclaimable worker remains.

### Data migration

1. Deployed the new schema explicitly to the rehearsal copy with `scripts/redesign_admin.py cli ... -- dev --once`.
2. `migrations:dryRun` confirmed the source inventory with zero rejects/warnings/issues.
3. `scripts/redesign_admin.py migrate --state ...` applied each paginated stage in dependency order, repeated all stages, and verified identical source counts/totals with no new mappings on replay. Original business records received migration mappings.
4. Exported the rehearsal database and independently compared original IDs, owners, descriptive fields and auth users using `scripts/verify_redesign_export.py`. All preserved.
5. After the complete 83-test suite and TypeScript check passed, deployed the final audited code to live `.convex/standalone` and repeated the same migration/replay procedure.
6. Compared live `post-redesign.zip` against the immediate pre-deploy export. Existing business records, auth users, sessions, and auth account rows remain unchanged. `.env.local` is byte-identical to its backup. No synthetic smoke-test records were written to live data.

Private evidence remains under `.convex/`: the pre-redesign full backup and exports, rehearsal `migration-verification.json`/`preservation.json`, and live `migration-verification.json`/`preservation.json`/`post-redesign.zip`. These contain private data and are deliberately ignored by source Git. No documents were fabricated during migration.

### Integration decisions

- The Git HTTP target whitelist now includes immutable revision and attribution-set targets supported by the backend.
- Plan input selectors exclude mutable plan/scenario identities and draft journals. The backend independently enforces this and captures the full relevant child graph. Snapshot size remains subject to Convex transaction/document limits; no unbounded background resolver is claimed.
- Browser testing exposed a pre-existing auth adapter cache retaining the previous identity after an in-app magic-code login. Login/signup and sign-out now use full navigation, discarding the old client connection and cached JWT. A fresh test session created records under the correct owner and could save Git details; ownership checks correctly denied the mismatched identity before this correction. Test records were confined to the isolated copy.
- The content repository is bare, uses a single-writer lock and compare-and-swap commit semantics, and has no remote. No concurrent merge workflow was added.
- Git pin ownership/hash validation happens in the database; actual pinned file availability is resolved by the Git adapter. Forecast runs remain `inputs_frozen`, never reported as computed projections.
- Monetary conversion never silently rounds. Nontrivial financial and migration conversions are covered by synthetic regression fixtures.
- Legacy Property data, if encountered on another installation, remains read-only until an explicitly verified content export. The current dataset has no such rows. Unknown legacy relationship/schedule meanings are preserved and reported rather than guessed.

### Validation

- `bun run test`: 83 tests in eight files pass, including all eleven independent audit cases and expanded frozen-manifest tests.
- `bun run test:local`: 14 tests pass, including export preservation failures and lifecycle safety.
- `bun run typecheck`: pass; generated APIs include all new modules.
- `bun run build`: pass; all new routes compile. Existing nonblocking warnings concern workspace-root inference and old Browserslist metadata.
- Authenticated browser smoke against the clone: entity creation; dedicated chart creation; plan and draft version creation with a captured entity; details read, first Git commit, update and history request; navigation through arrangements, types, events, measurements, tags, accounts, journals, trial balance, obligations and planning. The planning screenshot was visually inspected. This is a smoke test, not exhaustive browser coverage of every advanced API.
- Git content test repository contains two verified commits. Production content remains separate and untouched by these tests.
- `git diff --check`: clean.

### Operational rollback

Stop frontend writes and the backend before restoring. Preserve the current state separately, restore the complete pre-redesign backend directory and environment from the private backup, and check out the pre-implementation code/spec commit `1c1f897` in a separate checkout. Never copy only SQLite or merge old and new runtime directories. Rollback must also restore a matching content-repository snapshot when application content documents exist. Do not overwrite subsequent user work automatically.

### Remaining scope

No forecast engine, bank import, new analytical dashboards, notification delivery, or Git conflict-resolution UI was built. The schema supports these layers. Advanced reconciliation, recognized-obligation adjustment journals, variable schedule revision and provenance-heavy measurement creation are backend operations; the migrated UI covers basic record entry and existing workflows. No hosted production deployment or real email configuration was requested.
