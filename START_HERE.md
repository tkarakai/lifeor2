# Start here

LifeOR2 runs locally with a standalone Convex backend and passwordless login codes printed to the terminal.

**First setup or recovering an old database:** follow [QUICKSTART.md](QUICKSTART.md).

**Already configured:** run these in two terminals from this repository:

```bash
# Terminal 1 — database, code sync, and login codes
bun run convex:dev
```

```bash
# Terminal 2 — frontend
bun dev
```

Open **http://localhost:3000/login**, enter your email, and paste the login code from Terminal 1. No email is actually sent; there is no password.

Keep both processes running. Ctrl+C stops them; data persists in `.convex/standalone/`.

- [README](README.md): project overview and architecture
- [Quick start](QUICKSTART.md): setup, recovery, configuration, and troubleshooting
- [Setup checklist](SETUP_CHECKLIST.md): manual verification
- [Implementation status](IMPLEMENTATION_STATUS.md): current features and limitations
