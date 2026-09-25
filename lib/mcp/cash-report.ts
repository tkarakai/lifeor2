import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { recurringScenario, type RecurringChange } from "../life-reports/recurring-scenario";
import { QueryError } from "./query-error";
import { bankProjection } from "../insights/cash-projection";
import type { InsightData, Posting } from "../insights/types";
import { baseFinancialReport as financialReport } from "./financial-report";
import { parseMoney, scale, add } from "../../convex/lib/domain";
import { decimal } from "../life-reports/finance";
import { dateRange } from "../../convex/lib/lifeQueries/common";
import { saveReport, readReport } from "./report-store";
export async function cashReport(
  client: ConvexHttpClient,
  token: string,
  scope: { userId: string; connectionId: string; datasetId: string },
  args: Record<string, unknown>,
) {
  const snapshot = new ConvexHttpClient(client.url);
  const input = await snapshot.consistentQuery(
    makeFunctionReference<"query">("agentPlanning:projectionInputs"),
    { agentToken: token, datasetId: scope.datasetId },
  );
  if (args.scope === "household" && !input.defaultHouseholdChart)
    throw new Error(
      "QUERY_LIMIT: no unique default household books are configured. Select explicit accounts with scope=dataset.",
    );
  const householdChart =
    args.scope === "household" ? input.defaultHouseholdChart : null;
  const cutoff = String(args.asOf ?? input.today),
    through = String(args.through);
  dateRange(cutoff, through, 366);
  const summary = await financialReport(
    client,
    token,
    scope,
    {
      datasetId: scope.datasetId,
      from: cutoff,
      through: cutoff,
      metric: "cash_balances",
      scope: args.scope ?? "dataset",
      groupBy: "total",
    },
    snapshot,
  );
  if (input.revision !== summary.revision) throw new Error("DATA_CHANGED: cash projection inputs changed during the balance query. Retry; no mixed-version projection was supplied.");
  const full = await readReport(scope, summary.reportId),
    rows = full.report.rows as typeof summary.rows;
  const requested = args.accountIds as string[] | undefined;
  const eligible = input.accounts.filter(
    (a: any) =>
      ["checking", "savings", "cash"].includes(
        a.financialKind?.toLowerCase(),
      ) &&
      (!householdChart || a.chart === householdChart.id) &&
      (!requested || requested.includes(a.id)),
  );
  if (requested?.some((id) => !eligible.some((a: any) => a.id === id)))
    throw new Error(
      "Choose verified cash account IDs from life.search; one or more are unavailable.",
    );
  const hypothetical = (args.additionalMovements ?? args.hypothetical) as
    | { date: string; accountId: string; amount: string; label: string }[]
    | undefined;
  for (const change of hypothetical ?? []) {
    dateRange(cutoff, change.date, 366);
    if (
      change.date <= cutoff ||
      change.date > through ||
      !eligible.some((a: any) => a.id === change.accountId)
    )
      throw new Error(
        "Hypothetical movements require a selected cash account and a date after cutoff through end date",
      );
  }
  const data = {
    ...input,
    entities: [],
    arrangements: [],
    charts: [],
    tags: [],
    links: [],
    ownership: [],
    events: [],
    measurements: [],
    budgets: [],
    versions: [],
    schedules: [],
    coverage: {
      untypedMeasurements: 0,
      draftJournals: 0,
      unclassifiedPostings: 0,
    },
    postings: rows
      .filter((r) => r.cashAccount)
      .map(
        (r) =>
          ({
            id: r.accountId,
            journal: "opening-report:" + summary.reportId,
            date: cutoff,
            account: r.accountId,
            amount: parseMoney(r.amount, r.currency),
            memo: "Recorded balance through cutoff",
            event: "",
            portions: [],
            tags: [],
          }) as Posting,
      ),
  } as InsightData;
  const changes = (args.recurringChanges ?? []) as RecurringChange[];
  if (changes.length && args.includeSchedules === false) throw new QueryError("invalid_scenario", "Recurring changes require schedule projections to be included.");
  const changed = recurringScenario(data.cashSchedules ?? [], data.cashRoutes ?? [], changes, cutoff, through);
  const scenarioData = { ...data, cashSchedules: changed.schedules };
  const reports = [];
  for (const currency of [
    ...new Set<string>(eligible.map((a: any) => a.currency)),
  ]) {
    const accountIds = eligible
      .filter((a: any) => a.currency === currency)
      .map((a: any) => a.id);
    const options = {
      accountIds,
      start: cutoff,
      cutoff,
      end: through,
      schedules: args.includeSchedules !== false,
      assumptions: args.includeAssumptions !== false,
      overdue: true,
    };
    const baseline = bankProjection(data, options);
    const projection = bankProjection(scenarioData, options);
    const points = projection.points.map((p) => ({
      ...p,
      values: { ...p.values },
    }));
    for (const c of hypothetical ?? []) {
      if (!accountIds.includes(c.accountId)) continue;
      const amount = parseMoney(c.amount, currency);
      if (!points.some((p) => p.date === c.date)) {
        const previous = points.filter((p) => p.date < c.date).at(-1)!;
        points.push({
          ...previous,
          date: c.date,
          values: { ...previous.values },
        });
        points.sort((a, b) => a.date.localeCompare(b.date));
      }
      for (const p of points.filter((p) => p.date >= c.date)) {
        p.values[c.accountId] = add(p.values[c.accountId], amount);
        p.total = add(p.total, amount);
      }
    }
    const minimum = points.reduce((a, b) => (b.total < a.total ? b : a)),
      end = points.at(-1)!;
    const money = (n: number) => decimal(n, scale(currency));
    reports.push({
      currency,
      baselineClosing: money(baseline.points.at(-1)!.total),
      hypotheticalClosingChange: money(
        add(end.total, -baseline.points.at(-1)!.total),
      ),
      opening: money(points[0].total),
      projectedClosing: money(end.total),
      lowestProjected: money(minimum.total),
      lowestDate: minimum.date,
      firstNegativeDate: points.find((p) => p.total < 0)?.date ?? null,
      accounts: projection.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        projectedClosing: money(end.values[a.id]),
        lowestProjected: money(Math.min(...points.map((p) => p.values[a.id]))),
        firstNegativeDate: points.find((p) => p.values[a.id] < 0)?.date ?? null,
      })),
      movements: projection.movements.map((m) => ({
        ...m,
        amount: money(m.amount),
      })),
      hypothetical: (hypothetical ?? []).filter((c) =>
        accountIds.includes(c.accountId),
      ),
      recurringChanges: changed.evidence.filter(c => c.currency === currency),
      issues: projection.issues,
    });
  }
  const result = {
    reportType: "cash",
    scope: householdChart
      ? `Books: ${householdChart.name}`
      : "Selected cash accounts across dataset books",
    from: cutoff,
    through,
    reports,
    queryComplete: true,
    datasetCompleteness: "unknown",
    openingReportId: summary.reportId,
    sampleActualsThrough: input.sampleActualsThrough,
    included: {
      outstandingCommitments: true,
      schedules: args.includeSchedules !== false,
      unincurredAssumptions: args.includeAssumptions !== false,
    },
    basis:
      "Recorded ledger opening cash plus current outstanding claims, explicit cash routes, schedule projections and selected assumptions. Overdue unpaid items are projected for the next day. Internal transfers net to zero across selected accounts. Missing routes are reported as issues; this is not a guarantee of affordability. Recurring changes replace projected schedule amounts only; existing claims, payments and opening cash stay unchanged. Additional movements add to that scenario. This report calculates hypothetical changes without modifying records.",
  };
  const saved = await saveReport(scope, {
    ...result,
    rows: reports.flatMap((r) => r.movements),
  });
  return {
    ...result,
    ...saved,
    reports: reports.map((r) => ({
      ...r,
      movements: r.movements.slice(0, 20),
      movementCount: r.movements.length,
      movementsComplete: r.movements.length <= 20,
    })),
  };
}
