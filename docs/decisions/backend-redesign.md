# Backend redesign implementation contract

Backend implementation handoff, 2026-09-16. Additive schema; old IDs and legacy rows remain. No live deployment or data mutation by this worker.

## UI contracts

- `entities.list/get/create/update/remove` remain; remove archives. Names/kinds gain immutable complete timeline revisions; optional `effectiveAt`, `expectedRevision`, `reason` on updates.
- `arrangements.list/get/create/update/remove`: create accepts `typeId`, `name`, `valid_from`, optional `valid_to`, parent/replacement IDs. `kind` remains a compatibility input that resolves/creates a type, except non-arrangement kinds. List excludes archived/migrated records. `listTypes`, `createType({name,templates?: [{name,participation: "participant"|"subject",eligibleKinds?: string[]}]})`, `updateType({id,name?,templates?,expectedRevision?})`.
- `arrangements.getRoleDefinitions({arrangementId})`, `getRoles({arrangementId})`, `createRole({arrangementId,name,participation,eligibleKinds?})`, `updateRole({id,name?,archived?,effectiveAt?})`, `assignRole({roleId,entityId,valid_from,valid_to?})`, `updateAssignment({id,valid_to?,effectiveAt?})`. Existing `addRole` is a compatibility shim. Role outputs include entity_id and role_name.
- `tags.list/create({name})/update({id,name?,archived?})/assign({tagId,target})/unassign({id})/getAssignments({tagId})`. Typed targets are `{kind: tableName,id: typedId}` for explicitly supported business tables.
- `finance.listCharts/createChart({name,reportingEntityId?})`; `listAccounts({chartId?})`, `createAccount({chartId,name,type,normal_balance,currency,parent_account_id?})`; journal APIs use `chartId`, `accounting_date: YYYY-MM-DD`, and posting `minor_units` integers. Legacy `coaArrangementId` and decimal-major `amount` remain compatibility inputs only, with exact conversion and no rounding.
- `finance.getAccountBalance` returns `minor_units`, `currency`, compatibility major `balance`; trial balance returns `byCurrency` with exact minor-unit totals and per-account minor units. No mixed-currency total.
- `events.create` adds title and optional interval/correction fields; legacy payload remains preserved, not financial authority.

## Git adapter contract

`details.ensure({target,repositoryKey})` allocates or returns a stable locator. `details.get({id})` and `details.forTarget({target})` enforce the authenticated owner. `details.observe({id,commit?,availability})` updates disposable cache only; `availability` is `available | missing | unreadable`. Locator fields: `_id`, `user_id`, `target`, `repository_key`, `path` (deterministic `details/<id>.md`), optional `observed_commit`, `availability`. Markdown never enters this API. Each target has at most one live document. `details_document_id` is attached to the target when allocated.

## Decisions

Money uses safe integer minor units with explicit supported scales. History uses complete typed timelines, selected first by recorded knowledge time and then half-open effective interval. All new references enforce ownership; deletion APIs archive stable roots. Existing property and measurement payloads remain read-only legacy evidence until verified export/conversion; no generic property write API is introduced. Planning publishes immutable captured input manifests and never claims a computed forecast.

Operator commands and verification results are below.

## Additional UI contracts

