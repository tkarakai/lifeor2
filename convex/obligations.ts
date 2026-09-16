import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { owned, requireUser, evidence, expected } from "./lib/access";
import {
  money,
  add,
  date,
  period,
  timezone,
  nonempty,
  integer,
  overlayTimeline,
  selectRevision,
} from "./lib/domain";
import { posted, postingAmount, isReversed, writeJournal } from "./lib/ledger";
import { moneyValue } from "./schema/shared";
import { recurrence } from "./schema/planning";
export async function outstanding(
  ctx: QueryCtx,
  o: Doc<"monetary_obligation">,
) {
  const adjustments = await ctx.db
    .query("obligation_adjustment")
    .withIndex("by_obligation", (q) => q.eq("obligation_id", o._id))
    .collect();
  const settlements = await ctx.db
    .query("obligation_settlement")
    .withIndex("by_obligation", (q) => q.eq("obligation_id", o._id))
    .collect();
  const adjusted = add(
    o.original_minor_units,
    ...adjustments.map((x) => x.minor_units),
  );
  const settled = add(
    ...settlements.map((x) => (x.reverses_id ? -x.minor_units : x.minor_units)),
  );
  return {
    outstanding_minor_units:
      o.voided_at === undefined ? add(adjusted, -settled) : 0,
    approved_minor_units: adjusted,
    settled_minor_units: settled,
    adjustments,
    settlements,
  };
}
const scheduleFields = {
  creditor_id: v.id("entity"),
  debtor_id: v.id("entity"),
  amount: v.optional(moneyValue),
  variable_rule: v.optional(
    v.union(v.literal("manual_amount"), v.literal("metered_quantity")),
  ),
  currency: v.string(),
  recurrence,
  start_date: v.string(),
  end_date: v.optional(v.string()),
  timezone: v.string(),
  valid_from: v.number(),
  valid_to: v.optional(v.number()),
  evidence_ids: v.optional(v.array(v.id("evidence_item"))),
};
export async function validateSchedule(
  ctx: QueryCtx,
  user: string,
  a: {
    creditor_id: Doc<"entity">["_id"];
    debtor_id: Doc<"entity">["_id"];
    amount?: { minor_units: number; currency: string };
    variable_rule?: string;
    currency: string;
    recurrence: { frequency: string; interval: number; day_of_month?: number };
    start_date: string;
    end_date?: string;
    timezone: string;
    valid_from: number;
    valid_to?: number;
    evidence_ids?: Doc<"evidence_item">["_id"][];
  },
) {
  await owned(ctx, "entity", a.creditor_id, user);
  await owned(ctx, "entity", a.debtor_id, user);
  if (a.creditor_id === a.debtor_id)
    throw new Error("Creditor and debtor must differ");
  await evidence(ctx, a.evidence_ids, user);
  date(a.start_date);
  if (a.end_date) {
    date(a.end_date);
    if (a.end_date <= a.start_date)
      throw new Error("Schedule end must follow start");
  }
  period(a.valid_from, a.valid_to);
  timezone(a.timezone);
  if (Boolean(a.amount) === Boolean(a.variable_rule))
    throw new Error("Choose fixed amount or explicit variable rule");
  if (
    a.amount &&
    (money(a.amount.minor_units, a.amount.currency) <= 0 ||
      a.amount.currency !== a.currency)
  )
    throw new Error("Invalid schedule amount/currency");
  money(0, a.currency);
  if (
    integer(a.recurrence.interval) < 1 ||
    (a.recurrence.day_of_month !== undefined &&
      (!Number.isInteger(a.recurrence.day_of_month) ||
        a.recurrence.day_of_month < 1 ||
        a.recurrence.day_of_month > 31))
  )
    throw new Error("Invalid recurrence");
}
export const createSchedule = mutation({
  args: {
    arrangement_id: v.id("arrangement"),
    name: v.string(),
    ...scheduleFields,
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    await owned(ctx, "arrangement", a.arrangement_id, u._id);
    await validateSchedule(ctx, u._id, a);
    const id = await ctx.db.insert("commitment_schedule", {
      user_id: u._id,
      arrangement_id: a.arrangement_id,
      name: nonempty(a.name),
      revision: 1,
      created_at: Date.now(),
    });
    const { arrangement_id, name, ...facts } = a;
    const version = await ctx.db.insert("commitment_schedule_version", {
      ...facts,
      user_id: u._id,
      schedule_id: id,
      revision: 1,
      recorded_at: Date.now(),
      actor: u._id,
    });
    await ctx.db.insert("commitment_schedule_revision", {
      user_id: u._id,
      schedule_id: id,
      revision: 1,
      recorded_at: Date.now(),
      actor: u._id,
      segments: [
        {
          valid_from: a.valid_from,
          valid_to: a.valid_to,
          facts: { version_id: version },
        },
      ],
    });
    return id;
  },
});
export const reviseSchedule = mutation({
  args: {
    id: v.id("commitment_schedule"),
    expectedRevision: v.number(),
    reason: v.string(),
    ...scheduleFields,
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      old = await owned(ctx, "commitment_schedule", a.id, u._id);
    expected(old.revision, a.expectedRevision);
    await validateSchedule(ctx, u._id, a);
    const { id, expectedRevision, ...facts } = a;
    const version = await ctx.db.insert("commitment_schedule_version", {
      ...facts,
      user_id: u._id,
      schedule_id: id,
      revision: old.revision + 1,
      recorded_at: Date.now(),
      actor: u._id,
    });
    const previous = (
      await ctx.db
        .query("commitment_schedule_revision")
        .withIndex("by_schedule", (q) => q.eq("schedule_id", id))
        .collect()
    ).sort((x, y) => y.revision - x.revision)[0];
    const segments = overlayTimeline(
      previous?.segments ?? [],
      a.valid_from,
      a.valid_to,
      { version_id: version },
    );
    await ctx.db.insert("commitment_schedule_revision", {
      user_id: u._id,
      schedule_id: id,
      revision: old.revision + 1,
      recorded_at: Date.now(),
      actor: u._id,
      reason: a.reason,
      segments,
    });
    await ctx.db.patch(id, { revision: old.revision + 1 });
    return version;
  },
});
export const listSchedules = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    const roots = await ctx.db
      .query("commitment_schedule")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
    return Promise.all(
      roots.map(async (r) => ({
        ...r,
        versions: await ctx.db
          .query("commitment_schedule_version")
          .withIndex("by_schedule", (q) => q.eq("schedule_id", r._id))
          .collect(),
      })),
    );
  },
});
export const create = mutation({
  args: {
    creditor_id: v.id("entity"),
    debtor_id: v.id("entity"),
    due_date: v.string(),
    minor_units: v.number(),
    currency: v.string(),
    arrangement_id: v.optional(v.id("arrangement")),
    event_id: v.optional(v.id("event")),
    evidence_ids: v.optional(v.array(v.id("evidence_item"))),
    schedule_version_id: v.optional(v.id("commitment_schedule_version")),
    occurrence_key: v.optional(v.string()),
    recognition_posting_id: v.optional(v.id("posting")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    if (money(a.minor_units, a.currency) <= 0)
      throw new Error("Obligation amount must be positive");
    date(a.due_date);
    await owned(ctx, "entity", a.creditor_id, u._id);
    await owned(ctx, "entity", a.debtor_id, u._id);
    if (a.creditor_id === a.debtor_id)
      throw new Error("Creditor and debtor must differ");
    if (a.arrangement_id)
      await owned(ctx, "arrangement", a.arrangement_id, u._id);
    if (a.event_id) await owned(ctx, "event", a.event_id, u._id);
    await evidence(ctx, a.evidence_ids, u._id);
    if (a.schedule_version_id) {
      const version = await owned(
        ctx,
        "commitment_schedule_version",
        a.schedule_version_id,
        u._id,
      );
      if (
        version.currency !== a.currency ||
        version.creditor_id !== a.creditor_id ||
        version.debtor_id !== a.debtor_id
      )
        throw new Error("Schedule occurrence parties/currency mismatch");
      if (!a.occurrence_key?.startsWith(`${version._id}:`))
        throw new Error("Occurrence key must be version ID plus period");
      const occurrencePeriod = a.occurrence_key.slice(version._id.length + 1);
      if (
        !/^(?:\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(occurrencePeriod) ||
        !a.due_date.startsWith(occurrencePeriod)
      )
        throw new Error(
          "Occurrence period must identify its due-date calendar period",
        );
    } else if (a.occurrence_key)
      throw new Error("Occurrence requires schedule version");
    if (a.occurrence_key) {
      const existing = await ctx.db
        .query("monetary_obligation")
        .withIndex("by_occurrence", (q) =>
          q.eq("occurrence_key", a.occurrence_key),
        )
        .first();
      if (existing) throw new Error("Occurrence already incurred");
    }
    if (a.recognition_posting_id) {
      const { p, je } = await posted(ctx, a.recognition_posting_id, u._id),
        account = await owned(ctx, "ledger_account", p.account_id, u._id);
      if (
        (await isReversed(ctx, je._id)) ||
        p.currency !== a.currency ||
        !["Asset", "Liability"].includes(account.type) ||
        postingAmount(p) !==
          (account.type === "Asset" ? a.minor_units : -a.minor_units)
      )
        throw new Error("Recognition amount/account mismatch");
      if (
        (await ctx.db.query("monetary_obligation").collect()).some(
          (o) => o.recognition_posting_id === p._id,
        )
      )
        throw new Error("Recognition posting already allocated");
    }
    const { minor_units, ...facts } = a;
    return ctx.db.insert("monetary_obligation", {
      ...facts,
      original_minor_units: minor_units,
      user_id: u._id,
      created_at: Date.now(),
    });
  },
});
export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    const all = await ctx.db
      .query("monetary_obligation")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
    return Promise.all(
      all.map(async (o) => ({ ...o, ...(await outstanding(ctx, o)) })),
    );
  },
});
export const settle = mutation({
  args: {
    obligationId: v.id("monetary_obligation"),
    capacityPostingId: v.id("posting"),
    minor_units: v.number(),
    settlement_date: v.string(),
    recognitionPostingId: v.optional(v.id("posting")),
    evidence_ids: v.optional(v.array(v.id("evidence_item"))),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      o = await owned(ctx, "monetary_obligation", a.obligationId, u._id);
    if (o.voided_at !== undefined) throw new Error("Obligation void");
    if (money(a.minor_units, o.currency) <= 0)
      throw new Error("Settlement must be positive");
    date(a.settlement_date);
    await evidence(ctx, a.evidence_ids, u._id);
    const { p, je } = await posted(ctx, a.capacityPostingId, u._id);
    if (
      p.currency !== o.currency ||
      je.reverses_id ||
      (await isReversed(ctx, je._id))
    )
      throw new Error("Invalid payment posting");
    const mapping = await ctx.db
      .query("financial_account")
      .withIndex("by_ledger", (q) => q.eq("ledger_account_id", p.account_id))
      .first();
    if (!mapping)
      throw new Error(
        "Payment capacity must be a designated financial-account posting",
      );
    const all = await ctx.db.query("obligation_settlement").collect();
    if (
      all.some(
        (s) =>
          s.journal_entry_id === je._id &&
          !s.reverses_id &&
          s.capacity_posting_id !== p._id,
      )
    )
      throw new Error("Journal has a different canonical capacity posting");
    const used = add(
      ...all
        .filter(
          (s) =>
            s.capacity_posting_id === p._id &&
            !s.reverses_id &&
            !all.some((r) => r.reverses_id === s._id),
        )
        .map((s) => s.minor_units),
    );
    const fulfilled = await ctx.db
      .query("expected_flow_fulfillment")
      .withIndex("by_posting", (q) => q.eq("posting_id", p._id))
      .collect();
    // A canonical payment portion cannot fulfill an unrelated prediction and a claim twice.
    const forecastUsed = add(...fulfilled.map((x) => x.minor_units));
    if (add(used, forecastUsed, a.minor_units) > Math.abs(postingAmount(p)))
      throw new Error("Payment capacity exceeded");
    if ((await outstanding(ctx, o)).outstanding_minor_units < a.minor_units)
      throw new Error("Settlement exceeds outstanding");
    if (o.recognition_posting_id) {
      if (!a.recognitionPostingId || a.recognitionPostingId === p._id)
        throw new Error("Recognized obligation requires separate counterpart");
      const original = (await posted(ctx, o.recognition_posting_id, u._id)).p;
      const counterpart = (await posted(ctx, a.recognitionPostingId, u._id)).p;
      if (
        counterpart.je_id !== je._id ||
        counterpart.account_id !== original.account_id ||
        Math.sign(postingAmount(counterpart)) ===
          Math.sign(postingAmount(original))
      )
        throw new Error("Recognition counterpart mismatch");
      const consumed = add(
        ...all
          .filter(
            (s) =>
              s.recognition_posting_id === counterpart._id &&
              !s.reverses_id &&
              !all.some((r) => r.reverses_id === s._id),
          )
          .map((s) => s.minor_units),
      );
      if (add(consumed, a.minor_units) > Math.abs(postingAmount(counterpart)))
        throw new Error("Recognition counterpart capacity exceeded");
    } else if (a.recognitionPostingId)
      throw new Error("Unexpected recognition counterpart");
    return ctx.db.insert("obligation_settlement", {
      user_id: u._id,
      obligation_id: o._id,
      journal_entry_id: je._id,
      capacity_posting_id: p._id,
      recognition_posting_id: a.recognitionPostingId,
      minor_units: a.minor_units,
      currency: o.currency,
      settlement_date: a.settlement_date,
      evidence_ids: a.evidence_ids,
      created_at: Date.now(),
    });
  },
});
const journalInput = v.object({
  eventId: v.id("event"),
  chartId: v.id("chart_of_accounts"),
  memo: v.string(),
  accounting_date: v.string(),
  postings: v.array(
    v.object({
      accountId: v.id("ledger_account"),
      minor_units: v.number(),
      currency: v.string(),
      description: v.string(),
    }),
  ),
});
export const adjust = mutation({
  args: {
    obligationId: v.id("monetary_obligation"),
    minor_units: v.number(),
    effective_date: v.string(),
    reason: v.string(),
    evidence_ids: v.optional(v.array(v.id("evidence_item"))),
    journal: v.optional(journalInput),
    recognitionAccountId: v.optional(v.id("ledger_account")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      o = await owned(ctx, "monetary_obligation", a.obligationId, u._id);
    if (o.voided_at !== undefined) throw new Error("Obligation void");
    money(a.minor_units, o.currency);
    if (!a.minor_units) throw new Error("Adjustment must be nonzero");
    date(a.effective_date);
    nonempty(a.reason);
    await evidence(ctx, a.evidence_ids, u._id);
    if (
      add((await outstanding(ctx, o)).outstanding_minor_units, a.minor_units) <
      0
    )
      throw new Error("Adjustment creates negative outstanding");
    let postingId;
    if (o.recognition_posting_id) {
      const original = (await posted(ctx, o.recognition_posting_id, u._id)).p;
      if (!a.journal || a.recognitionAccountId !== original.account_id)
        throw new Error(
          "Recognized adjustment requires atomic journal effects",
        );
      const matching = a.journal.postings.filter(
        (p) => p.accountId === original.account_id,
      );
      if (
        matching.length !== 1 ||
        matching[0].currency !== o.currency ||
        matching[0].minor_units !==
          a.minor_units * Math.sign(postingAmount(original))
      )
        throw new Error("Adjustment recognition effects mismatch");
      const result = await writeJournal(ctx, u._id, a.journal);
      postingId =
        result.postingIds[
          a.journal.postings.findIndex(
            (p) => p.accountId === original.account_id,
          )
        ];
    } else if (a.journal || a.recognitionAccountId)
      throw new Error("Unrecognized obligation cannot imply recognition");
    return ctx.db.insert("obligation_adjustment", {
      user_id: u._id,
      obligation_id: o._id,
      minor_units: a.minor_units,
      currency: o.currency,
      effective_date: a.effective_date,
      reason: a.reason,
      evidence_ids: a.evidence_ids,
      posting_id: postingId,
      created_at: Date.now(),
    });
  },
});
export const voidObligation = mutation({
  args: { id: v.id("monetary_obligation"), reason: v.string() },
  handler: async (ctx, a) => {
    const o = await owned(
      ctx,
      "monetary_obligation",
      a.id,
      (await requireUser(ctx))._id,
    );
    if (
      o.recognition_posting_id ||
      (await outstanding(ctx, o)).settled_minor_units !== 0
    )
      throw new Error(
        "Recognized or settled obligation requires explicit financial correction",
      );
    await ctx.db.patch(a.id, {
      voided_at: Date.now(),
      void_reason: nonempty(a.reason),
    });
  },
});
export const scheduleAt = query({
  args: {
    id: v.id("commitment_schedule"),
    effectiveAt: v.number(),
    knownAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    await owned(ctx, "commitment_schedule", a.id, u._id);
    const revisions = await ctx.db
      .query("commitment_schedule_revision")
      .withIndex("by_schedule", (q) => q.eq("schedule_id", a.id))
      .collect();
    const selected = selectRevision(
      revisions,
      a.effectiveAt,
      a.knownAt ?? Date.now(),
    );
    return selected
      ? owned(
          ctx,
          "commitment_schedule_version",
          (
            selected.facts as {
              version_id: import("./_generated/dataModel").Id<"commitment_schedule_version">;
            }
          ).version_id,
          u._id,
        )
      : null;
  },
});
