# LifeOR2

A local prototype for modeling people, assets, relationships, events, and finances. Built with Next.js 16, React 19, Convex, Better Auth, and Bun.

## Run locally

This project can run a **standalone Convex backend on your Mac**, using a copy of an existing saved database. No Vercel project, Convex account, or hosted auth service is required for this workflow. Package installation may need internet access; the matching backend executable must already be cached.

See **[QUICKSTART.md](QUICKSTART.md)** for prerequisites, first-time recovery, login, and troubleshooting.

After completing the one-time setup, use two terminals in this repository:

```bash
# Terminal 1: local database, backend code sync, and login codes
bun run convex:dev
```

```bash
# Terminal 2: frontend
bun dev
```

Open **http://localhost:3000/login**. Enter your email, then paste the login code printed in **Terminal 1**. Emails are mocked: nothing is delivered to an inbox, and there is no password to remember. Codes expire after 10 minutes.

Stop each terminal with Ctrl+C. Use `bun run convex:stop` to stop this project’s backend from another terminal or recover a leftover process. Local data persists between restarts.

## Current status

The code includes entity, arrangement, and event screens; a chart of accounts; journal entries with double-entry validation; and a trial balance report. Authentication uses Better Auth's magic-link plugin, with its tokens entered as login codes.

This is an unfinished prototype. Reconciliation, forecasting, and further UI/error-handling work remain. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior and limitations. The broader design is in [docs/design/spec_0.1.md](docs/design/spec_0.1.md).

## Local architecture

| Process | Address | Purpose |
| --- | --- | --- |
| Next.js | `http://localhost:3000` | Frontend and `/api/auth/*` proxy |
| Convex backend | `http://127.0.0.1:3240` | Queries, mutations, subscriptions |
| Convex HTTP endpoint | `http://127.0.0.1:3241` | Better Auth HTTP handlers |

`bun run convex:dev` starts the cached backend directly, configures its auth environment, and runs the Convex CLI against the self-hosted URL. This project uses dedicated ports 3240/3241; other projects can keep using 3210/3211. Run `bun run local:configure --cloud-port 3240 --site-port 3241` with this backend stopped to change ports and update frontend URLs together. The backend's optional telemetry beacon is disabled. It does not select or create a managed Convex project.

Data, file storage, and local backend configuration live in **`.convex/standalone/`**, which Git ignores. `.env.local` contains the frontend URLs and private self-hosted admin key. Keep both out of version control.

## Project layout

- `app/` — Next.js pages and auth proxy
- `components/` — navigation and UI components
- `convex/` — schema, functions, HTTP routes, and Better Auth component registration
- `lib/` — auth clients, Convex provider, and temporal helpers
- `scripts/local_convex.py` — saved-state setup and standalone backend lifecycle
- `docs/design/spec_0.1.md` — original system specification

## Development checks

After starting the backend to generate Convex types, run `bun run typecheck`. Use `bun run build` for a production build. Run `bun run test` for the Convex/Better Auth regression suite. Linting is not configured yet.

## References

- [Convex self-hosting](https://docs.convex.dev/self-hosting)
- [Convex local deployments](https://docs.convex.dev/cli/local-deployments)
- [Better Auth + Convex Next.js setup](https://labs.convex.dev/better-auth/framework-guides/next)

The standalone workflow here starts an existing cached executable directly. It is separate from the CLI's account-linked local-deployment setup.
