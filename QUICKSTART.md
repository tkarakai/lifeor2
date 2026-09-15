# Local setup and recovery

## Prerequisites

- Bun and Node.js installed (the Convex CLI uses Node).
- Python 3 (standard library only).
- An existing saved Convex deployment, including `config.json`, `convex_local_backend.sqlite3`, and `convex_local_storage/`.
- Its matching cached backend executable at `~/.cache/convex/binaries/<backendVersion>/convex-local-backend`.
- Free ports **3000, 3210, and 3211**.

This guide restores the database already on this Mac. It does not provision a new database or download a backend. The recovery trial succeeded with backend `precompiled-2026-01-15-002379a` and Convex CLI `1.31.5`; no upgrade was necessary.

## 1. Install dependencies

From the repository root:

```bash
bun install
```

## 2. Copy the saved database and configure this project (once)

Stop any process using the source deployment before copying it, so SQLite and file storage represent the same point in time.

For the deployment previously selected by this project:

```bash
bun run local:setup --from "$HOME/.convex/convex-backend-state/local-tamas_karakai-lifeor2_23378"
```

The setup command:

1. Checks that the saved state and matching executable exist.
2. Copies the database and file storage into `.convex/standalone/`.
3. Preserves the source instance identity and admin credentials.
4. Generates a persistent local auth secret.
5. Backs up the previous `.env.local` to `.convex/standalone/previous.env.local`.
6. Configures `.env.local` for the standalone backend, removing the old managed deployment selection.

The original source files stay unchanged. Setup refuses to overwrite an existing `.convex/standalone/` directory. Once configured, skip this step on subsequent starts.

Other saved snapshots found on this Mac are `local-tamas_karakai-lifeor2` and `local-tamas_karakai-lifeor2_b78f2`. They are separate databases; setup does not merge them. Restoring a database does not guarantee that a particular historical account or its records exist in it.

Do not copy `.env.local.example` over the generated `.env.local`.

## 3. Start the backend

Terminal 1, in the repository:

```bash
bun run convex:dev
```

Wait for **Convex functions ready**. Leave this terminal open. This command runs both the standalone database process and the code watcher, and shows function logs containing login codes.

For this workflow use the package script above. Running bare `bunx convex dev` only syncs code once the standalone backend is already running; it does not start that backend.

## 4. Start the frontend

Terminal 2, in the same repository:

```bash
bun dev
```

Open **http://localhost:3000/login**. Use this exact hostname and port: the auth site's configured origin is `http://localhost:3000`.

## 5. Log in

1. Enter your email and click **Send Login Code**.
2. Look in Terminal 1 for **MOCK EMAIL SENT (from Convex)**.
3. Copy the token after **Your login code is:** into the login form.
4. Click **Verify Code** to enter the dashboard.

There is no password and no real email delivery. Tokens are single-use and expire after 10 minutes. The local auth plugin can create an account on first login. Use the same email on later visits to return to that account.

If you need a separate log terminal while the backend is running:

```bash
bunx convex logs
```

## Everyday startup and shutdown

Run `bun run convex:dev` and `bun dev` in two terminals. Ctrl+C stops each process; stopping the backend script also stops its code watcher. Data remains in `.convex/standalone/`.

The old recovery trial at `http://localhost:3020` under `/private/tmp/lifeor2-auth-trial` is separate. It is not the project's permanent setup, and trial logins/data are not automatically copied here.

## Configuration and backups

| Setting | Location | Value / purpose |
| --- | --- | --- |
| `CONVEX_SELF_HOSTED_URL` | `.env.local` | `http://127.0.0.1:3210` |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | `.env.local` | Private credential recovered from saved state |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | `http://127.0.0.1:3210` |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `.env.local` | `http://127.0.0.1:3211` |
| `NEXT_PUBLIC_SITE_URL` | `.env.local` | `http://localhost:3000` |
| `SITE_URL` | Convex backend environment | `http://localhost:3000`, set by startup script |
| `BETTER_AUTH_SECRET` | Convex backend environment | Persistent secret loaded by startup script |

The standalone script fixes these local ports/origin. Changing only one frontend URL is insufficient; change the script's backend ports and auth origin together if customization is needed. Remove conflicting exported Convex variables from your shell if invoking the CLI manually.

**Back up the entire `.convex/standalone/` directory with the backend stopped**, along with `.env.local`. The directory includes SQLite, file/module storage, configuration, and the auth secret. Copying only the SQLite file is not a complete backup. Treat backups as private.

## Troubleshooting

### `ManagedTeamCannotCreateProjects` or project access errors

These come from the managed-project configuration path. Complete `local:setup` and use `bun run convex:dev`. The standalone workflow uses `CONVEX_SELF_HOSTED_URL` and an admin key, not a managed `CONVEX_DEPLOYMENT`.

### Connection refused / unavailable auth

Keep the backend terminal running and wait for deployment to finish. Confirm database URL uses **3210**, HTTP/auth URL uses **3211**, and Next.js uses **localhost:3000**. Restart Next.js after changing `.env.local`.

### Port already in use

Stop the other process using that port. Do not accept Next.js switching to 3001 without also configuring the auth origin. The backend script reports occupied database ports before opening its database.

### No email or expired code

Emails are deliberately printed to local function logs. Request a new code and read Terminal 1 or `bunx convex logs`. Do not use an earlier token again.

### Missing backend binary

Setup prints the expected cached executable path. Restore that matching version first, or follow the official [self-hosting guide](https://docs.convex.dev/self-hosting) to obtain a compatible backend. Do not silently switch versions against the only copy of a database; back up and test a copy first.

### Backend startup failure

Read `.convex/standalone/backend.log`. The script retains the existing database and logs; it does not reset failed deployments.

### Auth component or secret errors

The component definition belongs in `convex/convex.config.ts`. Wait for `bun run convex:dev` to deploy it. The startup script configures the secret in the backend environment; setting it only in Next.js's `.env.local` does not configure Convex auth.

## First application workflow

After login: create a `ChartOfAccounts` arrangement, create Cash and Revenue ledger accounts, record an event, and create a balanced journal entry (Cash +100, Revenue -100, same currency). Then inspect Finance → Reports.

This is a suggested manual check, not a claim that every finance workflow is tested. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
