import { expect, test } from "vitest";
import { presentReport } from "../lib/mcp/report-presentation";
import { summarizeFinance, type FinanceRow } from "../lib/life-reports/finance";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveReport, readReport } from "../lib/mcp/report-store";
const row = (
  account: string,
  type: string,
  minorUnits: number,
  cash = false,
): FinanceRow => ({
  key: account,
  period: "2026-06",
  accountId: account,
  account,
  type,
  currency: "USD",
  minorUnits,
  cash,
  journalIds: ["source-journal"],
  sourceCount: 1,
});
test("payroll separates full-month cash from gross without splitting a second time", () => {
  const rows = [
    row("salary", "Income", 1300000),
    row("checking", "Asset", 910000, true),
    row("withheld", "Expense", 390000),
  ];
  const report = {
    reportType: "financial",
    metric: "payroll",
    from: "2026-06-01",
    through: "2026-06-30",
    rows: rows.map((r) => ({ ...r, sourceJournalIds: r.journalIds })),
    ...summarizeFinance(rows, "2026-06-01", "2026-06-30", () => 2, "payroll"),
    basis: "Payroll only",
    coverage: "Recorded entries",
  };
  const text = presentReport(report);
  expect(text).toContain(
    "| 2026-06 | 13000.00 USD | 9100.00 USD | 3900.00 USD |",
  );
  expect(text).toContain("Average monthly cash: **9100.00 USD**");
  expect(text).not.toContain("4550.00");
});
test("project renders capital cost, paid cash, debt and future work as distinct facts", () => {
  const text = presentReport({
    reportType: "project",
    project: { name: "Remodel" },
    from: "2026-01-01",
    through: "2026-09-16",
    actuals: {
      rows: [
        {
          account: "Improvements",
          type: "Asset",
          cashAccount: false,
          amount: "55000.00",
          currency: "USD",
        },
        {
          account: "Checking",
          type: "Asset",
          cashAccount: true,
          amount: "-40000.00",
          currency: "USD",
        },
        {
          account: "Payable",
          type: "Liability",
          amount: "-15000.00",
          currency: "USD",
        },
      ],
    },
    obligations: [
      {
        debtor: "Household",
        creditor: "Builder",
        dueDate: "2026-09-30",
        amount: "15000.00",
        currency: "USD",
      },
    ],
    expectations: [
      {
        kind: "linked_obligation",
        name: "Invoice",
        amount: "-15000.00",
        currency: "USD",
      },
      {
        kind: "unincurred_assumption",
        name: "Final milestone",
        date: "2026-11-15",
        amount: "-30000.00",
        currency: "USD",
      },
    ],
    notes: [],
    coverage: "Current obligations",
  });
  expect(text).toContain(
    "| Non-cash asset increase (see accounts below) | 55000.00 USD |",
  );
  expect(text).toContain("| Net cash paid | 40000.00 USD |");
  expect(text).toContain("| Posted expenses | 0.00 USD |");
  expect(text).toContain("| Household | Builder | 2026-09-30 | 15000.00 USD |");
  expect(text).toContain("| Final milestone | 2026-11-15 | -30000.00 USD |");
  expect(text).not.toContain("| Invoice |");
});
test("saved report access is scoped to user, connection and dataset", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeor-reports-")),
    old = process.env.LIFEOR_REPORT_DIRECTORY;
  process.env.LIFEOR_REPORT_DIRECTORY = dir;
  const scope = {
    userId: "user-a",
    connectionId: "grant-a",
    datasetId: "dataset-a",
  };
  try {
    const saved = await saveReport(scope, {
      reportType: "financial",
      rows: [],
    });
    expect((await readReport(scope, saved.reportId)).report.rows).toEqual([]);
    for (const changed of [
      { userId: "user-b" },
      { connectionId: "grant-b" },
      { datasetId: "dataset-b" },
    ])
      await expect(
        readReport({ ...scope, ...changed }, saved.reportId),
      ).rejects.toThrow();
    await expect(readReport(scope, "../../credentials")).rejects.toThrow(
      "Unknown report",
    );
  } finally {
    if (old === undefined) delete process.env.LIFEOR_REPORT_DIRECTORY;
    else process.env.LIFEOR_REPORT_DIRECTORY = old;
    await rm(dir, { recursive: true, force: true });
  }
});

test("large timeline presentation pages detail without changing complete totals", () => {
  const report = {
    reportType: "timeline",
    from: "2026-01-01",
    through: "2026-12-31",
    timezone: "UTC",
    nextOffset: null,
    items: Array.from({ length: 120 }, (_, i) => ({
      date: "2026-09-20",
      title: `Bill ${i}`,
      amount: "1.25",
      currency: "USD",
      kind: "obligation",
      direction: "outflow",
      sourceIds: [`s${i}`],
    })),
  };
  const first = presentReport(report),
    next = presentReport(report, "summary", 50, 50);
  expect(first).toContain("| Bill 49 |");
  expect(first).not.toContain("| Bill 50 |");
  expect(next).toContain("| Bill 50 |");
  expect(next).not.toContain("| Bill 49 |");
  for (const text of [first, next])
    expect(text).toContain("| outflow | 150.00 USD |");
  expect(next).toContain("offset 100");
});
