# Implementation status

Reviewed September 15, 2026. This supersedes the early generated completion estimates and OAuth setup claims.

## Present in the code

- Next.js 16 / React 19 frontend with dashboard navigation.
- Convex schemas for entities, arrangements, roles, events, properties, measurements, and finance.
- Entity, arrangement, and event screens and backend operations.
- Ledger accounts, journal entries, double-entry validation, and trial balance.
- Better Auth magic-link login, with tokens entered as codes and mock email output in local function logs.
- Standalone backend startup and recovery from saved SQLite/file storage.

## Verified in the isolated recovery trial

Using a copy of `local-tamas_karakai-lifeor2_23378` and cached backend `precompiled-2026-01-15-002379a`:

- The database starts without managed Convex project access.
- The CLI can list application tables and deploy the Better Auth component.
- The Next.js auth proxy accepts a magic-link login request.
- A locally logged code creates a session cookie.
- That session produces a Convex token and successfully queries the authenticated user and entity list.
- The dashboard route returns HTTP 200.

These checks used a new test identity in an isolated database copy. They do not establish recovery of a historical account or complete browser/finance workflow coverage. No backend upgrade was required.

## Local auth corrections

- Component registration lives in `convex/convex.config.ts`.
- Auth imports the minimal Better Auth build and mounts the component's routes.
- Login/signup verification passes the token in `query` and checks returned API errors.
- Frontend database and HTTP/auth URLs use separate ports.
- The standalone startup script configures `SITE_URL` and a persistent `BETTER_AUTH_SECRET` in the backend environment.

## Repository validation

- `bun run typecheck` passes.
- `bun run build --webpack` passes in an isolated copy, without disturbing the running development app.
- The Python runner parses successfully; standalone startup and component deployment were verified during setup.
- Ignore rules were checked against local credentials, database state, generated code, dependencies, and reports. A candidate-file scan found no copies of the local credentials.

## Still unfinished

- Reconciliation and bank statement import.
- Forecasting and variance analysis.
- Dedicated property/measurement management UI and complete editing workflows.
- Pagination and broader UX/error-handling work.
- Real email delivery and production deployment configuration.
- ESLint is not configured. Backend regression tests now run with `bun run test`.

The dashboard requires authentication. Email/password and GitHub/Google OAuth are not enabled. The local mock-mail setup is a development workflow, not a production authentication configuration.

## Repository baseline

The project snapshot includes source code, Bun lockfile, local recovery runner, and documentation. Environment files, database state, dependencies, generated Convex types, and build outputs are ignored. Generate Convex types by starting the backend before running TypeScript checks on a fresh checkout.

Run `bun run typecheck` to check the application and backend types. The finance query arguments and diagnostic route types identified during recovery have been corrected.

See [QUICKSTART.md](QUICKSTART.md) for repeatable startup and backup instructions, and [the original specification](docs/design/spec_0.1.md) for the larger intended system.


## Convex recovery audit (September 15, 2026)

### Fixed in source and regression-tested

- All seven `user_id` fields now store Better Auth component IDs as strings. Component table IDs cannot be validated as IDs from the application's tables, even when both tables have the same name. This caused the entity-create failure and would also block arrangements, events, accounts, and journal entries. Existing ID strings are preserved; no records are reassigned to a different user.
- Record queries, updates, deletes, role links, event targets, and finance operations check the authenticated user's ownership. Referenced records must exist and belong to that user.
- Ledger accounts require a ChartOfAccounts arrangement; parent accounts and postings must match their chart and currency.
- Journal postings reject non-finite and zero amounts, mismatched currencies/charts, and imbalances previously permitted by the 0.001 tolerance. Financial writes remain transactional.
- Deletes reject references from journal entries, accounts, arrangement hierarchy/versioning, event targets, properties, measurements, and roles as applicable. Existing cleanup of an arrangement's roles and an event's affects remains transactional.
- Event payloads and role shares validate JSON; event/arrangement dates must be finite and arrangement date ranges ordered. An end date of zero is no longer treated as open-ended.
- Anonymous lists return empty results, and dashboard content waits for Convex authentication. Create/delete failures are caught in the affected forms.

