# Isolated query acceptance

These scripts use the production MCP handler and production client adapter with the configured local model. They do not deploy to, seed, or edit the normal database. Private state and transcripts belong in ignored directories.

Prerequisites: the normal local Convex binary/configuration exists, Bun dependencies are installed in both sibling repositories, and ports 3300, 3340 and 3341 are available. `setup.py` uses the local binary and creates a different database and storage directory. It rejects an unrecognized process already occupying the evaluation port. The fixture function is copied into this disposable deployment only; it is not included in production `convex/`.

```sh
# In lifeor2
python3 scripts/evaluation/setup.py
python3 scripts/evaluation/provision.py
bun scripts/evaluation/serve.ts
# In another terminal:
bun scripts/evaluation/call.ts datasets.saveSampleDocuments '{}'
bun scripts/evaluation/provision-writes.ts
```

The base family has 308 journals. Growth is resumable and restricted to the isolated URL. Keep growth stopped while measuring final values and latency. Financial reports reject changed dataset revisions instead of returning totals assembled during an import. Named-dataset reads do not depend on the short retention period of a pinned backend timestamp; legacy unversioned scopes still require a pinned snapshot.

```sh
bun scripts/evaluation/grow.ts 3080
bun scripts/evaluation/benchmark.ts 3080
bun scripts/evaluation/grow.ts 30800
bun scripts/evaluation/benchmark.ts 30800
bun scripts/evaluation/grow.ts 308000
bun scripts/evaluation/benchmark.ts 308000
```

Synthetic history spans 2010–2025 and uses the existing design business, currency, accounts and explicit subject. Each group has a $100 receipt and four $25 expenses, with balanced double-entry journals. At 308,000 total journals the independent historical oracle is income $6,153,900, expenses $6,153,825 and net $75. This is a transaction-volume stress fixture, not a claim that every household has this transaction mix. Relationship cardinality stays small. Original 2026 records and source notes remain intact.

Run actual inference from the client application's directory:

```sh
# In lifeor2-client/apps/web; credentials remain local, never in source control.
bun --env-file=.env.local scripts/eval-life-queries.ts \
  --cases=../../../lifeor2/scripts/evaluation/acceptance.json \
  --output=../../.eval-results/acceptance.jsonl

bun --env-file=.env.local scripts/eval-life-queries.ts \
  --credentials=../../../lifeor2/.convex/query-evaluation/write-credentials.json \
  --dataset-name='Isolated write workflows' \
  --cases=../../../lifeor2/scripts/evaluation/write-cases.json \
  --output=../../.eval-results/write-acceptance.jsonl
```

The broad and held-out expectations are dated September 18, 2026. Actual inference always uses the real current workspace clock; update time-sensitive expected outcomes when rerunning on another date. Do not freeze the live application clock to make an acceptance case pass. The separate relative-calendar preparation computes its oracle from the actual local day. Deterministic unit tests use their own fixed fixture clock.

Use `--only=id1,id2` for diagnosis. The harness logs model configuration, exact questions, tool operations, latency, reported tokens, compactions, rendering mode and sanitized transport observations. Presence/absence string checks are smoke checks only. Review every answer against the `expected` criterion and independent records, including meaning, scope, dates, completeness, unwanted writes, and whether all parts of the question were answered. Preserve failed attempts. Run `bun scripts/evaluation/verify-writes.ts` from the server repo after the ordered write suite to check committed identities, corrections, balanced postings, schedule versions and preserved notes. For writes, inspect the resulting records and revisions; a model saying “done” is not evidence of a committed operation.

`write-cases.json` is ordered: create, reschedule, expense, rent revision, name correction and note append, then verification and negative cases. The source note contains an inert instruction-injection fixture. The model must treat it as document content. Use a fresh isolated fixture or inspect existing results before replaying non-idempotent conversational requests.

## Index migration

New named/sample datasets maintain report indexes transactionally. Existing datasets remain on complete source-query fallback until backfilled. In the isolated evaluation only:

```sh
bun scripts/evaluation/admin.ts
# If only current-claim indexing is newly added:
bun scripts/evaluation/admin.ts --obligations-only
```

For an actual deployment, use its authenticated operator environment and run the internal `reportIndex:backfill` and `reportIndex:backfillObligations` mutations, passing the explicit dataset ID and each returned cursor until `ready: true`. Do not use the evaluation admin script against another URL. Never set readiness manually. Source records remain authoritative and are not rewritten by these migrations.

