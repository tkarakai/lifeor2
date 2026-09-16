import { v } from "convex/values";
import { mutation, query } from "./lib/scoped";
import { owned, ownedTarget, requireUser } from "./lib/access";
import { nonempty } from "./lib/domain";
import { target } from "./schema/shared";
export const ensure = mutation({
  args: { target, repositoryKey: v.string() },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      object = await ownedTarget(ctx, a.target, u._id);
    if ("details_document_id" in object && object.details_document_id)
      return owned(ctx, "details_document", object.details_document_id, u._id);
    const all = await ctx.db
      .query("details_document")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
    const existing = all.find(
      (d) => d.target.kind === a.target.kind && d.target.id === a.target.id,
    );
    if (existing) return existing;
    const id = await ctx.db.insert("details_document", {
      user_id: u._id,
      target: a.target,
      repository_key: nonempty(a.repositoryKey),
      path: "pending",
      availability: "missing",
      created_at: Date.now(),
    });
    await ctx.db.patch(id, { path: `details/${id}.md` });
    await ctx.db.patch(a.target.id, { details_document_id: id });
    return (await ctx.db.get(id))!;
  },
});
export const get = query({
  args: { id: v.id("details_document") },
  handler: async (ctx, a) =>
    owned(ctx, "details_document", a.id, (await requireUser(ctx))._id),
});
export const forTarget = query({
  args: { target },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    await ownedTarget(ctx, a.target, u._id);
    return (
      (
        await ctx.db
          .query("details_document")
          .withIndex("by_user", (q) => q.eq("user_id", u._id))
          .collect()
      ).find(
        (d) => d.target.kind === a.target.kind && d.target.id === a.target.id,
      ) ?? null
    );
  },
});
export const observe = mutation({
  args: {
    id: v.id("details_document"),
    commit: v.optional(v.string()),
    availability: v.union(
      v.literal("available"),
      v.literal("missing"),
      v.literal("unreadable"),
    ),
  },
  handler: async (ctx, a) => {
    await owned(ctx, "details_document", a.id, (await requireUser(ctx))._id);
    if (
      a.commit !== undefined &&
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(a.commit)
    )
      throw new Error("Expected full commit ID");
    if (a.availability === "available" && !a.commit)
      throw new Error("Available document requires committed revision");
    await ctx.db.patch(
      a.id,
      a.commit
        ? { observed_commit: a.commit, availability: a.availability }
        : { availability: a.availability },
    );
    return a.id;
  },
});
