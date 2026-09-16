import { entityAt } from "./lib/history";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { owned, requireUser, expected } from "./lib/access";
import { nonempty, changeTimeline, selectRevision } from "./lib/domain";
export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    return u
      ? Promise.all(
          (
            await ctx.db
              .query("entity")
              .withIndex("by_user", (q) => q.eq("user_id", u._id))
              .collect()
          )
            .filter((x) => !x.archived)
            .map((x) => entityAt(ctx, x)),
        )
      : [];
  },
});
export const get = query({
  args: { id: v.id("entity") },
  handler: async (ctx, a) =>
    entityAt(
      ctx,
      await owned(ctx, "entity", a.id, (await requireUser(ctx))._id),
    ),
});
export const create = mutation({
  args: { kind: v.string(), display_name: v.string() },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      now = Date.now();
    const facts = {
      kind: nonempty(a.kind),
      display_name: nonempty(a.display_name),
    };
    const id = await ctx.db.insert("entity", {
      ...facts,
      user_id: u._id,
      created_at: now,
      revision: 1,
    });
    await ctx.db.insert("entity_revision", {
      root_id: id,
      user_id: u._id,
      revision: 1,
      recorded_at: now,
      actor: u._id,
      segments: [{ valid_from: now, facts }],
    });
    return id;
  },
});
export const update = mutation({
  args: {
    id: v.id("entity"),
    kind: v.optional(v.string()),
    display_name: v.optional(v.string()),
    effectiveAt: v.optional(v.number()),
    expectedRevision: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      old = await owned(ctx, "entity", a.id, u._id);
    expected(old.revision, a.expectedRevision);
    const revisions = await ctx.db
      .query("entity_revision")
      .withIndex("by_root", (q) => q.eq("root_id", a.id))
      .collect();
    const prev = revisions.sort((a, b) => b.revision - a.revision)[0];
    const at = a.effectiveAt ?? Date.now();
    const oldSegments = prev?.segments ?? [
      {
        valid_from: old._creationTime,
        facts: { kind: old.kind, display_name: old.display_name },
      },
    ];
    const oldFacts = oldSegments.find(
      (s) =>
        s.valid_from <= at && (s.valid_to === undefined || at < s.valid_to),
    )?.facts;
    if (!oldFacts) throw new Error("Effective time outside entity history");
    const facts = {
      kind: nonempty(a.kind ?? oldFacts.kind),
      display_name: nonempty(a.display_name ?? oldFacts.display_name),
    };
    const segments = changeTimeline(oldSegments, at, facts);
    const revision = (old.revision ?? 0) + 1;
    await ctx.db.insert("entity_revision", {
      root_id: a.id,
      user_id: u._id,
      revision,
      recorded_at: Date.now(),
      actor: u._id,
      reason: a.reason,
      prior_id: prev?._id,
      segments,
    });
    const current =
      segments.find(
        (s) =>
          s.valid_from <= Date.now() &&
          (s.valid_to === undefined || Date.now() < s.valid_to),
      )?.facts ?? facts;
    await ctx.db.patch(a.id, { ...current, revision });
    return a.id;
  },
});
export const history = query({
  args: {
    id: v.id("entity"),
    effectiveAt: v.optional(v.number()),
    knownAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    await owned(ctx, "entity", a.id, (await requireUser(ctx))._id);
    const revisions = await ctx.db
      .query("entity_revision")
      .withIndex("by_root", (q) => q.eq("root_id", a.id))
      .collect();
    return {
      revisions,
      selected: selectRevision(
        revisions,
        a.effectiveAt ?? Date.now(),
        a.knownAt ?? Date.now(),
      ),
    };
  },
});
export const remove = mutation({
  args: { id: v.id("entity") },
  handler: async (ctx, a) => {
    await owned(ctx, "entity", a.id, (await requireUser(ctx))._id);
    await ctx.db.patch(a.id, { archived: true });
  },
});
