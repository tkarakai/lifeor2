# Family Observatory

The Observatory at `/dashboard/insights` offers 27 interactive views across Overview, Money, Family & assets, Life timeline, and Planning. It reads the active dataset. Bank routing is an explicit, saved planning instruction; chart exploration does not change journals, settlements, or contractual amounts. It is linked from the sidebar and Records home.

## Views and variations

| Lens            | Views                                                                                                                                                                                           | Useful for                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Money           | Historical/projected bank balances; income/expense/surplus trends; spending composition; book net assets; surplus waterfall; income composition; monthly category matrix; cash account movement | Reviewing results, spotting seasonal changes, understanding spending and cash changes    |
| Family & assets | Income/spending by earner or cost subject; beneficiary spending; asset composition; liabilities; relationship map; ownership shares; entity inventory                                           | Seeing who benefits, what the family owns or owes, and how people and agreements connect |
| Life timeline   | Activity calendar; searchable chronological events; event-kind ranking; arrangement timeline; typed measurement comparisons                                                                     | Exploring history, milestones, relationship intervals, and observations                  |
| Planning        | Obligation aging; upcoming expected movements; budget versus actual; recurring commitments; cash what-if; debt payoff comparison; savings goal                                                  | Reviewing payment pressure, tracking a plan, and exploring choices                       |

Trend charts can use bars, lines, or areas. Composition charts can use rings, proportional strip treemaps, or ranked bars. Rankings sort by size or name. The relationship map can be searched and traversed by selecting a relationship and one of its participants. The calendar and financial charts open source-record tables. Table disclosure, keyboard focus, native dialog focus handling, reduced-motion support, and responsive layouts provide alternatives to pointer-only exploration.

## Filters and customization

Shared controls include date range, cutoff, currency, monthly/quarterly/yearly grouping, financial chart, person/entity, and project/tag. Their scope is explained in the filter disclosure and on cards:

- Period income/expenses use accounting dates, falling back to the source event date for legacy journals.
- Balances include all posted history through cutoff, including opening balances before the start date.
- A person scope matches explicit subjects, counterparties, or beneficiary allocations. It does not infer ownership of every connected record. Project filtering follows explicit activity/attribution tags and tagged agreements. Tagging an asset as a project participant does not classify every utility bill for that asset as project spending.
- Family maps and ownership use active recorded intervals at cutoff and current facts. Measurement and relationship views use relevant subjects and dates. These views do not apply the financial-chart or project filter.
- Events use dates, person and project; financial-chart and currency selection do not change event counts.
- Obligation and schedule cards use currency and their own creditor/debtor perspective. They intentionally do not inherit a financial-chart or project filter.
- Budget comparisons use the selected saved version, each target’s original period and scope, and the global cutoff. Tag scopes use frozen `resolved_targets`, never current tag membership. Independent, potentially overlapping budgets are not summed together.

“Make it yours” controls visible cards, ordering, favorites, density, atmosphere and amount formatting. Card controls change chart style or width. Favorites appear in My collection. Preferences and filters are saved in local storage per dataset; no financial source rows are stored there. New cards are merged into older saved layouts. Browser storage failure does not block exploration.

Exports contain the selected summary, filters, currency and integer minor-unit amounts. Source-record exports use exact formatted amounts even when charts use compact notation. CSV cells protect against spreadsheet formula injection.

## Source integrity

`convex/insights.ts` reads through the existing authenticated, dataset-scoped database wrapper. The snapshot normalizes records for the client, retains signed minor-unit money, includes only posted journal activity, selects latest attribution revisions, and removes superseded event/measurement corrections. Original financial postings and their reversals are both retained so they net correctly. Current outstanding obligations include adjustments and settlement reversals; expected remainders reuse the existing planning-domain calculation.

Money is never summed across currencies. Combining charts is a simple sum, not a consolidation with intercompany eliminations. Book asset balances are not market valuations. A filtered balance shows attributed portions, not necessarily a complete balance sheet for that person. Unknown legacy measurements without typed units are counted in coverage notes rather than guessed.

This remains a local prototype. A table with more than 15,000 accessible rows makes the snapshot fail explicitly instead of silently truncating totals. Aggregate server read/response limits may apply sooner in very large datasets; server-side paginated analytics should replace the snapshot before scaling up. Interactive date ranges are capped at 100 years.

## Exploratory calculations

All local calculators are labeled What-if. Inputs reset when a view is unmounted, and do not modify plans, scenarios, forecast runs, loans or journals.

- **Cash:** defaults to the book balance in designated checking/savings/cash/deposit accounts. Monthly inputs average three complete calendar months of net cash movement per journal (including zero-activity months). Intra-scope cash transfers cancel within each journal. Users can replace these inputs, adjust incoming/outgoing amounts and annual expense growth, add a first-month cost, and set a reserve threshold. A stress line subtracts another 10% of baseline monthly inflow. The model does not add explicit expected flows or expand schedules, avoiding double counting with its historical baseline.
- **Debt:** starts from a selected liability’s full book balance. When recognizable contractual principal, rate and term measurements exist, it estimates the initial principal-and-interest payment from those terms. Otherwise it requires rate and payment inputs. It compares fixed-rate monthly amortization with an extra principal contribution, rounds interest to minor units, caps the final payment, detects non-amortizing payments, and stops after 600 months. Fees, escrow and variable rates are excluded.
- **Savings:** uses user-entered current savings, target and monthly contributions, with no assumed investment returns. The completion estimate is unrestricted; the chart displays at most 60 months.

