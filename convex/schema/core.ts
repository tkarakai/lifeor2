import { scopedTable as defineTable } from "./datasets";
import { v } from "convex/values";
import { root, target, capturedInput } from "./shared";

// Stable roots plus additive fields; legacy property/role/payload rows stay intact.

export const coreSchema = {
  // Entity: A person, organization, or thing
  entity: defineTable({
    ...root,
    revision: v.optional(v.number()),
    kind: v.string(), // e.g., "Person", "LLC", "House", "Car", "Bank"
    display_name: v.string(),
    user_id: v.string(), // Better Auth component ID; not an app-table ID,
  })
    .index("by_user", ["user_id"])
    .index("by_user_dataset", ["user_id", "dataset_id"]),

  // Arrangement: A relationship or agreement with temporal validity
  arrangement: defineTable({
    ...root,
    revision: v.optional(v.number()),
    type_id: v.optional(v.id("arrangement_type")),
    name: v.optional(v.string()),
    lifecycle: v.optional(
      v.union(v.literal("draft"), v.literal("active"), v.literal("ended")),
    ),
    migrated_to: v.optional(target),
    kind: v.string(), // e.g., "Employment", "Tenancy", "Ownership", "ChartOfAccounts"
    valid_from: v.number(), // Unix timestamp
    valid_to: v.optional(v.number()), // Unix timestamp, open-ended if null
    parent_arrangement_id: v.optional(v.id("arrangement")), // For hierarchical arrangements
    supersedes_arrangement_id: v.optional(v.id("arrangement")), // For versioning
    user_id: v.string(), // Better Auth component ID; not an app-table ID,
  })
    .index("by_user", ["user_id"])
    .index("by_valid_time", ["valid_from", "valid_to"])
    .index("by_parent", ["parent_arrangement_id"])
    .index("by_supersedes", ["supersedes_arrangement_id"]),

  // ArrangementRole: Links entities to arrangements with a named role
  arrangement_role: defineTable({
    arrangement_id: v.id("arrangement"),
    role_name: v.string(), // e.g., "employer", "employee", "landlord", "tenant", "owner"
    entity_id: v.id("entity"),
    share_json: v.optional(v.string()), // For ownership percentages, split ratios, etc.
  })
    .index("by_arrangement", ["arrangement_id"])
    .index("by_entity", ["entity_id"]),

  // Event: A recorded occurrence at a point in time
  event: defineTable({
    ...root,
    title: v.optional(v.string()),
    ended_at: v.optional(v.number()),
    corrects_id: v.optional(v.id("event")),
    voided_at: v.optional(v.number()),
    void_reason: v.optional(v.string()),
    kind: v.string(), // e.g., "PayrollDeposit", "RentPayment", "Purchase"
    occurred_at: v.number(), // Unix timestamp when event happened
    payload_json: v.string(), // Event-specific data
    recorded_at: v.number(), // Unix timestamp when event was recorded
    user_id: v.string(), // Better Auth component ID; not an app-table ID,
  })
    .index("by_user", ["user_id"])
    .index("by_occurred_at", ["occurred_at"])
    .index("by_dataset_occurred", ["dataset_id", "occurred_at"])
    .index("by_corrects", ["corrects_id"])
    .index("by_dataset_kind_occurred", ["dataset_id", "kind", "occurred_at"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["dataset_id", "kind"],
    }),

  // EventAffects: Links events to entities or arrangements they affect
  event_affects: defineTable({
    event_id: v.id("event"),
    target: v.optional(target),
    meaning: v.optional(v.string()),
    target_type: v.string(),
    target_id: v.string(), // Polymorphic reference (entity or arrangement ID)
  })
    .index("by_event", ["event_id"])
    .index("by_target", ["target_type", "target_id"]),

  // Read-only legacy Property source: retained until verified Git export/retirement.
  property: defineTable({
    owner_type: v.union(
      v.literal("entity"),
      v.literal("arrangement"),
      v.literal("event"),
    ),
    owner_id: v.string(), // Polymorphic reference
    name: v.string(), // Property name, e.g., "address", "tax_id", "status"
    value_json: v.string(), // Property value as JSON
    valid_from: v.number(), // Unix timestamp
    valid_to: v.optional(v.number()), // Unix timestamp, open-ended if null
    recorded_at: v.number(), // Unix timestamp when property was recorded
    user_id: v.string(), // Better Auth component ID; not an app-table ID,
  })
    .index("by_owner", ["owner_type", "owner_id"])
    .index("by_owner_name", ["owner_type", "owner_id", "name"])
    .index("by_valid_time", ["valid_from", "valid_to"]),

  // Measurement: Quantitative observations (observed, expected, or derived)
  measurement: defineTable({
    ...root,
    subject: v.optional(target),
    value: v.optional(
      v.object({
        decimal: v.string(),
        unit: v.string(),
        currency: v.optional(v.string()),
      }),
    ),
    method: v.optional(v.string()),
    corrects_id: v.optional(v.id("measurement")),
    evidence_ids: v.optional(v.array(v.id("evidence_item"))),
    assumption_id: v.optional(v.id("forecast_assumption")),
    input_references: v.optional(v.array(target)),
    input_snapshot: v.optional(v.array(capturedInput)),
    calculation_version: v.optional(v.string()),
    owner_type: v.optional(
      v.union(
        v.literal("entity"),
        v.literal("arrangement"),
        v.literal("event"),
      ),
    ),
    owner_id: v.optional(v.string()), // Polymorphic reference
    name: v.string(), // Measurement name, e.g., "account_balance", "rent_amount"
    m_type: v.union(
      v.literal("observed"), // Actual measured value
      v.literal("expected"), // Forecasted or planned value
      v.literal("contractual"),
      v.literal("derived"), // Calculated from other values
    ),
    value_json: v.optional(v.string()), // Measurement value as JSON (could include unit, currency, etc.)
    as_of: v.number(), // Unix timestamp this measurement applies to
    recorded_at: v.number(), // Unix timestamp when measurement was recorded
    user_id: v.string(), // Better Auth component ID; not an app-table ID,
  })
    .index("by_owner", ["owner_type", "owner_id"])
    .index("by_owner_name", ["owner_type", "owner_id", "name"])
    .index("by_as_of", ["as_of"])
    .index("by_dataset_as_of", ["dataset_id", "as_of"])
    .index("by_subject_as_of", ["dataset_id", "subject.id", "as_of"])
    .index("by_legacy_owner_as_of", ["dataset_id", "owner_id", "as_of"])
    .index("by_corrects", ["corrects_id"]),
};
