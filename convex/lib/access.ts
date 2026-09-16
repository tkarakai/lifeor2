import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { authComponent } from "../auth";

type OwnedTable = "entity" | "arrangement" | "event" | "ledger_account" | "journal_entry";

export async function requireUser(ctx: QueryCtx) {
  return await authComponent.getAuthUser(ctx);
}

export async function owned<T extends OwnedTable>(ctx: QueryCtx, table: T, id: Id<T>, userId: string): Promise<Doc<T>> {
  const doc = await ctx.db.get(table, id);
  if (!doc || doc.user_id !== userId) throw new Error("Record not found or access denied");
  return doc;
}

export async function requireChart(ctx: QueryCtx, id: Id<"arrangement">, userId: string) {
  const chart = await owned(ctx, "arrangement", id, userId);
  if (chart.kind !== "ChartOfAccounts") throw new Error("Arrangement must be a ChartOfAccounts");
  return chart;
}

export function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

export function validateJson(value: string) {
  try { JSON.parse(value); } catch { throw new Error("Invalid JSON"); }
}

// Restrict deletes rather than silently destroying related records or financial history.
export async function assertUnreferenced(ctx: QueryCtx, table: "entity" | "arrangement" | "event", id: string) {
  const properties = await ctx.db.query("property").withIndex("by_owner", q => q.eq("owner_type", table).eq("owner_id", id)).first();
  const measurements = await ctx.db.query("measurement").withIndex("by_owner", q => q.eq("owner_type", table).eq("owner_id", id)).first();
  let referenced = Boolean(properties || measurements);
  if (table !== "event") {
    referenced ||= Boolean(await ctx.db.query("event_affects").withIndex("by_target", q => q.eq("target_type", table).eq("target_id", id)).first());
  }
  if (table === "entity") {
    referenced ||= Boolean(await ctx.db.query("arrangement_role").withIndex("by_entity", q => q.eq("entity_id", id as Id<"entity">)).first());
  } else if (table === "event") {
    referenced ||= Boolean(await ctx.db.query("journal_entry").withIndex("by_event", q => q.eq("event_id", id as Id<"event">)).first());
  } else {
    const arrangementId = id as Id<"arrangement">;
    referenced ||= Boolean(await ctx.db.query("ledger_account").withIndex("by_coa", q => q.eq("coa_arrangement_id", arrangementId)).first());
    referenced ||= Boolean(await ctx.db.query("journal_entry").withIndex("by_coa", q => q.eq("coa_arrangement_id", arrangementId)).first());
    referenced ||= Boolean(await ctx.db.query("arrangement").withIndex("by_parent", q => q.eq("parent_arrangement_id", arrangementId)).first());
    referenced ||= Boolean(await ctx.db.query("arrangement").withIndex("by_supersedes", q => q.eq("supersedes_arrangement_id", arrangementId)).first());
  }
  if (referenced) throw new Error("Cannot delete a referenced record; remove its links first");
}
