/** Independent arithmetic oracle and transport measurements; run after growth stops. */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../../.convex/query-evaluation/", import.meta.url),
  creds = JSON.parse(await readFile(new URL("credentials.json", root), "utf8"));
const count = Number(process.argv[2] ?? 308000),
  synthetic = count - 308;
if (!Number.isSafeInteger(synthetic) || synthetic < 0)
  throw new Error("Expected total journal count >= 308");
const income = Math.ceil(synthetic / 5) * 100,
  expense = (synthetic - Math.ceil(synthetic / 5)) * 25;
const client = new Client(
  { name: "Independent report benchmark", version: "1" },
  {
    capabilities: { elicitation: { form: {} } },
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  },
);
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"), {
    authProvider: { token: async () => creds.token },
  }),
);
const cases: Record<string, unknown>[] = [],
  assert = (ok: boolean, message: string) => {
    if (!ok) throw new Error(message);
  };
async function call(name: string, args: Record<string, unknown> = {}) {
  const at = performance.now(),
    r = await client.callTool({
      name,
      arguments: {
        datasetId: creds.datasetId,
        ...(name === "reports.finances" ? { scope: "dataset" } : {}),
        ...args,
      },
    });
  if (r.isError) throw new Error(JSON.stringify(r.structuredContent));
  const data = r.structuredContent as any;
  cases.push({
    tool: name,
    args,
    elapsedMs: Math.round(performance.now() - at),
    bytes: JSON.stringify(data).length,
    pages: data.pages,
    examinedCells: data.examinedCells,
    examinedJournals: data.examinedJournals,
  });
  return data;
}
try {
  const context = await call("life.context"),
    chartId = context.charts.find((c: any) =>
      c.name.startsWith("Juniper Design"),
    )?.id;
  assert(!!chartId, "Missing design chart");
  for (const [metric, total] of [
    ["income", income],
    ["expenses", expense],
    ["profit_loss", income - expense],
  ] as const) {
    const r = await call("reports.finances", {
      metric,
      chartId,
      from: "2010-01-01",
      through: "2025-12-31",
      groupBy: "year",
    });
    const actual =
      metric === "profit_loss"
        ? r.profitLoss[0]?.netRecordedIncome
        : r.totals[0]?.amount;
    assert(
      actual === total.toFixed(2),
      `${metric}: expected ${total.toFixed(2)}, received ${actual}`,
    );
    assert(r.queryComplete === true, "Partial report");
    cases.at(-1)!.expected = total.toFixed(2);
    cases.at(-1)!.actual = actual;
  }
  const alex = context.defaultHousehold.members.find(
    (m: any) => m.name === "Alex Morgan",
  ).id;
  const payroll = await call("reports.finances", {
    metric: "payroll",
    entityId: alex,
    from: "2026-06-01",
    through: "2026-08-31",
  });
  assert(
    payroll.payroll[0].totalGross === "39000.00" &&
      payroll.payroll[0].totalCashDeposited === "27300.00",
    "Payroll regression",
  );
  const timeline = await call("life.timeline", {
    from: "2026-09-18",
    through: "2026-09-30",
  });
  assert(
    timeline.items.filter((i: any) => i.amount === "15000.00").length === 1,
    "Duplicate/missing remodel debt",
  );
  assert(
    timeline.items.some((i: any) => i.amount === "4550.00"),
    "Missing cash paycheck",
  );
  const project = await call("reports.project", {
    project: "Cedar Lane remodel",
    from: "2026-01-01",
    through: "2026-09-16",
  });
  assert(
    project.actuals.rows.some(
      (r: any) => r.account.includes("improvements") && r.amount === "55000.00",
    ),
    "Project capital cost mismatch",
  );
  assert(project.obligations[0].amount === "15000.00", "Project debt mismatch");
  for (const [scope, expected] of [
    ["household", "95719.77"],
    ["dataset", "165060.32"],
  ] as const) {
    const cash = await call("reports.finances", {
      scope,
      metric: "cash_balances",
      from: "2026-09-16",
      through: "2026-09-16",
      groupBy: "total",
    });
    assert(
      cash.cashSummary[0].cash === expected,
      `Wrong ${scope} cash balance`,
    );
    cases.at(-1)!.expected = expected;
    cases.at(-1)!.actual = cash.cashSummary[0].cash;
  }
  const baseline = await call("reports.cashProjection", {
    scope: "household",
    through: "2026-11-30",
    includeAssumptions: true,
  });
  const commitments = await call("reports.cashProjection", {
    scope: "household",
    through: "2026-11-30",
    includeAssumptions: false,
  });
  assert(
    baseline.reports[0].accounts.length === 2,
    "Household forecast included company cash",
  );
  assert(
    Math.round(
      (Number(commitments.reports[0].projectedClosing) -
        Number(baseline.reports[0].projectedClosing)) *
        100,
    ) === 3000000,
    "Assumption exclusion lost/duplicated current debt",
  );
  const result = {
    at: new Date().toISOString(),
    targetJournals: count,
    syntheticJournals: synthetic,
    independentExpected: { income, expense, net: income - expense },
    passed: true,
    cases,
  };
  const file = new URL(`benchmark-${count}.json`, root);
  await writeFile(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}
