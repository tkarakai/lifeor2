import { v } from "convex/values";
import { query } from "./lib/scoped";
import { workspace, referenceRows, money } from "./lib/lifeQueries/common";
import { planningData } from "./lib/lifeQueries/planning";
import { owned } from "./lib/access";
import { date } from "./lib/domain";
import { outstandingAsOf } from "./lib/obligationState";
export const project = query({
  agent: { operation: "reports.projectInputs", scope: "data:read" },
  args: { tagId: v.id("tag"), asOf: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const w = await workspace(ctx),
      tag = await owned(ctx, "tag", a.tagId, w.user._id),
      graph = await planningData(ctx);
    const links = await ctx.db
      .query("tag_assignment")
      .withIndex("by_tag", (q) => q.eq("tag_id", a.tagId))
      .take(2001);
    if (links.length > 2000)
      throw new Error(
        "Project exceeds 2000 tagged records; use focused financial reports",
      );
    const targets = new Set(
      links
        .filter((l) => l.removed_at === undefined)
        .map((l) => String(l.target.id)),
    );
    targets.add(a.tagId);
    if (a.asOf) date(a.asOf);
    const claims = graph.claims.filter(
      (c) =>
        !c.archived &&
        c.voided_at === undefined &&
        (targets.has(c._id) ||
          (c.arrangement_id && targets.has(c.arrangement_id))),
    );
    const expected = graph.expected.filter(
      (f) =>
        f.remaining &&
        ((f.claim && claims.some((c) => c._id === f.claim!._id)) ||
          (f.assumption?.context && targets.has(f.assumption.context.id))),
    );
    let historicalObligations: Record<string, unknown>[] | undefined;
    if (a.asOf) {
      const arrangements = graph.arrangements.filter(r => targets.has(r._id));
      const claimPages = await Promise.all(arrangements.map(r => ctx.db.query("monetary_obligation")
        .withIndex("by_arrangement", q => q.eq("arrangement_id", r._id)).take(2001)));
      if (claimPages.some(rows => rows.length > 2000)) throw new Error("QUERY_LIMIT: project arrangement exceeds 2000 claims; no historical total was supplied");
      const directlyTagged = await Promise.all(links.filter(l => l.removed_at === undefined && l.target.kind === "monetary_obligation")
        .map(l => ctx.db.get(l.target.id as import("./_generated/dataModel").Id<"monetary_obligation">)));
      const historicalClaims = [...new Map([...claimPages.flat(), ...directlyTagged.filter((c): c is NonNullable<typeof c> => c !== null)].map(c => [c._id, c])).values()];
      historicalObligations = [];
      for (const claim of historicalClaims) {
        const state = await outstandingAsOf(ctx, claim, a.asOf, w.timezone);
        if (state.outstanding_minor_units === 0) continue;
        historicalObligations.push({ id: claim._id, dueDate: claim.due_date,
          amount: state.outstanding_minor_units === null ? null : money(state.outstanding_minor_units, claim.currency),
          currency: claim.currency, creditor: graph.name(claim.creditor_id), debtor: graph.name(claim.debtor_id),
          historicalState: state.historicalState, recognitionDate: state.recognitionDate,
          limitation: state.historicalState === "unknown" ? state.limitation : undefined });
      }
    }
    return {
      project: { id: tag._id, name: tag.name, kind: "tag" },
      today: w.today,
      revision: w.dataset?.data_revision ?? 0,
      arrangements: graph.arrangements
        .filter((r) => targets.has(r._id))
        .map((r) => ({
          id: r._id,
          name: r.name,
          from: new Date(r.valid_from).toISOString().slice(0, 10),
          through: r.valid_to
            ? new Date(r.valid_to).toISOString().slice(0, 10)
            : null,
        })),
      obligationsAsOf: a.asOf ?? null,
      obligations: historicalObligations ?? claims
        .filter((c) => c.outstanding_minor_units > 0)
        .map((c) => ({
          id: c._id,
          dueDate: c.due_date,
          amount: money(c.outstanding_minor_units, c.currency),
          currency: c.currency,
          creditor: graph.name(c.creditor_id),
          debtor: graph.name(c.debtor_id),
        })),
      expectations: expected.map((f) => ({
        id: f._id,
        date: f.expected_date,
        amount: money(f.remaining, f.currency),
        currency: f.currency,
        kind: f.claim ? "linked_obligation" : "unincurred_assumption",
        obligationId: f.claim?._id ?? null,
        assumptionId: f.assumption?._id ?? null,
        name: f.name,
      })),
      sourceTargets: [
        { kind: "tag", id: tag._id },
        ...graph.arrangements
          .filter((r) => targets.has(r._id))
          .map((r) => ({ kind: "arrangement", id: r._id })),
      ],
      basis:
        "Linked obligation expectations are the same debt, not additional costs. Unincurred assumptions are future work, not current debt.",
    };
  },
});
export const projectionInputs = query({
  agent: { operation: "reports.projectionInputs", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    const w = await workspace(ctx),
      g = await planningData(ctx),
      accounts = await referenceRows(ctx, "ledger_account"),
      financial = await referenceRows(ctx, "financial_account"),
      householdCharts = (await referenceRows(ctx, "chart_of_accounts")).filter(
        (c) =>
          !c.archived && c.reporting_entity_id === w.household && w.household,
      );
    return {
      today: w.today,
      timezone: w.timezone,
      revision: w.dataset?.data_revision ?? 0,
      sampleActualsThrough: w.dataset?.seed_as_of ?? null,
      defaultHouseholdChart:
        householdCharts.length === 1
          ? { id: householdCharts[0]._id, name: householdCharts[0].name }
          : null,
      accounts: accounts.map((a) => ({
        id: a._id,
        name: a.name,
        chart: a.chart_id ?? "",
        type: a.type,
        currency: a.currency,
        financialKind: financial.find((f) => f.ledger_account_id === a._id)
          ?.kind,
      })),
      cashSchedules: g.cashSchedules,
      cashRoutes: [...g.routes.values()],
      blockedCashOccurrences: g.claims.map((c) => c.occurrence),
      obligations: g.claims
        .filter((c) => !c.archived && c.voided_at === undefined)
        .map((c) => ({
          id: c._id,
          name: g.name(c.arrangement_id),
          date: c.due_date,
          currency: c.currency,
          creditor: c.creditor_id,
          debtor: c.debtor_id,
          arrangement: c.arrangement_id,
          amount: c.outstanding_minor_units,
          original: c.original_minor_units,
          settled: c.settled_minor_units,
          schedule: g.cashSchedules.find(
            (s) => s.version === c.schedule_version_id,
          )?.id,
          occurrence: c.occurrence,
        })),
      flows: g.expected.map((f) => ({
        id: f._id,
        name: f.name,
        date: f.expected_date,
        amount: f.remaining,
        currency: f.currency,
        account: f.account_id,
        obligation: f.claim?._id,
        source: f.assumption ? "Assumption" : "Expectation",
        occurrence: f.occurrence,
        tags: [],
        entities: [],
      })),
    };
  },
});
