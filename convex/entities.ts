import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { owned, requireUser, assertUnreferenced } from "./lib/access";

// Query: List all entities for the current user
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return [];
    }

    return await ctx.db
      .query("entity")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
  },
});

// Query: Get a single entity by ID
export const get = query({
  args: { id: v.id("entity") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    return await owned(ctx, "entity", args.id, user._id);
  },
});

// Mutation: Create a new entity
export const create = mutation({
  args: {
    kind: v.string(),
    display_name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const entityId = await ctx.db.insert("entity", {
      kind: args.kind,
      display_name: args.display_name,
      user_id: user._id,
    });

    return entityId;
  },
});

// Mutation: Update an entity
export const update = mutation({
  args: {
    id: v.id("entity"),
    kind: v.optional(v.string()),
    display_name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    await owned(ctx, "entity", args.id, user._id);
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return id;
  },
});

// Mutation: Delete an entity
export const remove = mutation({
  args: { id: v.id("entity") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    await owned(ctx, "entity", args.id, user._id);
    await assertUnreferenced(ctx, "entity", args.id);

    await ctx.db.delete(args.id);
  },
});