Six integration-style tests use `convex-test` with the real Better Auth component schema and adapter, including two users and sessions. Run `bun run test` and `bun run typecheck`. The test harness is pinned to the Convex-compatible 0.0.41 release; this is not a production dependency upgrade.

### Isolated backend and live login verified

The project now runs an account-free standalone backend from `.convex/standalone/` on dedicated ports **3240/3241**, preserving its recovered database, instance identity, and credentials. The unrelated anonymous backend on 3210/3211 remains running. This uses the standalone runner rather than the Convex CLI's shared anonymous deployment selection.

`bun run local:configure` updates both backend ports and frontend URLs, backing up the previous private configuration first. `bun run convex:dev` reads the configured ports, starts the backend, configures auth, and syncs functions. Defaults for future recovery setups are also 3240/3241.

Verified against the running backend and the Next.js proxy on localhost:3000: functions deployed successfully; a login-code request returned 200; code verification established a session; the session produced a Convex JWT; an authenticated `entities:list` query succeeded. Verification used a local `isolation-smoke@example.test` account. The six backend regression tests and TypeScript check also pass. No production build or interactive browser walkthrough was performed in this pass.

### Next recovery milestones, in order

1. **Verify recovered data and workflows:** back up the saved state and complete an interactive walkthrough of login → entity → arrangement → event → accounts → balanced journal → report. Check historical owners and existing cross-owner/orphaned references; source guards do not repair pre-existing data.
2. **Make financial reports reliable:** separate totals by currency (the current trial balance mixes currencies), exclude draft journal postings, define currency precision and integer-minor-unit/decimal storage, and introduce reversals/corrections for posted entries. The current floating-point amount model remains a prototype.
3. **Upgrade in a separate tested pass:** inventory dependency/security advisories, choose compatible Next/React and Convex/Better Auth versions together, and test backend binary/database compatibility against a backup copy before replacing the cached January 2026 binary. No runtime dependency or database binary upgrades have been performed in this pass.
4. **Complete core editing:** property/measurement APIs and UI, role/affects removal, arrangement updates/versioning, account management, and pagination. Delete restrictions intentionally preserve linked history, but some link-removal workflows are not implemented yet.
5. **Production readiness:** real email delivery, production auth/origin configuration, lint/CI checks, browser tests, recovery/backup tests, and removal or restriction of diagnostic routes.
6. **Remaining product features:** reconciliation/import, forecasting, variance analysis, and the rest of the original design specification.

References: [Convex component ID boundaries](https://docs.convex.dev/components/authoring), [Better Auth authorization](https://labs.convex.dev/better-auth/basic-usage/authorization), [Convex testing](https://docs.convex.dev/testing/convex-test).


### Local process lifecycle correction

The runner now handles SIGINT/SIGTERM by requesting shutdown rather than raising during cleanup. Backend and watcher use separate process groups; cleanup ignores repeated interrupts, stops descendants, and reaps children. A project lock prevents duplicate supervisors, and `bun run convex:stop` handles recorded processes plus legacy backends matched by exact database path and executable. Port checks use server-style socket reuse so TIME_WAIT connections do not appear as live port conflicts. Interactive Bun invocations can read confirmation from the controlling terminal when stdin is piped.

Validation: 11 Python regression tests pass (including repeated signals during cleanup, descendants, stale identity rejection, duplicate locks, port confirmation, and TIME_WAIT). Real backend start → repeated interrupt → immediate restart → stop-command cycles exited cleanly and released both 3240/3241; repeated stop was harmless. The backend was left stopped after verification. An additional probe of the unrelated service on 3210 returned connection refused; its current availability was not verified.
