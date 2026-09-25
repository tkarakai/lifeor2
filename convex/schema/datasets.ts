import { defineTable } from "convex/server";
import { v, type PropertyValidators } from "convex/values";

/** Every business row, including links and history, belongs to one dataset. */
export function scopedTable<T extends PropertyValidators>(fields: T) {
  return defineTable({
    ...fields,
    dataset_id: v.optional(v.id("dataset")),
  }).index("by_dataset", ["dataset_id"]);
}
export const datasetSchema = {
  sample_record: scopedTable({
    user_id: v.string(),
    key: v.string(),
    target: v.object({ kind: v.string(), id: v.string() }),
  }),
  dataset: defineTable({
    user_id: v.string(),
    name: v.string(),
    is_default: v.boolean(),
    kind: v.union(v.literal("live"), v.literal("test")),
    created_at: v.number(),
    seed_next_month: v.optional(v.number()),
    seed_version: v.optional(v.string()),
    seed_as_of: v.optional(v.string()),
    timezone: v.optional(v.string()),
    data_revision: v.optional(v.number()),
    report_obligations_ready: v.optional(v.boolean()),
    report_index_ready: v.optional(v.boolean()),
    report_index_version: v.optional(v.number()),
    household_entity_id: v.optional(v.id("entity")),
    household_arrangement_id: v.optional(v.id("arrangement")),
    seed_status: v.optional(v.union(v.literal("building"), v.literal("ready"))),
  }).index("by_user", ["user_id"]),
  dataset_preference: defineTable({
    user_id: v.string(),
    dataset_id: v.id("dataset"),
  }).index("by_user", ["user_id"]),
};
