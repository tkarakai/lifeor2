import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Query: List all arrangements for the current user
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    return await ctx.db
      .query("arrangement")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
  },
});

// Query: Get arrangements valid at a specific timestamp
export const listValidAt = query({
  args: { timestamp: v.number() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    const allArrangements = await ctx.db
      .query("arrangement")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();

    // Filter for arrangements valid at the given timestamp
    return allArrangements.filter(
      (arr) =>
        arr.valid_from <= args.timestamp &&
        (!arr.valid_to || arr.valid_to >= args.timestamp)
    );
  },
});

// Query: Get a single arrangement by ID
export const get = query({
  args: { id: v.id("arrangement") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.db.get(args.id);
  },
});

// Query: Get roles for an arrangement
export const getRoles = query({
  args: { arrangementId: v.id("arrangement") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.db
      .query("arrangement_role")
      .withIndex("by_arrangement", (q) =>
        q.eq("arrangement_id", args.arrangementId)
      )
      .collect();
  },
});

// Mutation: Create a new arrangement
export const create = mutation({
  args: {
    kind: v.string(),
    valid_from: v.number(),
    valid_to: v.optional(v.number()),
    parent_arrangement_id: v.optional(v.id("arrangement")),
    supersedes_arrangement_id: v.optional(v.id("arrangement")),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const arrangementId = await ctx.db.insert("arrangement", {
      kind: args.kind,
      valid_from: args.valid_from,
      valid_to: args.valid_to,
      parent_arrangement_id: args.parent_arrangement_id,
      supersedes_arrangement_id: args.supersedes_arrangement_id,
      user_id: user._id,
    });

    return arrangementId;
  },
});

// Mutation: Add a role to an arrangement
export const addRole = mutation({
  args: {
    arrangementId: v.id("arrangement"),
    roleName: v.string(),
    entityId: v.id("entity"),
    shareJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const roleId = await ctx.db.insert("arrangement_role", {
      arrangement_id: args.arrangementId,
      role_name: args.roleName,
      entity_id: args.entityId,
      share_json: args.shareJson,
    });

    return roleId;
  },
});

// Mutation: Delete an arrangement
export const remove = mutation({
  args: { id: v.id("arrangement") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Delete associated roles
    const roles = await ctx.db
      .query("arrangement_role")
      .withIndex("by_arrangement", (q) => q.eq("arrangement_id", args.id))
      .collect();

    for (const role of roles) {
      await ctx.db.delete(role._id);
    }

    // Delete the arrangement
    await ctx.db.delete(args.id);
  },
});
