import { add } from "../../convex/lib/domain";
import type {
  InsightData,
  Filters,
  Posting,
  Account,
  Bucket,
  Budget,
} from "./types";
export const DAY = 86400000;
export const dateNumber = (date: string) => Date.parse(date + "T00:00:00Z");
export const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function monthShift(date: string, months: number) {
  const d = new Date(dateNumber(date));
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}
export function periodKey(date: string, group: string) {
  return group === "year"
    ? date.slice(0, 4)
    : group === "quarter"
      ? `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`
      : date.slice(0, 7);
}
export const niceDate = (date: string) =>
  new Date(dateNumber(date)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
export function monthsBetween(start: string, end: string) {
  if (end < start) return [];
  const count =
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(end.slice(5, 7)) -
    Number(start.slice(5, 7));
  return Array.from({ length: Math.min(count + 1, 1201) }, (_, i) =>
    monthShift(start, i),
  );
}
export function postingValue(
  p: Posting,
  f: Pick<Filters, "entity" | "tag">,
): number {
  if (!f.entity && !f.tag) return p.amount;
  return p.portions.reduce(
    (total, part) => {
      if (f.tag && !p.tags.includes(f.tag) && !part.tags.includes(f.tag))
        return total;
      if (
        !f.entity ||
        part.subject === f.entity ||
        part.counterparty === f.entity
      )
        return add(total, part.amount);
      return add(
        total,
        ...part.beneficiaries
          .filter((b) => b.entity === f.entity)
          .map((b) => b.amount),
      );
    },
    !p.portions.length && !f.entity && p.tags.includes(f.tag) ? p.amount : 0,
  );
}
export function scopedPostings(data: InsightData, f: Filters, range = true) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  return data.postings.flatMap((p) => {
    const account = accounts.get(p.account);
    if (
      !account ||
      account.currency !== f.currency ||
      (f.chart && account.chart !== f.chart) ||
      p.date > f.end ||
      (range && p.date < f.start)
    )
      return [];
    const amount = postingValue(p, f);
    return amount === 0 ? [] : [{ ...p, amount, accountInfo: account }];
  });
}
export function balances(data: InsightData, f: Filters) {
  const totals = new Map<string, number>();
  for (const p of scopedPostings(data, f, false))
    totals.set(p.account, add(totals.get(p.account) ?? 0, p.amount));
  return data.accounts
    .filter(
      (a) => a.currency === f.currency && (!f.chart || a.chart === f.chart),
    )
    .map((a) => ({
      ...a,
      raw: totals.get(a.id) ?? 0,
      value:
        (a.type === "Liability" || a.type === "Income" || a.type === "Equity"
          ? -1
          : 1) * (totals.get(a.id) ?? 0),
    }));
}
export function buckets(
  data: InsightData,
  f: Filters,
  group = "month",
): Bucket[] {
  const keys = [
    ...new Set(monthsBetween(f.start, f.end).map((d) => periodKey(d, group))),
  ];
  const rows = new Map(
    keys.map((key) => [
      key,
      {
        key,
        label:
          key.includes("Q") || key.length === 4
            ? key
            : new Date(key + "-01T00:00:00Z").toLocaleDateString("en-US", {
                month: "short",
                year: "2-digit",
                timeZone: "UTC",
              }),
        income: 0,
        expense: 0,
        net: 0,
        assets: 0,
        liabilities: 0,
        worth: 0,
      },
    ]),
  );
  let assets = 0,
    liabilities = 0;
  for (const p of scopedPostings(data, f, false).sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    const row = rows.get(periodKey(p.date, group));
    if (p.accountInfo.type === "Asset") {
      if (p.date < f.start) assets = add(assets, p.amount);
      else if (row) row.assets = add(row.assets, p.amount);
    }
    if (p.accountInfo.type === "Liability") {
      if (p.date < f.start) liabilities = add(liabilities, -p.amount);
      else if (row) row.liabilities = add(row.liabilities, -p.amount);
    }
    if (!row || p.date < f.start) continue;
    if (p.accountInfo.type === "Income")
      row.income = add(row.income, -p.amount);
    if (p.accountInfo.type === "Expense")
      row.expense = add(row.expense, p.amount);
  }
  return [...rows.values()].map((row) => {
    assets = add(assets, row.assets);
    liabilities = add(liabilities, row.liabilities);
    return {
      ...row,
      net: add(row.income, -row.expense),
      assets,
      liabilities,
      worth: add(assets, -liabilities),
    };
  });
}
export function accountTotals(data: InsightData, f: Filters, type: string) {
  const totals = new Map<string, number>();
  for (const p of scopedPostings(data, f))
    if (p.accountInfo.type === type)
      totals.set(
        p.account,
        add(
          totals.get(p.account) ?? 0,
          p.amount * (type === "Income" ? -1 : 1),
        ),
      );
  return data.accounts
    .filter((a) => totals.has(a.id))
    .map((a) => ({ id: a.id, label: a.name, value: totals.get(a.id)! }))
    .sort((a, b) => b.value - a.value);
}
export function filteredEvents(data: InsightData, f: Filters) {
  const postingEvents = new Set(
    data.postings.filter((p) => postingValue(p, f) !== 0).map((p) => p.event),
  );
  return data.events.filter(
    (e) =>
      e.date >= f.start &&
      e.date <= f.end &&
      (!f.entity || e.targets.includes(f.entity) || postingEvents.has(e.id)) &&
      (!f.tag || e.tags.includes(f.tag) || postingEvents.has(e.id)),
  );
}
export function filteredFlows(data: InsightData, f: Filters) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  return data.flows.filter(
    (x) =>
      x.amount !== 0 &&
      x.currency === f.currency &&
      (!f.chart || (x.account && accounts.get(x.account)?.chart === f.chart)) &&
      (!f.entity || x.entities.includes(f.entity)) &&
      (!f.tag || x.tags.includes(f.tag)),
  );
}
export function budgetActual(
  data: InsightData,
  target: Budget,
  cutoff: string,
) {
  const f = {
    start: target.start,
    end: target.end < cutoff ? target.end : cutoff,
    currency: target.currency,
    chart: target.chart,
    entity: "",
    tag: "",
  };
  const targets = target.scopeTargets ? new Set(target.scopeTargets) : null;
  return scopedPostings(data, f)
    .filter(
      (p) =>
        (!target.account || p.account === target.account) &&
        p.accountInfo.type ===
          (target.measure === "income" ? "Income" : "Expense"),
    )
    .reduce((sum, p) => {
      // Published tag targets are frozen. Never reinterpret them using today's tags.
      const wholePosting =
        !targets ||
        [p.id, p.journal, p.event, p.account].some((id) => targets.has(id));
      let amount: number;
      if (wholePosting)
        amount = postingValue(p, { entity: target.subject ?? "", tag: "" });
      else
        amount = p.portions.reduce((total, part) => {
          const wholePart = [
            part.id,
            part.subject,
            part.arrangement,
            part.counterparty,
          ].some((id) => id && targets!.has(id));
          const subjectMatchesPart =
            !target.subject ||
            part.subject === target.subject ||
            part.counterparty === target.subject;
          if (wholePart && subjectMatchesPart) return add(total, part.amount);
          return add(
            total,
            ...part.beneficiaries
              .filter(
                (b) =>
                  (wholePart || (b.entity && targets!.has(b.entity))) &&
                  (subjectMatchesPart || b.entity === target.subject),
              )
              .map((b) => b.amount),
          );
        }, 0);
      return add(sum, amount * (target.measure === "income" ? -1 : 1));
    }, 0);
}
export const cashAccount = (a: Account) =>
  a.type === "Asset" &&
  !!a.financialKind &&
  /checking|savings|cash|deposit|money.?market/i.test(a.financialKind);
