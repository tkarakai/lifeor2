/** Transport-independent deterministic reduction. Large database pages never enter LLM context. */
export type FinanceRow = {
  key: string;
  period: string;
  accountId: string;
  account: string;
  type: string;
  currency: string;
  cash: boolean;
  minorUnits: number;
  journalIds: string[];
  sourceCount: number;
};
export type FinancePage = {
  scope?: string[];
  sampleActualsThrough?: string | null;
  revision: number;
  rows: FinanceRow[];
  nextCursor: string | null;
  examinedJournals: number;
  examinedCells?: number;
  warnings: string[];
  queryComplete: boolean;
  datasetCompleteness: string;
  from: string;
  through: string;
};
export function mergeRows(target: Map<string, FinanceRow>, rows: FinanceRow[]) {
  for (const r of rows) {
    const old = target.get(r.key);
    if (!old) {
      target.set(r.key, { ...r, journalIds: [...r.journalIds] });
      continue;
    }
    const n = old.minorUnits + r.minorUnits;
    if (!Number.isSafeInteger(n))
      throw new Error("Report exceeds exact integer range");
    old.minorUnits = n;
    old.sourceCount += r.sourceCount;
    old.journalIds = [...new Set([...old.journalIds, ...r.journalIds])].slice(
      0,
      5,
    );
  }
}
export async function collectFinance(
  query: (cursor?: string) => Promise<FinancePage>,
  maxPages = 10000,
) {
  const rows = new Map<string, FinanceRow>(),
    warnings = new Set<string>(),
    seen = new Set<string>();
  let cursor: string | undefined,
    examined = 0,
    examinedCells = 0,
    first: FinancePage | undefined,
    pages = 0;
  for (;;) {
    if (++pages > maxPages)
      throw new Error(
        "QUERY_LIMIT: report exceeds scan budget. Narrow the period; no partial total is supplied.",
      );
    const p = await query(cursor);
    first ??= p;
    if (p.revision !== first.revision)
      throw new Error(
        "DATA_CHANGED: records changed during this report. Retry the query; no mixed-version total is supplied.",
      );
    examined += p.examinedJournals;
    examinedCells += p.examinedCells ?? 0;
    for (const w of p.warnings) warnings.add(w);
    mergeRows(rows, p.rows);
    if (!p.nextCursor) {
      if (!p.queryComplete)
        throw new Error("Incomplete financial query; no total supplied");
      break;
    }
    if (seen.has(p.nextCursor))
      throw new Error("Pagination made no progress; no partial total supplied");
    seen.add(p.nextCursor);
    cursor = p.nextCursor;
  }
  return {
    scope: first!.scope ?? [],
    sampleActualsThrough: first!.sampleActualsThrough ?? null,
    revision: first!.revision,
    rows: [...rows.values()].sort(
      (a, b) =>
        a.period.localeCompare(b.period) || a.account.localeCompare(b.account),
    ),
    examinedJournals: examined,
    examinedCells,
    pages,
    from: first!.from,
    through: first!.through,
    warnings: [...warnings],
    queryComplete: true,
    datasetCompleteness: "unknown",
  };
}
export function decimal(minor: number, precision = 2) {
  if (!Number.isSafeInteger(minor)) throw new Error("Unsafe monetary amount");
  const digits = Math.abs(minor)
    .toString()
    .padStart(precision + 1, "0");
  return (
    (minor < 0 ? "-" : "") +
    (precision
      ? digits.slice(0, -precision) + "." + digits.slice(-precision)
      : digits)
  );
}
/** Report arithmetic is exact in minor units; absent periods stay explicitly unobserved. */
export function summarizeFinance(
  rows: FinanceRow[],
  from: string,
  through: string,
  precision: (currency: string) => number,
  metric: string,
) {
  const periods: string[] = [];
  for (
    let year = Number(from.slice(0, 4)), month = Number(from.slice(5, 7));
    ;
  ) {
    const key = `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    if (key > through.slice(0, 7)) break;
    periods.push(key);
    if (++month > 12) {
      year++;
      month = 1;
    }
    if (periods.length > 1201) throw new Error("Too many reporting months");
  }
  const totals = new Map<
      string,
      {
        type: string;
        currency: string;
        minorUnits: number;
        sourceJournalIds: string[];
      }
    >(),
    monthly = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = r.type + ":" + r.currency,
      old = totals.get(key) ?? {
        type: r.type,
        currency: r.currency,
        minorUnits: 0,
        sourceJournalIds: [],
      };
    old.minorUnits += r.minorUnits;
    if (!Number.isSafeInteger(old.minorUnits)) throw new Error("Unsafe total");
    old.sourceJournalIds = [
      ...new Set([...old.sourceJournalIds, ...r.journalIds]),
    ].slice(0, 5);
    totals.set(key, old);
    if (/^\d{4}-\d{2}$/.test(r.period)) {
      const map = monthly.get(key) ?? new Map<string, number>();
      map.set(r.period, (map.get(r.period) ?? 0) + r.minorUnits);
      monthly.set(key, map);
    }
  }
  const balances = [...new Set(rows.map((r) => r.currency))].map((currency) => {
    const sum = (test: (r: FinanceRow) => boolean) =>
      rows
        .filter((r) => r.currency === currency && test(r))
        .reduce((n, r) => n + r.minorUnits, 0);
    const assets = sum((r) => r.type === "Asset"),
      liabilities = sum((r) => r.type === "Liability"),
      cash = sum((r) => r.cash);
    return {
      currency,
      assets: decimal(assets, precision(currency)),
      liabilities: decimal(liabilities, precision(currency)),
      netWorth: decimal(assets - liabilities, precision(currency)),
      cash: decimal(cash, precision(currency)),
    };
  });
  const profitLoss = [...new Set(rows.map((r) => r.currency))].map(
    (currency) => {
      const income = totals.get("Income:" + currency)?.minorUnits ?? 0,
        expense = totals.get("Expense:" + currency)?.minorUnits ?? 0;
      return {
        currency,
        income: decimal(income, precision(currency)),
        expense: decimal(expense, precision(currency)),
        netRecordedIncome: decimal(income - expense, precision(currency)),
      };
    },
  );
  const payroll = [...new Set(rows.map((r) => r.currency))].map((currency) => {
    const selected = rows.filter((r) => r.currency === currency),
      sum = (list: FinanceRow[], test: (r: FinanceRow) => boolean) =>
        list.filter(test).reduce((n, r) => n + r.minorUnits, 0),
      amount = (n: number) => decimal(n, precision(currency));
    const cash = sum(selected, (r) => r.cash),
      gross = sum(selected, (r) => r.type === "Income");
    return {
      currency,
      totalGross: amount(gross),
      totalCashDeposited: amount(cash),
      averageMonthlyCash: amount(
        Math.sign(cash) * Math.floor(Math.abs(cash) / periods.length + 0.5),
      ),
      averageMonthlyGross: amount(
        Math.sign(gross) * Math.floor(Math.abs(gross) / periods.length + 0.5),
      ),
      requestedMonthCount: periods.length,
      months: periods.map((period) => {
        const rs = selected.filter((r) => r.period === period);
        return {
          period,
          gross: amount(sum(rs, (r) => r.type === "Income")),
          cashDeposited: amount(sum(rs, (r) => r.cash)),
          withholdingAndOtherExpenses: amount(
            sum(rs, (r) => r.type === "Expense"),
          ),
          hasRecordedEntries: rs.length > 0,
          sourceJournalIds: [...new Set(rs.flatMap((r) => r.journalIds))].slice(
            0,
            5,
          ),
        };
      }),
    };
  });
  return {
    ...(metric === "payroll" ? { payroll } : {}),
    ...(metric === "profit_loss" ? { profitLoss } : {}),
    totals: [...totals.values()].map((r) => ({
      type: r.type,
      currency: r.currency,
      amount: decimal(r.minorUnits, precision(r.currency)),
      sourceJournalIds: r.sourceJournalIds,
      ...(metric === "income" || metric === "expenses"
        ? {
            averageMonthlyAmount: decimal(
              Math.sign(r.minorUnits) *
                Math.floor(Math.abs(r.minorUnits) / periods.length + 0.5),
              precision(r.currency),
            ),
            averageExact: {
              numeratorMinorUnits: r.minorUnits,
              denominatorMonths: periods.length,
            },
            averageBasis:
              "Requested calendar months, including months with no matching records; partial boundary months are not extrapolated.",
          }
        : {}),
      ...(monthly.has(r.type + ":" + r.currency)
        ? {
            months: periods.map((period) => ({
              period,
              amount: decimal(
                monthly.get(r.type + ":" + r.currency)!.get(period) ?? 0,
                precision(r.currency),
              ),
              hasRecordedEntries: monthly
                .get(r.type + ":" + r.currency)!
                .has(period),
            })),
          }
        : {}),
    })),
    ...(metric === "balances" ? { balanceSummary: balances } : {}),
    ...(metric === "cash_balances"
      ? {
          cashSummary: balances.map((r) => ({
            currency: r.currency,
            cash: r.cash,
          })),
        }
      : {}),
    requestedMonths: periods.length,
  };
}
