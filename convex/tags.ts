import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { owned, ownedTarget, requireUser } from "./lib/access";
import { nonempty } from "./lib/domain";
import { target } from "./schema/shared";
export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    return u
      ? (
          await ctx.db
            .query("tag")
            .withIndex("by_user", (q) => q.eq("user_id", u._id))
            .collect()
        ).filter((x) => !x.archived)
      : [];
  },
});
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      name = nonempty(a.name);
    const all = await ctx.db
      .query("tag")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
    if (all.some((t) => t.name === name && !t.archived))
      throw new Error("Tag name already exists");
    return ctx.db.insert("tag", {
      user_id: u._id,
      name,
      created_at: Date.now(),
    });
  },
});
export const update = mutation({
  args: {
    id: v.id("tag"),
    name: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    const previous = await owned(ctx, "tag", a.id, u._id);
    const update: { name?: string; archived?: boolean } = {};
    if (a.name !== undefined) {
      update.name = nonempty(a.name);
      const all = await ctx.db
        .query("tag")
        .withIndex("by_user", (q) => q.eq("user_id", u._id))
        .collect();
      if (
        all.some((x) => x._id !== a.id && !x.archived && x.name === update.name)
      )
        throw new Error("Tag name already exists");
    }
    if (a.archived === false) {
      const all = await ctx.db
        .query("tag")
        .withIndex("by_user", (q) => q.eq("user_id", u._id))
        .collect();
      if (
        all.some(
          (x) =>
            x._id !== a.id &&
            !x.archived &&
            x.name === (update.name ?? previous.name),
        )
      )
        throw new Error("Tag name already exists");
    }
    if (a.archived !== undefined) update.archived = a.archived;
    await ctx.db.patch(a.id, update);
    return a.id;
  },
});
export const assign = mutation({
  args: { tagId: v.id("tag"), target },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      tag = await owned(ctx, "tag", a.tagId, u._id);
    if (tag.archived) throw new Error("Tag archived");
    await ownedTarget(ctx, a.target, u._id);
    const all = await ctx.db
      .query("tag_assignment")
      .withIndex("by_tag", (q) => q.eq("tag_id", a.tagId))
      .collect();
    if (
      all.some(
        (x) =>
          x.removed_at === undefined &&
          x.target.kind === a.target.kind &&
          x.target.id === a.target.id,
      )
    )
      throw new Error("Duplicate active tag link");
    return ctx.db.insert("tag_assignment", {
      user_id: u._id,
      tag_id: a.tagId,
      target: a.target,
      added_at: Date.now(),
    });
  },
});
export const unassign = mutation({
  args: { id: v.id("tag_assignment") },
  handler: async (ctx, a) => {
    const x = await owned(
      ctx,
      "tag_assignment",
      a.id,
      (await requireUser(ctx))._id,
    );
    if (x.removed_at === undefined)
      await ctx.db.patch(a.id, { removed_at: Date.now() });
  },
});
export const getAssignments = query({
  args: { tagId: v.id("tag"), asOf: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await owned(ctx, "tag", a.tagId, (await requireUser(ctx))._id);
    const all = await ctx.db
        .query("tag_assignment")
        .withIndex("by_tag", (q) => q.eq("tag_id", a.tagId))
        .collect(),
      at = a.asOf ?? Date.now();
    return all.filter(
      (x) =>
        x.added_at <= at && (x.removed_at === undefined || at < x.removed_at),
    );
  },
});
