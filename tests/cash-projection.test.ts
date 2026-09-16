import { expect, test } from "vitest";
import {
  bankProjection,
  occurrences,
  entityContribution,
} from "../lib/insights/cash-projection";
import type { CashSchedule, InsightData, Posting } from "../lib/insights/types";
const data: InsightData = {
  entities: [
    { id: "house", name: "Oak House", kind: "House" },
    { id: "alex", name: "Alex", kind: "Person" },
  ],
  arrangements: [],
  accounts: [
    {
      id: "a",
      name: "Bills",
      type: "Asset",
      chart: "home",
      currency: "USD",
      financialKind: "checking",
    },
    {
      id: "b",
      name: "Savings",
      type: "Asset",
      chart: "home",
      currency: "USD",
      financialKind: "savings",
    },
    {
      id: "income",
      name: "Rent",
      type: "Income",
      chart: "home",
      currency: "USD",
    },
    {
      id: "expense",
      name: "Costs",
      type: "Expense",
      chart: "home",
      currency: "USD",
    },
    {
      id: "euro",
      name: "Euro",
      type: "Asset",
      chart: "home",
      currency: "EUR",
      financialKind: "checking",
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
const p = (
  id: string,
  account: string,
  amount: number,
  date: string,
): Posting => ({
  id,
  journal: id,
  account,
  amount,
  date,
  event: id,
  memo: id,
  portions: [],
  tags: [],
});
const options = {
  accountIds: ["a", "b"],
  start: "2026-01-01",
  cutoff: "2026-06-16",
  end: "2026-09-30",
  schedules: true,
  assumptions: false,
  overdue: true,
};
const schedule: CashSchedule = {
  id: "schedule",
  version: "v1",
  name: "Loan",
  currency: "USD",
  amount: 500,
  start: "2026-01-01",
  validFrom: "2026-01-01",
  frequency: "monthly",
  interval: 1,
  day: 1,
  debtor: "alex",
  creditor: "bank",
  timezone: "America/Chicago",
};
test("balances retain opening history; claims replace matching schedule and expected flow once; settled and void periods stay suppressed", () => {
  const d: InsightData = {
    ...data,
    postings: [
      p("open", "a", 1000, "2025-12-31"),
      p("other", "b", 200, "2026-02-01"),
    ],
    cashSchedules: [schedule],
    cashRoutes: [
      {
        source: "schedule",
        kind: "commitment_schedule",
        currency: "USD",
        revision: 1,
        from: "a",
      },
    ],
    obligations: [
      {
        id: "claim",
        name: "July partial claim",
        currency: "USD",
        date: "2026-07-01",
        debtor: "alex",
        creditor: "bank",
        amount: 300,
        original: 500,
        settled: 200,
        schedule: "schedule",
        occurrence: "schedule:schedule:monthly:2026-07",
      },
      {
        id: "paid",
        name: "Paid early",
        currency: "USD",
        date: "2026-08-01",
        debtor: "alex",
        creditor: "bank",
        amount: 0,
        original: 500,
        settled: 500,
        schedule: "schedule",
        occurrence: "schedule:schedule:monthly:2026-08",
      },
    ],
    blockedCashOccurrences: ["schedule:schedule:monthly:2026-09"],
    flows: [
      {
        id: "flow",
        name: "Partial remainder",
        date: "2026-07-05",
        currency: "USD",
        amount: -300,
        account: "a",
        obligation: "claim",
        occurrence: "schedule:schedule:monthly:2026-07",
        source: "Outstanding obligation",
        entities: [],
        tags: [],
      },
    ],
  };
  const result = bankProjection(d, options);
  expect(result.points[0].values.a).toBe(1000);
  expect(result.movements).toHaveLength(1);
  expect(result.movements[0]).toMatchObject({
    date: "2026-07-05",
    amount: -300,
  });
  expect(result.points.at(-1)?.total).toBe(900);
  expect(result.issues).toEqual([]);
});
test("internal transfers cancel only when both selected accounts are aggregated", () => {
  const d: InsightData = {
    ...data,
    postings: [p("open", "a", 1000, "2026-01-01")],
    obligations: [
      {
        id: "transfer",
        name: "Transfer",
        date: "2026-07-01",
        currency: "USD",
        creditor: "alex",
        debtor: "house",
        amount: 200,
        original: 200,
        settled: 0,
      },
    ],
    cashRoutes: [
      {
        source: "transfer",
        kind: "monetary_obligation",
        from: "a",
        to: "b",
        currency: "USD",
        revision: 1,
      },
    ],
  };
  const both = bankProjection(d, options);
  expect(both.movements.map((m) => m.amount)).toEqual([-200, 200]);
  expect(both.points.at(-1)?.total).toBe(1000);
  expect(
    bankProjection(d, { ...options, accountIds: ["a"] }).points.at(-1)?.total,
  ).toBe(800);
  expect(
    bankProjection(d, { ...options, accountIds: ["b"] }).points.at(-1)?.total,
  ).toBe(200);
  expect(() =>
    bankProjection(d, { ...options, accountIds: ["a", "euro"] }),
  ).toThrow(/single currency/);
});
test("overdue catch-up is explicit, missing routing is flagged, assumptions opt in, explicit schedule expectations suppress expansion", () => {
  const d: InsightData = {
    ...data,
    cashSchedules: [schedule],
    cashRoutes: [
      {
        source: "schedule",
        kind: "commitment_schedule",
        from: "a",
        currency: "USD",
        revision: 1,
      },
    ],
    obligations: [
      {
        id: "late",
        name: "Late bill",
        date: "2026-06-01",
        currency: "USD",
        creditor: "shop",
        debtor: "alex",
        amount: 100,
        original: 100,
        settled: 0,
      },
    ],
    flows: [
      {
        id: "late-flow",
        name: "Late",
        date: "2026-06-01",
        currency: "USD",
        amount: -100,
        account: "a",
        obligation: "late",
        source: "Outstanding obligation",
        entities: [],
        tags: [],
      },
      {
        id: "expect",
        name: "July expectation",
        date: "2026-07-03",
        currency: "USD",
        amount: -400,
        account: "a",
        occurrence: "schedule:schedule:monthly:2026-07",
        source: "Scheduled expectation",
        entities: [],
        tags: [],
      },
      {
        id: "assume",
        name: "Future work",
        date: "2026-08-10",
        currency: "USD",
        amount: -300,
        account: "a",
        source: "Assumption",
        entities: [],
        tags: [],
      },
    ],
  };
  const rows = bankProjection(d, options).movements;
  expect(rows.find((r) => r.source === "late")).toMatchObject({
    date: "2026-06-17",
    overdue: true,
  });
  expect(
    rows.filter((r) => r.date.startsWith("2026-07")).map((r) => r.amount),
  ).toEqual([-400]);
  expect(rows.some((r) => r.kind === "Assumption")).toBe(false);
  expect(
    bankProjection(d, { ...options, overdue: false }).movements.some(
      (r) => r.overdue,
    ),
  ).toBe(false);
  expect(
    bankProjection(d, { ...options, assumptions: true }).movements.some(
      (r) => r.kind === "Assumption",
    ),
  ).toBe(true);
  expect(
    bankProjection({ ...d, cashRoutes: [], flows: [] }, options)
      .issues.map((i) => i.source)
      .sort(),
  ).toEqual(["late", "schedule"]);
});
test("recurrences clamp month ends, respect intervals, exclusive boundaries and scheduled-version changes", () => {
  const s = { ...schedule, start: "2026-01-31", day: 31 };
  expect(
    occurrences(s, undefined, "2026-01-31", "2026-04-30").map((r) => r.date),
  ).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  expect(
    occurrences(
      { ...s, interval: 2, end: "2026-05-31" },
      undefined,
      "2026-01-31",
      "2026-06-01",
    ).map((r) => r.date),
  ).toEqual(["2026-03-31"]);
  expect(
    occurrences(
      { ...s, validFrom: "2026-03-01", validTo: "2026-04-01" },
      undefined,
      "2026-01-01",
      "2026-06-01",
    ).map((r) => r.date),
  ).toEqual(["2026-03-31"]);
  expect(
    occurrences(
      { ...s, start: "2024-02-29", frequency: "yearly", day: 29 },
      undefined,
      "2026-01-01",
      "2026-12-31",
    )[0].date,
  ).toBe("2026-02-28");
});
test("net payroll splits exactly and only unpaid future dates remain after cutoff", () => {
  const route = {
    source: "schedule",
    kind: "commitment_schedule" as const,
    currency: "USD",
    revision: 1,
    to: "a",
    amount: 101,
    days: [15, 28],
  };
  expect(
    occurrences(schedule, route, "2026-06-01", "2026-06-30").map(
      (r) => r.amount,
    ),
  ).toEqual([51, 50]);
  expect(
    occurrences(schedule, route, "2026-06-16", "2026-06-30"),
  ).toMatchObject([{ date: "2026-06-28", amount: 50 }]);
});
test("entity comparison partitions subjects, keeps refunds, retains unclassified amounts, and separates accrual from bank cash", () => {
  const d = {
    ...data,
    postings: [
      {
        ...p("rent", "income", -200, "2026-04-01"),
        portions: [
          {
            amount: -200,
            subject: "house",
            tags: [],
            beneficiaries: [{ entity: "alex", amount: -200 }],
          },
        ],
      },
      {
        ...p("cost", "expense", 100, "2026-04-01"),
        portions: [
          {
            amount: 30,
            subject: "house",
            tags: ["project"],
            beneficiaries: [],
          },
          { amount: 70, subject: "alex", tags: [], beneficiaries: [] },
        ],
      },
      {
        ...p("refund", "expense", -10, "2026-04-02"),
        portions: [
          { amount: -10, subject: "alex", tags: [], beneficiaries: [] },
        ],
      },
      p("unknown", "expense", 20, "2026-04-03"),
      {
        ...p("mortgage", "a", -150, "2026-04-01"),
        portions: [
          { amount: -150, subject: "house", tags: [], beneficiaries: [] },
        ],
      },
    ],
  };
  const f = {
    start: "2026-01-01",
    end: "2026-06-30",
    currency: "USD",
    chart: "home",
    tag: "",
    basis: "accrual" as const,
  };
  const r = entityContribution(d, f);
  expect(r.rows.find((r) => r.id === "house")).toMatchObject({
    income: 200,
    expense: 30,
    net: 170,
  });
  expect(r.rows.find((r) => r.id === "alex")).toMatchObject({
    income: 0,
    expense: 60,
  });
  expect(r.rows.find((r) => r.id === "unclassified")?.expense).toBe(20);
  expect(entityContribution(d, { ...f, tag: "project" }).rows).toHaveLength(1);
  expect(entityContribution(d, { ...f, basis: "cash" }).rows[0]).toMatchObject({
    id: "house",
    income: 0,
    expense: 150,
    net: -150,
  });
});

test("a fully fulfilled expected schedule occurrence is not forecast a second time", () => {
  const result = bankProjection(
    {
      ...data,
      cashSchedules: [schedule],
      cashRoutes: [
        {
          source: "schedule",
          kind: "commitment_schedule",
          currency: "USD",
          revision: 1,
          from: "a",
        },
      ],
      flows: [
        {
          id: "paid",
          name: "Paid early",
          date: "2026-07-01",
          currency: "USD",
          amount: 0,
          account: "a",
          occurrence: "schedule:schedule:monthly:2026-07",
          source: "Scheduled expectation",
          entities: [],
          tags: [],
        },
      ],
    },
    options,
  );
  expect(result.movements.map((m) => m.date)).toEqual([
    "2026-08-01",
    "2026-09-01",
  ]);
});