Report files use private permissions, per-user/connection/dataset isolation, bounded size/count, and a 24-hour access TTL. Configure `LIFEOR_REPORT_DIRECTORY` on durable local/shared storage when deploying multiple workers; ephemeral serverless disks cannot guarantee cross-worker report availability. Expired files are pruned on subsequent saves in that scope; operators should also clean expired inactive scopes under their normal retention process. Conversations contain evidence snapshots, not a new source of truth.


`heldout.json` adds fresh phrasings and a three-turn conversation that reuses a saved report. `long-note.ts prepare`, `long-note-cases.json`, and `long-note.ts verify` test a source document exceeding 40,000 characters: appending must preserve its exact prefix, and reading facts must use bounded text pages. These scripts are restricted to the separate write fixture.

The source workflow cases also create a new person and a previously missing note, then ask a follow-up question. The oracle checks that no unrequested relationships were added. `analytical-cases.json` covers period comparisons, zero-baseline percentages and historical project debt before a later payment. These supplement the core suite rather than replacing failed attempts.

Preserve failed negative-test writes as evidence. If an operator explicitly reverses a failed isolated test, `verify-writes.ts --allow-corrected-negative` checks the documented original/reversal pair in private `negative-test-reversal.json` and rejects any additional journals. This is validation of compensated state, not a pass for the original model attempt. Ordinary acceptance uses the strict default.

After read acceptance on the large fixture, `scale-write-cases.json` records and reverses explicitly specified bank and credit-card expenses in separate conversations, and reads their effects. Use the main isolated credentials for these cases. Run `bun scripts/evaluation/verify-scale-writes.ts` afterward: the oracle independently reads the four posted journals, checks the original amount and accounts, and requires an exact compensating reversal. This adds four historical journals to the 308,000-journal fixture without changing its net balances. Do not blindly replay this conversation on an already-used fixture.

## Varied household volume fixture

The second isolated owner/dataset keeps the same current sample but generates 307,692 historical journals in six-entry cycles: funding income, two bank-paid purchases, two card charges, and the corresponding card payment. Dates span 2010–2025; amounts, ten expense categories, two checking accounts, two cards, accounting subjects and explicit beneficiaries vary. Each complete cycle leaves bank cash and card debt unchanged. This is a varied transaction-volume workload with independently checkable totals, not a statistically calibrated model of household behavior. Family graph cardinality remains small.

```sh
python3 scripts/evaluation/setup.py
python3 scripts/evaluation/provision-diverse.py
bun scripts/evaluation/grow.ts 308000 --credentials=diverse-credentials.json --variant=diverse
python3 scripts/evaluation/diverse-oracle.py
bun scripts/evaluation/benchmark-diverse.ts
# From lifeor2-client/apps/web, after growth stops:
bun --env-file=.env.local scripts/eval-life-queries.ts \
  --credentials=../../../lifeor2/.convex/query-evaluation/diverse-credentials.json \
  --cases=../../../lifeor2/scripts/evaluation/diverse-cases.json \
  --output=../../.eval-results/diverse.jsonl
```

Provisioning checkpoints each month and resumes an unfinished isolated sample. Sample enrichment now runs by month and uses dataset/date indexes: a large neighboring dataset must neither be scanned nor cause the small sample's final transaction to exceed the backend read limit. The original 308,000-journal fixture and the separate edit-workflow fixture remain available.

`followup-write-cases.json` checks direct clarification, a next-year appointment, and a fall-back-clock edit that must remain uncommitted until the user distinguishes the repeated local time. Run it after the person/note suite on the same isolated write fixture, then run `verify-future-appointment.ts`. The oracle requires exactly the original next-year occurrence with no correction from the ambiguous request.

For a clean final write-suite rerun, provision a new isolated fixture instead of replaying creates on an already-used dataset:

```sh
bun scripts/evaluation/provision-writes.ts --tag=final --credentials=write-final-credentials.json
# Run write-cases.json with --credentials pointing to write-final-credentials.json.
bun scripts/evaluation/verify-writes.ts --credentials=write-final-credentials.json
```

Different tags use distinct idempotency namespaces and preserve the earlier fixture and failed-attempt evidence. `verify-cash-scenarios.ts` directly checks the production scenario calculation against the independently reconciled main fixture; it does not substitute for the actual-model scenario cases.


Memo receipt lookup additionally uses Convex's `journal_entry.search_memo` index. Deployment waits for its automatic backfill; do not serve the new search against an old schema. The varied inference suite includes an old receipt with no supplied date, whose date, amount and card are computed independently from the generator.

