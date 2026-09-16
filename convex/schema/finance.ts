import { scopedTable as defineTable } from "./datasets";
import { v } from "convex/values";
import { root, provenance, moneyValue } from "./shared";
export const accountType = v.union(
  v.literal("Asset"),
  v.literal("Liability"),
  v.literal("Equity"),
  v.literal("Income"),
  v.literal("Expense"),
);
export const financeSchema = {
  chart_of_accounts: defineTable({
    ...root,
    name: v.string(),
    reporting_entity_id: v.optional(v.id("entity")),
    legacy_arrangement_id: v.optional(v.id("arrangement")),
  })
    .index("by_user", ["user_id"])
    .index("by_legacy", ["legacy_arrangement_id"]),
  ledger_account: defineTable({
    ...root,
    chart_id: v.optional(v.id("chart_of_accounts")),
    coa_arrangement_id: v.optional(v.id("arrangement")),
    name: v.string(),
    type: accountType,
    normal_balance: v.union(v.literal("Debit"), v.literal("Credit")),
    currency: v.string(),
    parent_account_id: v.optional(v.id("ledger_account")),
  })
    .index("by_user", ["user_id"])
    .index("by_coa", ["coa_arrangement_id"])
    .index("by_chart", ["chart_id"]),
  journal_entry: defineTable({
    ...root,
    event_id: v.id("event"),
    chart_id: v.optional(v.id("chart_of_accounts")),
    coa_arrangement_id: v.optional(v.id("arrangement")),
    memo: v.string(),
    status: v.union(v.literal("draft"), v.literal("posted")),
    accounting_date: v.optional(v.string()),
    recorded_at: v.optional(v.number()),
    posted_at: v.optional(v.number()),
    source_ref: v.optional(v.string()),
    evidence_ids: v.optional(v.array(v.id("evidence_item"))),
    reverses_id: v.optional(v.id("journal_entry")),
    corrects_id: v.optional(v.id("journal_entry")),
  })
    .index("by_user", ["user_id"])
    .index("by_coa", ["coa_arrangement_id"])
    .index("by_chart", ["chart_id"])
    .index("by_event", ["event_id"])
    .index("by_reverses", ["reverses_id"]),
  posting: defineTable({
    user_id: v.optional(v.string()),
    je_id: v.id("journal_entry"),
    account_id: v.id("ledger_account"),
    amount: v.optional(v.number()),
    minor_units: v.optional(v.number()),
    currency: v.string(),
    description: v.string(),
    details_document_id: v.optional(v.id("details_document")),
    reverses_id: v.optional(v.id("posting")),
    attribution_revision: v.optional(v.number()),
  })
    .index("by_je", ["je_id"])
    .index("by_account", ["account_id"]),
  financial_account: defineTable({
    ...root,
    arrangement_id: v.id("arrangement"),
    ledger_account_id: v.id("ledger_account"),
    kind: v.string(),
    currency: v.string(),
    institution_entity_id: v.optional(v.id("entity")),
    identifier: v.optional(v.string()),
  })
    .index("by_user", ["user_id"])
    .index("by_ledger", ["ledger_account_id"])
    .index("by_arrangement", ["arrangement_id"]),
  posting_attribution_set: defineTable({
    user_id: v.string(),
    posting_id: v.id("posting"),
    revision: v.number(),
    ...provenance,
    supersedes_id: v.optional(v.id("posting_attribution_set")),
  }).index("by_posting", ["posting_id"]),
  posting_attribution: defineTable({
    ...root,
    set_id: v.id("posting_attribution_set"),
    minor_units: v.number(),
    currency: v.string(),
    subject_entity_id: v.optional(v.id("entity")),
    arrangement_id: v.optional(v.id("arrangement")),
    counterparty_entity_id: v.optional(v.id("entity")),
    unclassified: v.boolean(),
    reverses_id: v.optional(v.id("posting_attribution")),
  }).index("by_set", ["set_id"]),
  attribution_beneficiary: defineTable({
    user_id: v.string(),
    attribution_id: v.id("posting_attribution"),
    entity_id: v.optional(v.id("entity")),
    unassigned: v.boolean(),
    share_bps: v.number(),
    minor_units: v.number(),
  }).index("by_attribution", ["attribution_id"]),
  statement: defineTable({
    ...root,
    financial_account_id: v.id("financial_account"),
    evidence_id: v.id("evidence_item"),
    period_start: v.string(),
    period_end: v.string(),
    opening: v.optional(moneyValue),
    closing: v.optional(moneyValue),
  }).index("by_account", ["financial_account_id"]),
  statement_line: defineTable({
    ...root,
    statement_id: v.id("statement"),
    external_key: v.string(),
    revision: v.number(),
    posting_date: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("posted"),
      v.literal("removed"),
    ),
    minor_units: v.number(),
    currency: v.string(),
    raw_source_ref: v.string(),
    supersedes_id: v.optional(v.id("statement_line")),
    recorded_at: v.number(),
  }).index("by_statement", ["statement_id"]),
  balance_observation: defineTable({
    ...root,
    financial_account_id: v.id("financial_account"),
    minor_units: v.number(),
    currency: v.string(),
    source_at: v.number(),
    kind: v.union(v.literal("current"), v.literal("available")),
    pending: v.union(
      v.literal("included"),
      v.literal("excluded"),
      v.literal("unknown"),
    ),
    cutoff: v.optional(v.number()),
    evidence_id: v.id("evidence_item"),
    raw_source_ref: v.string(),
    corrects_id: v.optional(v.id("balance_observation")),
    recorded_at: v.number(),
  }).index("by_account", ["financial_account_id"]),
  reconciliation: defineTable({
    ...root,
    financial_account_id: v.id("financial_account"),
    statement_id: v.optional(v.id("statement")),
    observation_id: v.optional(v.id("balance_observation")),
    cutoff: v.optional(v.number()),
    observed_minor_units: v.number(),
    ledger_minor_units: v.number(),
    discrepancy_minor_units: v.number(),
    currency: v.string(),
    state: v.union(
      v.literal("provisional"),
      v.literal("unresolved"),
      v.literal("accepted"),
    ),
    revision: v.number(),
    recorded_at: v.number(),
    supersedes_id: v.optional(v.id("reconciliation")),
  }).index("by_account", ["financial_account_id"]),
  reconciliation_match: defineTable({
    user_id: v.string(),
    reconciliation_id: v.id("reconciliation"),
    line_id: v.id("statement_line"),
    posting_id: v.id("posting"),
    minor_units: v.number(),
    reason: v.string(),
    recorded_at: v.number(),
  }).index("by_reconciliation", ["reconciliation_id"]),
};
