import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { coreSchema } from "./schema/core";
import { financeSchema } from "./schema/finance";

// Main schema combining auth tables, core primitives, and finance

const schema = defineSchema({
  // Authentication is handled by @convex-dev/better-auth component
  // No need to define auth tables here

  // Core primitives (6 tables)
  ...coreSchema,

  // Finance tables (3 tables: ledger_account, journal_entry, posting)
  ...financeSchema,
});

export default schema;
