import { outstanding } from "./obligations";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { owned, requireUser, expected } from "./lib/access";
import { nonempty, scale, parseMoney, add, date } from "./lib/domain";
import { accountType } from "./schema/finance";
import {
  chartFor,
  writeJournal,
  postingAmount,
  ownedPosting,
  posted,
  isReversed,
  attribution,
  accountBalance,
} from "./lib/ledger";
const chartArgs = {
  chartId: v.optional(v.id("chart_of_accounts")),
  coaArrangementId: v.optional(v.id("arrangement")),
};
export const listCharts = query({
  args: {},
  handler: async (ctx) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    return u
      ? (
          await ctx.db
            .query("chart_of_accounts")
            .withIndex("by_user", (q) => q.eq("user_id", u._id))
            .collect()
        ).filter((x) => !x.archived)
      : [];
  },
});
export const createChart = mutation({
  args: { name: v.string(), reportingEntityId: v.optional(v.id("entity")) },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    if (a.reportingEntityId)
      await owned(ctx, "entity", a.reportingEntityId, u._id);
    return ctx.db.insert("chart_of_accounts", {
      user_id: u._id,
      name: nonempty(a.name),
      reporting_entity_id: a.reportingEntityId,
      created_at: Date.now(),
    });
  },
});
export const listAccounts = query({
  args: chartArgs,
  handler: async (ctx, a) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    if (!u) return [];
    if (a.chartId) await owned(ctx, "chart_of_accounts", a.chartId, u._id);
    if (a.coaArrangementId)
      await owned(ctx, "arrangement", a.coaArrangementId, u._id);
    return (
      await ctx.db
        .query("ledger_account")
        .withIndex("by_user", (q) => q.eq("user_id", u._id))
        .collect()
    ).filter(
      (x) =>
        !x.archived &&
        (!a.chartId || x.chart_id === a.chartId) &&
        (!a.coaArrangementId || x.coa_arrangement_id === a.coaArrangementId),
    );
  },
});
export const createAccount = mutation({
  args: {
    ...chartArgs,
    name: v.string(),
    type: accountType,
    normal_balance: v.union(v.literal("Debit"), v.literal("Credit")),
    currency: v.string(),
    parent_account_id: v.optional(v.id("ledger_account")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      chart = await chartFor(ctx, u._id, a.chartId, a.coaArrangementId);
    scale(a.currency);
    if (a.parent_account_id) {
      const parent = await owned(
        ctx,
        "ledger_account",
        a.parent_account_id,
        u._id,
      );
      if (parent.chart_id !== chart || parent.currency !== a.currency)
        throw new Error("Parent must belong to same chart and currency");
    }
    return ctx.db.insert("ledger_account", {
      user_id: u._id,
      chart_id: chart,
      coa_arrangement_id: a.coaArrangementId,
      name: nonempty(a.name),
      type: a.type,
      normal_balance: a.normal_balance,
      currency: a.currency,
      parent_account_id: a.parent_account_id,
      created_at: Date.now(),
    });
  },
});
export const updateAccount = mutation({
  args: {
    id: v.id("ledger_account"),
    name: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    parent_account_id: v.optional(v.id("ledger_account")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      old = await owned(ctx, "ledger_account", a.id, u._id);
    if (a.parent_account_id) {
      let cursor: typeof a.parent_account_id | undefined = a.parent_account_id;
      const seen = new Set<string>([a.id]);
      while (cursor) {
        if (seen.has(cursor)) throw new Error("Account parent cycle");
        seen.add(cursor);
        const p: import("./_generated/dataModel").Doc<"ledger_account"> =
          await owned(ctx, "ledger_account", cursor, u._id);
        if (p.chart_id !== old.chart_id || p.currency !== old.currency)
          throw new Error("Parent chart/currency mismatch");
        cursor = p.parent_account_id;
      }
    }
    const { id, ...changes } = a;
    if (changes.name !== undefined) nonempty(changes.name);
    await ctx.db.patch(id, changes);
    return id;
  },
});
export const listJournalEntries = query({
  args: chartArgs,
  handler: async (ctx, a) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    if (!u) return [];
    if (a.chartId) await owned(ctx, "chart_of_accounts", a.chartId, u._id);
    if (a.coaArrangementId)
      await owned(ctx, "arrangement", a.coaArrangementId, u._id);
    return (
      await ctx.db
        .query("journal_entry")
        .withIndex("by_user", (q) => q.eq("user_id", u._id))
        .order("desc")
        .collect()
    ).filter(
      (x) =>
        (!a.chartId || x.chart_id === a.chartId) &&
        (!a.coaArrangementId || x.coa_arrangement_id === a.coaArrangementId),
    );
  },
});
export const getJournalEntry = query({
  args: { jeId: v.id("journal_entry") },
  handler: async (ctx, a) => {
    const journalEntry = await owned(
      ctx,
      "journal_entry",
      a.jeId,
      (await requireUser(ctx))._id,
    );
    const postings = await ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", a.jeId))
      .collect();
    return { journalEntry, postings };
  },
});
export const getPostings = query({
  args: { jeId: v.id("journal_entry") },
  handler: async (ctx, a) => {
    await owned(ctx, "journal_entry", a.jeId, (await requireUser(ctx))._id);
    return ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", a.jeId))
      .collect();
  },
});
export const createJournalEntry = mutation({
  args: {
    ...chartArgs,
    eventId: v.id("event"),
    memo: v.string(),
    accounting_date: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("posted"))),
    corrects_id: v.optional(v.id("journal_entry")),
    evidence_ids: v.optional(v.array(v.id("evidence_item"))),
    postings: v.array(
      v.object({
        accountId: v.id("ledger_account"),
        minor_units: v.optional(v.number()),
        amount: v.optional(v.number()),
        currency: v.string(),
        description: v.string(),
      }),
    ),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      chart = await chartFor(ctx, u._id, a.chartId, a.coaArrangementId);
    const event = await owned(ctx, "event", a.eventId, u._id);
    const postings = a.postings.map((p) => {
      if ((p.minor_units === undefined) === (p.amount === undefined))
        throw new Error("Specify exactly one amount representation");
      return {
        ...p,
        minor_units: p.minor_units ?? parseMoney(String(p.amount), p.currency),
      };
    });
    const result = await writeJournal(ctx, u._id, {
      ...a,
      chartId: chart,
      accounting_date:
        a.accounting_date ??
        new Date(event.occurred_at).toISOString().slice(0, 10),
      postings,
    });
    if (a.coaArrangementId)
      await ctx.db.patch(result.id, { coa_arrangement_id: a.coaArrangementId });
    return result.id;
  },
});
export const postDraft = mutation({
  args: { jeId: v.id("journal_entry") },
  handler: async (ctx, a) => {
    const old = await owned(
      ctx,
      "journal_entry",
      a.jeId,
      (await requireUser(ctx))._id,
    );
    if (old.status !== "draft") throw new Error("Already posted");
    const ps = await ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", a.jeId))
      .collect();
    if (ps.length < 2) throw new Error("Incomplete draft");
    const sums = new Map<string, number>();
    for (const p of ps)
      sums.set(p.currency, add(sums.get(p.currency) ?? 0, postingAmount(p)));
    if ([...sums.values()].some((x) => x !== 0))
      throw new Error("Unbalanced draft");
    await ctx.db.patch(a.jeId, { status: "posted", posted_at: Date.now() });
    return a.jeId;
  },
});
export const getAccountBalance = query({
  args: { accountId: v.id("ledger_account") },
  handler: async (ctx, a) => {
    const account = await owned(
        ctx,
        "ledger_account",
        a.accountId,
        (await requireUser(ctx))._id,
      ),
      result = await accountBalance(ctx, account);
    return {
      accountId: a.accountId,
      ...result,
      balance: result.minor_units / 10 ** scale(result.currency),
    };
  },
});
export const getTrialBalance = query({
  args: chartArgs,
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    let chart = a.chartId;
    if (chart) await owned(ctx, "chart_of_accounts", chart, u._id);
    else if (a.coaArrangementId) {
      await owned(ctx, "arrangement", a.coaArrangementId, u._id);
      chart = (
        await ctx.db
          .query("chart_of_accounts")
          .withIndex("by_legacy", (q) =>
            q.eq("legacy_arrangement_id", a.coaArrangementId),
          )
          .first()
      )?._id;
    }
    if (!chart) throw new Error("Chart required");
    const accounts = await ctx.db
      .query("ledger_account")
      .withIndex("by_chart", (q) => q.eq("chart_id", chart))
      .collect();
    const balances = await Promise.all(
      accounts.map(async (account) => {
        const { minor_units, currency } = await accountBalance(ctx, account);
        return {
          accountId: account._id,
          accountName: account.name,
          accountType: account.type,
          currency,
          minor_units,
          debit: Math.max(minor_units, 0),
          credit: Math.max(-minor_units, 0),
        };
      }),
    );
    const currencies = [...new Set(balances.map((b) => b.currency))];
    const byCurrency = currencies.map((currency) => {
      const group = balances.filter((b) => b.currency === currency),
        totalDebit = add(...group.map((b) => b.debit)),
        totalCredit = add(...group.map((b) => b.credit));
      return {
        currency,
        totalDebit,
        totalCredit,
        isBalanced: totalDebit === totalCredit,
      };
    });
    return {
      balances,
      byCurrency,
      isBalanced: byCurrency.every((c) => c.isBalanced),
    };
  },
});
export const createFinancialAccount = mutation({
  args: {
    arrangement_id: v.id("arrangement"),
    ledger_account_id: v.id("ledger_account"),
    kind: v.string(),
    currency: v.string(),
    institution_entity_id: v.optional(v.id("entity")),
    identifier: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    await owned(ctx, "arrangement", a.arrangement_id, u._id);
    const ledger = await owned(
      ctx,
      "ledger_account",
      a.ledger_account_id,
      u._id,
    );
    if (
      !["Asset", "Liability"].includes(ledger.type) ||
      ledger.currency !== a.currency
    )
      throw new Error(
        "Financial account requires matching balance-sheet ledger",
      );
    if (a.institution_entity_id)
      await owned(ctx, "entity", a.institution_entity_id, u._id);
    if (
      (await ctx.db
        .query("financial_account")
        .withIndex("by_ledger", (q) =>
          q.eq("ledger_account_id", a.ledger_account_id),
        )
        .first()) ||
      (await ctx.db
        .query("financial_account")
        .withIndex("by_arrangement", (q) =>
          q.eq("arrangement_id", a.arrangement_id),
        )
        .first())
    )
      throw new Error("Financial account mapping already exists");
    return ctx.db.insert("financial_account", {
      ...a,
      kind: nonempty(a.kind),
      user_id: u._id,
      created_at: Date.now(),
    });
  },
});
export const listFinancialAccounts = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    return ctx.db
      .query("financial_account")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
  },
});
export const getAttribution = query({
  args: { postingId: v.id("posting") },
  handler: async (ctx, a) => {
    await ownedPosting(ctx, a.postingId, (await requireUser(ctx))._id);
    const sets = await ctx.db
        .query("posting_attribution_set")
        .withIndex("by_posting", (q) => q.eq("posting_id", a.postingId))
        .collect(),
      set = sets.sort((a, b) => b.revision - a.revision)[0];
    if (!set) return null;
    const portions = await ctx.db
      .query("posting_attribution")
      .withIndex("by_set", (q) => q.eq("set_id", set._id))
      .collect();
    return {
      set,
      portions: await Promise.all(
        portions.map(async (x) => ({
          ...x,
          beneficiaries: await ctx.db
            .query("attribution_beneficiary")
            .withIndex("by_attribution", (q) => q.eq("attribution_id", x._id))
            .collect(),
        })),
      ),
    };
  },
});
export const replaceAttribution = mutation({
  args: {
    postingId: v.id("posting"),
    expectedRevision: v.number(),
    reason: v.optional(v.string()),
    portions: v.array(
      v.object({
        minor_units: v.number(),
        subject_entity_id: v.optional(v.id("entity")),
        arrangement_id: v.optional(v.id("arrangement")),
        counterparty_entity_id: v.optional(v.id("entity")),
        unclassified: v.boolean(),
        beneficiaries: v.array(
          v.object({
            entity_id: v.optional(v.id("entity")),
            unassigned: v.boolean(),
            share_bps: v.number(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      { p, je } = await ownedPosting(ctx, a.postingId, u._id);
    expected(p.attribution_revision, a.expectedRevision);
    if (je.reverses_id || (await isReversed(ctx, je._id)))
      throw new Error("Reversed attribution is frozen");
    return attribution(ctx, u._id, p, a.portions, a.reason);
  },
});
export const reverseJournalEntry = mutation({
  args: {
    jeId: v.id("journal_entry"),
    accounting_date: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      original = await owned(ctx, "journal_entry", a.jeId, u._id);
    if (
      original.status !== "posted" ||
      original.reverses_id ||
      (await isReversed(ctx, a.jeId)) ||
      !original.chart_id
    )
      throw new Error("Journal cannot be reversed");
    date(a.accounting_date);
    nonempty(a.reason);
    const ps = await ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", a.jeId))
      .collect();
    const postingIds = new Set(ps.map((p) => p._id));
    const obligations = await ctx.db
      .query("monetary_obligation")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
    const voidIds = [];
    for (const obligation of obligations) {
      const state = await outstanding(ctx, obligation);
      if (
        obligation.recognition_posting_id &&
        postingIds.has(obligation.recognition_posting_id) &&
        obligation.voided_at === undefined
      ) {
        if (
          state.settled_minor_units !== 0 ||
          state.approved_minor_units !== obligation.original_minor_units
        )
          throw new Error(
            "Reverse dependent adjustments/settlements before recognition",
          );
        voidIds.push(obligation._id);
      }
      const adjustmentEffect = add(
        ...state.adjustments
          .filter((x) => x.posting_id && postingIds.has(x.posting_id))
          .map((x) => x.minor_units),
      );
      const settlementEffect = add(
        ...state.settlements
          .filter(
            (x) => postingIds.has(x.capacity_posting_id) && !x.reverses_id,
          )
          .map((x) => x.minor_units),
      );
      if (
        add(
          state.outstanding_minor_units,
          -adjustmentEffect,
          settlementEffect,
        ) < 0
      )
        throw new Error(
          "Reversal would create negative outstanding; reverse dependent settlements first",
        );
    }
    for (const id of voidIds)
      await ctx.db.patch(id, { voided_at: Date.now(), void_reason: a.reason });
    const eventId = await ctx.db.insert("event", {
      user_id: u._id,
      kind: "Adjustment",
      title: a.reason,
      payload_json: "{}",
      occurred_at: Date.parse(a.accounting_date + "T00:00:00Z"),
      recorded_at: Date.now(),
      corrects_id: original.event_id,
    });
    const result = await writeJournal(ctx, u._id, {
      eventId,
      chartId: original.chart_id,
      memo: a.reason,
      accounting_date: a.accounting_date,
      reverses_id: a.jeId,
      evidence_ids: original.evidence_ids,
      postings: ps.map((p) => ({
        accountId: p.account_id,
        minor_units: -postingAmount(p),
        currency: p.currency,
        description: `Reversal: ${p.description}`,
      })),
    });
    for (const [index, p] of ps.entries()) {
      const newId = result.postingIds[index];
      await ctx.db.patch(newId, { reverses_id: p._id });
      const sets = await ctx.db
          .query("posting_attribution_set")
          .withIndex("by_posting", (q) => q.eq("posting_id", p._id))
          .collect(),
        set = sets.sort((a, b) => b.revision - a.revision)[0];
      if (set) {
        const portions = await ctx.db
          .query("posting_attribution")
          .withIndex("by_set", (q) => q.eq("set_id", set._id))
          .collect();
        const reversed = await Promise.all(
          portions.map(async (x) => ({
            minor_units: -x.minor_units,
            subject_entity_id: x.subject_entity_id,
            arrangement_id: x.arrangement_id,
            counterparty_entity_id: x.counterparty_entity_id,
            unclassified: x.unclassified,
            reverses_id: x._id,
            beneficiaries: (
              await ctx.db
                .query("attribution_beneficiary")
                .withIndex("by_attribution", (q) =>
                  q.eq("attribution_id", x._id),
                )
                .collect()
            ).map((b) => ({
              entity_id: b.entity_id,
              unassigned: b.unassigned,
              share_bps: b.share_bps,
            })),
          })),
        );
        await attribution(
          ctx,
          u._id,
          (await ctx.db.get(newId))!,
          reversed,
          a.reason,
        );
      }
      const settlements = await ctx.db
        .query("obligation_settlement")
        .withIndex("by_capacity", (q) => q.eq("capacity_posting_id", p._id))
        .collect();
      for (const s of settlements) {
        if (s.reverses_id) continue;
        await ctx.db.insert("obligation_settlement", {
          user_id: u._id,
          obligation_id: s.obligation_id,
          journal_entry_id: result.id,
          capacity_posting_id: newId,
          minor_units: s.minor_units,
          currency: s.currency,
          settlement_date: a.accounting_date,
          reverses_id: s._id,
          created_at: Date.now(),
        });
      }
      const adjustments = (
        await ctx.db.query("obligation_adjustment").collect()
      ).filter((x) => x.posting_id === p._id && !x.reverses_id);
      for (const x of adjustments)
        await ctx.db.insert("obligation_adjustment", {
          user_id: u._id,
          obligation_id: x.obligation_id,
          minor_units: -x.minor_units,
          currency: x.currency,
          effective_date: a.accounting_date,
          reason: a.reason,
          posting_id: newId,
          reverses_id: x._id,
          created_at: Date.now(),
        });
    }
    return result.id;
  },
});
export const updateChart = mutation({
  args: {
    id: v.id("chart_of_accounts"),
    name: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    await owned(ctx, "chart_of_accounts", a.id, (await requireUser(ctx))._id);
    const { id, ...changes } = a;
    if (changes.name !== undefined) nonempty(changes.name);
    await ctx.db.patch(id, changes);
    return id;
  },
});
