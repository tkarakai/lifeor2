import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Query: List all events for the current user
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    return await ctx.db
      .query("event")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .order("desc") // Most recent first
      .collect();
  },
});

// Query: Get a single event by ID
export const get = query({
  args: { id: v.id("event") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.db.get(args.id);
  },
});

// Query: Get affected targets for an event
export const getAffects = query({
  args: { eventId: v.id("event") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.db
      .query("event_affects")
      .withIndex("by_event", (q) => q.eq("event_id", args.eventId))
      .collect();
  },
});

// Mutation: Create a new event
export const create = mutation({
  args: {
    kind: v.string(),
    occurred_at: v.number(),
    payload_json: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const eventId = await ctx.db.insert("event", {
      kind: args.kind,
      occurred_at: args.occurred_at,
      payload_json: args.payload_json,
      recorded_at: Date.now(),
      user_id: user._id,
    });

    return eventId;
  },
});

// Mutation: Add an affected target to an event
export const addAffects = mutation({
  args: {
    eventId: v.id("event"),
    targetType: v.union(v.literal("entity"), v.literal("arrangement")),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const affectsId = await ctx.db.insert("event_affects", {
      event_id: args.eventId,
      target_type: args.targetType,
      target_id: args.targetId,
    });

    return affectsId;
  },
});

// Mutation: Delete an event
export const remove = mutation({
  args: { id: v.id("event") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Delete associated affects
    const affects = await ctx.db
      .query("event_affects")
      .withIndex("by_event", (q) => q.eq("event_id", args.id))
      .collect();

    for (const affect of affects) {
      await ctx.db.delete(affect._id);
    }

    // Delete the event
    await ctx.db.delete(args.id);
  },
});
