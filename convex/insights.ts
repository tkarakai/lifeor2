import { query } from "./lib/scoped";
import { requireUser } from "./lib/access";
import { postingAmount } from "./lib/ledger";
import { remaining, canonicalOccurrence, incurredObligation } from "./planning";
import { selectRevision, add } from "./lib/domain";
import type { TableNames, Doc } from "./_generated/dataModel";
import type { InsightData } from "../lib/insights/types";

const day = (instant: number) => new Date(instant).toISOString().slice(0, 10);
/** One secured snapshot avoids inconsistent totals between independently loading cards.
 * Deliberately fails at the workspace limit rather than presenting truncated totals.
 */
export const snapshot = query({
  args: {},
  handler: async (ctx): Promise<InsightData> => {
    const user = await requireUser(ctx);
    async function rows<T extends TableNames>(table: T): Promise<Doc<T>[]> {
      const result = await ctx.db.query(table).take(15001);
      if (result.length > 15000)
        throw new Error(
          "This dataset exceeds the visual explorer's 15,000-row per-table limit. Use the ledger reports for this dataset.",
        );
      return result;
    }
    const [
      entities,
      arrangements,
      assignments,
      roles,
      ownership,
      charts,
      accounts,
      financial,
      journals,
      postings,
      sets,
      portions,
      beneficiaries,
      tags,
      tagLinks,
      events,
      affects,
      measurements,
      obligations,
      adjustments,
      settlements,
      flows,
      assumptions,
      budgets,
      versions,
      plans,
      schedules,
      scheduleVersions,
      scheduleRevisions,
      entityRevisions,
      arrangementRevisions,
      assignmentRevisions,
      roleRevisions,
      cashRoutes,
    ] = await Promise.all([
      rows("entity"),
      rows("arrangement"),
      rows("arrangement_role_assignment"),
      rows("arrangement_role_definition"),
      rows("ownership_interest"),
      rows("chart_of_accounts"),
      rows("ledger_account"),
      rows("financial_account"),
      rows("journal_entry"),
      rows("posting"),
      rows("posting_attribution_set"),
      rows("posting_attribution"),
      rows("attribution_beneficiary"),
      rows("tag"),
      rows("tag_assignment"),
      rows("event"),
      rows("event_affects"),
      rows("measurement"),
      rows("monetary_obligation"),
      rows("obligation_adjustment"),
      rows("obligation_settlement"),
      rows("expected_flow"),
      rows("forecast_assumption"),
      rows("budget_target"),
      rows("plan_version"),
      rows("plan"),
      rows("commitment_schedule"),
      rows("commitment_schedule_version"),
      rows("commitment_schedule_revision"),
      rows("entity_revision"),
      rows("arrangement_revision"),
      rows("role_assignment_revision"),
      rows("role_definition_revision"),
      rows("cash_flow_route"),
    ]);
    const now = Date.now();
    const liveTags = new Set(
      tags.filter((x) => !x.archived).map((x) => String(x._id)),
    );
    const tagsByTarget = new Map<string, string[]>();
    for (const link of tagLinks)
      if (link.removed_at === undefined && liveTags.has(link.tag_id))
        tagsByTarget.set(link.target.id, [
          ...(tagsByTarget.get(link.target.id) ?? []),
          link.tag_id,
        ]);
    const tagIds = (...ids: (string | undefined)[]) => [
      ...new Set(ids.flatMap((id) => (id ? (tagsByTarget.get(id) ?? []) : []))),
    ];
    const journalMap = new Map(
      journals.filter((x) => x.status === "posted").map((x) => [x._id, x]),
    );
    const eventMap = new Map(events.map((x) => [x._id, x]));
    const latestSets = new Map<string, (typeof sets)[number]>();
    for (const set of sets)
      if ((latestSets.get(set.posting_id)?.revision ?? -1) < set.revision)
        latestSets.set(set.posting_id, set);
    const partsBySet = new Map<string, typeof portions>();
    for (const part of portions)
      partsBySet.set(part.set_id, [
        ...(partsBySet.get(part.set_id) ?? []),
        part,
      ]);
    const beneficiariesByPart = new Map<string, typeof beneficiaries>();
    for (const b of beneficiaries)
      beneficiariesByPart.set(b.attribution_id, [
        ...(beneficiariesByPart.get(b.attribution_id) ?? []),
        b,
      ]);
    const mappedPostings = postings
      .filter((p) => journalMap.has(p.je_id))
      .map((p) => {
        const je = journalMap.get(p.je_id)!;
        const event = eventMap.get(je.event_id);
        const set = latestSets.get(p._id);
        return {
          id: p._id,
          journal: p.je_id,
          date:
            je.accounting_date ??
            day(event?.occurred_at ?? je.created_at ?? je._creationTime),
          account: p.account_id,
          amount: postingAmount(p),
          memo: je.memo,
          event: je.event_id,
          tags: tagIds(p._id, je._id, je.event_id),
          portions: (set ? (partsBySet.get(set._id) ?? []) : []).map(
            (part) => ({
              id: part._id,
              amount: part.minor_units,
              subject: part.subject_entity_id,
              arrangement: part.arrangement_id,
              counterparty: part.counterparty_entity_id,
              // An asset tagged as a project participant does not make all of its
              // utility bills project spending. Use explicit activity/arrangement tags.
              tags: tagIds(part._id, part.arrangement_id),
              beneficiaries: (beneficiariesByPart.get(part._id) ?? []).map(
                (b) => ({ entity: b.entity_id, amount: b.minor_units }),
              ),
            }),
          ),
        };
      });
    const correctedEvents = new Set(
      events.map((x) => x.corrects_id).filter(Boolean),
    );
    const correctedMeasurements = new Set(
      measurements.map((x) => x.corrects_id).filter(Boolean),
    );
    const activeMeasurements = measurements.filter(
      (x) => !x.archived && !correctedMeasurements.has(x._id),
    );
    const obligationData = await Promise.all(
      obligations
        .filter((x) => !x.archived && x.voided_at === undefined)
        .map(async (o) => {
          const approved = add(
            o.original_minor_units,
            ...adjustments
              .filter((a) => a.obligation_id === o._id)
              .map((a) => a.minor_units),
          );
          const settled = add(
            ...settlements
              .filter((s) => s.obligation_id === o._id)
              .map((s) => (s.reverses_id ? -s.minor_units : s.minor_units)),
          );
          return {
            id: o._id,
            name:
              arrangements.find((a) => a._id === o.arrangement_id)?.name ??
              "Monetary obligation",
            date: o.due_date,
            currency: o.currency,
            creditor: o.creditor_id,
            debtor: o.debtor_id,
            arrangement: o.arrangement_id,
            amount: add(approved, -settled),
            original: approved,
            settled,
            schedule: scheduleVersions.find(
              (v) => v._id === o.schedule_version_id,
            )?.schedule_id,
            occurrence: await canonicalOccurrence(
              ctx,
              { obligation_id: o._id, occurrence_key: o.occurrence_key ?? "" },
              user._id,
            ),
          };
        }),
    );
    const versionMap = new Map(
      versions.filter((x) => !x.archived).map((x) => [x._id, x]),
    );
    const planName = (id: string) =>
      plans.find((x) => x._id === id)?.name ?? "Plan";
    const latestRoutes = new Map<string, (typeof cashRoutes)[number]>();
    for (const r of cashRoutes)
      if ((latestRoutes.get(r.source.id)?.revision ?? 0) < r.revision)
        latestRoutes.set(r.source.id, r);
    return {
      blockedCashOccurrences: await Promise.all(
        obligations
          .filter((o) => o.archived || o.voided_at !== undefined)
          .map((o) =>
            canonicalOccurrence(
              ctx,
              { obligation_id: o._id, occurrence_key: o.occurrence_key ?? "" },
              user._id,
            ),
          ),
      ),
      cashRoutes: [...latestRoutes.values()].map((r) => ({
        source: r.source.id,
        kind: r.source.kind,
        from: r.from_account_id,
        to: r.to_account_id,
        amount: r.cash_minor_units,
        days: r.monthly_days,
        revision: r.revision,
        currency: r.currency,
      })),
      cashSchedules: schedules
        .filter((s) => !s.archived)
        .flatMap((s) => {
          const latest = scheduleRevisions
            .filter((r) => r.schedule_id === s._id && r.recorded_at <= now)
            .sort((a, b) => b.revision - a.revision)[0];
          return (latest?.segments ?? []).flatMap((segment) => {
            const v = scheduleVersions.find(
              (v) => v._id === segment.facts.version_id,
            );
            return v
              ? [
                  {
                    id: s._id,
                    name: s.name,
                    version: v._id,
                    currency: v.currency,
                    amount: v.amount?.minor_units,
                    start: v.start_date,
                    end: v.end_date,
                    validFrom: day(segment.valid_from),
                    validTo:
                      segment.valid_to === undefined
                        ? undefined
                        : day(segment.valid_to),
                    frequency: v.recurrence.frequency,
                    interval: v.recurrence.interval,
                    day: v.recurrence.day_of_month,
                    creditor: v.creditor_id,
                    debtor: v.debtor_id,
                    timezone: v.timezone,
                  },
                ]
              : [];
          });
        }),
      entities: entities
        .filter((x) => !x.archived)
        .map((x) => {
          const facts =
            (selectRevision(
              entityRevisions.filter((r) => r.root_id === x._id),
              now,
              now,
            )?.facts as typeof x | undefined) ?? x;
          return { id: x._id, name: facts.display_name, kind: facts.kind };
        }),
      arrangements: arrangements
        .filter(
          (x) => !x.archived && !x.migrated_to && x.kind !== "ChartOfAccounts",
        )
        .map((x) => {
          const facts =
            (selectRevision(
              arrangementRevisions.filter((r) => r.root_id === x._id),
              now,
              now,
            )?.facts as typeof x | undefined) ?? x;
          return {
            id: x._id,
            name: facts.name ?? x.kind,
            kind: x.kind,
            start: day(facts.valid_from),
            end: facts.valid_to === undefined ? undefined : day(facts.valid_to),
            lifecycle: facts.lifecycle ?? "active",
          };
        }),
      links: assignments
        .filter((x) => !x.archived)
        .map((x) => {
          const facts =
            (selectRevision(
              assignmentRevisions.filter((r) => r.root_id === x._id),
              now,
              now,
            )?.facts as typeof x | undefined) ?? x;
          const role = roles.find((r) => r._id === x.role_definition_id);
          const roleFacts =
            role &&
            ((selectRevision(
              roleRevisions.filter((r) => r.root_id === role._id),
              now,
              now,
            )?.facts as typeof role | undefined) ??
              role);
          return {
            entity: facts.entity_id,
            arrangement: x.arrangement_id,
            role: roleFacts?.name ?? "Participant",
            start: day(facts.valid_from),
            end: facts.valid_to === undefined ? undefined : day(facts.valid_to),
          };
        }),
      ownership: ownership
        .filter((x) => !x.archived)
        .map((x) => ({
          owner: x.owner_entity_id,
          asset: x.asset_entity_id,
          share: x.share_bps,
          start: day(x.valid_from),
          end: x.valid_to === undefined ? undefined : day(x.valid_to),
        })),
      charts: charts.map((x) => ({ id: x._id, name: x.name })),
      accounts: accounts.map((x) => ({
        id: x._id,
        name: x.name,
        chart: x.chart_id ?? x.coa_arrangement_id ?? "",
        type: x.type,
        currency: x.currency,
        financialKind: financial.find(
          (f) => f.ledger_account_id === x._id && !f.archived,
        )?.kind,
        arrangement: financial.find(
          (f) => f.ledger_account_id === x._id && !f.archived,
        )?.arrangement_id,
      })),
      tags: tags
        .filter((x) => !x.archived)
        .map((x) => ({ id: x._id, name: x.name })),
      postings: mappedPostings,
      events: events
        .filter(
          (x) =>
            !x.archived &&
            x.voided_at === undefined &&
            !correctedEvents.has(x._id),
        )
        .map((x) => ({
          id: x._id,
          name: x.title ?? x.kind,
          date: day(x.occurred_at),
          kind: x.kind,
          targets: affects
            .filter((a) => a.event_id === x._id)
            .map((a) => a.target?.id ?? a.target_id),
          tags: tagIds(x._id),
        })),
      measurements: activeMeasurements
        .filter((x) => x.value && Number.isFinite(Number(x.value.decimal)))
        .map((x) => ({
          id: x._id,
          name: x.name,
          subject: x.subject?.id ?? x.owner_id ?? "",
          date: day(x.as_of),
          value: Number(x.value!.decimal),
          unit: x.value!.currency ?? x.value!.unit,
          assertion: x.m_type,
        })),
      obligations: obligationData,
      flows: await Promise.all(
        flows
          .filter((x) => !x.archived && x.cancelled_at === undefined)
          .map(async (x) => {
            const assumption = assumptions.find(
              (a) => a._id === x.assumption_id,
            );
            const obligation = obligations.find(
              (o) => o._id === x.obligation_id,
            );
            const version = scheduleVersions.find(
              (v) => v._id === x.schedule_version_id,
            );
            return {
              id: x._id,
              name:
                assumption?.name ??
                schedules.find((s) => s._id === version?.schedule_id)?.name ??
                obligationData.find((o) => o.id === x.obligation_id)?.name ??
                "Expected movement",
              date: x.expected_date,
              amount: await remaining(ctx, x),
              currency: x.currency,
              account: x.account_id,
              obligation: (await incurredObligation(ctx, x, user._id))?._id,
              occurrence: await canonicalOccurrence(ctx, x, user._id),
              source: x.obligation_id
                ? "Outstanding obligation"
                : x.schedule_version_id
                  ? "Scheduled expectation"
                  : "Assumption",
              tags: [
                ...new Set([
                  ...tagIds(
                    x._id,
                    obligation?.arrangement_id,
                    schedules.find((s) => s._id === version?.schedule_id)
                      ?.arrangement_id,
                  ),
                  ...(assumption?.context?.kind === "tag" &&
                  liveTags.has(assumption.context.id)
                    ? [assumption.context.id]
                    : []),
                ]),
              ],
              entities: [
                obligation?.creditor_id,
                obligation?.debtor_id,
                version?.creditor_id,
                version?.debtor_id,
                assumption?.context?.kind === "entity"
                  ? assumption.context.id
                  : undefined,
              ].filter((s): s is NonNullable<typeof s> => !!s),
            };
          }),
      ),
      budgets: budgets
        .filter((x) => !x.archived && versionMap.has(x.plan_version_id))
        .map((x) => ({
          id: x._id,
          name:
            accounts.find((a) => a._id === x.account_id)?.name ??
            `${x.measure === "income" ? "Income" : "Expense"} target`,
          version: x.plan_version_id,
          start: x.period_start,
          end: x.period_end,
          measure: x.measure,
          chart: x.chart_id,
          account: x.account_id,
          subject: x.subject_id,
          tags: x.tag_id ? [x.tag_id] : undefined,
          scopeTargets: x.tag_id
            ? x.resolved_targets.map((t) => t.id)
            : undefined,
          amount: x.amount.minor_units,
          currency: x.amount.currency,
          status: versionMap.get(x.plan_version_id)!.status,
        })),
      versions: [...versionMap.values()].map((x) => ({
        id: x._id,
        name: `${planName(x.plan_id)} · v${x.revision}`,
        status: x.status,
      })),
      schedules: schedules
        .filter((x) => !x.archived)
        .flatMap((s) => {
          const selected = selectRevision(
            scheduleRevisions.filter((r) => r.schedule_id === s._id),
            now,
            now,
          );
          const v =
            selected &&
            scheduleVersions.find(
              (v) =>
                v._id === (selected.facts as { version_id: string }).version_id,
            );
          return v
            ? [
                {
                  id: s._id,
                  name: s.name,
                  arrangement: s.arrangement_id,
                  creditor: v.creditor_id,
                  debtor: v.debtor_id,
                  amount: v.amount?.minor_units,
                  currency: v.currency,
                  frequency: v.recurrence.frequency,
                  interval: v.recurrence.interval,
                  start: v.start_date,
                  end: v.end_date,
                },
              ]
            : [];
        }),
      coverage: {
        untypedMeasurements: activeMeasurements.filter((x) => !x.value).length,
        draftJournals: journals.filter((x) => x.status === "draft").length,
        unclassifiedPostings: mappedPostings.filter(
          (x) =>
            !x.portions.length ||
            x.portions.every(
              (p) => !p.subject && !p.arrangement && !p.counterparty,
            ),
        ).length,
        latestPosting: mappedPostings
          .map((x) => x.date)
          .sort()
          .pop(),
      },
    };
  },
});
