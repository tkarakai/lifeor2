import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// ============ LEDGER ACCOUNTS ============

export const listAccounts = query({
  args: { coaArrangementId: v.optional(v.id("arrangement")) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    if (args.coaArrangementId) {
      return await ctx.db
        .query("ledger_account")
        .withIndex("by_coa", (q) => q.eq("coa_arrangement_id", args.coaArrangementId!))
        .collect();
    }

    return await ctx.db
      .query("ledger_account")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
  },
});

export const createAccount = mutation({
  args: {
    coaArrangementId: v.id("arrangement"),
    name: v.string(),
    type: v.union(
      v.literal("Asset"),
      v.literal("Liability"),
      v.literal("Equity"),
      v.literal("Income"),
      v.literal("Expense")
    ),
    normal_balance: v.union(v.literal("Debit"), v.literal("Credit")),
    currency: v.string(),
    parent_account_id: v.optional(v.id("ledger_account")),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const accountId = await ctx.db.insert("ledger_account", {
      coa_arrangement_id: args.coaArrangementId,
      name: args.name,
      type: args.type,
      normal_balance: args.normal_balance,
      currency: args.currency,
      parent_account_id: args.parent_account_id,
      user_id: user._id,
    });

    return accountId;
  },
});

// ============ JOURNAL ENTRIES ============

export const listJournalEntries = query({
  args: { coaArrangementId: v.optional(v.id("arrangement")) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    if (args.coaArrangementId) {
      return await ctx.db
        .query("journal_entry")
        .withIndex("by_coa", (q) => q.eq("coa_arrangement_id", args.coaArrangementId!))
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("journal_entry")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .order("desc")
      .collect();
  },
});

export const getJournalEntry = query({
  args: { jeId: v.id("journal_entry") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const je = await ctx.db.get(args.jeId);
    if (!je) {
      return null;
    }

    const postings = await ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", args.jeId))
      .collect();

    return { journalEntry: je, postings };
  },
});

export const getPostings = query({
  args: { jeId: v.id("journal_entry") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", args.jeId))
      .collect();
  },
});

// ============ CREATE JOURNAL ENTRY WITH VALIDATION ============

export const createJournalEntry = mutation({
  args: {
    eventId: v.id("event"),
    coaArrangementId: v.id("arrangement"),
    memo: v.string(),
    postings: v.array(
      v.object({
        accountId: v.id("ledger_account"),
        amount: v.number(),
        currency: v.string(),
        description: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    // CRITICAL: Validate double-entry accounting
    // For each currency, the sum of amounts must equal 0
    const byCurrency = new Map<string, number>();
    for (const posting of args.postings) {
      const sum = byCurrency.get(posting.currency) || 0;
      byCurrency.set(posting.currency, sum + posting.amount);
    }

    for (const [currency, sum] of byCurrency) {
      // Allow small floating point errors (0.001)
      if (Math.abs(sum) > 0.001) {
        throw new Error(
          `Double-entry violation: ${currency} sum = ${sum.toFixed(2)}. ` +
            `Debits must equal credits for each currency.`
        );
      }
    }

    // Validate that at least 2 postings exist
    if (args.postings.length < 2) {
      throw new Error("Journal entry must have at least 2 postings");
    }

    // Create journal entry
    const jeId = await ctx.db.insert("journal_entry", {
      event_id: args.eventId,
      coa_arrangement_id: args.coaArrangementId,
      memo: args.memo,
      status: "posted",
      posted_at: Date.now(),
      user_id: user._id,
    });

    // Create postings
    for (const posting of args.postings) {
      await ctx.db.insert("posting", {
        je_id: jeId,
        account_id: posting.accountId,
        amount: posting.amount,
        currency: posting.currency,
        description: posting.description,
      });
    }

    return jeId;
  },
});

// ============ ACCOUNT BALANCE ============

export const getAccountBalance = query({
  args: { accountId: v.id("ledger_account") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const postings = await ctx.db
      .query("posting")
      .withIndex("by_account", (q) => q.eq("account_id", args.accountId))
      .collect();

    // Sum all postings for this account
    const balance = postings.reduce((sum, posting) => sum + posting.amount, 0);

    return {
      accountId: args.accountId,
      balance,
      postingCount: postings.length,
    };
  },
});

// ============ TRIAL BALANCE ============

export const getTrialBalance = query({
  args: { coaArrangementId: v.id("arrangement") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const accounts = await ctx.db
      .query("ledger_account")
      .withIndex("by_coa", (q) => q.eq("coa_arrangement_id", args.coaArrangementId))
      .collect();

    const balances = await Promise.all(
      accounts.map(async (account) => {
        const postings = await ctx.db
          .query("posting")
          .withIndex("by_account", (q) => q.eq("account_id", account._id))
          .collect();

        const balance = postings.reduce((sum, p) => sum + p.amount, 0);

        return {
          accountId: account._id,
          accountName: account.name,
          accountType: account.type,
          balance,
          debit: balance > 0 ? balance : 0,
          credit: balance < 0 ? -balance : 0,
        };
      })
    );

    // Calculate totals
    const totalDebit = balances.reduce((sum, b) => sum + b.debit, 0);
    const totalCredit = balances.reduce((sum, b) => sum + b.credit, 0);

    return {
      balances,
      totalDebit,
      totalCredit,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
    };
  },
});
