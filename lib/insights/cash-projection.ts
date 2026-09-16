import { add } from "../../convex/lib/domain";
import type { CashRoute, CashSchedule, InsightData } from "./types";
import { cashAccount, dateNumber, DAY, iso, monthShift } from "./analytics";
export type CashMovement = {
  id: string;
  source: string;
  name: string;
  date: string;
  amount: number;
  account: string;
  kind: "Obligation" | "Schedule" | "Expectation" | "Assumption";
  overdue: boolean;
};
export type CashIssue = { source: string; name: string; reason: string };
export type CashPoint = {
  date: string;
  values: Record<string, number>;
  total: number;
};
export type ProjectionOptions = {
  accountIds: string[];
  start: string;
  cutoff: string;
  end: string;
  schedules: boolean;
  assumptions: boolean;
  overdue: boolean;
};
const clampedDay = (year: number, month: number, day: number) =>
  iso(
    Date.UTC(
      year,
      month,
      Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()),
    ),
  );
/** Civil dates follow the schedule's calendar; month-end dates clamp, never roll into the next month. */
export function occurrences(
  s: CashSchedule,
  route: CashRoute | undefined,
  after: string,
  through: string,
) {
  const amount = route?.amount ?? s.amount;
  if (amount === undefined) return [];
  const start = new Date(dateNumber(s.start));
  const result: { date: string; amount: number; key: string }[] = [];
  const append = (date: string, amount: number, period: string) => {
    if (
      date > after &&
      date <= through &&
      date >= s.start &&
      (!s.end || date < s.end) &&
      date >= s.validFrom &&
      (!s.validTo || date < s.validTo)
    )
      result.push({
        date,
        amount,
        key: `schedule:${s.id}:${s.frequency}:${period}`,
      });
  };
  if (s.frequency === "once") append(s.start, amount, "once");
  else if (s.frequency === "daily" || s.frequency === "weekly") {
    const span = s.interval * (s.frequency === "weekly" ? 7 : 1) * DAY;
    const first = Math.max(
      0,
      Math.floor((dateNumber(after) - dateNumber(s.start)) / span),
    );
    for (let n = first; ; n++) {
      const date = iso(dateNumber(s.start) + n * span);
      if (date > through) break;
      append(date, amount, date);
    }
  } else if (s.frequency === "monthly") {
    const monthDiff =
      (Number(after.slice(0, 4)) - start.getUTCFullYear()) * 12 +
      Number(after.slice(5, 7)) -
      1 -
      start.getUTCMonth();
    const days = route?.days ?? [s.day ?? start.getUTCDate()];
    for (let n = Math.max(0, Math.floor(monthDiff / s.interval)); ; n++) {
      const month = monthShift(s.start, n * s.interval);
      if (month > through) break;
      const year = Number(month.slice(0, 4)),
        m = Number(month.slice(5, 7)) - 1;
      days.forEach((day, i) =>
        append(
          clampedDay(year, m, day),
          Math.floor(amount / days.length) + (i < amount % days.length ? 1 : 0),
          month.slice(0, 7),
        ),
      );
    }
  } else if (s.frequency === "yearly") {
    for (
      let n = Math.max(
        0,
        Math.floor(
          (Number(after.slice(0, 4)) - start.getUTCFullYear()) / s.interval,
        ),
      );
      ;
      n++
    ) {
      const year = start.getUTCFullYear() + n * s.interval;
      const date = clampedDay(
        year,
        start.getUTCMonth(),
        s.day ?? start.getUTCDate(),
      );
      if (date > through) break;
      append(date, amount, String(year));
    }
  }
  return result;
}
export function bankProjection(data: InsightData, options: ProjectionOptions) {
  const accounts = data.accounts.filter(
    (a) => cashAccount(a) && options.accountIds.includes(a.id),
  );
  if (new Set(accounts.map((a) => a.currency)).size > 1)
    throw new Error("Bank balances must use a single currency");
  const currency = accounts[0]?.currency;
  const selected = new Set(accounts.map((a) => a.id));
  const routes = new Map(
    (data.cashRoutes ?? [])
      .filter((r) => r.currency === currency)
      .map((r) => [r.source, r]),
  );
  const issues: CashIssue[] = [],
    movements: CashMovement[] = [];
  const blocked = new Set([
    ...(data.blockedCashOccurrences ?? []),
    ...data.obligations
      .map((o) => o.occurrence)
      .filter((s): s is string => !!s),
  ]);
  const availableCash = new Set(
    data.accounts
      .filter((a) => cashAccount(a) && a.currency === currency)
      .map((a) => a.id),
  );
  const emit = (
    source: string,
    name: string,
    date: string,
    amount: number,
    kind: CashMovement["kind"],
    route?: CashRoute,
    fallback?: { account?: string; amount: number },
  ) => {
    const overdue = date <= options.cutoff;
    if (overdue && !options.overdue) return;
    date = overdue ? iso(dateNumber(options.cutoff) + DAY) : date;
    if (date > options.end) return;
    const legs = route
      ? [
          { account: route.from, amount: -amount },
          { account: route.to, amount },
        ]
      : [
          {
            account: fallback?.account,
            amount: Math.sign(fallback?.amount ?? 0) * amount,
          },
        ];
    if (!legs.some((l) => l.account && availableCash.has(l.account))) {
      issues.push({ source, name, reason: "No bank account assigned" });
      return;
    }
    for (const [i, leg] of legs.entries())
      if (leg.account && selected.has(leg.account))
        movements.push({
          id: `${source}:${date}:${kind}:${i}:${movements.length}`,
          source,
          name,
          date,
          amount: leg.amount,
          account: leg.account,
          kind,
          overdue,
        });
  };
  for (const o of data.obligations.filter(
    (o) => o.currency === currency && o.amount > 0,
  )) {
    const linked = data.flows.find(
      (f) => f.obligation === o.id && f.amount !== 0,
    );
    emit(
      o.id,
      o.name,
      linked?.date ?? o.date,
      o.amount,
      "Obligation",
      routes.get(o.id) ?? (o.schedule ? routes.get(o.schedule) : undefined),
      linked,
    );
  }
  for (const f of data.flows.filter(
    (f) => f.currency === currency && !f.obligation,
  )) {
    const isAssumption = f.source === "Assumption";
    if (isAssumption && !options.assumptions) continue;
    if (f.occurrence) blocked.add(f.occurrence);
    if (f.amount === 0) continue;
    emit(
      f.id,
      f.name,
      f.date,
      Math.abs(f.amount),
      isAssumption ? "Assumption" : "Expectation",
      undefined,
      f,
    );
  }
  if (options.schedules)
    for (const s of (data.cashSchedules ?? []).filter(
      (s) =>
        s.currency === currency &&
        s.start <= options.end &&
        s.validFrom <= options.end &&
        (!s.validTo || s.validTo > options.cutoff) &&
        (!s.end || s.end > options.cutoff),
    )) {
      const route = routes.get(s.id);
      if (s.amount === undefined && route?.amount === undefined) {
        issues.push({
          source: s.id,
          name: s.name,
          reason: "Variable amount needs an explicit cash estimate",
        });
        continue;
      }
      for (const row of occurrences(s, route, options.cutoff, options.end))
        if (!blocked.has(row.key))
          emit(s.id, s.name, row.date, row.amount, "Schedule", route);
    }
  movements.sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
  const historical = data.postings
    .filter((p) => selected.has(p.account) && p.date <= options.cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = [
    ...new Set([
      options.start,
      options.cutoff,
      options.end,
      ...historical.filter((p) => p.date >= options.start).map((p) => p.date),
      ...movements.map((m) => m.date),
    ]),
  ]
    .filter((d) => d >= options.start && d <= options.end)
    .sort();
  const values: Record<string, number> = Object.fromEntries(
    accounts.map((a) => [a.id, 0]),
  );
  for (const p of historical.filter((p) => p.date < options.start))
    values[p.account] = add(values[p.account], p.amount);
  const byDate = new Map<string, { account: string; amount: number }[]>();
  for (const p of [
    ...historical.filter((p) => p.date >= options.start),
    ...movements,
  ])
    byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
  const points: CashPoint[] = dates.map((date) => {
    for (const p of byDate.get(date) ?? [])
      values[p.account] = add(values[p.account], p.amount);
    return {
      date,
      values: { ...values },
      total: add(...Object.values(values)),
    };
  });
  return {
    accounts,
    points,
    movements,
    issues: [
      ...new Map(issues.map((i) => [`${i.source}:${i.reason}`, i])).values(),
    ],
    historical,
    cutoff: options.cutoff,
  };
}
export function entityContribution(
  data: InsightData,
  options: {
    start: string;
    end: string;
    currency: string;
    chart: string;
    tag: string;
    basis: "accrual" | "cash";
  },
) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const eventKinds = new Map(data.events.map((e) => [e.id, e.kind]));
  const lines: {
    entity: string;
    posting: string;
    date: string;
    memo: string;
    account: string;
    income: number;
    expense: number;
  }[] = [];
  for (const p of data.postings) {
    const account = accounts.get(p.account);
    if (
      !account ||
      account.currency !== options.currency ||
      (options.chart && account.chart !== options.chart) ||
      p.date < options.start ||
      p.date > options.end
    )
      continue;
    if (
      options.basis === "accrual" &&
      !["Income", "Expense"].includes(account.type)
    )
      continue;
    if (
      options.basis === "cash" &&
      (!cashAccount(account) || eventKinds.get(p.event) === "OpeningBalance")
    )
      continue;
    const parts = p.portions.length
      ? p.portions
      : [{ amount: p.amount, tags: [] as string[], subject: undefined }];
    for (const part of parts) {
      if (
        options.tag &&
        !p.tags.includes(options.tag) &&
        !part.tags.includes(options.tag)
      )
        continue;
      const signed = part.amount;
      const income =
        options.basis === "cash"
          ? Math.max(0, signed)
          : account.type === "Income"
            ? -signed
            : 0;
      const expense =
        options.basis === "cash"
          ? Math.max(0, -signed)
          : account.type === "Expense"
            ? signed
            : 0;
      lines.push({
        entity: part.subject ?? "unclassified",
        posting: p.id,
        date: p.date,
        memo: p.memo,
        account: account.name,
        income,
        expense,
      });
    }
  }
  const totals = new Map<
    string,
    {
      id: string;
      name: string;
      kind: string;
      income: number;
      expense: number;
      net: number;
    }
  >();
  for (const line of lines) {
    const entity = data.entities.find((e) => e.id === line.entity);
    const row = totals.get(line.entity) ?? {
      id: line.entity,
      name:
        entity?.name ??
        (line.entity === "unclassified" ? "Unclassified" : "Archived entity"),
      kind: entity?.kind ?? "Unclassified",
      income: 0,
      expense: 0,
      net: 0,
    };
    row.income = add(row.income, line.income);
    row.expense = add(row.expense, line.expense);
    row.net = add(row.income, -row.expense);
    totals.set(row.id, row);
  }
  return { rows: [...totals.values()], lines };
}