After `verify-future-appointment.ts` has checked the unchanged January appointment, run `fold-resolution-cases.json` on the same write fixture and then `bun scripts/evaluation/verify-fold-resolution.ts`. This explicitly selects the second 1:30 AM at the November clock change. The oracle requires UTC 07:30, a correction of the original event, and its preserved person link. Do not run this correction before the unchanged-appointment oracle.


### Large local SQLite index backfills

The installed evaluation backend (`002379a`, January 2026) materializes the remaining SQLite index range even when its caller requests a small page. Its search backfill defaults to 128 documents per page. On a large existing table this can repeatedly scan the remaining range. See the version-matched [SQLite scan implementation](https://github.com/get-convex/convex-backend/blob/002379a/crates/sqlite/src/lib.rs) and [worker page-size setting](https://github.com/get-convex/convex-backend/blob/002379a/crates/common/src/knobs.rs). This is specific to that local backend version, not a general statement about hosted Convex.

The isolated migration procedure temporarily starts its recognized backend process with `VECTOR_INDEX_WORKER_PAGE_SIZE=16384`, waits for index readiness, then restarts with the default setting before inference. The variable is read at backend startup; setting it on an already-running backend does nothing. Start the tuned process before creating the index: restarting this old backend during an incomplete backfill exposed a timestamp invariant failure, which required dropping and recreating only that incomplete derived index in the isolated schema. Source records were preserved. Do not change or restart the ordinary deployment to run this experiment. `setup.py` recognizes an already-starting isolated process and waits up to five minutes for persisted indexes to load, instead of launching a second process against the same database.


### Calendar evidence, repeated edits and distant source facts

`prepare-typed-clock.ts` creates a separate clock-change appointment after the person/note fixture exists. Run `typed-evidence-cases.json` with the original write credentials, then `verify-typed-clock.ts`. This suite tests a typed daylight-saving clarification, the chosen correction, its read-back and bounded source facts. Review final answer freshness separately from the mutation oracle: a correct committed edit with an old report shown afterward is a failed answer.

After that oracle succeeds, run `prepare-freshness.ts`, then `freshness-cases.json`, then `verify-freshness.ts`. This ordered suite moves the appointment to the first November 2027 clock occurrence, reads it, moves it to the second occurrence and reads again. The independent oracle requires the two-link correction chain, both UTC instants and the preserved original event. Preparation also creates Robin Hayes's 65,026-character fictional source with parking and pet facts far apart. The final read must quote both facts with commit and coverage through focused excerpts. Do not replay these corrections blindly: use a fresh fixture sequence or inspect the existing chain first.

`relative-calendar-cases.json` adds a separate appointment for Robin: next Tuesday, two days later, a pronoun-only read-back, then tomorrow morning. Immediately before this suite, run `python3 scripts/evaluation/prepare-relative-calendar.py` and `bun scripts/evaluation/verify-relative-calendar.ts --before`. Use the original write credentials for inference, then run `bun scripts/evaluation/verify-relative-calendar.ts`. Python's `zoneinfo` independently computes the three expected instants; the oracle checks the current person-linked event and both correction links. All turns must finish within the same Chicago civil day. Preparation refuses to overwrite an existing fixture, and the precondition refuses to replay a create over an existing appointment.

Keep one inference run active at a time when collecting local-model timings. Freeze the loaded MCP server and client implementation for a suite, record their revisions, and review semantic results before calling it accepted. A wording-only report fix can be checked with a fresh read of the committed write result; do not repeat the original mutation merely to regenerate a confirmation.

### Mixed-direction overdue claims

The ordinary sample has an overdue receivable but no overdue household payable. This can conceal a missing debtor/creditor filter. Provision another sample with `python3 scripts/evaluation/provision-diverse.py --credentials=mixed-debt-credentials.json`, then run `bun scripts/evaluation/prepare-mixed-debt.ts`. The latter adds a balanced, posted $555.55 maintenance invoice and a linked unpaid claim due September 10. It independently verifies the $700 overdue receivable, the $555.55 overdue payable, and the separate $15,000 future-due payable. Run `mixed-debt-cases.json` with those credentials to check each direction, both together, and Garden Services’ own receivable perspective. MCP calls must now explicitly choose `direction=receivable|payable|both`; dataset-wide directed queries also require a unique `perspectiveQuery`. Party filters do not change that perspective. The main volume fixtures are unchanged; this small contrast fixture checks meaning rather than volume.


### Account references and known profile facts

`account-reference-cases.json` repeats the exact explicitly named-account cash scenario, a suffix-only reference, a missing-account clarification and its retained follow-up. Use the main volume fixture. Resolve names/suffixes into stable account IDs; a malformed ID must be recoverable without forcing the user to repeat an already supplied choice. Keep missing-choice negative tests separate and verify no journal was posted.

After provisioning the mixed-debt fixture, `bun scripts/evaluation/prepare-profile-source.ts` adds Quinn Rowan with a 67,273-character source. Its independently specified date of birth appears after character 60,000. Preparation verifies direct document-ID lookup, exact commit/target, the birthday excerpt and scoped absence for birthplace words. Run `profile-source-cases.json` with those credentials, and repeat `acceptance.json --only=missing-birthday` on the main fixture. The model must find the recorded birthday and distinguish missing birthplace/birthday evidence without inventing dates from ages. The fixture uses a stable idempotency key and refuses to overwrite a changed note.


### Unconfigured household and timezone

The fresh `write-final-credentials.json` fixture deliberately has neither a default household nor a configured timezone. Its `UTC` context value is explicitly a fallback, not a user choice. After the clean write-suite oracle passes, run `bun scripts/evaluation/verify-unconfigured-scope.ts --before`, then `unconfigured-scope-cases.json` through the client with those credentials, then `bun scripts/evaluation/verify-unconfigured-scope.ts` and the strict write oracle again. The first case asks about “our family”; the second requests a timed appointment without supplying a timezone in a fresh conversation. Both must clarify, make no writes, and never carry Morgan/Chicago defaults across datasets. The before snapshot refuses overwrite and the after check requires identical scope settings and current events. The intentional create request has `mode: read` so every attempted mutation is flagged for review. Distinguish an attempted call rejected before mutation from a committed write: preserve the conservative smoke flag, inspect the error and independently require unchanged business records. A success message alone is insufficient.


For a clean relative-calendar retry after any failed create, provision a separate fixture instead of overwriting the failed event:

```sh
bun scripts/evaluation/provision-writes.ts --tag=relative-final --credentials=write-relative-credentials.json
python3 scripts/evaluation/prepare-relative-calendar.py --tag=final --credentials=write-relative-credentials.json
bun scripts/evaluation/verify-relative-calendar.ts --tag=final --before
# Run generated .convex/query-evaluation/relative-calendar-cases-final.json
# through the client with write-relative-credentials.json.
bun scripts/evaluation/verify-relative-calendar.ts --tag=final
```

The generated cases use the fresh fixture's Avery identity. The oracle requires the person link, all three exact instants and the correction chain. A correctly named event without the participant link fails. The MCP create contract requires an explicit `subjects` list; names in titles do not create associations.


Calendar writes accept exactly one of an absolute `date` or a relative `dateExpression`. The latter supports today/tomorrow/yesterday, next weekday, in N days/weeks, and N days/weeks later/earlier (anchored to the existing event); the day after tomorrow and day before yesterday are also recognized. `time=same` preserves a rescheduled event's recorded local clock time. The client preserves simple relative phrases from the current original user message before validation and request-key generation. It does not automatically rewrite mixed origin/destination, negated, quoted-title or explicit-date instructions. Unsupported expressions need clarification or an explicit date.


`relative-period-cases.json` adds last-month household categories, month-over-month groceries, next-month mortgage schedules and current-month spending so far. Its independently reconciled expected values use the September 18, 2026 acceptance date; regenerate time-sensitive expectations for another run date. Include it with the broad, held-out and varied-history read suites on one frozen implementation.


`receipt-followup-cases.json` tests an exact old memo, a distinctive reference without a date, the journal’s household/company chart, and a nonexistent exact identifier on the varied fixture. Review the search sequence as well as the final values: a complete exact result should not trigger searches of unrelated company books. `singleExactMemoMatch` is deliberately false for partial-word matches, duplicates, incomplete pages and later pages. The chart and original posting fields remain available to ordinary read/write callers. Run `verify-receipt.ts` for the independent known-receipt oracle. A numerically correct answer that nearly exhausts the run budget after unnecessary retries remains a performance failure in the evidence report.

`guarantee-evidence-cases.json` explicitly requests project and cash reports plus their evidentiary limits. It complements the original `acceptance.json --only=future-certainty` case, which can correctly decline a guarantee without retrieving reports. Both paths must avoid promises of completion timing or perpetual cash sufficiency. The versioned run results and known limitations are in [the acceptance report](../../docs/evaluation/life-query-results-2026-09-18.md).