- `measurements.list()` / `create({subject: Target,name,assertion: observed|expected|derived|contractual,value:{decimal,unit,currency?},as_of,method?,evidence_ids?,corrects_id?,assumption_id?,input_references?,calculation_version?})`.
- `events.addAffects({eventId,target,meaning?})`, `voidEvent({id,reason})`; `create({kind,title?,occurred_at,ended_at?,payload_json?,corrects_id?})`.
- `finance.getTrialBalance({chartId})` returns `{balances:[{accountId,accountName,accountType,currency,minor_units,debit,credit}],byCurrency:[{currency,totalDebit,totalCredit,isBalanced}],isBalanced}`. Debit/credit totals are **minor units**. No totalDebit/totalCredit at root.
- `finance.createFinancialAccount({arrangement_id,ledger_account_id,kind,currency,institution_entity_id?,identifier?})`, `listFinancialAccounts()`; `reverseJournalEntry({jeId,accounting_date,reason})`.
- `finance.getAttribution({postingId})`, `replaceAttribution({postingId,expectedRevision,portions:[{minor_units,subject_entity_id?,arrangement_id?,counterparty_entity_id?,unclassified,beneficiaries:[{entity_id?,unassigned,share_bps}]}],reason?})`.
- `obligations.list()` includes derived `outstanding_minor_units`; `create({creditor_id,debtor_id,due_date,minor_units,currency,arrangement_id?,event_id?,evidence_ids?,schedule_version_id?,occurrence_key?,recognition_posting_id?})`.
- `obligations.settle({obligationId,capacityPostingId,minor_units,settlement_date,recognitionPostingId?,evidence_ids?})`; `adjust({obligationId,minor_units,effective_date,reason,evidence_ids?,journal?:{eventId,chartId,memo,accounting_date,postings:[{accountId,minor_units,currency,description}]},recognitionAccountId?})`. Recognized obligations require atomic journal effects for adjustments.
- `obligations.createSchedule({arrangement_id,name,creditor_id,debtor_id,amount?:{minor_units,currency},variable_rule?:manual_amount|metered_quantity,currency,recurrence:{frequency:once|daily|weekly|monthly|yearly,interval,day_of_month?},start_date,end_date?,timezone,valid_from,valid_to?,evidence_ids?})`, `listSchedules()`.
- `planning.listPlans()`, `createPlan({name})`, `createPlanVersion({planId,period_start,period_end,inputs:[{target,revision?,captured?: string|number|boolean,label}],git_revisions:[{repository_key,path,commit}],resolved_tag_targets:Target[],actual_boundary})`, `publishPlanVersion({id})`; `listScenarios()`, `createScenario({name})`, `createScenarioVersion({scenarioId,base_plan_version_id,overrides:[{target,value:{kind:amount,amount:{minor_units,currency}}|{kind:timing,date}}],git_revision?})`.
- `planning.createExpectedFlow({expected_date,minor_units,currency,account_id?,schedule_version_id?,obligation_id?,assumption_id?,occurrence_key,input_revision,supersedes_id?})`, `listExpectedFlows()` includes derived `remaining_minor_units`; `fulfillExpectedFlow({id,postingId,minor_units})`. Planning is a foundation API, no generated projections/results.

## Implemented history and financial decisions

- Root IDs survive structured edits. Entity/arrangement/local-role/assignment revisions hold typed complete timelines; type templates are embedded immutable versioned suggestions. Current reads resolve timelines at read time, including scheduled edits. Arrangement parent cycle validation includes scheduled edges. End-boundary corrections revise the complete interval in a new knowledge revision, so extending an old end does not leave a false gap.
- Schedule versions are immutable term records. `commitment_schedule_revision` holds a complete effective timeline of version IDs; `obligations.scheduleAt({id,effectiveAt,knownAt?})` selects knowledge revision then half-open segment. A bounded correction retains both surrounding segments. No occurrences are generated automatically.
- Legacy role dates are unknown. Migrated assignments start at migration time and explicitly set `history_unknown`; original `share_json` remains preserved verbatim, never treated as typed ownership. Legacy end dates are preserved and reported for review, not guessed into exclusive boundaries.
- Supported currency scales: USD/EUR/GBP/CAD/AUD/CHF/HUF=2; JPY=0; KWD/BHD=3. Unsupported currencies, precision loss, nonfinite/fractional minor units and overflow are rejected. Legacy decimal major amounts are parsed from explicit decimal text with no rounding. New postings contain only minor units; migrated postings retain original `amount` beside authoritative `minor_units` for audit.
- Beneficiary allocation uses largest fractional remainder; stable entity ID order breaks ties, with explicit unassigned remainder last. Attribution replaces an entire set with optimistic revision checking. Reversal analytical sets copy/negate original portions and beneficiaries and preserve project attribution tags. Reversed analytical interpretations are frozen.
- Settlement capacity requires a designated financial-account posting. A journal uses one canonical capacity posting across all its settlements; receivable/payable counterparts add no payment capacity. Explicit forecast fulfillment consumes the same capacity. Recognized adjustments create the balanced journal and claim adjustment atomically. Recognition reversal voids an untouched obligation atomically; dependent settlements/adjustments must be undone first. Any reversal creating negative outstanding is rejected.
- Chart/account names and archived state can change, but account type/currency remain immutable through public APIs. Removal APIs archive rather than destroy records. Journal replacement references require the original posted journal to have been reversed.
- Measurements use typed subjects and exact decimal quantities. New writes do not manufacture legacy owner fields or JSON values. Derived measurements capture immutable source snapshots and calculation version; expected measurements require an explicit assumption. Migration converts scalar observed quantities only when units/currency are explicit, preserving original bytes and evidence; unknown recurrence/derived/expected payloads are reported for review.
- Typed targets include immutable entity/arrangement/type/role/schedule revisions and attribution sets, so evidence and planning can pin these directly. Git pins require full 40- or 64-character commit hashes. `details.observe` allows omitted commit only for missing/unreadable availability and retains the last observed commit.

## Operator migration procedure

Only internal/admin functions perform migration. They retain each original owner and all old tables/IDs; they never use the operator's authenticated user as owner. The worker has not deployed or changed the live database.

Use the coordinator's isolated state wrapper (which keeps credentials out of logs):

```sh
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- dev --once
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:dryRun '{}'
```

