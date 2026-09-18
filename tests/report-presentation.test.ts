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

test("large source documents retain exact pinned text across bounded pages", async () => {
  const { documentPage } = await import("../lib/mcp/document-page");
  const source = "Original text ".repeat(2000),
    doc = {
      documentId: "note",
      availability: "available",
      source,
      commit: "abc",
    };
  let offset = 0,
    joined = "";
  do {
    const page = documentPage(doc, offset, 8000);
    expect(page.commit).toBe("abc");
    expect(page.source!.length).toBeLessThanOrEqual(8000);
    joined += page.source;
    offset = page.nextOffset ?? -1;
  } while (offset >= 0);
  expect(joined).toBe(source);
  expect(documentPage(doc).sourceComplete).toBe(false);
});

test("recurring terms and hypothetical changes preserve dates and compute labels without model rewriting", () => {
  const text = presentReport({
    reportType: "commitment",
    name: "Apartment rent",
    recordId: "rent",
    revision: 2,
    reason: "Agreed renewal",
    periods: [
      {
        localEffectiveDate: "2026-01-01",
        localLastEffectiveDate: "2026-09-30",
        amount: "1800.00",
        currency: "USD",
        recurrence: { frequency: "monthly", day_of_month: 1 },
        timezone: "America/Chicago",
        debtor: { name: "Avery" },
        creditor: { name: "Harbor" },
      },
      {
        localEffectiveDate: "2026-10-01",
        localLastEffectiveDate: null,
        amount: "1950.00",
        currency: "USD",
        recurrence: { frequency: "monthly", day_of_month: 1 },
        timezone: "America/Chicago",
        debtor: { name: "Avery" },
        creditor: { name: "Harbor" },
      },
    ],
    hypothetical: [
      {
        effectiveDate: "2026-11-01",
        recordedAmount: "1950.00",
        proposedAmount: "2100.00",
        difference: "150.00",
        currency: "USD",
        frequency: "monthly",
      },
      {
        effectiveDate: "2027-01-01",
        recordedAmount: "1950.00",
        proposedAmount: "2250.00",
        difference: "300.00",
        currency: "USD",
        frequency: "monthly",
        interval: 2,
      },
    ],
    basis: "No changes saved",
  });
  expect(text).toContain("2026-01-01 through 2026-09-30");
  expect(text).toContain("2026-10-01 through ongoing");
  expect(text).toContain("150.00 USD per monthly period");
  expect(text).toContain("300.00 USD per recurrence (monthly, interval 2)");
});

test("ranked financial views sort exact amounts before limiting and never rank unlike currencies", () => {
  const report = {
    reportType: "financial", metric: "expenses", from: "2026-08-01", through: "2026-08-31",
    totals: [{ type: "Expense", currency: "USD", amount: "12.00" }],
    rows: [
      { period: "2026-08", account: "Alpha", type: "Expense", currency: "USD", amount: "2.00" },
      { period: "2026-08", account: "Beta", type: "Expense", currency: "USD", amount: "10.00" },
    ], basis: "Recorded expenses", coverage: "Fixture",
  };
  const text = presentReport(report, "by_account", 0, 1, "amount_desc");
  expect(text).toContain("| All selected dates | Beta | Expense | 10.00 USD |");
  expect(text).not.toContain("| All selected dates | Alpha");
  expect(text).toContain("12.00 USD");
  expect(text).toContain("of 2");
  report.rows[1].currency = "EUR";
  expect(() => presentReport(report, "by_account", 0, 1, "amount_desc")).toThrow("one currency");
});

test("ranking profit periods uses income minus expenses, not the largest revenue", () => {
  const text = presentReport({
    reportType: "financial", metric: "profit_loss", from: "2026-06-01", through: "2026-07-31",
    profitLoss: [{ currency: "USD", income: "195.00", expense: "100.00", netRecordedIncome: "95.00" }],
    rows: [
      { period: "2026-06", account: "Sales", type: "Income", currency: "USD", amount: "100.00" },
      { period: "2026-06", account: "Costs", type: "Expense", currency: "USD", amount: "80.00" },
      { period: "2026-07", account: "Sales", type: "Income", currency: "USD", amount: "95.00" },
      { period: "2026-07", account: "Costs", type: "Expense", currency: "USD", amount: "20.00" },
    ], basis: "Recorded profit", coverage: "Fixture",
  }, "by_period", 0, 1, "amount_desc");
  expect(text).toContain("| 2026-07 | Net recorded income | Income less expenses | 75.00 USD |");
  expect(text).not.toContain("| 2026-06 | Net recorded income");
});

test('cash scenarios show the incremental baseline difference for recurring replacements without one-off movements', () => {
 const text = presentReport({reportType:'cash',from:'2026-09-18',through:'2026-10-31',reports:[{
  currency:'USD',opening:'1000.00',projectedClosing:'3900.00',lowestProjected:'1000.00',lowestDate:'2026-09-18',firstNegativeDate:null,
  baselineClosing:'3700.00',hypotheticalClosingChange:'200.00',accounts:[],hypothetical:[],issues:[],
  recurringChanges:[{schedule:'Rent',effectiveDate:'2026-10-01',recordedAmount:'2700.00',proposedAmount:'2900.00',difference:'200.00',currency:'USD',frequency:'monthly',interval:1}],
 }],basis:'Read only'});
 expect(text).toContain('Closing without these hypothetical changes: **3700.00 USD**');
 expect(text).toContain('Change in projected closing: **200.00 USD**');
 expect(text).toContain('| Rent | 2026-10-01 | 2700.00 USD | 2900.00 USD | 200.00 USD / monthly |');
 expect(text).not.toContain('Additional one-off');
});

test('ordinary period views expose net profit and its peak without requiring a separate ranking instruction', () => {
 const report = { reportType:'financial',metric:'profit_loss',from:'2025-01-01',through:'2026-12-31',
  profitLoss:[{currency:'USD',income:'190.00',expense:'135.00',netRecordedIncome:'55.00'}],
  rows:[{period:'2025',account:'Sales',type:'Income',currency:'USD',amount:'100.00'},
   {period:'2025',account:'Costs',type:'Expense',currency:'USD',amount:'95.00'},
   {period:'2026',account:'Sales',type:'Income',currency:'USD',amount:'90.00'},
   {period:'2026',account:'Costs',type:'Expense',currency:'USD',amount:'40.00'}],basis:'Recorded',coverage:'Fixture'};
 const text=presentReport(report,'by_period');
 expect(text).toContain('Highest recorded net income among periods with matching entries: **2026 — 50.00 USD**');
 expect(text).toContain('| 2025 | Net recorded income | Income less expenses | 5.00 USD |');
 expect(text).toContain('| 2026 | Net recorded income | Income less expenses | 50.00 USD |');
});
