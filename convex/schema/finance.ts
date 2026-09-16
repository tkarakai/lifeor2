import { defineTable } from "convex/server";
import { v } from "convex/values";

// Finance schema: Double-entry accounting tables

export const financeSchema = {
  // LedgerAccount: Accounts in the chart of accounts
  ledger_account: defineTable({
    coa_arrangement_id: v.id("arrangement"), // Links to ChartOfAccounts arrangement
    name: v.string(), // e.g., "Cash", "Accounts Payable", "Revenue"
    type: v.union(
      v.literal("Asset"),
      v.literal("Liability"),
      v.literal("Equity"),
      v.literal("Income"),
      v.literal("Expense")
    ),
    normal_balance: v.union(v.literal("Debit"), v.literal("Credit")),
    currency: v.string(), // e.g., "USD", "EUR"
    parent_account_id: v.optional(v.id("ledger_account")), // For hierarchical accounts
    user_id: v.string() // Better Auth component ID; not an app-table ID,
  })
    .index("by_coa", ["coa_arrangement_id"])
    .index("by_user", ["user_id"]),

  // JournalEntry: A collection of balanced postings
  journal_entry: defineTable({
    event_id: v.id("event"), // Links to the event that caused this entry
    coa_arrangement_id: v.id("arrangement"), // Which chart of accounts
    memo: v.string(), // Description of the transaction
    status: v.union(v.literal("draft"), v.literal("posted")),
    source_ref: v.optional(v.string()), // External reference (e.g., invoice number)
    posted_at: v.optional(v.number()), // When it was posted (different from event.occurred_at)
    user_id: v.string() // Better Auth component ID; not an app-table ID,
  })
    .index("by_event", ["event_id"])
    .index("by_coa", ["coa_arrangement_id"])
    .index("by_user", ["user_id"]),

  // Posting: Individual debit/credit line in a journal entry
  posting: defineTable({
    je_id: v.id("journal_entry"),
    account_id: v.id("ledger_account"),
    amount: v.number(), // Signed amount: positive = debit, negative = credit
    currency: v.string(),
    description: v.string(),
  })
    .index("by_je", ["je_id"])
    .index("by_account", ["account_id"]),
};
