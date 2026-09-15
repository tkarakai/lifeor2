# Local setup checklist

Follow [QUICKSTART.md](QUICKSTART.md) for the actual commands.

## One-time recovery

- [ ] Dependencies are installed.
- [ ] The original saved backend is stopped before copying its state.
- [ ] `bun run local:setup --from <saved-deployment-directory>` succeeds.
- [ ] `.convex/standalone/` contains the copied database, file storage, and config.
- [ ] `.env.local` selects the self-hosted URL and uses different database/auth ports.
- [ ] Original saved state remains available as a recovery source.

## Startup and login

- [ ] Terminal 1 runs `bun run convex:dev` and reports Convex functions ready.
- [ ] Terminal 2 runs `bun dev` at **http://localhost:3000**.
- [ ] `/login` accepts an email.
- [ ] A mock email/code appears in Terminal 1.
- [ ] Entering that code opens the dashboard.
- [ ] A dashboard refresh preserves the session.
- [ ] Signing out and requesting a fresh code permits another login.

## Optional application checks

- [ ] Create and list an entity.
- [ ] Create a `ChartOfAccounts` arrangement and ledger accounts.
- [ ] Record an event and balanced journal entry.
- [ ] Inspect the trial balance.
- [ ] Restart both processes and confirm the created records persist.

These boxes are a manual checklist, not a record of completed tests. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for what has actually been verified.
