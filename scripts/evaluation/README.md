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

The base family has 308 journals. Growth is resumable and restricted to the isolated URL. Keep growth stopped while measuring final values and latency.

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
