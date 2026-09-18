# Datasets, permanent deletion, and the Morgan family sample

Implemented September 16, 2026. This extends the backbone redesign without adding a forecasting engine or new dashboards.

## Dataset boundary

A dataset is a named, user-owned partition of the existing database instance. Existing records belong to **Live**; the fictional family belongs to **test-data1**. Authentication accounts remain shared, while every business record—including history, postings, links, document locators and migration bookkeeping—carries `dataset_id`. User ownership remains `user_id`; it is not repurposed as a dataset identifier.

All public domain functions use the scoped query/mutation wrappers in `convex/lib/scoped.ts`. They validate dataset ownership, filter reads (including direct ID lookups), inject the selected dataset on inserts, and prohibit moving records between datasets. Existing relationship checks run against this restricted database, preventing cross-dataset references. New domain functions must use these wrappers. Raw functions are restricted to authentication, dataset management, and explicitly internal migration/seeding operations.

UI requests carry an explicit dataset ID. Switching remounts the forms, and the user's selected dataset is remembered in the database. Other tabs follow that preference, but a save already initiated in an old tab still carries its original dataset ID. Calls that omit the dataset argument always address Live, never a mutable selection preference. This also supports older callers safely.

The migration is additive: it preserves record IDs, ownership, values and Git paths, creates a Live dataset for each existing data owner, then assigns previously unscoped records. Legacy ownerless children inherit their parent owner. It aborts atomically if an owner cannot be determined. During the transition, unscoped records are readable only from that owner's Live context; legacy child access also checks the actual parent. Repeating the backfill is idempotent.

Git remains authoritative for Markdown. A shared content repository is safe because document IDs and paths are globally unique, and document routes pass the selected dataset to authenticated locator lookups. Dataset boundaries are application/database access boundaries, not separate Git repositories or separate DB instances.

The UI provides a sidebar switcher and a Datasets page to create additional empty test datasets or prepare/resume the family sample. Cloning, importing between datasets, renaming, and deleting entire datasets are outside this change. The current query wrapper preserves existing indexes and filters rows; very large datasets will eventually benefit from composite dataset indexes and paginated list/reverse-reference queries.

## Trash and permanent deletion

Archiving remains the first step. The new Trash page lists archived roots in the current dataset and offers restoration and a review before permanent deletion. The confirmation requires typing `DELETE`.

Permanent deletion removes an unused root together with its owned history and auxiliary metadata, such as local roles, draft postings, tag/evidence links and document locators. It does **not** recursively erase independent objects that refer to it. A dependency review names those references, including immutable JSON snapshots and pinned document paths. The delete mutation recomputes dependencies transactionally, so a stale review cannot delete a newly referenced record.

Posted journal entries and published plan versions remain protected even when archived. Correct posted accounting with reversal entries. A referenced entity cannot be deleted until its dependent objects are dealt with; archiving a reference does not make it cease to exist. Shared evidence and tags survive deletion of an object they describe.

Historical Git commits remain in the content repository. Deleting a locator removes application access to that document, but is not a secure erasure of Git history or backups. Restoration of a local role appends a role-history revision; other roots clear their archive flag.

## Fictional family and dates

The fixture is deterministic in **USD**, with actual activity through **2026-09-16**. The start dates are chosen relative to that fixed date, not the day the sample is reloaded. Names, addresses, rates and amounts are fictional examples. No current product pricing is asserted.

- Alex and Jamie Morgan, with Emma (12) and Noah (8).
- Alex earns $156,000 gross annually from Northstar Analytics Inc., with two monthly payroll deposits and simplified withholding/benefit totals. He owns Morgan Software LLC, which has no revenue and pays development expenses from its owner-funded checking account.
- Jamie owns Juniper Design LLC. Named client Willow Home Staging LLC pays regularly through Square. Separate sales, clearing, fees and next-day payouts reach the LLC checking account. Owner distributions transfer cash into household checking without being recorded as business revenue again.
- Two household checking accounts, each paying a different credit card, plus one checking account per LLC: **four checking accounts total**. Household, software LLC and design LLC have separate charts of accounts.
- Three cars: a 2018 Honda Civic and 2016 Subaru Outback owned outright, and a 2022 Toyota Highlander with an active loan. All have maintenance activity.

