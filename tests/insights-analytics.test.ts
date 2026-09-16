import { expect, test } from "vitest";
import {
  amortizeDebt,
  balances,
  budgetActual,
  buckets,
  csv,
  filteredEvents,
  filteredFlows,
  goalMonths,
  monthsBetween,
  postingValue,
  project,
  scopedPostings,
} from "../lib/insights/analytics";
import type { InsightData, Filters, Posting } from "../lib/insights/types";
const filters: Filters = {
  start: "2026-01-01",
  end: "2026-03-31",
  currency: "USD",
  chart: "home",
  entity: "",
  tag: "",
};
const data: InsightData = {
  entities: [],
  arrangements: [],
  accounts: [
    {
      id: "cash",
      name: "Cash",
      chart: "home",
      type: "Asset",
      currency: "USD",
      financialKind: "checking",
    },
    {
      id: "debt",
      name: "Debt",
      chart: "home",
      type: "Liability",
      currency: "USD",
    },
    {
      id: "income",
      name: "Income",
      chart: "home",
      type: "Income",
      currency: "USD",
    },
    {
      id: "expense",
      name: "Expense",
      chart: "home",
      type: "Expense",
      currency: "USD",
    },
    { id: "eur", name: "Euro", chart: "home", type: "Asset", currency: "EUR" },
    {
      id: "company",
      name: "Company",
      chart: "business",
      type: "Asset",
      currency: "USD",
    },
  ],
  charts: [],
  tags: [],
  links: [],
  ownership: [],
  postings: [],
  events: [],
  measurements: [],
  obligations: [],
  flows: [],
  budgets: [],
  versions: [],
  schedules: [],
  coverage: {
    untypedMeasurements: 0,
    draftJournals: 0,
    unclassifiedPostings: 0,
  },
};
function p(
  id: string,
  account: string,
  amount: number,
  date = "2026-01-15",
): Posting {
  return {
    id,
    journal: id,
    account,
    amount,
    date,
    event: id,
    memo: id,
    portions: [],
    tags: [],
  };
}
const fixture = {
  ...data,
  postings: [
    p("opening", "cash", 10000, "2025-12-31"),
    p("debt-start", "debt", -3000, "2025-12-31"),
    p("pay", "cash", 5000),
    p("salary", "income", -5000),
    p("groceries", "expense", 2000),
    p("payment", "cash", -2000),
    p("refund", "expense", -500, "2026-03-01"),
    p("refund-cash", "cash", 500, "2026-03-01"),
    p("other-currency", "eur", 999999),
    p("other-chart", "company", 888888),
    p("future", "cash", 1000, "2026-04-01"),
  ],
};
test("balances include openings, preserve signs and isolate currency/chart/cutoff; periods retain zero months", () => {
  const rows = buckets(fixture, filters);
  expect(rows.map((r) => r.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
  expect(rows.map((r) => r.worth)).toEqual([10000, 10000, 10500]);
  expect(rows.map((r) => r.net)).toEqual([3000, 0, 500]);
  expect(rows[2].expense).toBe(-500);
  expect(balances(fixture, filters).find((a) => a.id === "debt")?.value).toBe(
    3000,
  );
  expect(scopedPostings(fixture, filters).map((p) => p.id)).not.toContain(
    "opening",
  );
  expect(buckets(fixture, filters, "quarter")[0]).toMatchObject({
    key: "2026-Q1",
    income: 5000,
    expense: 1500,
    worth: 10500,
  });
  expect(buckets(fixture, filters, "year")[0].net).toBe(3500);
});
test("person/project filters use matching portions and beneficiary amounts, without double counting subject matches", () => {
  const posting = {
    ...p("p", "expense", 1000),
    portions: [
      {
        id: "part",
        amount: 700,
        subject: "family",
        tags: ["project"],
        beneficiaries: [
          { entity: "alex", amount: 300 },
          { entity: "jamie", amount: 400 },
        ],
      },
      {
        amount: 300,
        subject: "alex",
        tags: [],
        beneficiaries: [{ entity: "alex", amount: 300 }],
      },
    ],
  };
  expect(postingValue(posting, { entity: "alex", tag: "" })).toBe(600);
  expect(postingValue(posting, { entity: "alex", tag: "project" })).toBe(300);
  expect(postingValue(posting, { entity: "family", tag: "project" })).toBe(700);
  expect(postingValue(posting, { entity: "nobody", tag: "project" })).toBe(0);
  expect(
    postingValue(
      { ...p("empty", "expense", 100), tags: ["project"] },
      { entity: "", tag: "project" },
    ),
  ).toBe(100);
});
test("budget actuals use saved target period, exact scope and frozen tag membership", () => {
  const posting = {
    ...p("p", "expense", 1000),
    portions: [
      {
        id: "part",
        amount: 1000,
        subject: "family",
        tags: ["new-tag"],
        beneficiaries: [
          { entity: "alex", amount: 300 },
          { entity: "jamie", amount: 700 },
        ],
      },
    ],
  };
  const d = { ...data, postings: [posting] };
  const target = {
    id: "budget",
    name: "Food",
    version: "v1",
    start: "2026-01-01",
    end: "2026-01-31",
    measure: "expense" as const,
    chart: "home",
    amount: 2000,
    currency: "USD",
    status: "published",
    tags: ["old-tag"],
    scopeTargets: ["part"],
  };
  expect(budgetActual(d, target, filters.end)).toBe(1000);
  expect(budgetActual(d, { ...target, subject: "alex" }, filters.end)).toBe(
    300,
  );
  expect(
    budgetActual(d, { ...target, scopeTargets: ["alex"] }, filters.end),
  ).toBe(300);
  expect(budgetActual(d, { ...target, scopeTargets: [] }, filters.end)).toBe(0);
  expect(budgetActual(d, target, "2025-12-31")).toBe(0);
});
test("event and expected-flow scope do not leak nonmatching person/project/chart records", () => {
  const d = {
    ...data,
    postings: [
      {
        ...p("posted", "expense", 100),
        event: "one",
        portions: [
          {
            amount: 100,
            subject: "alex",
            tags: ["project"],
            beneficiaries: [],
          },
        ],
      },
    ],
    events: [
      {
        id: "one",
        name: "One",
        date: "2026-01-01",
        kind: "Purchase",
        targets: [],
        tags: [],
      },
      {
        id: "two",
        name: "Two",
        date: "2026-01-01",
        kind: "Purchase",
        targets: [],
        tags: [],
      },
    ],
    flows: [
      {
        id: "f",
        name: "Forecast",
        date: "2026-04-01",
        amount: 100,
        currency: "USD",
        account: "cash",
        entities: ["alex"],
        tags: ["project"],
        source: "Assumption",
      },
    ],
  };
  expect(
    filteredEvents(d, { ...filters, entity: "alex", tag: "project" }).map(
      (e) => e.id,
    ),
  ).toEqual(["one"]);
  expect(filteredFlows(d, { ...filters, chart: "business" })).toHaveLength(0);
  expect(filteredFlows(d, { ...filters, entity: "jamie" })).toHaveLength(0);
});
test("what-if math, shocks and savings goals handle shortfalls and zero contributions", () => {
  const rows = project({
    opening: 1000,
    monthlyIncome: 300,
    monthlyExpense: 200,
    incomeChange: 0,
    expenseChange: 0,
    annualGrowth: 0,
    shock: 500,
    months: 3,
    start: "2026-01-31",
  });
  expect(rows.map((r) => r.base)).toEqual([1000, 1100, 1200, 1300]);
  expect(rows.map((r) => r.adjusted)).toEqual([1000, 600, 700, 800]);
  expect(rows.at(-1)?.stress).toBe(710);
  expect(rows.map((r) => r.key)).toEqual([
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
  ]);
  expect(goalMonths(1000, 500, 0)).toBe(0);
  expect(goalMonths(0, 1000, 0)).toBeNull();
  expect(goalMonths(0, 1000, 300)).toBe(4);
});
test("calendar ranges and CSV exports preserve boundaries and block spreadsheet formulas", () => {
  expect(monthsBetween("2025-12-31", "2026-02-28")).toEqual([
    "2025-12-01",
    "2026-01-01",
    "2026-02-01",
  ]);
  expect(monthsBetween("2026-03-01", "2026-01-01")).toEqual([]);
  expect(csv([['=HYPERLINK("bad")', "a,b", -125]])).toBe(
    '"\'=HYPERLINK(""bad"")","a,b","-125"',
  );
});

test("debt illustrations round interest, cap final payment, support zero rate and detect stalled repayment", () => {
  const base = amortizeDebt(100000, 600, 10000, 0);
  const faster = amortizeDebt(100000, 600, 10000, 5000);
  expect(faster.months!).toBeLessThan(base.months!);
  expect(faster.interest).toBeLessThan(base.interest);
  expect(base.rows.at(-1)?.balance).toBe(0);
  expect(base.rows.at(-1)!.payment).toBeLessThan(10000);
  expect(amortizeDebt(1000, 0, 400, 0).rows.map((r) => r.balance)).toEqual([
    1000, 600, 200, 0,
  ]);
  expect(amortizeDebt(100000, 1200, 100, 0).stalled).toBe(true);
  expect(base.rows.reduce((sum, row) => sum + row.principalPaid, 0)).toBe(
    100000,
  );
});
