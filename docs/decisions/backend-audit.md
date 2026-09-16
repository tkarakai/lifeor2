# Independent backend audit — 2026-09-16

This bounded audit reviewed the implemented backend/planning APIs against redesign-spec sections 3, 10–13. Only `tests/redesign-audit.test.ts` and this report were authored by the audit worker. Producer modules remain owned by the coordinator/backend worker, who were notified promptly with exact failing triggers. No live records, database deployments, Git repositories, package files, or existing tests were modified.

## Result at the audit checkpoint

**Six proven findings, represented by seven failing regression cases; four passing controls.** `bun run typecheck` exits 0. This is a successful defect-finding review, not a claim that the implementation passes its acceptance suite. The new tests deliberately assert the required behavior normally; they are not skipped or marked expected failures.

Reproduce:

```sh
bunx vitest run tests/redesign-audit.test.ts
```

Observed at 2026-09-16 00:27 America/Chicago: **11 tests, 7 failed, 4 passed**, approximately 0.53 seconds. All fixtures use isolated `convex-test` databases and real Better Auth test sessions. Business setup and defect triggers use public APIs through `anyApi`; a database read locates an adjustment's journal for the reversal test. No direct fixture corruption is used to induce the failures.

## Proven defects

### F1 — Recognition reversal separates the obligation from its receivable

**Owner:** backend worker, `convex/finance.ts:reverseJournalEntry`, coordinated with obligation accounting. **Priority:** high. **Spec:** 12.2, recognized receivable/payable and obligation changes must remain consistent in the same database operation.

Trigger `AUDIT-F1`:

1. Post USD 100 receivable against income.
2. Create a USD 100 obligation recognizing that receivable posting.
3. Reverse the recognition journal through `finance.reverseJournalEntry`.

Actual: receivable ledger balance becomes **0**, while the live obligation remains **100 outstanding**. The reverse operation does not check or correct obligations whose `recognition_posting_id` belongs to the journal. Expected: reject this generic reversal until an explicit obligation correction is supplied, or atomically preserve consistent obligation/ledger effects. The regression permits either correct behavior and compares the surviving obligation claim to the receivable balance.

### F2 — Reversing a settled increase creates negative outstanding

**Owner:** backend worker, `convex/finance.ts:reverseJournalEntry` and `convex/obligations.ts` invariants. **Priority:** high. **Spec:** 12.2, reject unexplained negative outstanding; excess payment requires explicit unapplied-credit/refund treatment.

Trigger `AUDIT-F2`:

1. Recognize a USD 100 obligation.
2. Increase it by USD 100 using `obligations.adjust` and the required atomic recognition journal.
3. Settle the USD 200 total with one cash receipt and receivable counterpart.
4. Reverse the adjustment journal.

Actual: the reversal appends a negative obligation adjustment, leaving approved amount **100**, settled amount **200**, outstanding **−100**. The normal adjustment API prevents this result, but the reversal path bypasses that validation. Expected: reject the reversal or perform a supported explicit correction that preserves nonnegative outstanding. The test permits rejection and asserts the invariant after the operation.

### P1 — Settlement and forecast fulfillment spend the same payment capacity twice

**Owners:** coordinator for `convex/planning.ts:fulfillExpectedFlow`; backend worker for `convex/obligations.ts:settle`. **Priority:** high. **Spec:** 12.2 canonical payment capacity; 13 actual fulfillment replaces only the fulfilled predicted portion.

Trigger `AUDIT-P1`, exercised in **both orders**:

- Create one obligation-backed USD 100 expected receipt and an independent assumption-backed USD 100 expected receipt.
- Post a single USD 100 cash receipt.
- Use that same posting both to settle the obligation and to fulfill the independent expected flow; repeat with fulfillment before settlement.

Actual: both mutations succeed, so **USD 200 of expectations are fulfilled using USD 100 of actual payment**. Aggregate remaining expected amount is 0; expected is 100. Each subsystem checks its own link table without reserving the capacity consumed in the other. A fix must address both operation orders; changing only planning fulfillment leaves settlement-after-fulfillment open.

This is distinct from two observations independently matching the same actual posting: these links consume fulfillment/payment capacity and reduce predicted or outstanding amounts.

### P2 — Draft journals enter actual-input manifests

**Owner:** coordinator, `convex/planning.ts:captureInputs/createPlanVersion`. **Priority:** high. **Spec:** 13, actual-input selection must exclude drafts.

Trigger `AUDIT-P2`: create a balanced **draft** journal, then pass it as a `journal_entry` target labeled as an actual receipt to `createPlanVersion`.

