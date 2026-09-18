import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { requireUser } from "./lib/access";
import { nonempty } from "./lib/domain";
import { businessTables } from "./lib/scoped";
import type { Id, Doc } from "./_generated/dataModel";

export async function ensureLive(ctx: MutationCtx, userId: string) {
  const rows = await ctx.db
    .query("dataset")
    .withIndex("by_user", (q) => q.eq("user_id", userId))
    .collect();
  const old = rows.find((x) => x.is_default);
  return (
    old?._id ??
    ctx.db.insert("dataset", {
      user_id: userId,
      name: "Live",
      kind: "live",
      is_default: true,
      created_at: Date.now(),
    })
  );
}
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const datasets = await ctx.db
      .query("dataset")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
    const preference = await ctx.db
      .query("dataset_preference")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .unique();
    return {
      datasets,
      activeId:
        datasets.find((x) => x._id === preference?.dataset_id)?._id ??
        datasets.find((x) => x.is_default)?._id ??
        null,
    };
  },
});
export const initialize = mutation({
  args: {},
  handler: async (ctx) => ensureLive(ctx, (await requireUser(ctx))._id),
});
export const create = mutation({
  args: { name: v.string() },
  handler: createDataset,
});
export const select = mutation({
  args: { id: v.id("dataset") },
  handler: selectDataset,
});

/** Operator-only additive backfill. IDs, user ownership and values never change. */
export const migrateExisting = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ownerById = new Map<string, string>();
    const rows: {
      table: (typeof businessTables)[number];
      row: Doc<(typeof businessTables)[number]>;
    }[] = [];
    for (const table of businessTables)
      for (const row of await ctx.db.query(table).collect()) {
        rows.push({ table, row });
        if ("user_id" in row && row.user_id)
          ownerById.set(row._id, row.user_id);
      }
    // Link/history rows without owners inherit through their original parent references.
    for (let pass = 0; pass < 8; pass++)
      for (const { row } of rows) {
        if (ownerById.has(row._id)) continue;
        for (const [key, value] of Object.entries(row))
          if (
            key !== "_id" &&
            typeof value === "string" &&
            ownerById.has(value)
          ) {
            ownerById.set(row._id, ownerById.get(value)!);
            break;
          }
      }
    const owners = new Map<string, Id<"dataset">>();
    for (const userId of new Set(ownerById.values()))
      owners.set(userId, await ensureLive(ctx, userId));
    let migrated = 0;
    for (const { table, row } of rows) {
      if (row.dataset_id) continue;
      const owner = ownerById.get(row._id);
      if (!owner)
        throw new Error(
          `Cannot determine dataset owner for ${table}; no changes applied`,
        );
      await ctx.db.patch(row._id, { dataset_id: owners.get(owner)! });
      migrated++;
    }
    return {
      migrated,
      owners: [...owners].map(([userId, datasetId]) => ({
        userId,
        datasetId,
        entityCount: rows.filter(
          (x) => x.table === "entity" && ownerById.get(x.row._id) === userId,
        ).length,
      })),
    };
  },
});

export async function createDataset(ctx: MutationCtx, args: { name: string }) {
  const user = await requireUser(ctx);
  await ensureLive(ctx, user._id);
  const name = nonempty(args.name);
  if (
    (
      await ctx.db
        .query("dataset")
        .withIndex("by_user", (q) => q.eq("user_id", user._id))
        .collect()
    ).some((x) => x.name.toLowerCase() === name.toLowerCase())
  )
    throw new Error("A dataset with that name already exists");
  return ctx.db.insert("dataset", {
    user_id: user._id,
    name,
    kind: "test",
    is_default: false,
    created_at: Date.now(),
    report_index_ready: true,
    report_obligations_ready: true,
    report_index_version: 1,
  });
}

export async function selectDataset(
  ctx: MutationCtx,
  args: { id: Id<"dataset"> },
) {
  const user = await requireUser(ctx),
    dataset = await ctx.db.get(args.id);
  if (!dataset || dataset.user_id !== user._id)
    throw new Error("Dataset not found or access denied");
  if (dataset.seed_status === "building")
    throw new Error("Dataset is still being prepared");
  const old = await ctx.db
    .query("dataset_preference")
    .withIndex("by_user", (q) => q.eq("user_id", user._id))
    .unique();
  if (old) await ctx.db.patch(old._id, { dataset_id: args.id });
  else
    await ctx.db.insert("dataset_preference", {
      user_id: user._id,
      dataset_id: args.id,
    });
}