| Asset | Original price | Loan principal | Fixed APR | Origination | Term | Last payment |
| --- | ---: | ---: | ---: | --- | --- | --- |
| 214 Oak Street rental | $300,000 | $240,000 | 3.25% | 2021-09-01 | 30 years | 2051-09-01 |
| 88 Maple Avenue rental | $360,000 | $288,000 | 3.50% | 2021-09-01 | 30 years | 2051-09-01 |
| 17 Cedar Lane primary home | $600,000 | $480,000 | 6.25% | 2025-09-01 | 30 years | 2055-09-01 |
| Toyota Highlander | $42,000 | $36,000 | 5.50% | 2022-09-01 | 5 years | 2027-09-01 |

Opening balances at December 31, 2025 contain the amortized outstanding principal: 51 prior payments on each rental mortgage, three on the home mortgage and 39 on the car loan. Nine additional actual payments cover January–September 2026, leaving 12 car payments. Historical payments before 2026 are summarized in the opening balance instead of duplicated.

Monthly interest is rounded to integer cents; the last scheduled payment clears the remaining principal. Principal, interest, escrow contributions and escrow tax/insurance disbursements are separate ledger movements. Contract schedules use an exclusive end date one month after the last payment. Property and vehicle carrying values use acquisition/opening values; the sample does not pretend these are current appraisals or implement depreciation/tax accounting.

Both rentals have named tenants, rent schedules, ownership and maintenance relationships. Monthly rent is $2,250 and $2,700. September Maple rent is partly paid, leaving a **$700 receivable** and an expected collection. Ordinary groceries, utilities, insurance, fuel, dining, subscriptions, medical costs and children's activities are included. School expenses allocate beneficiaries to the children; selected expenses carry asset/arrangement/counterparty attribution.

The Cedar Lane kitchen/bathroom remodel is a **tag**, with a separate construction-contract arrangement. The $85,000 contract has $25,000 of completed demolition/materials paid in June, a $30,000 September progress invoice with a $15,000 partial payment, and a final $30,000 future milestone. Thus $55,000 has been capitalized, **$15,000 remains payable September 30**, and $30,000 remains an assumption about future work, not an incurred payable. The last milestone is expected November 15. Improvement postings are tagged to the remodel.

The Square example uses an illustrative 2.9% + $0.30 per recorded receipt, explicitly not a statement of real pricing. End-of-sample account observations/reconciliations are synthetic and agree with the ledger; their evidence references say `fictional:` and do not claim imported bank documents.

## Seeding and recovery

Structure/opening balances and each of nine monthly batches commit atomically. Progress is stored on the dataset, so retrying continues the existing sample without duplicate transactions. A building dataset cannot be selected. Git notes are written afterward; failures can be retried without overwriting edited notes. The sample's ID registry supports resumability and belongs to its dataset. Retrying after editing or deleting records is not a reset or a repair operation; existing edits remain authoritative.

For normal use: **Datasets → Prepare / resume family sample**, then choose it in the switcher. Each signed-in user can create their own sample. The loader does not switch away from Live automatically.

For a local operator, with the backend running and a backed-up database:

```bash
bunx convex run datasets:migrateExisting '{}'
bun run seed:family -- <Better-Auth-user-ID>
```

The seed command uses the existing private local Convex configuration and Git content repository. It does not embed credentials in source files. Back up `.convex/standalone/`, the content repository and `.env.local` together before migrations. A private pre-change backup was taken before the Live backfill.

## Validation

Automated coverage checks dataset ownership and isolation of lists, direct IDs, links, timelines and Git locators; old-tab saves; legacy migration and repeatability; archive/restore/delete with dependency checks; posted journal and published snapshot protection; resumable seeding; balanced journals; loan amortization; separate card funding accounts; no software-LLC revenue; Square clearing; and the unpaid rent/remodel balances.

Local verification: 88 Vitest tests and 14 process-lifecycle tests pass, TypeScript passes, and the production build succeeds. The existing Next.js workspace-root and stale Browserslist notices remain non-failing build warnings.

The local backfill assigned the original records to their existing owners' Live datasets. A read-only comparison against the pre-change SQLite snapshot confirmed their values and IDs were unchanged apart from `dataset_id`. Each account can use the Datasets page to prepare its own fictional sample. The ready sample contains 31 entities, 27 arrangements, three charts, 51 ledger accounts, 308 posted journals, 738 postings, 19 obligations, and 18 Git documents. Browser verification covered loader retries, both switch directions, Git notes, the household trial balance, and archive → restore → archive → permanent deletion of a temporary entity. That entity was removed; selection was restored to Live.
