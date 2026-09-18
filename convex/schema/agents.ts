import { defineTable } from "convex/server";
import { v } from "convex/values";

// Credentials never appear in business records or dataset exports. Only hashes
// of high-entropy OAuth secrets are persisted.
const financeCell = {
  key: v.string(),
  date: v.string(),
  chartId: v.optional(v.string()),
  accountId: v.string(),
  currency: v.string(),
  eventKind: v.optional(v.string()),
  subjectId: v.optional(v.string()),
  arrangementId: v.optional(v.string()),
  beneficiaryId: v.optional(v.string()),
  basis: v.union(v.literal("posting"), v.literal("beneficiary")),
  tags: v.array(v.string()),
  amount: v.number(),
  count: v.number(),
};
export const agentSchema = {
  agent_finance_entry: defineTable({
    dataset_id: v.id("dataset"),
    user_id: v.string(),
    journal_id: v.id("journal_entry"),
    cells: v.array(v.object(financeCell)),
  })
    .index("by_journal", ["journal_id"])
    .index("by_dataset", ["dataset_id"]),
  agent_finance_cell: defineTable({
    ...financeCell,
    dataset_id: v.id("dataset"),
    user_id: v.string(),
    sources: v.array(v.string()),
  })
    .index("by_key", ["dataset_id", "key"])
    .index("by_date", ["dataset_id", "date"])
    .index("by_basis_date", ["dataset_id", "basis", "date"])
    .index("by_account_date", ["dataset_id", "basis", "accountId", "date"])
    .index("by_event_date", ["dataset_id", "basis", "eventKind", "date"])
    .index("by_dataset", ["dataset_id"]),
  agent_obligation_state: defineTable({
    dataset_id: v.id("dataset"),
    user_id: v.string(),
    obligation_id: v.id("monetary_obligation"),
    due_date: v.string(),
    active: v.boolean(),
    remaining_minor_units: v.number(),
  })
    .index("by_obligation", ["obligation_id"])
    .index("by_dataset_active", ["dataset_id", "active"])
    .index("by_dataset_due", ["dataset_id", "due_date"]),
  agent_client: defineTable({
    user_id: v.string(),
    name: v.string(),
    redirect_uris: v.array(v.string()),
    created_at: v.number(),
  }).index("by_user", ["user_id"]),
  agent_connection: defineTable({
    user_id: v.string(),
    client_id: v.id("agent_client"),
    name: v.string(),
    dataset_ids: v.array(v.id("dataset")),
    scopes: v.array(v.string()),
    resource: v.string(),
    created_at: v.number(),
    expires_at: v.number(),
    revoked_at: v.optional(v.number()),
    last_used_at: v.optional(v.number()),
  }).index("by_user", ["user_id"]),
  agent_code: defineTable({
    hash: v.string(),
    connection_id: v.id("agent_connection"),
    client_id: v.string(),
    redirect_uri: v.string(),
    challenge: v.string(),
    resource: v.string(),
    expires_at: v.number(),
    used_at: v.optional(v.number()),
  }).index("by_hash", ["hash"]),
  agent_token: defineTable({
    hash: v.string(),
    kind: v.union(v.literal("access"), v.literal("refresh")),
    connection_id: v.id("agent_connection"),
    expires_at: v.number(),
    used_at: v.optional(v.number()),
  })
    .index("by_hash", ["hash"])
    .index("by_connection", ["connection_id"]),
  agent_execution: defineTable({
    connection_id: v.id("agent_connection"),
    user_id: v.string(),
    dataset_id: v.optional(v.id("dataset")),
    key: v.string(),
    operation: v.string(),
    input_hash: v.string(),
    result: v.any(),
    created_at: v.number(),
  })
    .index("by_key", ["connection_id", "key"])
    .index("by_user", ["user_id"]),
  agent_rate: defineTable({
    connection_id: v.id("agent_connection"),
    window: v.number(),
    requests: v.number(),
  }).index("by_connection", ["connection_id"]),
};