Review `rejects`, `warnings`, per-account/currency `totals`, `counts`, and `applyOrder`. Run each stage below in this exact order, using batches of at most 100 rows:

```sh
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"entity","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"arrangement","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"arrangement_role","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"ledger_account","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"journal_entry","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"posting","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"event","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"event_affects","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"measurement","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:applyBatch '{"stage":"property","limit":50}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:dryRun '{}'
python3 scripts/redesign_admin.py cli --state .convex/redesign-rehearsal -- run migrations:exportLegacyProperties '{}'
```

If `isDone` is false, repeat that same stage with its returned cursor as `"cursor":"<returned cursor>"` until complete, then advance. Resume safely with the cursor or rerun from the start: `migration_map` prevents duplicates, and repeated issues are deduplicated. Rerun all stages a second time and compare counts/mappings/totals. Correct rejected source data only through an explicit reviewed operator procedure and then rerun; no silent monetary rounding or ownership repair occurs.

Property export returns **every** original row with owner, value, ID and effective/recorded timestamps; the Git worker's export workflow is responsible for committing and verifying these bytes. The legacy table remains read-only even after export. Ambiguous projects/chart relationship links and unknown measurement payloads remain preserved with `migration_issue` records. Dry-run currently audits the whole small local dataset in one read; mutation writes are paginated. Very large datasets need a paginated audit/export tool before migration.

After independent rehearsal review and verified backup, the coordinator may run the same commands with the actual configured live state directory. Do not reset an instance, delete old tables, upgrade the binary, change authentication configuration, or print credentials. Compare the coordinator's full before/after export verification, not just migration-map counts.

## Verification and scope boundaries

At this checkpoint: backend and app TypeScript pass; 28 focused backend/domain tests pass, including custom types/local subjects, ownership guards, templates not propagating, half-open end=0, future edits, late end extension, bounded schedule corrections, deterministic allocation, exact multi-currency journals/drafts, mixed card attribution/reversal, partial rent credit and settlement reversal, mortgage/escrow separation, observation matching capacity, immutable derived inputs, and idempotent migration with original money and duplicate property history retained. Coordinator-owned planning and independent audit tests are tracked separately and must pass before live deployment.

No bank import, recurrence generator, report/dashboard expansion, forecast engine/results, notification system, family authorization model, generic property engine, or hard deletion was added. Planning APIs/tests are owned by the coordinator; Git adapter/routes/editor and UI are owned by the other workers. Unknown legacy recurrence formats and historical end-date meaning require explicit review; the implementation preserves and reports them instead of claiming full semantic conversion. No live-data migration is claimed by this worker.


Final backend validation commands:

```sh
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
./node_modules/.bin/tsc -p convex/tsconfig.json --pretty false
./node_modules/.bin/vitest run tests/convex.test.ts tests/convex-domain.test.ts
```

All pass (28 backend/domain tests). The most recent whole-suite run additionally exposed four coordinator-owned planning audit failures: shared settlement/forecast capacity in the settle-first order, draft journal snapshot exclusion, schedule/obligation forecast alias deduplication, and the captured actual-data boundary. The coordinator owns `convex/planning.ts`, `tests/planning.test.ts`, and the independent audit suite, and has the concrete failures; these must be resolved before declaring the overall project green. Backend-side fulfill-first capacity and both financial reversal audit cases pass.

The legacy recurrence converter accepts only an explicit `kind: "schedule"` envelope containing authenticated-owned creditor/debtor IDs, an actual arrangement subject, declared currency and exact minor units (or an explicit variable rule), recurrence frequency/interval, start date, timezone and valid interval. It preserves the original measurement payload and attaches source evidence, maps it to a schedule, and excludes that converted legacy row from current measurement lists. Any incomplete/unknown payload remains preserved with an issue instead of guessed facts. Reconciliation uses event occurrence instants for cutoffs; calendar accounting dates remain separate.

Worker-owned files changed: `convex/arrangements.ts`, `convex/entities.ts`, `convex/events.ts`, `convex/finance.ts`, `convex/details.ts`, `convex/evidence.ts`, `convex/tags.ts`, `convex/measurements.ts`, `convex/obligations.ts`, `convex/observations.ts`, `convex/migrations.ts`, `convex/lib/access.ts`, `convex/lib/domain.ts`, `convex/lib/history.ts`, `convex/lib/ledger.ts`, `convex/lib/legacy.ts`, `convex/schema.ts`, `convex/schema/core.ts`, `convex/schema/finance.ts`, `convex/schema/foundation.ts`, `convex/schema/planning.ts`, `convex/schema/shared.ts`, `lib/temporal-queries.ts`, `tests/convex.test.ts`, `tests/convex-domain.test.ts`, and this report. The ignored generated `convex/_generated/api.d.ts` was refreshed to expose new modules; deployment codegen remains authoritative. No files were staged or committed by this worker.
