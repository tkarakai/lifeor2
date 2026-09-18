import { v } from "convex/values";
import { query } from "./lib/scoped";
import { workspace, money } from "./lib/lifeQueries/common";
import { planningData } from "./lib/lifeQueries/planning";
import { matchesText, queryTerms } from "./lib/lifeQueries/text";
import { add, date } from "./lib/domain";

/** Current unpaid claims have debtor/creditor meaning, independent of cash perspective. */
export const current = query({
  agent: { operation: "life.obligations", scope: "data:read" },
  args: {
    scope: v.union(v.literal("household"), v.literal("dataset")),
    debtorQuery: v.optional(v.string()),
    creditorQuery: v.optional(v.string()),
    partyQuery: v.optional(v.string()),
    query: v.optional(v.string()),
    overdueOnly: v.optional(v.boolean()),
    dueThrough: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const w = await workspace(ctx);
    if (a.scope === "household" && !w.household) throw new Error("No default household is configured. Specify dataset scope and named parties, or ask which household.");
    if (a.dueThrough) date(a.dueThrough);
    const graph = await planningData(ctx);
    const resolve = (name: string | undefined) => {
      if (name === undefined) return undefined;
      if (!queryTerms(name).length) throw new Error("Provide a nonempty party name");
      const found = graph.entities.filter(e => !e.archived && matchesText(e.display_name, name));
      if (found.length !== 1) throw new Error(`Party name ${JSON.stringify(name)} has ${found.length} matches. Use life.search to resolve it; do not infer absence of debt.`);
      return found[0]._id;
    };
    const debtor = resolve(a.debtorQuery), creditor = resolve(a.creditorQuery), party = resolve(a.partyQuery);
    const claims = graph.claims.filter(o => !o.archived && o.voided_at === undefined && o.outstanding_minor_units > 0
      && (a.scope === "dataset" || o.debtor_id === w.household || o.creditor_id === w.household)
      && (!debtor || o.debtor_id === debtor) && (!creditor || o.creditor_id === creditor)
      && (!party || o.debtor_id === party || o.creditor_id === party)
      && (!a.overdueOnly || o.due_date < w.today) && (!a.dueThrough || o.due_date <= a.dueThrough)
      && (!a.query || matchesText([graph.name(o.arrangement_id), graph.scheduleName(o.schedule_version_id)].join(" "), a.query)))
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a._id.localeCompare(b._id));
    const totals = new Map<string, { debtor: string; creditor: string; currency: string; minor: number; claimCount: number }>();
    for (const o of claims) {
      const key = JSON.stringify([o.debtor_id, o.creditor_id, o.currency]);
      const total = totals.get(key) ?? { debtor: graph.name(o.debtor_id), creditor: graph.name(o.creditor_id), currency: o.currency, minor: 0, claimCount: 0 };
      total.minor = add(total.minor, o.outstanding_minor_units); total.claimCount++; totals.set(key, total);
    }
    return {
      reportType: "obligations", today: w.today, timezone: w.timezone, queryComplete: true,
      scope: a.scope === "household" ? graph.name(w.household) : "All authorized dataset parties",
      filters: { debtor: debtor ? graph.name(debtor) : null, creditor: creditor ? graph.name(creditor) : null, party: party ? graph.name(party) : null, query: a.query ?? null, overdueOnly: a.overdueOnly ?? false, dueThrough: a.dueThrough ?? null },
      items: claims.map(o => ({ id: o._id, debtor: graph.name(o.debtor_id), creditor: graph.name(o.creditor_id), title: graph.name(o.arrangement_id), commitment: graph.scheduleName(o.schedule_version_id), dueDate: o.due_date, amount: money(o.outstanding_minor_units, o.currency), currency: o.currency, status: o.due_date < w.today ? "overdue" : "unpaid", sourceIds: [o._id] })),
      totals: [...totals.values()].map(({minor, ...row}) => ({...row, amount: money(minor, row.currency)})),
      matchedCount: claims.length,
      basis: "Current unpaid recorded claims after adjustments and settlements, including future-due claims unless filtered. Debtor owes creditor. Linked expected payments are not additional debt. Unincurred planned work and recurring projections are excluded. This is not all loan principal or a balance-sheet liability total; use financial balances for those. Empty results mean no matching recorded claims, not proof of no real-life debt.",
    };
  },
});
