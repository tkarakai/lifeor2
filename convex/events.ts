import { v } from "convex/values";
import { mutation, query } from "./lib/scoped";
import { authComponent } from "./auth";
import { owned, ownedTarget, requireUser, validateJson } from "./lib/access";
import { nonempty, instant, period } from "./lib/domain";
import { target } from "./schema/shared";
export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    return u
      ? (
          await ctx.db
            .query("event")
            .withIndex("by_user", (q) => q.eq("user_id", u._id))
            .order("desc")
            .collect()
        ).filter((x) => !x.archived)
      : [];
  },
});
export const get = query({
  args: { id: v.id("event") },
  handler: async (ctx, a) =>
    owned(ctx, "event", a.id, (await requireUser(ctx))._id),
});
export const create = mutation({
  args: {
    kind: v.string(),
    title: v.optional(v.string()),
    occurred_at: v.number(),
    ended_at: v.optional(v.number()),
    payload_json: v.optional(v.string()),
    corrects_id: v.optional(v.id("event")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    instant(a.occurred_at);
    if (a.ended_at !== undefined) period(a.occurred_at, a.ended_at);
    validateJson(a.payload_json ?? "{}");
    if (a.corrects_id) await owned(ctx, "event", a.corrects_id, u._id);
    return ctx.db.insert("event", {
      ...a,
      kind: nonempty(a.kind),
      title: a.title ?? a.kind,
      payload_json: a.payload_json ?? "{}",
      user_id: u._id,
      recorded_at: Date.now(),
      created_at: Date.now(),
    });
  },
});
export const getAffects = query({
  args: { eventId: v.id("event") },
  handler: async (ctx, a) => {
    await owned(ctx, "event", a.eventId, (await requireUser(ctx))._id);
    return ctx.db
      .query("event_affects")
      .withIndex("by_event", (q) => q.eq("event_id", a.eventId))
      .collect();
  },
});
export const addAffects = mutation({
  args: {
    eventId: v.id("event"),
    target: v.optional(target),
    targetType: v.optional(
      v.union(v.literal("entity"), v.literal("arrangement")),
    ),
    targetId: v.optional(v.string()),
    meaning: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    await owned(ctx, "event", a.eventId, u._id);
    let ref = a.target;
    if (!ref) {
      if (!a.targetType || !a.targetId) throw new Error("Missing target");
      if (a.targetType === "entity") {
        const id = ctx.db.normalizeId("entity", a.targetId);
        if (!id) throw new Error("Invalid target ID");
        ref = { kind: "entity", id };
      } else {
        const id = ctx.db.normalizeId("arrangement", a.targetId);
        if (!id) throw new Error("Invalid target ID");
        ref = { kind: "arrangement", id };
      }
    }
    await ownedTarget(ctx, ref, u._id);
    return ctx.db.insert("event_affects", {
      event_id: a.eventId,
      target: ref,
      target_type: ref.kind,
      target_id: ref.id,
      meaning: a.meaning,
    });
  },
});
export const remove = mutation({
  args: { id: v.id("event") },
  handler: async (ctx, a) => {
    await owned(ctx, "event", a.id, (await requireUser(ctx))._id);
    await ctx.db.patch(a.id, { archived: true });
  },
});
export const voidEvent = mutation({
  args: { id: v.id("event"), reason: v.string() },
  handler: async (ctx, a) => {
    await owned(ctx, "event", a.id, (await requireUser(ctx))._id);
    const journals = await ctx.db
      .query("journal_entry")
      .withIndex("by_event", (q) => q.eq("event_id", a.id))
      .collect();
    if (journals.some((j) => j.status === "posted"))
      throw new Error(
        "Financial events require journal correction, not voiding",
      );
    await ctx.db.patch(a.id, {
      voided_at: Date.now(),
      void_reason: nonempty(a.reason),
    });
  },
});
