import { v } from "convex/values";
import { query, type QueryCtx } from "./lib/scoped";
import { owned, requireUser } from "./lib/access";
import { date, add, scale } from "./lib/domain";
import { entityAt } from "./lib/history";
import { postingAmount } from "./lib/ledger";
import type { Doc } from "./_generated/dataModel";

// Exact decimal strings prevent models from re-scaling integer minor units.
function decimalAmount(minor: number, precision: number, divisor = 1): string {
  const n = BigInt(minor),
    d = BigInt(divisor);
  const magnitude = ((n < 0n ? -n : n) + d / 2n) / d;
  const digits = magnitude.toString().padStart(precision + 1, "0");
  return (
    (n < 0n && magnitude !== 0n ? "-" : "") +
    (precision
      ? digits.slice(0, -precision) + "." + digits.slice(-precision)
      : digits)
  );
}

const pageArgs = {
  cursor: v.optional(v.string()),
  limit: v.optional(v.number()),
};
function limit(value = 20) {
  if (!Number.isInteger(value) || value < 1 || value > 50)
    throw new Error("limit must be 1–50");
  return value;
}
export const searchEntities = query({
  agent: { operation: "agentQueries.searchEntities", scope: "data:read" },
  args: { query: v.string(), kind: v.optional(v.string()), ...pageArgs },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx);
    // Legacy Live includes rows without dataset_id; named datasets can use an exact index.
    const entitiesQuery = ctx.scope.legacy
      ? ctx.db
          .query("entity")
          .withIndex("by_user", (q) => q.eq("user_id", user._id))
      : ctx.db
          .query("entity")
          .withIndex("by_user_dataset", (q) =>
            q.eq("user_id", user._id).eq("dataset_id", ctx.scope.datasetId),
          );
    const page = await entitiesQuery.paginate({
      cursor: a.cursor ?? null,
      numItems: limit(a.limit ?? 50),
    });
    const entities = await Promise.all(page.page.map((e) => entityAt(ctx, e)));
    return {
      records: entities
        .filter(
          (e) =>
            !e.archived &&
            (!a.kind || e.kind.toLowerCase() === a.kind.toLowerCase()) &&
            e.display_name.toLowerCase().includes(a.query.toLowerCase()),
        )
        .map((e) => ({ id: e._id, name: e.display_name, kind: e.kind })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
      hint: "Continue through nextCursor before concluding that a name is unique or absent.",
    };
  },
});
async function portions(ctx: QueryCtx, p: Doc<"posting">) {
  const sets = await ctx.db
    .query("posting_attribution_set")
    .withIndex("by_posting", (q) => q.eq("posting_id", p._id))
    .take(101);
  if (sets.length > 100)
    throw new Error("Attribution history too large; narrow the query.");
  const latest = sets.sort((a, b) => b.revision - a.revision)[0];
  if (!latest) return [];
  const parts = await ctx.db
    .query("posting_attribution")
    .withIndex("by_set", (q) => q.eq("set_id", latest._id))
    .take(101);
  if (parts.length > 100) throw new Error("Too many attribution portions.");
  return parts;
}
async function journalData(ctx: QueryCtx, j: Doc<"journal_entry">) {
  const postings = await ctx.db
    .query("posting")
    .withIndex("by_je", (q) => q.eq("je_id", j._id))
    .take(101);
  if (postings.length > 100)
    throw new Error("Journal exceeds 100 postings; use journal detail tools.");
  return Promise.all(
    postings.map(async (p) => ({
      p,
      account: await ctx.db.get(p.account_id),
      parts: await portions(ctx, p),
    })),
  );
}
const rangeArgs = {
  from: v.string(),
  to: v.string(),
  chartId: v.optional(v.id("chart_of_accounts")),
};
function range(from: string, to: string) {
  date(from);
  date(to);
  if (from > to) throw new Error("from must not follow to");
}
export const searchJournals = query({
  agent: { operation: "agentQueries.searchJournals", scope: "data:read" },
  args: {
    ...rangeArgs,
    text: v.optional(v.string()),
    entityId: v.optional(v.id("entity")),
    ...pageArgs,
  },
  handler: async (ctx, a) => {
    range(a.from, a.to);
    const user = await requireUser(ctx);
    if (a.chartId) await owned(ctx, "chart_of_accounts", a.chartId, user._id);
    if (a.entityId) await owned(ctx, "entity", a.entityId, user._id);
    const page = await ctx.db
      .query("journal_entry")
      .withIndex("by_user_date", (q) =>
        q
          .eq("user_id", user._id)
          .gte("accounting_date", a.from)
          .lte("accounting_date", a.to),
      )
      .order("desc")
      .paginate({ cursor: a.cursor ?? null, numItems: limit(a.limit) });
    const records = [];
    for (const j of page.page) {
      if (
        !j.accounting_date ||
        j.accounting_date < a.from ||
        j.accounting_date > a.to ||
        (a.chartId && j.chart_id !== a.chartId) ||
        (a.text && !j.memo.toLowerCase().includes(a.text.toLowerCase()))
      )
        continue;
      const lines = await journalData(ctx, j);
      if (
        a.entityId &&
        !lines.some((l) =>
          l.parts.some((p) => p.subject_entity_id === a.entityId),
        )
      )
        continue;
      records.push({
        id: j._id,
        date: j.accounting_date,
        memo: j.memo,
        status: j.status,
        reversesId: j.reverses_id,
        postings: lines.map(({ p, account, parts }) => ({
          id: p._id,
          accountId: p.account_id,
          account: account?.name,
          type: account?.type,
          minorUnits: postingAmount(p),
          currency: p.currency,
          subjects: parts.map((x) => ({
            entityId: x.subject_entity_id,
            minorUnits: x.minor_units,
          })),
        })),
      });
    }
    return {
      records,
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

export const incomeSummary = query({
  agent: { operation: "agentQueries.incomeSummary", scope: "data:read" },
  args: {
    entityId: v.id("entity"),
    fromMonth: v.string(),
    toMonth: v.string(),
    chartId: v.optional(v.id("chart_of_accounts")),
  },
  handler: async (ctx, a) => {
    if (!/^\d{4}-\d{2}$/.test(a.fromMonth) || !/^\d{4}-\d{2}$/.test(a.toMonth))
      throw new Error("Months must be YYYY-MM");
    range(a.fromMonth + "-01", a.toMonth + "-01");
    const months: string[] = [];
    const end = new Date(a.toMonth + "-01T00:00:00Z");
    for (
      const d = new Date(a.fromMonth + "-01T00:00:00Z");
      d <= end;
      d.setUTCMonth(d.getUTCMonth() + 1)
    ) {
      months.push(d.toISOString().slice(0, 7));
      if (months.length > 24)
        throw new Error("Use a range of at most 24 months.");
    }
    const user = await requireUser(ctx),
      entity = await entityAt(
        ctx,
        await owned(ctx, "entity", a.entityId, user._id),
      );
    if (a.chartId) await owned(ctx, "chart_of_accounts", a.chartId, user._id);
    const endDate = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
    )
      .toISOString()
      .slice(0, 10);
    const journals = await ctx.db
      .query("journal_entry")
      .withIndex("by_user_date", (q) =>
        q
          .eq("user_id", user._id)
          .gte("accounting_date", a.fromMonth + "-01")
          .lte("accounting_date", endDate),
      )
      .filter((q) => q.eq(q.field("status"), "posted"))
      .take(501);
    if (journals.length > 500)
      throw new Error(
        "More than 500 posted journals in range; narrow the period. No partial total was computed.",
      );
    const totals = new Map<string, Map<string, number>>();
    const sources = new Map<string, Set<string>>();
    const warnings = new Set<string>();
    let examined = 0;
    for (const j of journals) {
      if (j.status !== "posted" || (a.chartId && j.chart_id !== a.chartId))
        continue;
      if (!j.accounting_date) {
        warnings.add(
          "Some posted journals lack accounting dates and could not be included.",
        );
        continue;
      }
      const month = j.accounting_date.slice(0, 7);
      if (!months.includes(month)) continue;
      if (++examined > 500)
        throw new Error(
          "More than 500 journals in range; narrow the period. No partial total was computed.",
        );
      const lines = await journalData(ctx, j);
      // Attribution is often attached to the cash leg (e.g. payroll), not the income leg.
      // Inherit only a single, fully classified subject across all explicit portions.
      const allParts = lines.flatMap((l) => l.parts);
      const subjects = new Set(allParts.map((p) => p.subject_entity_id));
      const soleSubject =
        allParts.length &&
        subjects.size === 1 &&
        !allParts.some((p) => p.unclassified || !p.subject_entity_id)
          ? allParts[0].subject_entity_id
          : undefined;
      for (const { p, account, parts } of lines) {
        if (!account)
          throw new Error(
            "Posting account is unavailable; no partial income total was computed.",
          );
        if (account.type !== "Income") continue;
        let amount: number;
        if (parts.some((x) => x.unclassified || !x.subject_entity_id))
          warnings.add(
            "Unclassified income portions were excluded; totals may omit earnings without subject attribution.",
          );
        if (parts.length)
          amount = add(
            ...parts
              .filter(
                (x) => !x.unclassified && x.subject_entity_id === a.entityId,
              )
              .map((x) => -x.minor_units),
          );
        else if (soleSubject)
          amount = soleSubject === a.entityId ? -postingAmount(p) : 0;
        else {
          warnings.add(
            "Income with missing or mixed subject attribution was excluded; totals are recorded attributable income, not proof of all earnings.",
          );
          continue;
        }
        if (!amount) continue;
        const byMonth = totals.get(p.currency) ?? new Map<string, number>();
        byMonth.set(month, add(byMonth.get(month) ?? 0, amount));
        totals.set(p.currency, byMonth);
        const key = p.currency + month,
          ids = sources.get(key) ?? new Set<string>();
        ids.add(j._id);
        sources.set(key, ids);
      }
    }
    return {
      entity: { id: entity._id, name: entity.display_name },
      status: totals.size ? "recorded_income" : "no_recorded_income",
      fromMonth: a.fromMonth,
      toMonth: a.toMonth,
      basis:
        "Posted Income-account credits minus debits by accounting month. Gross recognized income, NOT take-home pay. Latest explicit subject attribution; an unambiguous journal subject is inherited when the income leg lacks attribution. Reversals are signed in their own accounting month. Currencies are never combined.",
      coverage:
        "A month with no matching entries means no recorded attributable income, not confirmed zero earnings. Dataset completeness is unknown; records without accounting dates are excluded.",
      currencies: [...totals].map(([currency, values]) => {
        const totalMinorUnits = add(...values.values());
        return {
          currency,
          minorUnitScale: scale(currency),
          totalMinorUnits,
          totalAmount: decimalAmount(totalMinorUnits, scale(currency)),
          averageMonthlyAmount: decimalAmount(
            totalMinorUnits,
            scale(currency),
            months.length,
          ),
          amountFormat:
            "Decimal major currency units; average rounded to the currency precision, half away from zero. Do not divide these strings again.",
          averageMonthlyMinorUnits: totalMinorUnits / months.length,
          averageExact: {
            numeratorMinorUnits: totalMinorUnits,
            denominatorMonths: months.length,
          },
          months: months.map((month) => {
            const ids = [...(sources.get(currency + month) ?? [])];
            return {
              month,
              minorUnits: values.get(month) ?? 0,
              amount: decimalAmount(values.get(month) ?? 0, scale(currency)),
              hasRecordedIncome: ids.length > 0,
              sourceCount: ids.length,
              journalIds: ids.slice(0, 20),
              sourcesTruncated: ids.length > 20,
            };
          }),
        };
      }),
      warnings: [...warnings],
      examinedJournals: examined,
      queryComplete: true,
      datasetCompleteness: "unknown",
    };
  },
});
