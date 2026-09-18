import { matchesText } from "./lib/lifeQueries/text";
import { v } from "convex/values";
import { query } from "./lib/scoped";
import { requireUser, owned } from "./lib/access";
import { dateRange, referenceRows, workspace } from "./lib/lifeQueries/common";
import { journalData } from "./agentQueries";
import { postingAmount } from "./lib/ledger";
import { add } from "./lib/domain";
import {
  mergeRows,
  type FinanceRow,
  type FinancePage,
} from "../lib/life-reports/finance";

export const summary = query({
  agent: { operation: "reports.finances", scope: "data:read" },
  args: {
    scope: v.optional(v.union(v.literal("household"), v.literal("dataset"))),
    accountQuery: v.optional(v.string()),
    currency: v.optional(v.string()),
    eventKind: v.optional(v.string()),
    from: v.string(),
    through: v.string(),
    metric: v.union(
      v.literal("income"),
      v.literal("expenses"),
      v.literal("balances"),
      v.literal("cash_balances"),
      v.literal("activity"),
      v.literal("cashflow"),
      v.literal("profit_loss"),
      v.literal("payroll"),
    ),
    groupBy: v.optional(
      v.union(v.literal("month"), v.literal("year"), v.literal("total")),
    ),
    chartId: v.optional(v.id("chart_of_accounts")),
    entityId: v.optional(v.id("entity")),
    beneficiaryId: v.optional(v.id("entity")),
    arrangementId: v.optional(v.id("arrangement")),
    tagId: v.optional(v.id("tag")),
    accountId: v.optional(v.id("ledger_account")),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<FinancePage> => {
    if (a.currency) {
      if (!/^[A-Z]{3}$/.test(a.currency))
        throw new Error("Use a three-letter uppercase currency code");
    }
    if (a.metric === "payroll") {
      a.eventKind ??= "PayrollDeposit";
      a.groupBy = "month";
    }
    if (["balances", "cash_balances"].includes(a.metric)) a.from = a.through;
    dateRange(a.from, a.through, 36600);
    const user = await requireUser(ctx);
    if (a.scope === "household") {
      const w = await workspace(ctx);
      if (!w.household)
        throw new Error(
          "No default household is configured. Select an explicit chart from life.context.",
        );
      const charts = (await referenceRows(ctx, "chart_of_accounts")).filter(
        (c) => !c.archived && c.reporting_entity_id === w.household,
      );
      if (charts.length !== 1)
        throw new Error(
          "Household has zero or multiple books. Select an explicit chart and scope=dataset.",
        );
      if (a.chartId && a.chartId !== charts[0]._id)
        throw new Error("chartId conflicts with household scope");
      a.chartId = charts[0]._id;
    }
    const scope: string[] = [];
    if (a.chartId)
      scope.push(
        "Books: " +
          (await owned(ctx, "chart_of_accounts", a.chartId, user._id)).name,
      );
    else scope.push("All dataset books");
    if (a.entityId)
      scope.push(
        "Attributed subject: " +
          (await owned(ctx, "entity", a.entityId, user._id)).display_name,
      );
    if (a.beneficiaryId)
      scope.push(
        "Attributed beneficiary: " +
          (await owned(ctx, "entity", a.beneficiaryId, user._id)).display_name,
      );
    if (a.tagId)
      scope.push("Tag: " + (await owned(ctx, "tag", a.tagId, user._id)).name);
    if (a.accountId)
      scope.push(
        "Account: " +
          (await owned(ctx, "ledger_account", a.accountId, user._id)).name,
      );
    if (a.arrangementId)
      scope.push(
        "Arrangement: " +
          (await owned(ctx, "arrangement", a.arrangementId, user._id)).name,
      );
    if (a.accountQuery) scope.push("Account/category words: " + a.accountQuery);
    if (a.currency) scope.push("Currency: " + a.currency);
    if (a.eventKind) scope.push("Event kind: " + a.eventKind);
    const from = ["balances", "cash_balances"].includes(a.metric)
      ? "0001-01-01"
      : a.from;
    const dataset = ctx.scope.datasetId
      ? await ctx.db.get(ctx.scope.datasetId)
      : null;
    if (
      dataset?.report_index_ready &&
      dataset.report_index_version === 1 &&
      !ctx.scope.legacy
    )
      return {
        ...(await indexedSummary(ctx, a, from, dataset.data_revision ?? 0)),
        scope,
        versioned: !!dataset && !ctx.scope.legacy,
        sampleActualsThrough: dataset.seed_as_of ?? null,
      };
    const journals = ctx.scope.legacy
      ? ctx.db
          .query("journal_entry")
          .withIndex("by_user_date", (q) =>
            q
              .eq("user_id", user._id)
              .gte("accounting_date", from)
              .lte("accounting_date", a.through),
          )
      : a.chartId
        ? ctx.db
            .query("journal_entry")
            .withIndex("by_dataset_chart_date", (q) =>
              q
                .eq("dataset_id", ctx.scope.datasetId)
                .eq("chart_id", a.chartId)
                .gte("accounting_date", from)
                .lte("accounting_date", a.through),
            )
        : ctx.db
            .query("journal_entry")
            .withIndex("by_dataset_date", (q) =>
              q
                .eq("dataset_id", ctx.scope.datasetId)
                .gte("accounting_date", from)
                .lte("accounting_date", a.through),
            );
    const slice = await journals.paginate({
      cursor: a.cursor ?? null,
      numItems: 100,
    });
    const financial = await referenceRows(ctx, "financial_account"),
      cashIds = new Set(
        financial
          .filter(
            (f) =>
              !f.archived &&
              ["checking", "savings", "cash"].includes(f.kind.toLowerCase()),
          )
          .map((f) => String(f.ledger_account_id)),
      );
    const rows = new Map<string, FinanceRow>(),
      warnings = new Set<string>();
    const tagCache = new Map<string, boolean>();
    const tagged = async (id: string) => {
      if (!a.tagId) return true;
      if (tagCache.has(id)) return tagCache.get(id)!;
      const links = await ctx.db
        .query("tag_assignment")
        .withIndex("by_target", (q) => q.eq("target.id", id as never))
        .take(101);
      if (links.length > 100) throw new Error("Too many tags on one record");
      const yes = links.some(
        (l) => l.tag_id === a.tagId && l.removed_at === undefined,
      );
      tagCache.set(id, yes);
      return yes;
    };
    for (const j of slice.page) {
      if (j.status !== "posted" || (a.chartId && j.chart_id !== a.chartId))
        continue;
      if (a.eventKind && (await ctx.db.get(j.event_id))?.kind !== a.eventKind)
        continue;
      const lines = await journalData(ctx, j),
        allParts = lines.flatMap((l) => l.parts),
        subjects = new Set(allParts.map((p) => p.subject_entity_id));
      const soleSubject =
        allParts.length &&
        subjects.size === 1 &&
        !allParts.some((p) => p.unclassified || !p.subject_entity_id)
          ? allParts[0].subject_entity_id
          : undefined;
      const journalTagged = a.tagId
        ? (await tagged(j._id)) || (await tagged(j.event_id))
        : true;
      for (const { p, account, parts } of lines) {
        if (!account) throw new Error("Missing account; no total computed");
        if (a.accountQuery && !matchesText(account.name, a.accountQuery))
          continue;
        if (
          (a.currency && p.currency !== a.currency) ||
          (a.accountId && p.account_id !== a.accountId)
        )
          continue;
        if (
          ["cashflow", "cash_balances"].includes(a.metric) &&
          !cashIds.has(p.account_id)
        )
          continue;
        if (
          (a.metric === "profit_loss" &&
            !["Income", "Expense"].includes(account.type)) ||
          (a.metric === "income" && account.type !== "Income") ||
          (a.metric === "expenses" && account.type !== "Expense") ||
          (["balances", "cash_balances"].includes(a.metric) &&
            !["Asset", "Liability", "Equity"].includes(account.type))
        )
          continue;
        const postingTagged =
          journalTagged || (a.tagId ? await tagged(p._id) : true);
        let amount = postingAmount(p);
        const scoped =
          a.entityId ||
          a.beneficiaryId ||
          a.arrangementId ||
          (a.tagId && !postingTagged);
        if (scoped) {
          if (!parts.length) {
            if (
              a.entityId &&
              soleSubject === a.entityId &&
              !a.beneficiaryId &&
              !a.arrangementId &&
              (!a.tagId || postingTagged)
            ) {
              /* inherit unambiguous subject */
            } else {
              warnings.add(
                "Entries without matching explicit attribution were excluded; this is not proof of complete coverage.",
              );
              continue;
            }
          } else {
            const values: number[] = [];
            for (const part of parts) {
              if (
                part.unclassified ||
                (a.entityId && part.subject_entity_id !== a.entityId) ||
                (a.arrangementId && part.arrangement_id !== a.arrangementId)
              )
                continue;
              if (
                a.tagId &&
                !postingTagged &&
                !(await tagged(part._id)) &&
                !(part.arrangement_id && (await tagged(part.arrangement_id)))
              )
                continue;
              if (a.beneficiaryId) {
                const bs = await ctx.db
                  .query("attribution_beneficiary")
                  .withIndex("by_attribution", (q) =>
                    q.eq("attribution_id", part._id),
                  )
                  .take(101);
                if (bs.length > 100) throw new Error("Too many beneficiaries");
                values.push(
                  ...bs
                    .filter(
                      (b) => b.entity_id === a.beneficiaryId && !b.unassigned,
                    )
                    .map((b) => b.minor_units),
                );
              } else values.push(part.minor_units);
            }
            amount = add(...values);
          }
        }
        if (!amount) continue;
        // Income and credit-normal balances display positive credits. Activity retains signed debits.
        if (
          a.metric === "income" ||
          (["profit_loss", "payroll"].includes(a.metric) &&
            account.type === "Income") ||
          (["balances", "cash_balances"].includes(a.metric) &&
            ["Liability", "Equity"].includes(account.type))
        )
          amount = -amount;
        const period = ["balances", "cash_balances"].includes(a.metric)
            ? a.through
            : a.groupBy === "total"
              ? "total"
              : a.groupBy === "year"
                ? j.accounting_date!.slice(0, 4)
                : j.accounting_date!.slice(0, 7),
          key = `${period}:${p.account_id}:${p.currency}`;
        mergeRows(rows, [
          {
            key,
            period,
            accountId: p.account_id,
            account: account.name,
            type: account.type,
            currency: p.currency,
            cash: cashIds.has(p.account_id),
            minorUnits: amount,
            journalIds: [j._id],
            sourceCount: 1,
          },
        ]);
      }
    }
    return {
      scope,
      sampleActualsThrough: dataset?.seed_as_of ?? null,
      revision: dataset?.data_revision ?? 0,
      versioned: !!dataset && !ctx.scope.legacy,
      rows: [...rows.values()],
      nextCursor: slice.isDone ? null : slice.continueCursor,
      examinedJournals: slice.page.length,
      warnings: [...warnings],
      queryComplete: slice.isDone,
      datasetCompleteness: "unknown",
      from,
      through: a.through,
    };
  },
});

async function indexedSummary(
  ctx: import("./lib/lifeQueries/common").LifeContext,
  a: any,
  from: string,
  revision: number,
): Promise<FinancePage> {
  const accounts = await referenceRows(ctx, "ledger_account"),
    financial = await referenceRows(ctx, "financial_account"),
    cashIds = new Set(
      financial
        .filter(
          (f) =>
            !f.archived &&
            ["checking", "savings", "cash"].includes(f.kind.toLowerCase()),
        )
        .map((f) => String(f.ledger_account_id)),
    );
  const eligible = accounts.filter(
    (ac) =>
      (!a.chartId || ac.chart_id === a.chartId) &&
      (!a.accountQuery || matchesText(ac.name, a.accountQuery)),
  );
  const candidates = a.accountId
    ? eligible.filter((ac) => ac._id === a.accountId)
    : ["cashflow", "cash_balances"].includes(a.metric)
      ? eligible.filter((ac) => cashIds.has(ac._id))
      : a.metric === "income"
        ? eligible.filter((ac) => ac.type === "Income")
        : a.metric === "expenses"
          ? eligible.filter((ac) => ac.type === "Expense")
          : a.metric === "profit_loss"
            ? eligible.filter((ac) => ["Income", "Expense"].includes(ac.type))
            : a.metric === "balances"
              ? eligible.filter((ac) =>
                  ["Asset", "Liability", "Equity"].includes(ac.type),
                )
              : a.accountQuery || a.chartId
                ? eligible
                : undefined;
  if (candidates?.length === 0)
    return {
      revision,
      rows: [],
      nextCursor: null,
      examinedJournals: 0,
      examinedCells: 0,
      warnings: [],
      queryComplete: true,
      datasetCompleteness: "unknown",
      from,
      through: a.through,
    };
  const state = a.cursor
    ? (JSON.parse(a.cursor) as { index: number; cursor: string | null })
    : { index: 0, cursor: null };
  if (
    !Number.isInteger(state.index) ||
    state.index < 0 ||
    (candidates && state.index >= candidates.length) ||
    (state.cursor !== null && typeof state.cursor !== "string")
  )
    throw new Error("Invalid internal report cursor");
  const basis = a.beneficiaryId
    ? ("beneficiary" as const)
    : ("posting" as const);
  const source = a.eventKind
    ? ctx.db
        .query("agent_finance_cell")
        .withIndex("by_event_date", (q) =>
          q
            .eq("dataset_id", ctx.scope.datasetId!)
            .eq("basis", basis)
            .eq("eventKind", a.eventKind)
            .gte("date", from)
            .lte("date", a.through),
        )
    : candidates?.length
      ? ctx.db.query("agent_finance_cell").withIndex("by_account_date", (q) =>
          q
            .eq("dataset_id", ctx.scope.datasetId!)
            .eq("basis", basis)
            .eq("accountId", candidates[state.index]?._id ?? "missing")
            .gte("date", from)
            .lte("date", a.through),
        )
      : ctx.db
          .query("agent_finance_cell")
          .withIndex("by_basis_date", (q) =>
            q
              .eq("dataset_id", ctx.scope.datasetId!)
              .eq("basis", basis)
              .gte("date", from)
              .lte("date", a.through),
          );
  // Leave room for reference/attribution reads under the 4096-document query budget.
  // Larger bounded pages amortize authentication and reference reads over long histories.
  const slice = await source.paginate({ cursor: state.cursor, numItems: 2500 });
  const nextCursor = !slice.isDone
    ? JSON.stringify({ index: state.index, cursor: slice.continueCursor })
    : !a.eventKind && candidates && state.index + 1 < candidates.length
      ? JSON.stringify({ index: state.index + 1, cursor: null })
      : null;
  const rows = new Map<string, FinanceRow>(),
    warnings = new Set<string>(),
    taggedArrangements = new Map<string, boolean>();
  for (const c of slice.page) {
    if (
      (a.currency && c.currency !== a.currency) ||
      (a.eventKind && c.eventKind !== a.eventKind) ||
      (["cashflow", "cash_balances"].includes(a.metric) &&
        !cashIds.has(c.accountId))
    )
      continue;
    if (
      c.basis !== (a.beneficiaryId ? "beneficiary" : "posting") ||
      (a.chartId && c.chartId !== a.chartId) ||
      (a.accountId && c.accountId !== a.accountId) ||
      (a.beneficiaryId && c.beneficiaryId !== a.beneficiaryId)
    )
      continue;
    const account = accounts.find((ac) => ac._id === c.accountId);
    if (!account) throw new Error("Missing account; no total computed");
    if (a.accountQuery && !matchesText(account.name, a.accountQuery)) continue;
    if (
      (a.metric === "profit_loss" &&
        !["Income", "Expense"].includes(account.type)) ||
      (a.metric === "income" && account.type !== "Income") ||
      (a.metric === "expenses" && account.type !== "Expense") ||
      (["balances", "cash_balances"].includes(a.metric) &&
        !["Asset", "Liability", "Equity"].includes(account.type))
    )
      continue;
    if ((a.entityId && !c.subjectId) || (a.arrangementId && !c.arrangementId)) {
      warnings.add(
        "Entries without matching explicit attribution were excluded; this is not proof of complete coverage.",
      );
      continue;
    }
    if (
      (a.entityId && c.subjectId !== a.entityId) ||
      (a.arrangementId && c.arrangementId !== a.arrangementId)
    )
      continue;
    if (a.tagId && !c.tags.includes(a.tagId)) {
      if (!c.arrangementId) continue;
      if (!taggedArrangements.has(c.arrangementId)) {
        const assignments = await ctx.db
          .query("tag_assignment")
          .withIndex("by_target", (q) =>
            q.eq("target.id", c.arrangementId as never),
          )
          .take(101);
        if (assignments.length > 100) throw new Error("Too many tags");
        taggedArrangements.set(
          c.arrangementId,
          assignments.some(
            (t) => t.tag_id === a.tagId && t.removed_at === undefined,
          ),
        );
      }
      if (!taggedArrangements.get(c.arrangementId)) continue;
    }
    let amount = c.amount;
    if (
      a.metric === "income" ||
      (["profit_loss", "payroll"].includes(a.metric) &&
        account.type === "Income") ||
      (["balances", "cash_balances"].includes(a.metric) &&
        ["Liability", "Equity"].includes(account.type))
    )
      amount = -amount;
    if (!amount) continue;
    const period = ["balances", "cash_balances"].includes(a.metric)
        ? a.through
        : a.groupBy === "total"
          ? "total"
          : a.groupBy === "year"
            ? c.date.slice(0, 4)
            : c.date.slice(0, 7),
      key = `${period}:${c.accountId}:${c.currency}`;
    mergeRows(rows, [
      {
        key,
        period,
        accountId: c.accountId,
        account: account.name,
        type: account.type,
        currency: c.currency,
        cash: cashIds.has(c.accountId),
        minorUnits: amount,
        journalIds: c.sources,
        sourceCount: c.count,
      },
    ]);
  }
  return {
    revision,
    rows: [...rows.values()],
    nextCursor,
    examinedJournals: 0,
    examinedCells: slice.page.length,
    warnings: [...warnings],
    queryComplete: nextCursor === null,
    datasetCompleteness: "unknown",
    from,
    through: a.through,
  };
}
