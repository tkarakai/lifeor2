import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { outstanding } from "../obligationState";
/** Current claim state, maintained with the authoritative adjustment/settlement write. */
export async function indexObligation(
  ctx: MutationCtx,
  datasetId: Id<"dataset">,
  id: Id<"monetary_obligation">,
) {
  const old = await ctx.db
      .query("agent_obligation_state")
      .withIndex("by_obligation", (q) => q.eq("obligation_id", id))
      .unique(),
    claim = await ctx.db.get(id);
  if (!claim || claim.dataset_id !== datasetId) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  const state = await outstanding(ctx, claim),
    active =
      !claim.archived &&
      claim.voided_at === undefined &&
      state.outstanding_minor_units > 0;
  const value = {
    dataset_id: datasetId,
    user_id: claim.user_id,
    obligation_id: id,
    due_date: claim.due_date,
    active,
    remaining_minor_units: state.outstanding_minor_units,
  };
  if (old) await ctx.db.replace(old._id, value);
  else await ctx.db.insert("agent_obligation_state", value);
}
