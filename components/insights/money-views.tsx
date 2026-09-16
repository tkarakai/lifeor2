"use client";
import { useState } from "react";
import type { Filters, InsightData } from "@/lib/insights/types";
import {
  accountTotals,
  balances,
  buckets,
  cashAccount,
  scopedPostings,
} from "@/lib/insights/analytics";
import {
  COLORS,
  DataTable,
  Donut,
  EmptyChart,
  Mosaic,
  Plot,
  RankedBars,
  Waterfall,
} from "./charts";
import { formatMoney } from "@/components/money";
import type { MoneyFormatter } from "./planning-views";
const detailMoney = (n: number, f: Filters) =>
  formatMoney(Math.round(n), f.currency);
export type Drill = (
  title: string,
  headings: string[],
  rows: (string | number)[][],
  href?: string,
) => void;
export function Transactions({
  data,
  filters,
  format,
  drill,
  group,
  style,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
  drill: Drill;
  group: string;
  style: "line" | "area" | "bar";
}) {
  const rows = buckets(data, filters, group);
  const select = (index: number) => {
    const key = rows[index].key;
    const postings = scopedPostings(data, filters).filter(
      (p) =>
        (group === "year"
          ? p.date.slice(0, 4)
          : group === "quarter"
            ? `${p.date.slice(0, 4)}-Q${Math.ceil(Number(p.date.slice(5, 7)) / 3)}`
            : p.date.slice(0, 7)) === key &&
        ["Income", "Expense"].includes(p.accountInfo.type),
    );
    drill(
      `Income & expenses · ${rows[index].label}`,
      ["Date", "Account", "Memo", "Amount"],
      postings.map((p) => [
        p.date,
        p.accountInfo.name,
        p.memo,
        detailMoney(
          p.amount * (p.accountInfo.type === "Income" ? -1 : 1),
          filters,
        ),
      ]),
      "/dashboard/finance/entries",
    );
  };
  return (
    <>
      <Plot
        rows={rows}
        series={[
          { key: "income", label: "Income", color: COLORS[0] },
          { key: "expense", label: "Expenses", color: COLORS[1] },
          { key: "net", label: "Surplus", color: COLORS[2] },
        ]}
        format={format}
        mode={style}
        label="Income, expenses and surplus by period"
        onSelect={select}
      />
      <DataTable
        headings={["Period", "Income", "Expenses", "Surplus"]}
        rows={rows.map((r) => [
          r.label,
          detailMoney(r.income, filters),
          detailMoney(r.expense, filters),
          detailMoney(r.net, filters),
        ])}
      />
    </>
  );
}
export function Composition({
  data,
  filters,
  format,
  type,
  mode,
  drill,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
  type: string;
  mode: string;
  drill: Drill;
}) {
  const rows = accountTotals(data, filters, type);
  const select = (id: string) => {
    const account = data.accounts.find((a) => a.id === id)!;
    drill(
      account.name,
      ["Date", "Memo", "Amount"],
      scopedPostings(data, filters)
        .filter((p) => p.account === id)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((p) => [
          p.date,
          p.memo,
          detailMoney(p.amount * (type === "Income" ? -1 : 1), filters),
        ]),
      "/dashboard/finance/entries",
    );
  };
  return (
    <>
      {mode === "donut" ? (
        <Donut
          data={rows}
          format={format}
          onSelect={select}
          center={type === "Income" ? "Income" : "Expenses"}
        />
      ) : mode === "mosaic" ? (
        <Mosaic data={rows} format={format} onSelect={select} />
      ) : (
        <RankedBars data={rows} format={format} onSelect={select} />
      )}
      <p className="iv-footnote">
        Select a category to inspect postings.
        {mode !== "bars" &&
          " Composition shows positive net categories only; refunds and negative categories remain in the table."}
      </p>
      <DataTable
        headings={["Account", "Net amount"]}
        rows={rows.map((r) => [r.label, detailMoney(r.value, filters)])}
      />
    </>
  );
}
export function Worth({
  data,
  filters,
  format,
  group,
  style,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
  group: string;
  style: "line" | "area" | "bar";
}) {
  const rows = buckets(data, filters, group);
  return (
    <>
      <Plot
        rows={rows}
        series={[
          { key: "worth", label: "Book net assets", color: COLORS[0] },
          { key: "assets", label: "Assets", color: COLORS[2] },
          { key: "liabilities", label: "Liabilities", color: COLORS[3] },
        ]}
        format={format}
        mode={style}
        label="Book asset and liability balances over time"
      />
      <p className="iv-footnote">
        Cumulative posted balances, including records before the selected start.
        Book values are not market valuations. Multiple charts are added without
        consolidation eliminations.
      </p>
      <DataTable
        headings={["Period", "Assets", "Liabilities", "Net assets"]}
        rows={rows.map((r) => [
          r.label,
          detailMoney(r.assets, filters),
          detailMoney(r.liabilities, filters),
          detailMoney(r.worth, filters),
        ])}
      />
    </>
  );
}
export function BalanceComposition({
  data,
  filters,
  format,
  type,
  mode,
  drill,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
  type: string;
  mode: string;
  drill: Drill;
}) {
  const rows = balances(data, filters)
    .filter((a) => a.type === type && a.value !== 0)
    .map((a) => ({ id: a.id, label: a.name, value: a.value }));
  const select = (id: string) =>
    drill(
      data.accounts.find((a) => a.id === id)!.name,
      ["Date", "Memo", "Debit (+) / credit (−)"],
      scopedPostings(data, filters, false)
        .filter((p) => p.account === id)
        .map((p) => [p.date, p.memo, detailMoney(p.amount, filters)]),
      "/dashboard/finance/reports",
    );
  return (
    <>
      {mode === "donut" ? (
        <Donut
          data={rows}
          format={format}
          onSelect={select}
          center={type === "Asset" ? "Assets" : "Liabilities"}
        />
      ) : mode === "mosaic" ? (
        <Mosaic data={rows} format={format} onSelect={select} />
      ) : (
        <RankedBars data={rows} format={format} onSelect={select} />
      )}
      <p className="iv-footnote">
        Book balances through {filters.end}.{" "}
        {mode !== "bars"
          ? "Positive balances shown in composition; all signs retained below."
          : "Negative balances retain their sign in labels."}
      </p>
      <DataTable
        headings={["Account", "Book balance"]}
        rows={rows.map((r) => [r.label, detailMoney(r.value, filters)])}
      />
    </>
  );
}
export function SurplusBridge({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const rows = buckets(data, filters);
  const income = rows.reduce((s, r) => s + r.income, 0),
    expense = rows.reduce((s, r) => s + r.expense, 0);
  return (
    <>
      <Waterfall income={income} expense={expense} format={format} />
      <p className="iv-footnote">
        Posted income less expenses in this period. Transfers, debt principal
        and asset purchases do not count as expenses. Surplus is not the same as
        cash change.
      </p>
      <DataTable
        headings={["Measure", "Amount"]}
        rows={[
          ["Income", format(income)],
          ["Expenses", format(expense)],
          ["Surplus", format(income - expense)],
        ]}
      />
    </>
  );
}
export function Seasonality({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const [type, setType] = useState("Expense"),
    [sort, setSort] = useState("value");
  const postings = scopedPostings(data, filters).filter(
    (p) => p.accountInfo.type === type,
  );
  const months = [...new Set(buckets(data, filters).map((b) => b.key))];
  const accounts = accountTotals(data, filters, type).sort((a, b) =>
    sort === "name" ? a.label.localeCompare(b.label) : b.value - a.value,
  );
  const sums = new Map<string, number>();
  for (const p of postings) {
    const k = `${p.account}|${p.date.slice(0, 7)}`;
    sums.set(k, (sums.get(k) ?? 0) + p.amount * (type === "Income" ? -1 : 1));
  }
  const max = Math.max(...sums.values(), 1);
  return (
    <>
      <div className="iv-control-row">
        <label>
          Measure
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option>Expense</option>
            <option>Income</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="value">Highest total</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>
      {!accounts.length ? (
        <EmptyChart>No posted values in this period.</EmptyChart>
      ) : (
        <div className="iv-matrix-scroll">
          <table className="iv-matrix">
            <thead>
              <tr>
                <th>Category</th>
                {months.map((m) => (
                  <th key={m}>{m}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <th>{a.label}</th>
                  {months.map((m) => {
                    const value = sums.get(`${a.id}|${m}`) ?? 0;
                    return (
                      <td
                        key={m}
                        title={`${a.label}, ${m}: ${format(value)}`}
                        style={{
                          background:
                            value < 0
                              ? "#fbece6"
                              : `color-mix(in srgb, #147d73 ${(value / max) * 65}%, #f5f7f1)`,
                          color: value / max > 0.55 ? "white" : "#24473f",
                        }}
                      >
                        {format(value)}
                      </td>
                    );
                  })}
                  <td>
                    <strong>{format(a.value)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="iv-footnote">
        Darker cells mark larger months. Warm cells indicate a negative net
        value, such as a refund.
      </p>
    </>
  );
}
export function CashMovement({
  data,
  filters,
  format,
  drill,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
  drill: Drill;
}) {
  const cash = new Set(data.accounts.filter(cashAccount).map((a) => a.id));
  const endBalances = balances(data, filters).filter((a) => cash.has(a.id));
  const postings = scopedPostings(data, filters).filter((p) =>
    cash.has(p.account),
  );
  const rows = endBalances.map((a) => ({
    id: a.id,
    label: a.name,
    value: postings
      .filter((p) => p.account === a.id)
      .reduce((s, p) => s + p.amount, 0),
    detail: `Closing book cash ${format(a.value)}`,
  }));
  return (
    <>
      <RankedBars
        data={rows}
        format={format}
        onSelect={(id) =>
          drill(
            data.accounts.find((a) => a.id === id)!.name,
            ["Date", "Memo", "Cash movement"],
            postings
              .filter((p) => p.account === id)
              .map((p) => [p.date, p.memo, detailMoney(p.amount, filters)]),
            "/dashboard/finance/entries",
          )
        }
      />
      <p className="iv-footnote">
        Net period movement in designated checking, savings, cash and deposit
        accounts. Transfers between selected cash accounts cancel in aggregate.
        Loan and credit-card balances are excluded.
      </p>
    </>
  );
}
export function BeneficiarySpending({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const totals = new Map<string, number>();
  for (const p of scopedPostings(data, { ...filters, entity: "" }).filter(
    (p) => p.accountInfo.type === "Expense",
  )) {
    if (!p.portions.length && !filters.entity)
      totals.set("unassigned", (totals.get("unassigned") ?? 0) + p.amount);
    for (const part of p.portions) {
      if (
        filters.tag &&
        !part.tags.includes(filters.tag) &&
        !p.tags.includes(filters.tag)
      )
        continue;
      for (const b of part.beneficiaries)
        if (!filters.entity || b.entity === filters.entity)
          totals.set(
            b.entity ?? "unassigned",
            (totals.get(b.entity ?? "unassigned") ?? 0) + b.amount,
          );
    }
  }
  const rows = [...totals].map(([id, value]) => ({
    id,
    value,
    label: data.entities.find((e) => e.id === id)?.name ?? "Unassigned",
  }));
  return (
    <>
      <RankedBars data={rows} format={format} />
      <p className="iv-footnote">
        Expense allocations by explicitly recorded beneficiary, not an estimate
        of who paid. Person filter selects beneficiary allocations here.
      </p>
      <DataTable
        headings={["Beneficiary", "Allocated expenses"]}
        rows={rows.map((r) => [r.label, detailMoney(r.value, filters)])}
      />
    </>
  );
}
