import { indexObligation } from "./lib/lifeQueries/obligationIndex";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { indexJournal } from "./lib/lifeQueries/financeIndex";
/** Operator-only, resumable additive backfill. Source records are never changed.
 * Normal edits maintain indexed contributions transactionally during the scan. */
export const backfill = internalMutation({
  args: { datasetId: v.id("dataset"), cursor: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const dataset = await ctx.db.get(a.datasetId);
    if (!dataset) throw new Error("Dataset missing");
    if (!a.cursor)
      await ctx.db.patch(a.datasetId, { report_index_ready: false });
    const page = await ctx.db
      .query("journal_entry")
      .withIndex("by_dataset", (q) => q.eq("dataset_id", a.datasetId))
      .paginate({ cursor: a.cursor ?? null, numItems: 50 });
    for (const j of page.page) await indexJournal(ctx, a.datasetId, j._id);
    if (page.isDone)
      await ctx.db.patch(a.datasetId, {
        report_index_ready: true,
        report_index_version: 1,
      });
    return {
      indexed: page.page.length,
      nextCursor: page.isDone ? null : page.continueCursor,
      ready: page.isDone,
    };
  },
});

export const backfillObligations = internalMutation({
  args: { datasetId: v.id("dataset"), cursor: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const dataset = await ctx.db.get(a.datasetId);
    if (!dataset) throw new Error("Dataset missing");
    if (!a.cursor)
      await ctx.db.patch(a.datasetId, { report_obligations_ready: false });
    const page = await ctx.db
      .query("monetary_obligation")
      .withIndex("by_dataset", (q) => q.eq("dataset_id", a.datasetId))
      .paginate({ cursor: a.cursor ?? null, numItems: 50 });
    for (const claim of page.page)
      await indexObligation(ctx, a.datasetId, claim._id);
    if (page.isDone)
      await ctx.db.patch(a.datasetId, { report_obligations_ready: true });
    return {
      indexed: page.page.length,
      nextCursor: page.isDone ? null : page.continueCursor,
      ready: page.isDone,
    };
  },
});
