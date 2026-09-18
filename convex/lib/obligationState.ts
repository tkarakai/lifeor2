import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { add } from "./domain";
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
