import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  collectFinance,
  decimal,
  summarizeFinance,
  type FinancePage,
} from "../life-reports/finance";
import { scale } from "../../convex/lib/domain";
import { saveReport } from "./report-store";
export async function financialReport(
  client: ConvexHttpClient,
  token: string,
  scope: { userId: string; connectionId: string; datasetId: string },
  args: Record<string, unknown>,
  snapshotClient?: ConvexHttpClient,
) {
  const { cursor: _cursor, ...input } = args;
  const start = Date.now();
  // Fresh per-report snapshot: normal indexed queries finish well within the
  // backend's 30-second historical read window. Slow legacy scans fail closed.
  const snapshot = snapshotClient ?? new ConvexHttpClient(client.url);
  const report = await collectFinance(async (cursor) => {
    if (Date.now() - start > 150_000)
      throw new Error(
        "QUERY_LIMIT: report exceeded 150 seconds. Narrow the period; no partial total was supplied.",
      );
    return (await snapshot.consistentQuery(
      makeFunctionReference<"query">("agentFinance:summary"),
      { ...input, agentToken: token, ...(cursor ? { cursor } : {}) },
    )) as FinancePage;
  });
  const result = {
    reportType: "financial",
    ...report,
    rows: report.rows.map((r) => ({
      period: r.period,
      accountId: r.accountId,
      account: r.account,
      type: r.type,
      currency: r.currency,
      amount: decimal(r.minorUnits, scale(r.currency)),
      cashAccount: r.cash,
      sourceJournalIds: r.journalIds,
      contributionCount: r.sourceCount,
      sourcesComplete: r.sourceCount <= r.journalIds.length,
    })),
    ...summarizeFinance(
      report.rows,
      String(
        ["balances", "cash_balances"].includes(String(args.metric))
          ? args.through
          : args.from,
      ),
      String(args.through),
      scale,
      String(args.metric),
    ),
    scopeFilters: Object.fromEntries(
      Object.entries(input).filter(
        ([key]) =>
          !["datasetId", "from", "through", "metric", "groupBy"].includes(key),
      ),
    ),
    metric: args.metric,
    basis:
      args.metric === "cash_balances"
        ? "Recorded bank/cash-account balances through cutoff, including opening entries. Only designated checking, savings and cash accounts are included; this is not a forecast or a consolidation of legal ownership."
        : args.metric === "payroll"
          ? "Recorded payroll events: gross income and actual bank deposits are separate. cashDeposited and averageMonthlyCash are full calendar-month totals, not per-paycheck amounts. Missing months are not verified zero; partial boundary months are not extrapolated. Future pay is a schedule projection, not this report."
          : args.metric === "profit_loss"
            ? "Recorded recognized income less posted expenses in the selected scope. Capital purchases, principal and equity/transfer movements are excluded. This is not a consolidated tax profit or a cash-flow measure."
            : args.metric === "cashflow"
              ? "Recorded signed cash-account changes (positive inflow, negative outflow), filtered by the requested event kind if supplied. These can include transfers or owner funding; they are not automatically earnings."
              : args.metric === "income"
                ? "Recorded gross Income credits minus debits; not net take-home pay."
                : args.metric === "expenses"
                  ? "Posted Expense debits minus credits; excludes capital purchases, principal and transfers."
                  : ["balances", "cash_balances"].includes(String(args.metric))
                    ? "Posted balances through cutoff, including opening entries. Assets display net debits; liabilities and equity display net credits; do not sum assets and liabilities as net worth."
                    : "Signed posted debits minus credits by account; capital costs, expense, cash and liabilities remain separate.",
    coverage:
      "Dataset completeness unknown. Undated journals excluded. Source IDs are bounded examples; totals include every matching page. Subject filters use explicit attribution or an unambiguous journal subject; ownership does not imply income attribution.",
  };
  const saved = await saveReport(scope, result);
  return {
    ...result,
    ...saved,
    rows: result.rows.slice(0, args.metric === "payroll" ? 0 : 8),
    rowCount: result.rows.length,
    nextOffset:
      result.rows.length > (args.metric === "payroll" ? 0 : 8)
        ? args.metric === "payroll"
          ? 0
          : 8
        : null,
    rowsComplete: result.rows.length <= (args.metric === "payroll" ? 0 : 8),
  };
}
