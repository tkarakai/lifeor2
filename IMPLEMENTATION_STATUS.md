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
- Automated tests, pagination, and broader UX/error-handling work.
- Real email delivery and production deployment configuration.
- ESLint and test runners are not configured; placeholder lint/test scripts have been removed.

The dashboard requires authentication. Email/password and GitHub/Google OAuth are not enabled. The local mock-mail setup is a development workflow, not a production authentication configuration.

## Repository baseline

The project snapshot includes source code, Bun lockfile, local recovery runner, and documentation. Environment files, database state, dependencies, generated Convex types, and build outputs are ignored. Generate Convex types by starting the backend before running TypeScript checks on a fresh checkout.

Run `bun run typecheck` to check the application and backend types. The finance query arguments and diagnostic route types identified during recovery have been corrected.

See [QUICKSTART.md](QUICKSTART.md) for repeatable startup and backup instructions, and [the original specification](docs/design/spec_0.1.md) for the larger intended system.
