import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { add } from "./domain";
import { civilDate } from "./lifeQueries/time";
export async function outstanding(
  ctx: QueryCtx,
  o: Doc<"monetary_obligation">,
) {
  const adjustments = await ctx.db
    .query("obligation_adjustment")
    .withIndex("by_obligation", (q) => q.eq("obligation_id", o._id))
    .collect();
  const settlements = await ctx.db
    .query("obligation_settlement")
    .withIndex("by_obligation", (q) => q.eq("obligation_id", o._id))
    .collect();
  const adjusted = add(
    o.original_minor_units,
    ...adjustments.map((x) => x.minor_units),
  );
  const settled = add(
    ...settlements.map((x) => (x.reverses_id ? -x.minor_units : x.minor_units)),
  );
  return {
    outstanding_minor_units:
      o.voided_at === undefined ? add(adjusted, -settled) : 0,
    approved_minor_units: adjusted,
    settled_minor_units: settled,
    adjustments,
    settlements,
  };
}

/** Effective-date history using current recorded evidence, not creation timestamps. */
export async function outstandingAsOf(
  ctx: QueryCtx, o: Doc<"monetary_obligation">, through: string, timezone: string,
) {
  let recognitionDate: string | undefined;
  if (o.recognition_posting_id) {
    const posting = await ctx.db.get(o.recognition_posting_id);
    const journal = posting ? await ctx.db.get(posting.je_id) : null;
    if (journal?.status === "posted") recognitionDate = journal.accounting_date;
  }
  if (!recognitionDate && o.event_id) {
    const event = await ctx.db.get(o.event_id);
    if (event) recognitionDate = civilDate(event.occurred_at, timezone);
  }
  if (!recognitionDate) return { historicalState: "unknown" as const, recognitionDate: null, outstanding_minor_units: null,
    limitation: "No recognition journal date or originating event date establishes when this claim was incurred." };
  if (recognitionDate > through || (o.voided_at !== undefined && civilDate(o.voided_at, timezone) <= through))
    return { historicalState: "known" as const, recognitionDate, outstanding_minor_units: 0 };
  const state = await outstanding(ctx, o);
  return { historicalState: "known" as const, recognitionDate, outstanding_minor_units: add(
    o.original_minor_units,
    ...state.adjustments.filter(a => a.effective_date <= through).map(a => a.minor_units),
    ...state.settlements.filter(s => s.settlement_date <= through).map(s => s.reverses_id ? s.minor_units : -s.minor_units),
  ) };
}