Actual: the plan version is created and contains the draft's captured record. Expected: reject a draft journal as an actual input. Ownership and capture alone do not establish that a journal is posted; posting targets should also validate their parent journal when applying the same rule.

### P3 — Schedule occurrence and incurred obligation become duplicate forecasts

**Owner:** coordinator, `convex/planning.ts:createExpectedFlow`. **Priority:** high. **Spec:** 13, an amount owed and projected settlement cash may refer to the same obligation without becoming two forecasts.

Trigger `AUDIT-P3`:

1. Create a schedule version and its canonical occurrence key `versionId:2026-10`.
2. Create a USD 100 expected flow from that schedule occurrence.
3. Incur a USD 100 obligation with the same schedule version and occurrence.
4. Create a second expected flow from that obligation using a different client-provided occurrence-key alias.

Actual: the second expected flow succeeds. Existing duplicate checks compare supplied flow keys and direct obligation IDs, but do not resolve the obligation's underlying schedule occurrence. Expected: reject the alias or require explicit supersession/linkage, leaving one predicted cash occurrence.

### P4 — Captured actuals can be newer than the declared actual boundary

**Owner:** coordinator, `convex/planning.ts:captureInputs/createPlanVersion`. **Priority:** high for reproducibility. **Spec:** 13, a consistent actual-data revision boundary must accompany frozen inputs.

Trigger `AUDIT-P4`: post a journal now and create a plan version capturing it while setting `actual_boundary: 0` (1970).

Actual: the version is accepted even though the journal was recorded and posted long after the manifest's declared boundary. The API only rejects a boundary in the future; it does not check actual inputs against the selected boundary. Expected: reject the inconsistent input/boundary combination or select the historically valid inputs. The regression uses a posted journal so it does not duplicate the draft defect.

## Passing controls

| Test | Verified behavior |
| --- | --- |
| `AUDIT-C1` | A foreign user cannot settle or reverse another owner's records; settlement capacity cannot exceed a payment; reversing a payment restores obligation outstanding; a second reversal is rejected. |
| `AUDIT-C2` | Draft postings are excluded from actual balances; equal-and-opposite amounts in different currencies are rejected atomically; posting the valid draft updates actual balances. |
| `AUDIT-C3` | Reconciliation matching checks owner, direction, line/posting capacity, and accepted reconciliation immutability; a foreign user cannot read account observations. |
| `AUDIT-C4` | Attribution replacements must partition the posting, enforce ownership and expected revision, and reverse beneficiary cent allocations exactly; reversed analytical history cannot be edited. |

No new cross-owner bypass was proven in these exercised public paths. This limited result is not an exhaustive authorization proof for every API or malformed pre-existing row.

## Suggestions and limits — not additional proven findings

- Existing integration-review items on effective-time reads and derived measurement input capture were already assigned to the backend worker; this audit did not duplicate them as new defects.
- Inspect reconciliation source-cutoff semantics, correction lineage branching, and whether accepted revisions need an explicit frozen match list. These require a product/contract distinction between balance anchors and transaction-match coverage; no extra failure is asserted here.
- A future manifest resolver should verify pinned Git content availability before a forecast engine consumes it. The current database layer explicitly validates locator ownership and immutable hash syntax rather than Git availability, and runs are labeled `inputs_frozen`, not calculated forecasts.
- Consider shared helpers for settlement/forecast capacity and reversal obligation validation to prevent future asymmetric fixes.
- No browser or live migration audit was performed. API absence during active implementation was not counted as a defect. Existing tests and full-suite failures outside this file were not changed.

## Fix tracking and verification commands

At the checkpoint above, **none of F1, F2, P1, P2, P3, P4 has been reclassified as fixed**. The coordinator/backend worker may be editing concurrently; use the regression IDs and rerun the suite to establish a later status. A passing control is not a fix claim for another failing path.

Commands run:

1. `bunx vitest run tests/redesign-audit.test.ts` — initial seven-case suite: **5 failed, 2 passed**, proving F1/F2/P1/P2/P3.
2. Same command after adding reverse capacity order, P4, and additional controls — **7 failed, 4 passed**, proving six findings in eleven cases.
3. `bun run typecheck` — **passed**, exit 0.

No producer-module fix or application commit was made by the audit worker.


## Final integration verification

The coordinator reran the complete suite after backend and planning fixes: all 83 tests pass, including all eleven audit cases above. F1/F2 and both P1 orderings are resolved; P2–P4 pass. See [planning corrections](planning-integration.md) and [final integration evidence](redesign-implementation.md). The earlier failing checkpoint is retained as the review record.
