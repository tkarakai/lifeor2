import type { QueryCtx } from "../../_generated/server";
import type { Doc, TableNames } from "../../_generated/dataModel";
import type { Scope } from "../scoped";
import { date } from "../domain";
import { requireUser } from "../access";
import { decimalAmount } from "../../agentQueries";
import { scale } from "../domain";
import { civilDate } from "./time";
export { civilDate } from "./time";

export type LifeContext = QueryCtx & { scope: Scope };
export const MAX_REFERENCE_ROWS = 2000;
/** Indexed small reference tables only. Never use for events, journals or postings. */
export async function referenceRows<
  T extends Exclude<
    TableNames,
    "dataset" | "dataset_preference" | `agent_${string}`
  >,
>(ctx: LifeContext, table: T): Promise<Doc<T>[]> {
  await requireUser(ctx);
  const rows = await ctx.db
    .query(table)
    .withIndex("by_dataset", (q) =>
      q.eq("dataset_id", ctx.scope.datasetId as never),
    )
    .take(MAX_REFERENCE_ROWS + 1);
  if (ctx.scope.legacy && ctx.scope.datasetId) {
    rows.push(
      ...(await ctx.db
        .query(table)
        .withIndex("by_dataset", (q) => q.eq("dataset_id", undefined as never))
        .take(MAX_REFERENCE_ROWS + 1)),
    );
  }
  if (rows.length > MAX_REFERENCE_ROWS)
    throw new Error(
      `QUERY_LIMIT: ${table} exceeds ${MAX_REFERENCE_ROWS} reference records. No complete report was computed.`,
    );
  return rows;
}
export function dateRange(from: string, through: string, maxDays = 3660) {
  date(from);
  date(through);
  const span = (Date.parse(through) - Date.parse(from)) / 86400000;
  if (span < 0 || span > maxDays)
    throw new Error(`Use an inclusive range of 0–${maxDays} days.`);
}
export function money(amount: number, currency: string) {
  return decimalAmount(amount, scale(currency));
}
export function page<T>(items: T[], limit = 20, offset = 0) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new Error("limit must be 1–50; offset must be a nonnegative integer");
  const end = offset + limit;
  return {
    items: items.slice(offset, end),
    matchedCount: items.length,
    nextOffset: end < items.length ? end : null,
    queryComplete: true,
    itemsComplete: end >= items.length,
    datasetCompleteness: "unknown",
  };
}
export async function workspace(ctx: LifeContext) {
  const user = await requireUser(ctx);
  const dataset = ctx.scope.datasetId
    ? await ctx.db.get(ctx.scope.datasetId)
    : null;
  const entities = await referenceRows(ctx, "entity");
  // Explicit sample metadata identifies the fixture, not an arbitrary dataset name.
  const household =
    dataset?.household_entity_id ??
    (dataset?.seed_version
      ? entities.find(
          (e) =>
            e.kind === "Household" &&
            e.display_name.toLowerCase() === "morgan family",
        )?._id
      : undefined);
  const memberships = dataset?.seed_version
    ? await referenceRows(ctx, "arrangement")
    : [];
  const householdArrangement =
    dataset?.household_arrangement_id ??
    memberships.find((r) => r.name?.toLowerCase() === "morgan household")?._id;
  const timezone =
    dataset?.timezone ?? (dataset?.seed_version ? "America/Chicago" : "UTC");
  return {
    user,
    dataset,
    entities,
    household,
    householdArrangement,
    timezone,
    timezoneConfigured: !!dataset?.timezone || !!dataset?.seed_version,
    today: civilDate(Date.now(), timezone),
  };
}
