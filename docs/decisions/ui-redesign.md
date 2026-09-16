# UI redesign decisions

UI implementation completed, 2026-09-16. Scope: existing dashboard routes and basic forms for the redesigned domain model; authentication remains the existing Better Auth/Convex boundary.

## Decisions

- Keep the existing restrained visual language, local typography, and dependencies. Shared labeled fields, pending controls, inline mutation errors, loading/empty distinctions, and a dashboard error boundary make forms consistent. Mobile navigation is available through a native expandable menu.
- The dashboard is a records index, without invented totals or a new analytical dashboard. Remove nonfunctional forecast/reconciliation links and unsupported financial statement promises. Planning exposes record entry only.
- Entity kinds and arrangement types are user-authored labels. Templates copy into arrangement-local participant/subject roles. Role assignment periods display exclusive ends. Archive actions explicitly preserve historical references; ending an arrangement is separate from archiving it.
- Charts are dedicated records; accounts, journals, and reports select chart IDs directly. The UI never infers a chart from an arrangement kind.
- Monetary entry uses decimal text parsed by the backend's shared pure exact-money parser, with no floating-point rounding. Posting currency comes from the account. Formatting uses BigInt quotient/remainder and the declared currency scale, including zero- and three-decimal currencies. Totals are currency-specific.
- Actual events are immutable occurrences. Corrections create linked events; preserved legacy payloads are readable without becoming a second editable financial ledger. Event times use local datetime inputs; accounting/due dates use calendar-date inputs.
- DetailsEditor is provided by the Git worker and saves independently through authenticated routes. UI callers pass typed record references and never write Markdown through Convex.
- Tags are simple explicit memberships; projects receive no special lifecycle or collection model.

## Delivered workflows

- Entities: create, rename/change kind with revision conflict detection, archive, Git details.
- Arrangements: create from freely authored types/templates, edit lifecycle/name/effective end, add/rename/archive local roles, assign entities and end assignments, Git details. Role classes are explicit on creation; changing templates never changes existing roles.
- Events: actual occurrence entry, typed affected-record links, correction lineage, void/archive with backend safeguards, preserved source payload display, Git details.
- Measurements: observed/contractual decimal quantities, currency/unit/date/method, correction records, legacy value visibility. Existing expected/derived records display their meaning; their provenance-heavy creation remains available through backend APIs.
- Tags: create/rename/archive, add/remove memberships for selectable domain records, Git details.
- Finance: dedicated chart/account creation, rename/archive, financial-account mapping, exact journal entry and attribution portion/beneficiary editing, reversal, per-currency trial balance, monetary obligations, unrecognized adjustments, payment settlement including recognized counterpart selection, void and history display.
- Planning: fixed-amount schedules, plans and persisted versions, selected structured input capture, draft budget targets and publishing, scenarios based on published plans with explicit amount/timing overrides, manual assumptions, expected flows with exactly one obligation/assumption source, and actual fulfillment. Obligation-backed remaining flows derive from settlement; their UI links users back to obligations.

## Deliberate limits

This is basic record-entry UI, not a full editor for every foundation API. Atomic journal adjustments for already ledger-recognized obligations, advanced evidence/reconciliation workflows, variable schedule revisions, and full assumption provenance remain backend operations. The UI states the recognized-adjustment requirement and never pretends an independent obligation amount edit updates the ledger. Plan input capture includes selected structured records; its form explicitly states that Markdown commits are not included. No forecast results, new analytical dashboard, bank import, notifications, projects/collections, or generic properties were introduced.

## Final validation

- `npm run typecheck`: passed against the generated live contracts, including the final void/settlement state changes.
- `npx vitest run tests/ui-money.test.ts`: 3 tests passed; includes editable decimal round trips for positive/negative maximum safe integers at USD/JPY/KWD precision.
- `npm run build`: passed; all existing and added dashboard routes compiled and prerendered. Existing nonblocking warnings concern workspace root inference and the Browserslist database age.
- Static review: no `ChartOfAccounts`/`coaArrangementId`, `parseFloat`, `toFixed`, `as any`, or alert-based mutation flows remain in the owned dashboard UI.
- No authenticated browser interaction was performed by this worker. Live deployment, migration, and authenticated smoke validation belong to the coordinator’s integration work.
- No dependencies added; no backend/authentication implementation or other workers’ files edited; no files staged or committed.

## Files modified by the UI worker

- `app/(dashboard)/layout.tsx`
- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/dashboard/error.tsx`
- `app/(dashboard)/dashboard/loading.tsx`
- `app/(dashboard)/dashboard/entities/page.tsx`
- `app/(dashboard)/dashboard/arrangements/page.tsx`
- `app/(dashboard)/dashboard/arrangements/types/page.tsx`
- `app/(dashboard)/dashboard/events/page.tsx`
- `app/(dashboard)/dashboard/measurements/page.tsx`
- `app/(dashboard)/dashboard/tags/page.tsx`
- `app/(dashboard)/dashboard/finance/page.tsx`
- `app/(dashboard)/dashboard/finance/accounts/page.tsx`
- `app/(dashboard)/dashboard/finance/entries/page.tsx`
- `app/(dashboard)/dashboard/finance/reports/page.tsx`
- `app/(dashboard)/dashboard/finance/obligations/page.tsx`
- `app/(dashboard)/dashboard/planning/page.tsx`
- `components/sidebar.tsx`
- `components/record-ui.tsx`
- `components/record-details.tsx`
- `components/target-select.tsx`
- `components/money.ts`
- `components/financial-fields.tsx`
- `components/financial-accounts.tsx`
- `components/posting-attribution.tsx`
- `components/planning-versions.tsx`
- `components/planning-assumptions.tsx`
- `components/planning-scenarios.tsx`
- `tests/ui-money.test.ts`
- `docs/decisions/ui-redesign.md`
