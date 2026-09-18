import { defineTable } from "convex/server";
import { v } from "convex/values";

// Credentials never appear in business records or dataset exports. Only hashes
// of high-entropy OAuth secrets are persisted.
export const agentSchema = {
  agent_client: defineTable({
    user_id: v.string(), name: v.string(), redirect_uris: v.array(v.string()), created_at: v.number(),
  }).index("by_user", ["user_id"]),
  agent_connection: defineTable({
    user_id: v.string(), client_id: v.id("agent_client"), name: v.string(),
    dataset_ids: v.array(v.id("dataset")), scopes: v.array(v.string()),
    resource: v.string(), created_at: v.number(), expires_at: v.number(),
    revoked_at: v.optional(v.number()), last_used_at: v.optional(v.number()),
  }).index("by_user", ["user_id"]),
  agent_code: defineTable({
    hash: v.string(), connection_id: v.id("agent_connection"), client_id: v.string(),
    redirect_uri: v.string(), challenge: v.string(), resource: v.string(),
    expires_at: v.number(), used_at: v.optional(v.number()),
  }).index("by_hash", ["hash"]),
  agent_token: defineTable({
    hash: v.string(), kind: v.union(v.literal("access"), v.literal("refresh")),
    connection_id: v.id("agent_connection"), expires_at: v.number(),
    used_at: v.optional(v.number()),
  }).index("by_hash", ["hash"]).index("by_connection", ["connection_id"]),
  agent_execution: defineTable({
    connection_id: v.id("agent_connection"), user_id: v.string(), dataset_id: v.optional(v.id("dataset")),
    key: v.string(), operation: v.string(), input_hash: v.string(), result: v.any(), created_at: v.number(),
  }).index("by_key", ["connection_id", "key"]).index("by_user", ["user_id"]),
  agent_rate: defineTable({
    connection_id: v.id("agent_connection"), window: v.number(), requests: v.number(),
  }).index("by_connection", ["connection_id"]),
};
