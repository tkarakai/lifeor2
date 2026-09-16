# Integration review resolutions

Completed September 16, 2026. The review checkpoints below were resolved before the final live migration. See [the final evidence log](redesign-implementation.md).

| Checkpoint | Resolution and evidence |
| --- | --- |
| Empty Git branch | Quiet revision lookup supports an empty repository; Git tests and the first browser save pass. |
| Missing document observation | Optional commit only for missing/unreadable availability; no fabricated hashes. Details HTTP/service tests pass. |
| Future effective edits | Current reads resolve typed timelines; future/half-open/late-correction backend tests pass. |
| Late relationship end correction | Complete timeline revisions retain earlier knowledge and corrected end boundaries; regression tests pass. |
| Derived measurement inputs | Immutable input snapshots and calculation version accompany references; backend tests pass. |
| Structural scenario overrides | Presence and effective-interval variants supported without actual mutations; planning tests pass. |
| Dedicated charts/accounts | Schema/APIs/UI use chart IDs; exact currency-separated trial balance. Browser chart creation passes. |
| Source readability | Backend/worker modules formatted; final diff has no whitespace errors. |
| Financial reversal audit F1/F2 | Recognition reversal and adjustment reversal preserve obligation/ledger consistency; both audit tests pass. |
| Planning audit P1–P4 | Shared capacity in both operation orders, draft exclusion, canonical occurrence identity and actual-boundary enforcement; all audit tests pass. |
| Complete forecast manifests | Child snapshots, immutable plan budgets, scenario baseline and accepted anchor inputs frozen; expanded tests pass. |
| Auth session transition | Browser found a cached prior JWT after client-only navigation. Full navigation on login/signup/sign-out resets the connection; refreshed-session ownership and Git access verified. |
| Plan input selector | Mutable plan/scenario roots and draft journals removed from selectable snapshot inputs; backend remains authoritative. |
| Real migration | Full private backup, isolated rehearsal, live apply, replay idempotency and independent exports all verified. |

All 83 JavaScript/TypeScript tests and 14 Python tests pass. Full TypeScript and production build pass. The sandbox build initially could not bind a Turbopack worker port; the authorized unsandboxed retry is the applicable build check.
