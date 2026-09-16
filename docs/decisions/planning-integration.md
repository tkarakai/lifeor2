# Planning integration corrections

Completed 2026-09-16. This pass owns only `convex/planning.ts`, `tests/planning.test.ts`, and this report. No schema, dependency, live deployment, database, staging, or commit changes were made.

## Independent audit resolutions

| Audit | Change | Verification |
| --- | --- | --- |
| P1: settle-first shared capacity | Forecast fulfillment counts active obligation settlements and existing forecast fulfillment against the same posting capacity. A journal already using a different canonical settlement posting is rejected. The previously implemented obligation-side guard covers fulfill-first ordering. | Both independent P1 orderings pass; partial fulfillment and foreign-owner checks pass. |
| P2: draft actual snapshots | Direct draft journal/posting inputs are rejected. Account/chart aggregates capture only posted journal effects. Mutable plan/scenario roots, unpublished plan versions, and draft budget inputs are rejected. | Independent P2 plus draft-budget and historical aggregate tests pass. |
| P3: occurrence aliases | Identity is derived from schedule identity, recurrence period, and frequency, or the explicit obligation identity. Obligation source keys resolve through their schedule occurrence. Monthly/yearly calendar formats normalize; weekly dates map to the anchored recurrence period; one-time schedules have one identity. Superseded schedule versions cannot create a second active forecast for the same occurrence. | Independent P3 plus revised-version/calendar-alias tests pass. |
| P4: historical actual boundary | Captures validate recorded knowledge time and journal posting time against `actual_boundary`. A journal created as draft before the cutoff but posted after it is excluded from aggregates and rejected as a direct actual input. Newer mutable structured revisions require an explicit immutable historical revision. | Independent P4, historical-posting, and late-anchor tests pass. |

A schedule-backed forecast follows the outstanding amount of its incurred obligation, so partial settlement does not leave a duplicate unreduced scheduled forecast. Direct forecast fulfillment is rejected once that obligation exists; settlement is the authoritative write. Multiple incurred claims resolving to one schedule period are surfaced as an explicit ambiguity rather than selecting one silently. Predicted settlement date remains independent of the source occurrence period, so an October obligation can be forecast for receipt in November.

## Frozen manifests

Each captured input now contains a versioned `lifeor2-plan-input-v1` bundle with the selected record and a deduplicated typed dependency graph. No new property system or calculation engine is introduced; these are immutable snapshot bytes in the existing captured-input field.

The snapshot includes the children required to interpret selected domain inputs: structured revisions and local assignments; schedule versions and revision timelines; journal postings and known reversal/replacement chains; the applicable attribution set, portions, beneficiaries and tags; obligation adjustments and settlements; statement lines, reconciliation matches and evidence; and expected-flow fulfillment links and their payment history. Membership and attribution selection obey the recorded boundary. Posted amounts remain authoritative in the ledger; snapshots do not create financial records.

Run manifests preserve the published plan's already captured inputs and add the published plan with its budget targets, scenario version/overrides, scenario Git pin, and accepted anchor/source/account data. An anchor already captured by the plan is reused, not counted twice. Captured scenario baselines reuse the published plan's snapshot when available, so later edits to actual arrangements cannot rewrite a saved assumption. If an override requires an uncaptured mutable record that has changed beyond the plan's boundary, the run rejects it rather than claiming historical reproducibility.

Git pins remain explicit repository/path/full-commit references; the Git adapter verifies content availability. The database snapshot does not read working-tree Markdown. Runs keep status `inputs_frozen`; no forecast result or calculation success is claimed.

Existing parent-only captures cannot guarantee complete child history. Publishing/running such an incomplete legacy capture is rejected with a request to create a new complete plan version; the old version is preserved. Newly captured assumptions can use immutable published planning versions, but mutable `plan`/`scenario` identity pointers and draft budgets cannot stand in for published facts.

## Verification

```sh
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
```

Full suite: **83 tests across 8 files pass**. Full application/backend TypeScript: **passes**. Focused planning plus independent audit suite: **24 tests pass**, including all P1–P4 and financial audit cases.

The added tests cover frozen posting/attribution/beneficiary records, known reversal closure, budget children, scenario baseline reuse after actual edits, mutable/draft planning rejection, schedule-to-obligation settlement remainder, revised and alternate-format occurrence aliases, post-cutoff posting exclusion, anchor boundary/source snapshots, reuse of pinned anchors, and rejection of incomplete historical captures.

## Limits and remaining integration work

These APIs capture explicitly selected inputs and their domain dependencies; they do not claim that an empty manifest describes all actual activity. Snapshots are assembled atomically in one Convex mutation and subject to existing transaction/document limits; larger histories need a separately designed bounded capture protocol. No forecasting, recurrence generation, ingestion, or reconciliation workflow was added. Coordinator deployment/rehearsal and UI smoke verification remain outside this worker's ownership.
