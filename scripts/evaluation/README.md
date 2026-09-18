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
