import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { owned, ownedTarget, requireUser } from "./lib/access";
import { nonempty, date } from "./lib/domain";
import { target } from "./schema/shared";
export const create = mutation({
  args: {
    kind: v.string(),
    namespace: v.string(),
    external_key: v.optional(v.string()),
    source_date: v.optional(v.string()),
    content_ref: v.string(),
    supersedes_id: v.optional(v.id("evidence_item")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    nonempty(a.kind);
    nonempty(a.namespace);
    nonempty(a.content_ref);
    if (a.source_date) date(a.source_date);
    if (a.supersedes_id) {
      const prev = await owned(ctx, "evidence_item", a.supersedes_id, u._id);
      if (
        prev.namespace !== a.namespace ||
        prev.external_key !== a.external_key
      )
        throw new Error("Evidence lineage source mismatch");
    }
    const all = await ctx.db
      .query("evidence_item")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
    const same = all.find(
      (e) =>
        e.namespace === a.namespace &&
        e.external_key === a.external_key &&
        e.content_ref === a.content_ref,
    );
    if (same) return same._id;
    const siblings = all.filter(
      (e) => e.namespace === a.namespace && e.external_key === a.external_key,
    );
    if (a.external_key !== undefined && siblings.length && !a.supersedes_id)
      throw new Error("Changed external source requires supersession lineage");
    if (
      a.supersedes_id &&
      siblings.some((e) => e.supersedes_id === a.supersedes_id)
    )
      throw new Error("Evidence revision already superseded");
    return ctx.db.insert("evidence_item", {
      ...a,
      user_id: u._id,
      created_at: Date.now(),
      captured_at: Date.now(),
    });
  },
});
export const link = mutation({
  args: {
    evidence_id: v.id("evidence_item"),
    target,
    target_revision: v.optional(v.number()),
    relationship: v.union(v.literal("supports"), v.literal("contradicts")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    await owned(ctx, "evidence_item", a.evidence_id, u._id);
    const object = await ownedTarget(ctx, a.target, u._id);
    if (
      a.target_revision !== undefined &&
      (!Number.isInteger(a.target_revision) ||
        a.target_revision < 1 ||
        !("revision" in object) ||
        typeof object.revision !== "number" ||
        a.target_revision > object.revision)
    )
      throw new Error("Unknown target revision");
    if (
      a.target_revision !== undefined &&
      (a.target.kind.endsWith("_revision") ||
        a.target.kind.endsWith("_version")) &&
      "revision" in object &&
      a.target_revision !== object.revision
    )
      throw new Error("Immutable target revision mismatch");
    return ctx.db.insert("evidence_link", {
      ...a,
      user_id: u._id,
      recorded_at: Date.now(),
    });
  },
});
export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    return ctx.db
      .query("evidence_item")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
  },
});
