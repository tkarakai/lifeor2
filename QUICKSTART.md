# Local setup and recovery

## Prerequisites

- Bun and Node.js installed (the Convex CLI uses Node).
- Python 3 (standard library only).
- An existing saved Convex deployment, including `config.json`, `convex_local_backend.sqlite3`, and `convex_local_storage/`.
- Its matching cached backend executable at `~/.cache/convex/binaries/<backendVersion>/convex-local-backend`.
- Free ports **3000, 3240, and 3241**.

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
5. Backs up the previous configuration and `.env.local` in `.convex/standalone/configuration-backup-*/`.
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

Run `bun run convex:dev` and `bun dev` in two terminals. Ctrl+C stops each process; the backend supervisor completes cleanup even if Ctrl+C is pressed repeatedly. It terminates and reaps its backend and watcher process groups. A project lock prevents two supervisors from opening the same database. Data remains in `.convex/standalone/`.

The old recovery trial at `http://localhost:3020` under `/private/tmp/lifeor2-auth-trial` is separate. It is not the project's permanent setup, and trial logins/data are not automatically copied here.

## Configuration and backups

### Git-owned details

The redesigned model stores Markdown details in a separate local Git repository.
Initialize it once if it does not already exist:

```bash
git init --bare --initial-branch=main .convex/details-content.git
```

The default content branch is `main`; no remote is required. Optional settings
are shown in `.env.local.example` (`DETAILS_REPOSITORY_PATH`,
`DETAILS_REPOSITORY_KEY`, and `DETAILS_GIT_BRANCH`). Keep this content repository
separate from the application's source repository. The app writes commits;
database records contain document locators, not authoritative Markdown copies.

Back up the entire content repository **in addition to** the backend state and
private environment. Stop application writes while taking a consistent backup.
Restoring only the database cannot restore document contents. Do not initialize
over or replace an existing content repository during ordinary startup.

Phase 1 assumes one document writer. If editing externally later, use a separate
clone/worktree and an explicit commit/merge workflow; do not expect a bare
repository to expose editable Markdown files directly. Concurrent merge UI is
not included.

### Backend state

| Setting | Location | Value / purpose |
| --- | --- | --- |
| `CONVEX_SELF_HOSTED_URL` | `.env.local` | `http://127.0.0.1:3240` |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | `.env.local` | Private credential recovered from saved state |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | `http://127.0.0.1:3240` |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `.env.local` | `http://127.0.0.1:3241` |
| `NEXT_PUBLIC_SITE_URL` | `.env.local` | `http://localhost:3000` |
| `SITE_URL` | Convex backend environment | `http://localhost:3000`, set by startup script |
| `BETTER_AUTH_SECRET` | Convex backend environment | Persistent secret loaded by startup script |

This project uses its own database directory and dedicated ports, without a Convex cloud account. Other projects may keep using 3210/3211. To change ports with this backend stopped, run `bun run local:configure --cloud-port 3240 --site-port 3241`; this backs up the configuration and updates both backend ports and frontend URLs. Restart Next.js afterward. The auth origin remains `http://localhost:3000`. Remove conflicting exported Convex variables from your shell if invoking the CLI manually.

**Back up the entire `.convex/standalone/` directory with the backend stopped**, along with `.env.local`. The directory includes SQLite, file/module storage, configuration, and the auth secret. Copying only the SQLite file is not a complete backup. Treat backups as private.

## Troubleshooting

### `ManagedTeamCannotCreateProjects` or project access errors

These come from the managed-project configuration path. Complete `local:setup` and use `bun run convex:dev`. The standalone workflow uses `CONVEX_SELF_HOSTED_URL` and an admin key, not a managed `CONVEX_DEPLOYMENT`.

### Connection refused / unavailable auth

Keep the backend terminal running and wait for deployment to finish. Confirm database URL uses **3240**, HTTP/auth URL uses **3241**, and Next.js uses **localhost:3000**. Restart Next.js after changing `.env.local`.

### Port already in use

Both `bun dev` and `bun run convex:dev` show the listening PID, executable, and working directory when their ports are occupied. In an interactive terminal they offer to send SIGTERM; the default is **No**. Non-interactive runs exit without stopping anything. If a process does not release the port, startup stops without a forced kill. Confirm the displayed project before accepting.

For a backend port conflict, choose two unused ports with `bun run local:configure --cloud-port 3230 --site-port 3231` while this backend is stopped. Other projects can keep running. Do not accept Next.js switching to 3001 without also configuring the auth origin. The backend script reports occupied database ports before opening its database.

### No email or expired code

Emails are deliberately printed to local function logs. Request a new code and read Terminal 1 or `bunx convex logs`. Do not use an earlier token again.

### Missing backend binary

Setup prints the expected cached executable path. Restore that matching version first, or follow the official [self-hosting guide](https://docs.convex.dev/self-hosting) to obtain a compatible backend. Do not silently switch versions against the only copy of a database; back up and test a copy first.

### Backend startup failure

Read `.convex/standalone/backend.log`. The script retains the existing database and logs; it does not reset failed deployments.

### Auth component or secret errors

The component definition belongs in `convex/convex.config.ts`. Wait for `bun run convex:dev` to deploy it. The startup script configures the secret in the backend environment; setting it only in Next.js's `.env.local` does not configure Convex auth.

## First application workflow

After login, choose **Live** or a test dataset in the sidebar. **Datasets → Prepare / resume family sample** creates a fictional family workspace with realistic transactions and Git-backed notes; then select **test-data1**. **Create an empty test dataset** starts a separate workspace for your own experiments. Existing records stay in Live.

For a manual finance check, use **Finance → Charts & accounts** to create a chart and Cash/Revenue ledger accounts, record an event, then create a balanced journal entry (Cash +100, Revenue -100, same currency). Inspect Finance → Reports.

To remove an archived record, open **Trash**, choose **Review permanent deletion**, and type `DELETE`. Trash also offers **Restore**. References to other records must be resolved before deletion; posted accounting history and published plan snapshots stay protected. Historical Git commits are retained.

See [dataset and sample decisions](docs/decisions/datasets-trash-and-family-sample.md) for the sample assumptions, isolation rules and local operator commands.

This is a suggested manual check, not a claim that every finance workflow is tested. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).


### Stop a backend left running after an interrupted terminal

```bash
bun run convex:stop
```

This works without an interactive prompt: it stops only this project's recorded supervisor/child processes (checking process identity to avoid stale PIDs), or a legacy backend whose executable and exact database path match this project. It does not kill an unrelated app merely because it uses the same port. Running it again is safe. Stop the backend before changing ports. Then restart with `bun run convex:dev`.

Owned child groups get a graceful shutdown interval before forced termination. Port-conflict prompts for unrelated listeners remain default-No and never force-kill. Bun's piped stdin falls back to the controlling terminal when available.

Run `bun run test:local` for port-conflict and process-lifecycle regression tests.
