import type { QueryCtx } from "../_generated/server";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { authComponent } from "../auth";

type OwnedTable = TableNames;

export async function requireUser(ctx: QueryCtx) {
  return await authComponent.getAuthUser(ctx);
}

export async function owned<T extends OwnedTable>(
  ctx: QueryCtx,
  table: T,
  id: Id<T>,
  userId: string,
): Promise<Doc<T>> {
  const doc = await ctx.db.get(table, id);
  if (!doc || !("user_id" in doc) || doc.user_id !== userId)
    throw new Error("Record not found or access denied");
  return doc;
}

export function validateJson(value: string) {
  try {
    JSON.parse(value);
  } catch {
    throw new Error("Invalid JSON");
  }
}

// All public removal operations archive roots; no hard-delete helper is exposed.

import type { Infer } from "convex/values";
import { target } from "../schema/shared";
export type Target = Infer<typeof target>;
export async function ownedTarget(ctx: QueryCtx, ref: Target, userId: string) {
  const doc = await ctx.db.get(ref.id);
  if (!doc) throw new Error("Record not found or access denied");
  if (ref.kind === "posting") {
    const posting = await ctx.db.get(ref.id);
    if (!posting) throw new Error("Posting missing");
    await owned(ctx, "journal_entry", posting.je_id, userId);
  } else if (!("user_id" in doc) || doc.user_id !== userId)
    throw new Error("Record not found or access denied");
  return doc;
}
export async function evidence(
  ctx: QueryCtx,
  ids: Id<"evidence_item">[] | undefined,
  userId: string,
) {
  for (const id of ids ?? []) await owned(ctx, "evidence_item", id, userId);
}
export function expected(
  actual: number | undefined,
  requested: number | undefined,
) {
  if (requested !== undefined && (actual ?? 0) !== requested)
    throw new Error("Revision conflict");
}
