import { v } from "convex/values";
import { mutation, query } from "./lib/scoped";
import { owned, requireUser } from "./lib/access";
import { money, add, date, period, instant, nonempty } from "./lib/domain";
import { posted, postingAmount, accountBalance } from "./lib/ledger";
import { moneyValue } from "./schema/shared";
export const createStatement = mutation({
  args: {
    financial_account_id: v.id("financial_account"),
    evidence_id: v.id("evidence_item"),
    period_start: v.string(),
    period_end: v.string(),
    opening: v.optional(moneyValue),
    closing: v.optional(moneyValue),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      account = await owned(
        ctx,
        "financial_account",
        a.financial_account_id,
        u._id,
      );
    await owned(ctx, "evidence_item", a.evidence_id, u._id);
    date(a.period_start);
    date(a.period_end);
    if (a.period_end <= a.period_start)
      throw new Error("Statement period must be half-open and nonempty");
    for (const m of [a.opening, a.closing])
      if (m) {
        money(m.minor_units, m.currency);
        if (m.currency !== account.currency)
          throw new Error("Statement currency mismatch");
      }
    return ctx.db.insert("statement", {
      ...a,
      user_id: u._id,
      created_at: Date.now(),
    });
  },
});
export const addStatementLine = mutation({
  args: {
    statement_id: v.id("statement"),
    external_key: v.string(),
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
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      statement = await owned(ctx, "statement", a.statement_id, u._id),
      account = await owned(
        ctx,
        "financial_account",
        statement.financial_account_id,
        u._id,
      );
    money(a.minor_units, a.currency);
    if (a.currency !== account.currency)
      throw new Error("Source currency mismatch");
    date(a.posting_date);
    nonempty(a.external_key);
    nonempty(a.raw_source_ref);
    const all = await ctx.db
        .query("statement_line")
        .withIndex("by_statement", (q) => q.eq("statement_id", a.statement_id))
        .collect(),
      same = all.filter((x) => x.external_key === a.external_key);
    let revision = 1;
    if (a.supersedes_id) {
      const prev = await owned(ctx, "statement_line", a.supersedes_id, u._id);
      if (
        prev.statement_id !== a.statement_id ||
        prev.external_key !== a.external_key ||
        same.some((x) => x.supersedes_id === prev._id)
      )
        throw new Error("Source revision lineage mismatch");
      revision = prev.revision + 1;
    } else if (same.length)
      throw new Error("Duplicate source key requires correction lineage");
    return ctx.db.insert("statement_line", {
      ...a,
      user_id: u._id,
      revision,
      recorded_at: Date.now(),
      created_at: Date.now(),
    });
  },
});
export const observeBalance = mutation({
  args: {
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
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      account = await owned(
        ctx,
        "financial_account",
        a.financial_account_id,
        u._id,
      );
    money(a.minor_units, a.currency);
    if (a.currency !== account.currency)
      throw new Error("Observation currency mismatch");
    instant(a.source_at);
    if (a.cutoff !== undefined) instant(a.cutoff);
    await owned(ctx, "evidence_item", a.evidence_id, u._id);
    nonempty(a.raw_source_ref);
    if (a.corrects_id) {
      const prev = await owned(
        ctx,
        "balance_observation",
        a.corrects_id,
        u._id,
      );
      if (prev.financial_account_id !== a.financial_account_id)
        throw new Error("Observation correction account mismatch");
    }
    return ctx.db.insert("balance_observation", {
      ...a,
      user_id: u._id,
      recorded_at: Date.now(),
      created_at: Date.now(),
    });
  },
});
export const reconcile = mutation({
  args: {
    financial_account_id: v.id("financial_account"),
    statement_id: v.optional(v.id("statement")),
    observation_id: v.optional(v.id("balance_observation")),
    cutoff: v.optional(v.number()),
    accept: v.optional(v.boolean()),
    supersedes_id: v.optional(v.id("reconciliation")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      account = await owned(
        ctx,
        "financial_account",
        a.financial_account_id,
        u._id,
      ),
      ledger = await owned(
        ctx,
        "ledger_account",
        account.ledger_account_id,
        u._id,
      );
    if (!a.statement_id && !a.observation_id)
      throw new Error("Reconciliation requires observed source");
    const statement = a.statement_id
        ? await owned(ctx, "statement", a.statement_id, u._id)
        : null,
      observation = a.observation_id
        ? await owned(ctx, "balance_observation", a.observation_id, u._id)
        : null;
    if (
      (statement && statement.financial_account_id !== account._id) ||
      (observation && observation.financial_account_id !== account._id)
    )
      throw new Error("Reconciliation source account mismatch");
    const cutoff = a.cutoff ?? observation?.cutoff;
    if (cutoff !== undefined) instant(cutoff);
    if (observation?.cutoff !== undefined && cutoff !== observation.cutoff)
      throw new Error("Observation cutoff mismatch");
    const observed =
      observation?.minor_units ?? statement?.closing?.minor_units;
    if (observed === undefined) throw new Error("No source closing balance");
    const balance = await accountBalance(ctx, ledger, cutoff),
      discrepancy = add(observed, -balance.minor_units);
    const provisional =
      cutoff === undefined ||
      Boolean(
        observation &&
        (observation.pending !== "excluded" || observation.kind !== "current"),
      );
    if (a.accept && (provisional || discrepancy !== 0))
      throw new Error("Unknown coverage or discrepancy cannot be accepted");
    let revision = 1;
    if (a.supersedes_id) {
      const previous = await owned(
        ctx,
        "reconciliation",
        a.supersedes_id,
        u._id,
      );
      if (previous.financial_account_id !== account._id)
        throw new Error("Reconciliation lineage mismatch");
      revision = previous.revision + 1;
    }
    return ctx.db.insert("reconciliation", {
      user_id: u._id,
      financial_account_id: account._id,
      statement_id: a.statement_id,
      observation_id: a.observation_id,
      cutoff,
      observed_minor_units: observed,
      ledger_minor_units: balance.minor_units,
      discrepancy_minor_units: discrepancy,
      currency: account.currency,
      state: provisional ? "provisional" : a.accept ? "accepted" : "unresolved",
      revision,
      recorded_at: Date.now(),
      created_at: Date.now(),
      supersedes_id: a.supersedes_id,
    });
  },
});
export const match = mutation({
  args: {
    reconciliation_id: v.id("reconciliation"),
    line_id: v.id("statement_line"),
    posting_id: v.id("posting"),
    minor_units: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      r = await owned(ctx, "reconciliation", a.reconciliation_id, u._id),
      line = await owned(ctx, "statement_line", a.line_id, u._id),
      account = await owned(
        ctx,
        "financial_account",
        r.financial_account_id,
        u._id,
      ),
      { p, je } = await posted(ctx, a.posting_id, u._id);
    if (r.state === "accepted")
      throw new Error(
        "Accepted reconciliation is immutable; create a revision",
      );
    if (
      !r.statement_id ||
      line.statement_id !== r.statement_id ||
      p.account_id !== account.ledger_account_id ||
      line.currency !== p.currency ||
      p.currency !== r.currency ||
      line.status !== "posted"
    )
      throw new Error("Reconciliation match account/source/currency mismatch");
    const versions = await ctx.db
      .query("statement_line")
      .withIndex("by_statement", (q) => q.eq("statement_id", line.statement_id))
      .collect();
    if (versions.some((x) => x.supersedes_id === line._id))
      throw new Error("Cannot match superseded source line");
    money(a.minor_units, r.currency);
    if (
      !a.minor_units ||
      Math.sign(a.minor_units) !== Math.sign(line.minor_units) ||
      Math.sign(a.minor_units) !== Math.sign(postingAmount(p))
    )
      throw new Error("Match sign mismatch");
    const all = await ctx.db
      .query("reconciliation_match")
      .withIndex("by_reconciliation", (q) => q.eq("reconciliation_id", r._id))
      .collect();
    if (
      add(
        ...all
          .filter((x) => x.line_id === line._id)
          .map((x) => Math.abs(x.minor_units)),
        Math.abs(a.minor_units),
      ) > Math.abs(line.minor_units) ||
      add(
        ...all
          .filter((x) => x.posting_id === p._id)
          .map((x) => Math.abs(x.minor_units)),
        Math.abs(a.minor_units),
      ) > Math.abs(postingAmount(p))
    )
      throw new Error("Match capacity exceeded");
    const event = await owned(ctx, "event", je.event_id, u._id);
    if (r.cutoff !== undefined && event.occurred_at > r.cutoff)
      throw new Error("Posting exceeds cutoff");
    return ctx.db.insert("reconciliation_match", {
      ...a,
      reason: nonempty(a.reason),
      user_id: u._id,
      recorded_at: Date.now(),
    });
  },
});
export const list = query({
  args: { financialAccountId: v.id("financial_account") },
  handler: async (ctx, a) => {
    await owned(
      ctx,
      "financial_account",
      a.financialAccountId,
      (await requireUser(ctx))._id,
    );
    return {
      statements: await ctx.db
        .query("statement")
        .withIndex("by_account", (q) =>
          q.eq("financial_account_id", a.financialAccountId),
        )
        .collect(),
      observations: await ctx.db
        .query("balance_observation")
        .withIndex("by_account", (q) =>
          q.eq("financial_account_id", a.financialAccountId),
        )
        .collect(),
      reconciliations: await ctx.db
        .query("reconciliation")
        .withIndex("by_account", (q) =>
          q.eq("financial_account_id", a.financialAccountId),
        )
        .collect(),
    };
  },
});