export type ProjectionInput = {
  opening: number;
  monthlyIncome: number;
  monthlyExpense: number;
  incomeChange: number;
  expenseChange: number;
  annualGrowth: number;
  shock: number;
  months: number;
  start: string;
};
/** Deliberately a local what-if model. No compounding of an invented investment return. */
export function project(input: ProjectionInput) {
  let base = input.opening,
    adjusted = input.opening;
  return [
    {
      key: input.start.slice(0, 7),
      label: "Start",
      base,
      adjusted,
      stress: adjusted,
    },
    ...Array.from({ length: input.months }, (_, index) => {
      const growth = (1 + input.annualGrowth / 100) ** (index / 12);
      base += input.monthlyIncome - input.monthlyExpense;
      adjusted +=
        Math.round(
          input.monthlyIncome * (1 + input.incomeChange / 100) -
            input.monthlyExpense * (1 + input.expenseChange / 100) * growth,
        ) - (index === 0 ? input.shock : 0);
      return {
        key: monthShift(input.start, index + 1).slice(0, 7),
        label: new Date(
          dateNumber(monthShift(input.start, index + 1)),
        ).toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
          timeZone: "UTC",
        }),
        base,
        adjusted,
        stress: Math.round(adjusted - input.monthlyIncome * 0.1 * (index + 1)),
      };
    }),
  ];
}
export function goalMonths(current: number, target: number, monthly: number) {
  return current >= target
    ? 0
    : monthly > 0
      ? Math.ceil((target - current) / monthly)
      : null;
}
export function csv(rows: (string | number)[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          // Spreadsheet formula injection protection for labels from user records.
          const safe =
            typeof value === "string" && /^[=+@\-\t\r]/.test(text)
              ? "'" + text
              : text;
          return '"' + safe.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
/** Fixed-rate monthly illustration with rounded minor-unit interest and a capped final payment. */
export function amortizeDebt(
  principal: number,
  aprBps: number,
  payment: number,
  extra: number,
  limit = 600,
) {
  const rows = [
    { month: 0, balance: principal, interest: 0, principalPaid: 0, payment: 0 },
  ];
  let balance = principal,
    interestTotal = 0;
  for (let month = 1; month <= limit && balance > 0; month++) {
    const interest = Number(
      (BigInt(balance) * BigInt(aprBps) + 60000n) / 120000n,
    );
    const paid = Math.min(balance + interest, payment + extra);
    if (paid <= interest)
      return { rows, months: null, interest: interestTotal, stalled: true };
    const principalPaid = paid - interest;
    balance -= principalPaid;
    interestTotal += interest;
    rows.push({ month, balance, interest, principalPaid, payment: paid });
  }
  return {
    rows,
    months: balance > 0 ? null : rows.length - 1,
    interest: interestTotal,
    stalled: false,
  };
}
