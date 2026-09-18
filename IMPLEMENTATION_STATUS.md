# Implementation status

Updated September 16, 2026. The [redesign specification](docs/design/redesign-spec.md) is implemented as the current data backbone. The existing local database has been migrated. Earlier recovery notes are retained in Git history; they do not describe the current schema.

## Implemented

- Named, isolated Live/test datasets in one DB instance, with a sidebar switcher and resumable fictional family seed.
- Trash with archive restoration, dependency review, and protected permanent deletion.
- Concrete entity instances with effective/recorded history.
- Freely authored arrangement types, copied role templates, arrangement-local role definitions, dated assignments, and independent sub-arrangements.
- Many-to-many tags, including project groupings. No project or collection primitive.
- Git-owned Markdown details with optional descriptive scalar front matter, authenticated reads/writes, optimistic conflict checks, history, diffs, and pinned reads.
- Actual events, evidence references, typed observations and derived measurement input snapshots.
- Dedicated charts and accounts; exact minor-unit, per-currency journals; reversals; attribution portions and beneficiary allocations.
- Financial account mappings, monetary obligations, adjustments, canonical payment capacity, partial settlements, and versioned commitment schedules.
- Source statements/observations, reconciliation matching and accepted anchors as backend foundations.
- Immutable plan versions, budget targets, scenario overrides, explicit assumptions, expected flows, and frozen forecast input manifests.
- Family Observatory: 27 interactive views, sortable and filterable data, chart variations, per-dataset browser preferences, exact-data exports, and cash/savings/debt scenario calculators. See [scope and calculations](docs/decisions/visual-observatory.md).
- Migrated entity, arrangement, event and finance UI plus type/template, tag, measurement, obligation and basic planning screens. Advanced provenance-heavy operations remain API-level workflows as documented in the UI report.

## Verified

- 97 automated JavaScript/TypeScript tests across eleven files pass, including the independent financial/planning audit regressions.
- 14 Python lifecycle/export-verification tests pass.
- Full application/backend TypeScript checks pass.
- Production build passes (existing workspace-root and Browserslist-age warnings are nonblocking).
- Authenticated browser smoke test on an isolated database: entity and chart creation, plan creation and one-input draft snapshot, Git details creation/update/history HTTP requests, and all migrated route navigation. Planning screenshot visually inspected.
- Browser testing found a stale in-memory auth token during identity switching. Login, signup and sign-out now perform full navigation to discard the old Convex connection. The refreshed session creates records under the correct owner and accesses their Git details.
- Rehearsal and live migrations each ran twice; replay created no duplicates. Full snapshot comparisons preserved the existing business records, auth users, sessions, and original owners. No rejects, warnings, issues, or legacy Property records require review.

- Dataset backfill assigned existing records to Live; comparison with the pre-change backup found no other value changes. The fictional Morgan family sample contains: 31 entities, 27 arrangements, three charts, 51 ledger accounts, 308 posted journals, 738 postings, 19 obligations and 18 Git documents.
- Browser verification covered sample-loader retry, switching Live ↔ test-data1, Markdown notes, balanced trial balance, and create/archive/restore/permanent-delete of a disposable test record. That test record was removed and the selection restored to Live.

See [dataset, deletion and sample decisions](docs/decisions/datasets-trash-and-family-sample.md), [implementation decisions and evidence](docs/decisions/redesign-implementation.md), [backend](docs/decisions/backend-redesign.md), [UI](docs/decisions/ui-redesign.md), [Git details](docs/decisions/git-details.md), and [planning corrections](docs/decisions/planning-integration.md).

## Deliberate boundaries

No persisted forecast calculation engine, bank import, notification delivery, or concurrent document merge UI is included. The Observatory provides explicitly labeled local what-if calculations; it does not evaluate or publish saved forecast runs. Plans/runs freeze selected inputs; they do not claim calculated results. Reconciliation and several advanced financial operations have backend APIs but no complete user workflow yet. This remains a local prototype with list-based queries, not a large-dataset or production deployment release.

Authentication remains Better Auth magic links with locally logged mock mail. No external messages are sent; email/password and social OAuth are not enabled. Git details assume one writer and require the separate content repository to be backed up with the database.

## Local operation

Use `bun run convex:dev` and `bun dev` after following [QUICKSTART.md](QUICKSTART.md). The live backend remains `.convex/standalone` on 3240/3241; frontend uses localhost:3000. The cached backend binary and existing private configuration were preserved. No package upgrades were required.

Run `bun run typecheck`, `bun run test`, `bun run test:local`, and `bun run build`. Generate ignored Convex API types by deploying/starting the backend on a fresh checkout. ESLint configuration remains outside this change.
