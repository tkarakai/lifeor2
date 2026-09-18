import { v } from "convex/values";
import { mutation } from "./lib/scoped";
import { workspace } from "./lib/lifeQueries/common";
import { AmbiguousLocalTimeError, clockFacts, localInstant } from "./lib/lifeQueries/time";
import { owned, ownedTarget, expected, requireUser } from "./lib/access";

import { nonempty, parseMoney, overlayTimeline } from "./lib/domain";
import { validateSchedule } from "./obligations";
import { writeJournal, attribution } from "./lib/ledger";
export const recordEvent = mutation({
  agent: { operation: "records.recordEvent", scope: "data:write" },
  args: {
    title: v.string(),
    kind: v.string(),
    date: v.string(),
    time: v.string(),
    timezone: v.optional(v.string()),
    utcOffsetMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    subjects: v.optional(
      v.array(
        v.object({
          kind: v.union(
            v.literal("entity"),
            v.literal("arrangement"),
            v.literal("tag"),
          ),
          id: v.string(),
        }),
      ),
    ),
    correctsId: v.optional(v.id("event")),
  },
  handler: async (ctx, a) => {
    const w = await workspace(ctx);
    if (!a.timezone && !w.timezoneConfigured)
      throw new Error(
        "Specify an IANA timezone for this appointment; this dataset has no configured timezone.",
      );
    const timezone = a.timezone ?? w.timezone;
    let occurred_at: number;
    try { occurred_at = localInstant(a.date, a.time, timezone, a.utcOffsetMinutes); }
    catch (error) { if (error instanceof AmbiguousLocalTimeError) return error.clarification; throw error; }
    if (a.subjects && a.subjects.length > 20)
      throw new Error("Limit events to 20 linked subjects");
    const subjects = (a.subjects ?? []).map((ref) => {
      const id = ctx.db.normalizeId(ref.kind, ref.id);
      if (!id) throw new Error("Invalid linked subject ID");
      return { kind: ref.kind, id } as import("./lib/access").Target;
    });
    const subjectNames = await Promise.all(subjects.map(async (ref) => {
      const record = await ownedTarget(ctx, ref, w.user._id);
      return "display_name" in record ? String(record.display_name) : "name" in record ? String(record.name) : String(ref.id);
    }));
    if (a.correctsId) {
      if (
        await ctx.db
          .query("event")
          .withIndex("by_corrects", (q) => q.eq("corrects_id", a.correctsId))
          .first()
      )
        throw new Error("Read the newer correction first");
      await owned(ctx, "event", a.correctsId, w.user._id);
      const journals = await ctx.db
        .query("journal_entry")
        .withIndex("by_event", (q) => q.eq("event_id", a.correctsId!))
        .take(1);
      if (journals.length)
        throw new Error(
          "Correct financial events through journal reversal, not this tool",
        );
    }
    const id = await ctx.db.insert("event", {
      user_id: w.user._id,
      created_at: Date.now(),
      recorded_at: Date.now(),
      title: nonempty(a.title),
      kind: nonempty(a.kind),
      occurred_at,
      corrects_id: a.correctsId,
      payload_json: JSON.stringify({
        notes: a.notes ?? "",
        timezone,
        localDate: a.date,
        localTime: a.time,
      }),
    });
    for (const ref of subjects)
      await ctx.db.insert("event_affects", {
        event_id: id,
        target: ref,
        target_type: ref.kind,
        target_id: ref.id,
      });
    return {
      id,
      title: a.title,
      date: a.date,
      time: a.time,
      timezone,
      occurredAt: new Date(occurred_at).toISOString(),
      ...clockFacts(occurred_at, timezone),
      correctsId: a.correctsId ?? null,
      subjects,
      subjectNames,
      status: "recorded",
    };
  },
});
export const changeSchedule = mutation({
  agent: {
    operation: "records.changeSchedule",
    scope: "finance:write",
    revision: true,
  },
  args: {
    id: v.id("commitment_schedule"),
    expectedRevision: v.number(),
    effectiveDate: v.string(),
    amount: v.optional(v.string()),
    dayOfMonth: v.optional(v.number()),
    endDate: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx),
      root = await owned(ctx, "commitment_schedule", a.id, user._id);
    expected(root.revision, a.expectedRevision);
    if (root.archived) throw new Error("Schedule is archived");
    const revisions = await ctx.db
      .query("commitment_schedule_revision")
      .withIndex("by_schedule", (q) => q.eq("schedule_id", a.id))
      .take(201);
    if (revisions.length > 200)
      throw new Error("Use schedule history for this large revision timeline");
    const previous = revisions.sort((a, b) => b.revision - a.revision)[0];
    if (!previous)
      throw new Error("Read and repair the missing schedule timeline first");
    let selected: (typeof previous.segments)[number] | undefined,
      version:
        | Awaited<ReturnType<typeof ctx.db.get<"commitment_schedule_version">>>
        | undefined,
      at = 0;
    for (const segment of previous.segments) {
      const candidate = await ctx.db.get(segment.facts.version_id);
      if (!candidate) continue;
      const instant = localInstant(
        a.effectiveDate,
        "00:00",
        candidate.timezone,
      );
      if (
        segment.valid_from <= instant &&
        (segment.valid_to === undefined || instant < segment.valid_to)
      ) {
        selected = segment;
        version = candidate;
        at = instant;
        break;
      }
    }
    if (!selected || !version)
      throw new Error(
        "Effective date is outside the recorded schedule timeline",
      );
    if (
      a.amount === undefined &&
      a.dayOfMonth === undefined &&
      a.endDate === undefined
    )
      throw new Error("Specify a requested amount, day or end date");
    const amount =
      a.amount === undefined
        ? version.amount
        : {
            minor_units: parseMoney(a.amount, version.currency),
            currency: version.currency,
          };
    const facts = {
      creditor_id: version.creditor_id,
      debtor_id: version.debtor_id,
      amount,
      variable_rule: amount ? undefined : version.variable_rule,
      currency: version.currency,
      recurrence: {
        ...version.recurrence,
        ...(a.dayOfMonth === undefined ? {} : { day_of_month: a.dayOfMonth }),
      },
      start_date: version.start_date,
      end_date: a.endDate ?? version.end_date,
      timezone: version.timezone,
      valid_from: at,
      valid_to: selected.valid_to,
    };
    await validateSchedule(ctx, user._id, facts);
    const revision = root.revision + 1,
      versionId = await ctx.db.insert("commitment_schedule_version", {
        ...facts,
        user_id: user._id,
        schedule_id: a.id,
        revision,
        recorded_at: Date.now(),
        actor: user._id,
        reason: nonempty(a.reason),
      });
    await ctx.db.insert("commitment_schedule_revision", {
      user_id: user._id,
      schedule_id: a.id,
      revision,
      recorded_at: Date.now(),
      actor: user._id,
      reason: a.reason,
      segments: overlayTimeline(previous.segments, at, selected.valid_to, {
        version_id: versionId,
      }),
    });
    await ctx.db.patch(root._id, { revision });
    return {
      id: root._id,
      versionId,
      revision,
      effectiveDate: a.effectiveDate,
      amount,
      recurrence: facts.recurrence,
      endDate: facts.end_date ?? null,
      basis:
        "Updated this effective segment; later scheduled changes are preserved. Existing debts, posted payments and separately configured cash-routing amounts were not changed.",
    };
  },
});
export const recordExpense = mutation({
  agent: { operation: "records.recordExpense", scope: "finance:write" },
  args: {
    date: v.string(),
    amount: v.string(),
    currency: v.string(),
    paidFromAccountId: v.id("ledger_account"),
    expenseAccountId: v.id("ledger_account"),
    memo: v.string(),
    subjectId: v.optional(v.id("entity")),
  },
  handler: async (ctx, a) => {
    const w = await workspace(ctx),
      cash = await owned(
        ctx,
        "ledger_account",
        a.paidFromAccountId,
        w.user._id,
      ),
      expense = await owned(
        ctx,
        "ledger_account",
        a.expenseAccountId,
        w.user._id,
      ),
      amount = parseMoney(a.amount, a.currency);
    const financialAccount = await ctx.db.query("financial_account")
      .withIndex("by_ledger", q => q.eq("ledger_account_id", cash._id)).unique();
    const creditCard = cash.type === "Liability" && !financialAccount?.archived && financialAccount?.kind.toLowerCase().replace(/[\s-]+/g, "_") === "credit_card";
    if (
      amount <= 0 ||
      expense.type !== "Expense" ||
      (cash.type !== "Asset" && !creditCard) ||
      cash.chart_id !== expense.chart_id ||
      !cash.chart_id
    )
      throw new Error(
        "Use a positive amount, an expense account and an asset payment account or designated credit card in the same chart",
      );
    if (a.subjectId) await owned(ctx, "entity", a.subjectId, w.user._id);
    const eventId = await ctx.db.insert("event", {
      user_id: w.user._id,
      created_at: Date.now(),
      recorded_at: Date.now(),
      title: nonempty(a.memo),
      kind: "Purchase",
      occurred_at: localInstant(a.date, "12:00", w.timezone),
      payload_json: JSON.stringify({ datePrecision: "day" }),
    });
    const result = await writeJournal(ctx, w.user._id, {
      eventId,
      chartId: cash.chart_id,
      memo: a.memo,
      accounting_date: a.date,
      postings: [
        {
          accountId: expense._id,
          minor_units: amount,
          currency: a.currency,
          description: a.memo,
        },
        {
          accountId: cash._id,
          minor_units: -amount,
          currency: a.currency,
          description: a.memo,
        },
      ],
    });
    if (a.subjectId)
      await attribution(
        ctx,
        w.user._id,
        (await ctx.db.get(result.postingIds[0]))!,
        [
          {
            minor_units: amount,
            unclassified: false,
            subject_entity_id: a.subjectId,
            beneficiaries: [{ unassigned: true, share_bps: 10000 }],
          },
        ],
        "Explicit subject supplied when recording expense",
      );
    return {
      journalId: result.id,
      eventId,
      amount: a.amount,
      currency: a.currency,
      date: a.date,
      status: "posted",
      basis: creditCard
        ? "Expense debited; selected credit-card liability credited. This records a card charge, not a payment from bank cash. Use a reversal for corrections."
        : "Expense debited; selected asset payment account credited. Use a reversal for corrections.",
    };
  },
});
export const rescheduleEvent = mutation({
  agent: { operation: "records.rescheduleEvent", scope: "data:write" },
  args: {
    id: v.id("event"),
    date: v.string(),
    time: v.string(),
    timezone: v.optional(v.string()),
    utcOffsetMinutes: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const w = await workspace(ctx);
    if (!a.timezone && !w.timezoneConfigured)
      throw new Error(
        "Specify an IANA timezone for this appointment; this dataset has no configured timezone.",
      );
    const old = await owned(ctx, "event", a.id, w.user._id),
      timezone = a.timezone ?? w.timezone;
    if (old.archived || old.voided_at !== undefined)
      throw new Error("Cannot reschedule an archived or voided event");
    if (
      await ctx.db
        .query("event")
        .withIndex("by_corrects", (q) => q.eq("corrects_id", old._id))
        .first()
    )
      throw new Error(
        "This event has a newer correction. Read the current event before editing.",
      );
    if (
      await ctx.db
        .query("journal_entry")
        .withIndex("by_event", (q) => q.eq("event_id", old._id))
        .first()
    )
      throw new Error("Financial events require a journal correction workflow");
    let occurred_at: number;
    try { occurred_at = localInstant(
        a.date,
        a.time,
        timezone,
        a.utcOffsetMinutes,
      ); }
    catch (error) { if (error instanceof AmbiguousLocalTimeError) return error.clarification; throw error; }
    const duration =
        old.ended_at === undefined ? undefined : old.ended_at - old.occurred_at;
    const links = await ctx.db
      .query("event_affects")
      .withIndex("by_event", (q) => q.eq("event_id", old._id))
      .take(101);
    if (links.length > 100)
      throw new Error("Event exceeds 100 linked subjects");
    const id = await ctx.db.insert("event", {
      user_id: w.user._id,
      created_at: Date.now(),
      recorded_at: Date.now(),
      kind: old.kind,
      title: old.title,
      occurred_at,
      ended_at: duration === undefined ? undefined : occurred_at + duration,
      corrects_id: old._id,
      payload_json: JSON.stringify({
        ...JSON.parse(old.payload_json),
        timezone,
        localDate: a.date,
        localTime: a.time,
        rescheduled: {
          localDate: a.date,
          localTime: a.time,
          timezone,
          reason: a.reason ?? "User-requested reschedule",
        },
      }),
    });
    for (const { _id, _creationTime, ...link } of links)
      await ctx.db.insert("event_affects", { ...link, event_id: id });
    return {
      id,
      correctsId: old._id,
      title: old.title,
      date: a.date,
      time: a.time,
      timezone,
      subjects: links.map((link) => link.target ?? { kind: link.target_type, id: link.target_id }),
      subjectNames: await Promise.all(links.map(async (link) => {
        if (!link.target) return `${link.target_type} ${link.target_id}`;
        const record = await ownedTarget(ctx, link.target, w.user._id);
        return "display_name" in record ? String(record.display_name) : "name" in record ? String(record.name) : String(link.target.id);
      })),
      status: "rescheduled",
      occurredAt: new Date(occurred_at).toISOString(),
      ...clockFacts(occurred_at, timezone),
      basis:
        "New event supersedes the prior occurrence; duration, subject links and history are preserved.",
    };
  },
});