Upcoming-flow bars show only explicitly recorded, unfulfilled expectations. Recurring-commitment bars normalize fixed schedules to approximate monthly equivalents; they are not automatically generated payment dates. Current remaining obligations and expectations are not historical reconstructions, even when aged against a past cutoff.

## Validation

The automated suite covers balance openings and signs, zero-activity periods, refunds, chart/currency/date isolation, partial beneficiary allocations, frozen budget tag scopes, event/flow filtering, formula-safe CSV, forecast arithmetic, and fixed-rate payoff edge cases. Convex integration tests exercise the full fictional family sample, reconcile all account signs to a zero trial balance, verify attribution partitions, test empty/draft/corrected data, and reject cross-user/dataset reads.

An isolated browser fixture generated by those Convex tests exercises rendering and interaction without modifying the live database. Browser checks cover chart variations, source-record dialogs, preferences after reload, favorites, scenario changes, map traversal, record filtering, exports, invalid ranges, visibility/order controls, empty states, and responsive widths. The temporary preview route and fixture are removed after validation.

## Bank history and obligation-based projection

The bank timeline combines selectable designated bank/cash accounts, with individual lines, an aggregate, or both. Solid actuals and dashed projections share a calendar-scaled axis; step paths show payment jumps, and connected lines provide an alternative. Reserve thresholds, the minimum projected balance/date, ending balances, individual account lows, and source movement tables make liquidity gaps inspectable. Account selection is saved per dataset.

History uses full signed posted balances including openings; the global From date controls its visible start. Actuals always end today, independently of the global Through date. Person/project filtering cannot turn partial attributions into apparent bank balances. Currency and financial-chart filters control available accounts. The future horizon is 3, 6, 12, or 24 months, through that final month's end.

Outstanding claims use their unpaid remainder, including adjustments and settlement reversals. Known schedule revision segments expand into future civil payment dates, honoring recurrence intervals and exclusive end dates; month-end dates clamp. Canonical occurrences prevent counting the same obligation, expectation, and schedule twice. Settled or voided obligations suppress re-expansion. Fully fulfilled explicit expectations also suppress their occurrence. Assumptions are opt-in. Overdue claims can be moved to tomorrow as a visible catch-up assumption.

Saved, revisioned `cash_flow_route` records assign the outgoing and/or incoming bank for a claim or schedule. A schedule route is inherited by its claims unless explicitly overridden. Routing does not post a journal or settle a claim. Both sides of an internal transfer cancel when both accounts are selected. Explicit expectations use their own bank. Missing routing or variable contractual amounts without an explicit cash estimate are listed as incomplete coverage.

Schedules can specify a cash amount distinct from the contractual amount, such as net payroll, and monthly payment days that split that period amount exactly in minor units. Claim amounts/due dates cannot be overridden by routing. Authentication, dataset ownership, bank designation, currency, date ranges, and optimistic revisions are validated on save. Future unrecorded purchases, fees, and interest are excluded; this is a commitment projection, not a complete household spending forecast.

## Earners and cost subjects

The existing posting-attribution model already supports multiple portions, each with one subject and a partition of beneficiaries. The UI now calls the subject **Earner / cost subject (person, asset or family)**. Assign or split it in Journal entries. The graph groups the exact subject portions, never inferring the earner from the beneficiary or counterparty. Unclassified activity remains visible. Controls include entity type, search, sorting, paired bars or diverging net bars, period, chart, currency and project filters. Its person filter selects the exact subject.

Income/expense mode uses accrual ledger accounts: mortgage interest is an expense, principal repayment is not. Bank cash mode includes full loan payments, capital purchases and transfers, excludes opening entries, and is explicitly labeled received/paid rather than earned/spent. Classify both relevant accrual and bank postings to use both modes. Refunds/reversals preserve their signed effect in accrual mode.

The idempotent `sampleData:enhanceForOwner` migration accepts only the ready fictional family test dataset. It extends sample classifications to previously unclassified ledger legs, preserves later custom revisions, and adds payment routes. Fictional allocations are fuel 40/30/30 across the three cars, combined insurance 25% per car plus 25% family life cover, and school costs 50/50 between children. Payroll cash is $9,100/month split between the 15th and 28th; gross contractual pay remains $13,000. New sample seeds receive the same enrichment automatically.

On 2026-09-16, the existing local `test-data1` was enriched: 429 posting attribution revisions and 8 routes. Before/after snapshot comparison verified all monetary values, claims, settlements, observations and reconciliations unchanged, and every record outside this test dataset unchanged. Re-running returned zero changes. Local backup: `/tmp/lifeor-before-cash-subjects.zip`.
