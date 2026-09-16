import { defineTable } from "convex/server";
import { v } from "convex/values";

// Core schema: 6 primitive tables for the arrangements model

export const coreSchema = {
  // Entity: A person, organization, or thing
  entity: defineTable({
    kind: v.string(), // e.g., "Person", "LLC", "House", "Car", "Bank"
    display_name: v.string(),
    user_id: v.string() // Better Auth component ID; not an app-table ID,
  }).index("by_user", ["user_id"]),

  // Arrangement: A relationship or agreement with temporal validity
  arrangement: defineTable({
    kind: v.string(), // e.g., "Employment", "Tenancy", "Ownership", "ChartOfAccounts"
    valid_from: v.number(), // Unix timestamp
    valid_to: v.optional(v.number()), // Unix timestamp, open-ended if null
    parent_arrangement_id: v.optional(v.id("arrangement")), // For hierarchical arrangements
    supersedes_arrangement_id: v.optional(v.id("arrangement")), // For versioning
    user_id: v.string() // Better Auth component ID; not an app-table ID,
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
  }).index("by_arrangement", ["arrangement_id"])
    .index("by_entity", ["entity_id"]),

  // Event: A recorded occurrence at a point in time
  event: defineTable({
    kind: v.string(), // e.g., "PayrollDeposit", "RentPayment", "Purchase"
    occurred_at: v.number(), // Unix timestamp when event happened
    payload_json: v.string(), // Event-specific data
    recorded_at: v.number(), // Unix timestamp when event was recorded
    user_id: v.string() // Better Auth component ID; not an app-table ID,
  })
    .index("by_user", ["user_id"])
    .index("by_occurred_at", ["occurred_at"]),

  // EventAffects: Links events to entities or arrangements they affect
  event_affects: defineTable({
    event_id: v.id("event"),
    target_type: v.union(v.literal("entity"), v.literal("arrangement")),
    target_id: v.string(), // Polymorphic reference (entity or arrangement ID)
  })
    .index("by_event", ["event_id"])
    .index("by_target", ["target_type", "target_id"]),

  // Property: Attributes of entities, arrangements, or events
  property: defineTable({
    owner_type: v.union(
      v.literal("entity"),
      v.literal("arrangement"),
      v.literal("event")
    ),
    owner_id: v.string(), // Polymorphic reference
    name: v.string(), // Property name, e.g., "address", "tax_id", "status"
    value_json: v.string(), // Property value as JSON
    valid_from: v.number(), // Unix timestamp
    valid_to: v.optional(v.number()), // Unix timestamp, open-ended if null
    recorded_at: v.number(), // Unix timestamp when property was recorded
    user_id: v.string() // Better Auth component ID; not an app-table ID,
  })
    .index("by_owner", ["owner_type", "owner_id"])
    .index("by_owner_name", ["owner_type", "owner_id", "name"])
    .index("by_valid_time", ["valid_from", "valid_to"]),

  // Measurement: Quantitative observations (observed, expected, or derived)
  measurement: defineTable({
    owner_type: v.union(
      v.literal("entity"),
      v.literal("arrangement"),
      v.literal("event")
    ),
    owner_id: v.string(), // Polymorphic reference
    name: v.string(), // Measurement name, e.g., "account_balance", "rent_amount"
    m_type: v.union(
      v.literal("observed"), // Actual measured value
      v.literal("expected"), // Forecasted or planned value
      v.literal("derived") // Calculated from other values
    ),
    value_json: v.string(), // Measurement value as JSON (could include unit, currency, etc.)
    as_of: v.number(), // Unix timestamp this measurement applies to
    recorded_at: v.number(), // Unix timestamp when measurement was recorded
    user_id: v.string() // Better Auth component ID; not an app-table ID,
  })
    .index("by_owner", ["owner_type", "owner_id"])
    .index("by_owner_name", ["owner_type", "owner_id", "name"])
    .index("by_as_of", ["as_of"]),
};
