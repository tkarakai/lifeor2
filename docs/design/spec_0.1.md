# Arrangements Model — Comprehensive System Specification
*A unified life + finance data model with strict accounting extensions*

> Historical specification. The [2026-09-15 data model redesign](redesign-spec.md) supersedes conflicting guidance here, including projects, properties, arrangement types/roles, charts of accounts, and document ownership. Use the redesign for new implementation work; this document is retained for provenance.

> Status: **Specification v1 (as of 2026-01-20)**  
> Audience: **Users and developers** (onboarding + implementation)  
> Goal: Provide a **single mental model** for “life data” plus **rigorous financial hygiene** (double-entry, reconciliation, forecasting).

---

## Table of contents
1. [Purpose](#purpose)  
2. [Philosophy](#philosophy)  
3. [Core ontology](#core-ontology)  
4. [Time, provenance, and lineage](#time-provenance-and-lineage)  
5. [Modeling criteria and guides](#modeling-criteria-and-guides)  
6. [Capabilities](#capabilities)  
7. [Core relational schema (6 primitives)](#core-relational-schema-6-primitives)  
8. [Finance extension](#finance-extension)  
9. [Strict accounting schema](#strict-accounting-schema)  
10. [Reconciliation specification](#reconciliation-specification)  
11. [Forecasting specification](#forecasting-specification)  
12. [Worked examples (full rows)](#worked-examples-full-rows)  
13. [Invariants and validations](#invariants-and-validations)  
14. [Anti-patterns](#anti-patterns)  
15. [Glossary](#glossary)  

---

## Purpose
This system models an individual/family’s world—assets, relationships, obligations, work, projects, preferences, events, and money—so you can:

- **Capture history** (accurately, immutably, auditable)
- Answer **as-of** questions (“what was true on date X?”)
- Manage **expectations** (“what should happen?”)
- Track **actuals vs plans**
- Maintain **financial hygiene** (double-entry bookkeeping, reconciliation)
- **Forecast** future cashflows and financial statements from known schedules and commitments

---

## Philosophy
### Minimal and uniform
We use a small set of concepts consistently across domains (housing, pets, jobs, school, business, finance).

### Time-first
We distinguish:
- **Valid time**: when something is true in the world
- **Transaction time**: when our system recorded/learned it

### Arrangements drive meaning
All meaningful directed relationships between real things can be modeled as **Arrangements** (even informal and subjective ones), because they encode expectations, stance, or informational context.

### Events capture change; avoid overwrites
Do not overwrite history to represent change. Record events and new versions (or supersessions). Derive “current” state by time filtering.

### Finance is an extension with stronger invariants
Finance uses the same ontology, but introduces domain-specific tables and constraints to ensure correctness and usability (postings, statements, reconciliation, forecast runs).

---

## Core ontology
The system is based on **six primitives**:

1) **Entity**  
2) **Arrangement**  
3) **Role** (scoped to an Arrangement)  
4) **Event**  
5) **Property**  
6) **Measurement**

### 1) Entity
**Definition:** A thing that exists as a stable identity over time.  
**Examples:** Person, specific LLC, house, car (VIN), dog, school, bank, DMV, streaming service, employer.

**Rules:**
- Entities have **persistent identity**.
- Do **not** create Entities for purely abstract labels (e.g., “USD”, “JobTitle”).

### 2) Arrangement
**Definition:** A relationship of **expectations** between Entities (normative, behavioral, or informational).

**Key features:**
- Assigns **Roles** to participants.
- Has **valid time** (`valid_from`, `valid_to`).
- Can **nest** (sub-arrangements) and **supersede** earlier arrangements.

**Examples (non-exhaustive):**
- Employment, Tenancy, Ownership, LoanNote, MortgageLien, InsurancePolicy
- MaintenanceContract, CareAgreement (vet), CarRegistration (DMV)
- Project, PipelineOpportunity, Budget, Scenario/Plan (self-arrangement)
- Friendship, Love/Spouse, “Likes Netflix”, “Prefers Netflix over Hulu”
- InformationArrangement: valuation estimates, FX-rate provider feeds, market price feeds

### 3) Role (inside Arrangement)
**Definition:** How an Entity participates in an Arrangement (scoped).  
**Examples:** Employer, Employee, Landlord, Tenant, Borrower, Lender, Insurer, Insured, LossPayee, Provider, Client, Planner, InformationProvider, InformationConsumer.

**Rule:** Roles are not global; they exist only as participation records within an Arrangement.

### 4) Event
**Definition:** Something that happens at a point or interval. It may affect entities/arrangements or be standalone.

**Examples:** Deposit, InvoiceIssued, PaymentReceived, RentBilled, MortgagePayment, Refinance, OilChange, VaccinationGiven, BBQParty.

### 5) Property
**Definition:** A descriptive fact about an Entity or Arrangement (objective or subjective).

**Important decision:** Home value is often best modeled as a **Property of an InformationArrangement** (provider/consumer context + provenance + confidence), not a single “true” property of the house.

### 6) Measurement
**Definition:** A quantified or scaled value—observed, expected, or derived.
- Scalar: amount/unit/currency
- Rate: % per year, etc.
- Schedule/Rule: recurring payment schedules
- Derived: computed aggregates (net worth, burn, DSCR, reputation score)

**Finance stance:** Measurements alone can represent money, but for bookkeeping ergonomics we store postings in dedicated tables (see Finance).

---

## Time, provenance, and lineage
### Valid time vs transaction time
- `valid_from`, `valid_to`: when something is true in the real world
- `recorded_at`: when the system recorded it

### Supersession
Arrangements that replace earlier arrangements link via `supersedes_arrangement_id`.
- Refinancing: new LoanNote/MortgageLien supersedes old
- Employment terms updated: new SalaryTerms supersedes prior SalaryTerms

### Provenance and confidence
Any record may include:
- `source`: where the data came from (document, statement, API, user input)
- `confidence`: a 0–1 estimate (especially for inferred/subjective info)

---

## Modeling criteria and guides
### Decision tests
1. **Existence test:** does it exist as a stable unit? → Entity  
2. **Expectation/stance test:** does it encode expectations/rights/duties/relationship/attitude between Entities? → Arrangement (+ Roles)  
3. **Descriptive test:** is it a descriptive attribute of an Entity/Arrangement? → Property  
4. **Happening test:** did it occur in time? → Event  
5. **Quantification test:** is it a number/rate/schedule or computed figure? → Measurement  

### Relationships as Arrangements
We intentionally model many “relationships” as Arrangements, including:
- Family/spouse/friendship
- Likes/preferences directed at another entity (“likes Netflix”)
- Projects and plans (self-arrangements that can expand to multi-party)

**Counterexamples (prefer Property):**
- Purely spatial/descriptive relations: “car is in garage”
- Raw causal relations (belongs in a reasoning/knowledge layer, not the life ledger)
- Non-directed preferences: “prefers red cars” (Property), unless you represent “red cars” as an entity category

### Nesting guidance
Prefer sub-arrangements for term bundles:
- Employment → SalaryTerms, TitleTerms, LeavePolicyTerms, ReportingLine
- Tenancy → RentTerms, DepositTerms, PetTerms
- LoanNote → PaymentScheduleTerms, EscrowTerms
- Project → Scope, Milestones, PaymentTerms

---

## Capabilities
### Life data
- Track assets (houses, cars), their ownership, insurance, maintenance
- Track people, pets, family relationships, school enrollment
- Track work and business arrangements (employment, LLC, clients, projects)
- Track preferences and social ties with valid-time history
- Track informational relationships (valuations, price feeds, FX feeds)

### Finance data
- Record full double-entry accounting history
- Reconcile bank statements to journal entries
- Maintain accounts receivable/payable patterns (rent, invoices)
- Forecast cashflows and projected financial statements
- Track actual vs forecast variance

---

## Core relational schema (6 primitives)
This is the universal layer; finance adds specialized tables.

### `entity`
- `entity_id` (PK)
- `kind`
- `display_name`

### `arrangement`
- `arrangement_id` (PK)
- `kind`
- `valid_from`
- `valid_to` (nullable)
- `parent_arrangement_id` (nullable)
- `supersedes_arrangement_id` (nullable)

### `arrangement_role`
- `arrangement_id` (FK)
- `role_name`
- `entity_id` (FK)
- (optional) `share_json`, `constraints_json`

### `event`
- `event_id` (PK)
- `kind`
- `occurred_at` (or `start_at`, `end_at`)
- `payload_json`
- `recorded_at`

### `event_affects`
- `event_id` (FK)
- `target_type` ('entity'|'arrangement')
- `target_id`

### `property`
- `property_id` (PK)
- `owner_type` ('entity'|'arrangement'|'event')
- `owner_id`
- `name`
- `value_json`
- `valid_from`
- `valid_to` (nullable)
- `source`
- `recorded_at`
- `confidence` (nullable)

### `measurement`
- `measurement_id` (PK)
- `owner_type` ('entity'|'arrangement'|'event')
- `owner_id`
- `name`
- `m_type` ('observed'|'expected'|'derived')
- `value_json`
- `as_of`
- `source`
- `recorded_at`
- `confidence` (nullable)

---

## Finance extension
### Rationale
Finance benefits from stricter structure than “Measurements everywhere”:
- Double-entry constraints must be enforceable
- Posting lines are high-volume and require indexing and reporting
- Reconciliation must track external lines and match decisions
- Forecasting needs run snapshots and variance workflows

**Design decision:** keep the Arrangements mental model, but store accounting mechanics in dedicated tables. These are *extensions*, not replacements.

---

## Strict accounting schema
### `ledger_account`
Ledger accounts belong to a ChartOfAccounts arrangement.

- `account_id` (PK)
- `coa_arrangement_id` (FK → arrangement)
- `name`
- `type` ('Asset'|'Liability'|'Equity'|'Income'|'Expense')
- `normal_balance` ('Debit'|'Credit')
- `currency` (e.g., 'USD')

### `journal_entry`
A journal entry wraps an Event.

- `je_id` (PK)
- `event_id` (FK → event)
- `coa_arrangement_id` (FK → arrangement)
- `memo`
- `status` ('draft'|'posted')
- `source_ref` (nullable)

### `posting`
Line items with amounts (recommended: signed amounts where debits are positive and credits are negative).

- `posting_id` (PK)
- `je_id` (FK → journal_entry)
- `account_id` (FK → ledger_account)
- `amount` (decimal, signed)
- `currency`
- `description`

**Core invariant:** For each `je_id` and `currency`, `SUM(amount) = 0`.

---

## Reconciliation specification
### Purpose
Ensure every external statement line is either:
- matched to one or more journal entries, or
- flagged as an exception (missing, ambiguous, needs split, etc.)

### Tables
#### `statement`
- `statement_id` (PK)
- `arrangement_id` (FK → arrangement; e.g., checking account)
- `provider_entity_id` (FK → entity; e.g., bank)
- `period_start`, `period_end`
- `imported_at`

#### `statement_line`
- `line_id` (PK)
- `statement_id` (FK)
- `posted_at`
- `description`
- `amount` (signed)
- `currency`
- `external_id`
- `raw_json`
- `fingerprint` (de-dupe)

#### `reconciliation_run`
- `recon_id` (PK)
- `statement_id` (FK)
- `status` ('open'|'closed')
- `opened_at`, `closed_at`
- `opened_by_entity_id`

#### `match`
- `match_id` (PK)
- `recon_id` (FK)
- `line_id` (FK)
- `je_id` (FK)
- `match_type` ('exact'|'partial'|'many_to_one'|'one_to_many')
- `matched_amount`
- `confidence`
- `matched_at`
- `matched_by` ('system'|'manual')

#### `recon_exception`
- `exception_id` (PK)
- `recon_id` (FK)
- `line_id` (FK)
- `reason_code` ('missing_je'|'amount_mismatch'|'duplicate'|'ambiguous'|'split_needed')
- `notes`
- `status` ('open'|'resolved')
- `created_at`, `resolved_at`

### Reconciliation invariants
- Every `statement_line` must be matched or have an open exception.
- If line is split: sum of `matched_amount` rows for that line must equal line amount.
- Optional: statement balance checks (start + sum(lines) == end).

---

## Forecasting specification
### Purpose
Project future cashflows and optionally projected financial statements using:
- expected schedules on arrangements (rent, payroll, mortgage)
- known invoices/opportunities and assumptions (payment delays, vacancy, inflation)
- scenario assumptions, reproducible runs, and variance tracking

### Tables
#### `forecast_scenario`
- `scenario_id` (PK)
- `name`
- `owner_entity_id`
- `created_at`
- `assumptions_json`
- `scope_json`

#### `forecast_run`
- `run_id` (PK)
- `scenario_id` (FK)
- `run_at`
- `horizon_start`, `horizon_end`
- `status`
- `notes`

#### `cashflow_projection`
- `proj_id` (PK)
- `run_id` (FK)
- `projected_date`
- `amount` (signed)
- `currency`
- `counterparty_entity_id` (nullable)
- `source_kind` ('schedule'|'invoice_pipeline'|'manual')
- `source_ref_type` ('arrangement'|'event'|'entity')
- `source_ref_id`
- `confidence`
- `tags_json`

#### `projected_journal_entry` (optional)
- `pje_id` (PK)
- `run_id` (FK)
- `projected_at`
- `coa_arrangement_id`
- `memo`
- `source_ref_type`, `source_ref_id`
- `confidence`

#### `projected_posting` (optional)
- `pp_id` (PK)
- `pje_id` (FK)
- `account_id` (FK)
- `amount`
- `currency`

#### `variance`
- `variance_id` (PK)
- `scenario_id`
- `actual_je_id` (nullable)
- `pje_id` (nullable)
- `actual_event_id` (nullable)
- `proj_id` (nullable)
- `variance_amount`
- `computed_at`
- `reason_code` ('timing'|'amount'|'missing'|'extra'|'timing_ok')

---

## Worked examples (full rows)
The following sections provide **exact instance rows** for the four finance scenarios, including reconciliation and forecast examples.

### Shared baseline (Entities + Arrangements + Accounts)
#### `entity`
| entity_id | kind | name |
|---|---|---|
| E:YOU | Person | You |
| E:SPOUSE | Person | Spouse |
| E:EMPLOYER | LegalEntity | EmployerCo |
| E:BANK | Institution | BigBank |
| E:TENANT | Person | Tenant A |
| E:LLC | LegalEntity | SpouseLLC |
| E:CLIENTA | LegalEntity | Client A |

#### `arrangement`
| arrangement_id | kind | valid_from | valid_to | parent_arrangement_id | supersedes |
|---|---|---:|---:|---|---|
| A:COA:MAIN | ChartOfAccounts | 2025-01-01 | null | null | null |
| A:CHECKING | DepositoryAccount | 2025-01-01 | null | null | null |
| A:TENANCY:1 | Tenancy | 2025-01-01 | null | null | null |
| A:LOAN:1 | LoanNote | 2024-06-01 | null | null | null |
| A:PROJECT:CLIENTA:1 | Project | 2025-01-10 | null | null | null |

#### `arrangement_role`
| arrangement_id | role_name | entity_id |
|---|---|---|
| A:CHECKING | Owner | E:YOU |
| A:CHECKING | Bank | E:BANK |
| A:TENANCY:1 | Landlord | E:YOU |
| A:TENANCY:1 | Tenant | E:TENANT |
| A:LOAN:1 | Borrower | E:YOU |
| A:LOAN:1 | Lender | E:BANK |
| A:PROJECT:CLIENTA:1 | Provider | E:LLC |
| A:PROJECT:CLIENTA:1 | Client | E:CLIENTA |

#### `ledger_account`
| account_id | coa_arrangement_id | name | type | normal_balance | currency |
|---|---|---|---|---|---|
| AC:CASH:CHECKING | A:COA:MAIN | Cash:Checking | Asset | Debit | USD |
| AC:INC:SALARY | A:COA:MAIN | Income:Salary | Income | Credit | USD |
| AC:AR:RENT | A:COA:MAIN | Asset:AR:Rent | Asset | Debit | USD |
| AC:INC:RENT | A:COA:MAIN | Income:Rent | Income | Credit | USD |
| AC:LIAB:MORTGAGE | A:COA:MAIN | Liability:Mortgage | Liability | Credit | USD |
| AC:EXP:INTEREST | A:COA:MAIN | Expense:MortgageInterest | Expense | Debit | USD |
| AC:ASSET:ESCROW | A:COA:MAIN | Asset:Escrow | Asset | Debit | USD |
| AC:AR:LLC | A:COA:MAIN | Asset:AR:LLC | Asset | Debit | USD |
| AC:INC:LLC | A:COA:MAIN | Income:LLCRevenue | Income | Credit | USD |

---

### Example 1) Payroll hits checking (you)
#### `event`
| event_id | kind | occurred_at | payload_json | recorded_at |
|---|---|---:|---|---:|
| EV:PAYROLL:2025-01-15 | Deposit | 2025-01-15T09:03:00-07:00 | {"source":"bank_feed","external_id":"BBK-88321"} | 2025-01-15T09:03:10-07:00 |

#### `event_affects`
| event_id | target_type | target_id |
|---|---|---|
| EV:PAYROLL:2025-01-15 | arrangement | A:CHECKING |

#### `journal_entry`
| je_id | event_id | coa_arrangement_id | memo | status | source_ref |
|---|---|---|---|---|---|
| JE:PAYROLL:2025-01-15 | EV:PAYROLL:2025-01-15 | A:COA:MAIN | Payroll deposit | posted | BBK-88321 |

#### `posting`
| posting_id | je_id | account_id | amount | currency | description |
|---|---|---|---:|---|---|
| P:JE:PAYROLL:1 | JE:PAYROLL:2025-01-15 | AC:CASH:CHECKING | +5000.00 | USD | Increase cash |
| P:JE:PAYROLL:2 | JE:PAYROLL:2025-01-15 | AC:INC:SALARY | -5000.00 | USD | Salary income |

---

### Example 2) Rent from Tenant (billing + receipt)
#### `measurement` (rent schedule)
| measurement_id | owner_type | owner_id | name | m_type | value_json | as_of | source | recorded_at |
|---|---|---|---|---|---|---:|---|---:|
| M:RENTSCHED:1 | arrangement | A:TENANCY:1 | RentSchedule | expected | {"rule_spec":"monthly on day 1","amount":2150.00,"currency":"USD"} | 2025-01-01 | user | 2025-01-01T00:00:00-07:00 |

#### Rent billed
`event`
| event_id | kind | occurred_at | payload_json | recorded_at |
|---|---|---:|---|---:|
| EV:RENTBILL:2025-02-01 | RentBilled | 2025-02-01T08:00:00-07:00 | {"tenancy":"A:TENANCY:1","period":"2025-02"} | 2025-02-01T08:00:02-07:00 |

`journal_entry`
| je_id | event_id | coa_arrangement_id | memo | status |
|---|---|---|---|---|
| JE:RENTBILL:2025-02 | EV:RENTBILL:2025-02-01 | A:COA:MAIN | Rent billed Feb 2025 | posted |

`posting`
| posting_id | je_id | account_id | amount | currency | description |
|---|---|---|---:|---|---|
| P:JE:RENTBILL:1 | JE:RENTBILL:2025-02 | AC:AR:RENT | +2150.00 | USD | Rent receivable |
| P:JE:RENTBILL:2 | JE:RENTBILL:2025-02 | AC:INC:RENT | -2150.00 | USD | Rent income |

#### Rent received
`event`
| event_id | kind | occurred_at | payload_json | recorded_at |
|---|---|---:|---|---:|
| EV:RENTRECV:2025-02-03 | PaymentReceived | 2025-02-03T10:15:00-07:00 | {"source":"bank_feed","external_id":"BBK-99102"} | 2025-02-03T10:15:05-07:00 |

`journal_entry`
| je_id | event_id | coa_arrangement_id | memo | status | source_ref |
|---|---|---|---|---|---|
| JE:RENTRECV:2025-02 | EV:RENTRECV:2025-02-03 | A:COA:MAIN | Rent received Feb 2025 | posted | BBK-99102 |

`posting`
| posting_id | je_id | account_id | amount | currency | description |
|---|---|---|---:|---|---|
| P:JE:RENTRECV:1 | JE:RENTRECV:2025-02 | AC:CASH:CHECKING | +2150.00 | USD | Cash received |
| P:JE:RENTRECV:2 | JE:RENTRECV:2025-02 | AC:AR:RENT | -2150.00 | USD | Reduce receivable |

---

### Example 3) Mortgage payment with escrow
`event`
| event_id | kind | occurred_at | payload_json | recorded_at |
|---|---|---:|---|---:|
| EV:MORTPAY:2025-02-01 | MortgagePayment | 2025-02-01T07:30:00-07:00 | {"loan":"A:LOAN:1","source":"bank_feed","external_id":"BBK-77111","split":{"interest":1000,"escrow":300,"principal":1900}} | 2025-02-01T07:30:06-07:00 |

`journal_entry`
| je_id | event_id | coa_arrangement_id | memo | status | source_ref |
|---|---|---|---|---|---|
| JE:MORTPAY:2025-02 | EV:MORTPAY:2025-02-01 | A:COA:MAIN | Mortgage payment Feb 2025 | posted | BBK-77111 |

`posting`
| posting_id | je_id | account_id | amount | currency | description |
|---|---|---|---:|---|---|
| P:JE:MORT:1 | JE:MORTPAY:2025-02 | AC:CASH:CHECKING | -3200.00 | USD | Payment out |
| P:JE:MORT:2 | JE:MORTPAY:2025-02 | AC:EXP:INTEREST | +1000.00 | USD | Interest expense |
| P:JE:MORT:3 | JE:MORTPAY:2025-02 | AC:ASSET:ESCROW | +300.00 | USD | Escrow deposit |
| P:JE:MORT:4 | JE:MORTPAY:2025-02 | AC:LIAB:MORTGAGE | +1900.00 | USD | Reduce principal |

---

### Example 4) Spouse LLC: project + invoice + payment
Invoice issued:
- JE: debit AR, credit revenue

Payment received:
- JE: debit cash, credit AR

(See rows above in the earlier examples section.)

---

## Invariants and validations
- Double-entry per JE/currency
- Statement-line coverage by match or exception
- Forecast runs are immutable snapshots; variance tracked as derived results

---

## Appendix: Assumptions and rationale (summary)
- Keep **universal primitives** for meaning and extensibility.
- Use **domain tables** where constraints and ergonomics matter (accounting).
- Maintain both **valid time** and **recorded time** for trustable “as-of” queries.
- Keep valuation and other subjective facts contextual via InformationArrangements.
