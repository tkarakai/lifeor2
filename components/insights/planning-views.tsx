"use client";
import { useMemo, useState } from "react";
import type { Filters, InsightData } from "@/lib/insights/types";
import {
  amortizeDebt,
  balances,
  budgetActual,
  cashAccount,
  dateNumber,
  DAY,
  filteredFlows,
  goalMonths,
  monthShift,
  niceDate,
  project,
  scopedPostings,
} from "@/lib/insights/analytics";
import { currencyScales, formatMoney } from "@/components/money";
import { COLORS, DataTable, EmptyChart, Plot, RankedBars } from "./charts";
const detailMoney = (n: number, f: Filters) =>
  formatMoney(Math.round(n), f.currency);
export type MoneyFormatter = (value: number) => string;
export function UpcomingFlows({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const [months, setMonths] = useState(12),
    [direction, setDirection] = useState("all");
  const cutoff = monthShift(filters.end, months + 1);
  const flows = filteredFlows(data, filters)
    .filter(
      (f) =>
        f.date > filters.end &&
        f.date < cutoff &&
        (direction === "all" ||
          (direction === "in" ? f.amount > 0 : f.amount < 0)),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows = Array.from({ length: months + 1 }, (_, i) =>
    monthShift(filters.end, i),
  ).map((date) => ({
    label: date.slice(0, 7),
    incoming: flows
      .filter((f) => f.date.startsWith(date.slice(0, 7)) && f.amount > 0)
      .reduce((s, f) => s + f.amount, 0),
    outgoing: flows
      .filter((f) => f.date.startsWith(date.slice(0, 7)) && f.amount < 0)
      .reduce((s, f) => s + f.amount, 0),
  }));
  return (
    <>
      <div className="iv-control-row">
        <label>
          Look ahead{" "}
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
            <option value="24">24 months</option>
          </select>
        </label>
        <label>
          Direction{" "}
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="all">In & out</option>
            <option value="in">Incoming</option>
            <option value="out">Outgoing</option>
          </select>
        </label>
      </div>
      {flows.length ? (
        <>
          <Plot
            label="Expected incoming and outgoing movements"
            rows={rows}
            series={[
              { key: "incoming", label: "Expected in", color: COLORS[0] },
              { key: "outgoing", label: "Expected out", color: COLORS[3] },
            ]}
            mode="bar"
            format={format}
          />
          <DataTable
            headings={["Expected date", "Movement", "Source", "Remaining"]}
            rows={flows.map((f) => [
              f.date,
              f.name,
              f.source,
              detailMoney(f.amount, filters),
            ])}
          />
        </>
      ) : (
        <EmptyChart href="/dashboard/planning">
          No recorded expected movements in this horizon.
        </EmptyChart>
      )}
      <p className="iv-footnote">
        Only explicit, unfulfilled expected flows after {niceDate(filters.end)}.
        Recurring schedules are not automatically expanded here. Amounts reflect
        current fulfillment, even when viewing an earlier cutoff.
      </p>
    </>
  );
}
export function ObligationPressure({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const [party, setParty] = useState(filters.entity || ""),
    [direction, setDirection] = useState("pay"),
    [view, setView] = useState("aging");
  const who = party || filters.entity;
  const rows = data.obligations
    .filter(
      (o) =>
        o.currency === filters.currency &&
        o.amount > 0 &&
        (!who || (direction === "pay" ? o.debtor === who : o.creditor === who)),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const groups = [
    { id: "late", label: "Overdue", color: COLORS[3], min: -Infinity, max: -1 },
    { id: "week", label: "Due in 0–7 days", color: COLORS[1], min: 0, max: 7 },
    {
      id: "month",
      label: "Due in 8–30 days",
      color: COLORS[2],
      min: 8,
      max: 30,
    },
    {
      id: "later",
      label: "Due after 30 days",
      color: COLORS[0],
      min: 31,
      max: Infinity,
    },
  ].map((g) => ({
    ...g,
    value: rows
      .filter((o) => {
        const diff = Math.round(
          (dateNumber(o.date) - dateNumber(filters.end)) / DAY,
        );
        return diff >= g.min && diff <= g.max;
      })
      .reduce((s, o) => s + o.amount, 0),
  }));
  const entityName = (id: string) =>
    data.entities.find((e) => e.id === id)?.name ?? "Archived entity";
  return (
    <>
      <div className="iv-control-row">
        <label>
          Perspective{" "}
          <select value={who} onChange={(e) => setParty(e.target.value)}>
            <option value="">All parties · gross claims</option>
            {data.entities
              .filter((e) =>
                data.obligations.some(
                  (o) => o.creditor === e.id || o.debtor === e.id,
                ),
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        <select
          aria-label="Obligation direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="pay">To pay</option>
          <option value="receive">To receive</option>
        </select>
        <select
          aria-label="Obligation chart style"
          value={view}
          onChange={(e) => setView(e.target.value)}
        >
          <option value="aging">Aging buckets</option>
          <option value="list">By obligation</option>
        </select>
      </div>
      {rows.length ? (
        <>
          <RankedBars
            data={
              view === "aging"
                ? groups
                : rows.map((o) => ({
                    id: o.id,
                    label: `${o.name} · ${niceDate(o.date)}`,
                    value: o.amount,
                    detail: `${entityName(o.debtor)} → ${entityName(o.creditor)}`,
                  }))
            }
            format={format}
          />
          <DataTable
            headings={[
              "Due",
              "From",
              "To",
              "Approved",
              "Settled",
              "Outstanding",
            ]}
            rows={rows.map((o) => [
              o.date,
              entityName(o.debtor),
              entityName(o.creditor),
              detailMoney(o.original, filters),
              detailMoney(o.settled, filters),
              detailMoney(o.amount, filters),
            ])}
          />
        </>
      ) : (
        <EmptyChart href="/dashboard/finance/obligations">
          No outstanding obligations for this perspective.
        </EmptyChart>
      )}
      <p className="iv-footnote">
        Current outstanding claims aged against {niceDate(filters.end)}; not
        historical balances. Currency and perspective apply. Chart and project
        filters do not apply to obligations.
      </p>
    </>
  );
}
export function BudgetProgress({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const [version, setVersion] = useState("");
  const selected = data.versions.some((v) => v.id === version)
    ? version
    : (data.versions.at(-1)?.id ?? "");
  const budgets = data.budgets.filter(
    (b) =>
      b.version === selected &&
      b.currency === filters.currency &&
      (!filters.chart || b.chart === filters.chart) &&
      b.start <= filters.end &&
      b.end >= filters.start,
  );
  return (
    <>
      <div className="iv-inline-control">
        <label>
          Plan version{" "}
          <select value={selected} onChange={(e) => setVersion(e.target.value)}>
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.status}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!budgets.length ? (
        <EmptyChart href="/dashboard/planning">
          Add a budget target to a plan version to compare it with actual
          results.
        </EmptyChart>
      ) : (
        <div className="iv-budget-list">
          {budgets.map((b) => {
            const actual = budgetActual(data, b, filters.end),
              ratio = b.amount ? (actual / b.amount) * 100 : actual ? 100 : 0,
              over = actual > b.amount && b.measure === "expense";
            return (
              <div key={b.id}>
                <div className="iv-row-between">
                  <strong>{b.name}</strong>
                  <span className={over ? "iv-warning" : ""}>
                    {b.amount ? `${Math.round(ratio)}%` : "No target amount"}
                  </span>
                </div>
                <div className="iv-budget-track">
                  <i
                    style={{
                      width: `${Math.max(0, Math.min(100, ratio))}%`,
                      background: over ? COLORS[3] : COLORS[0],
                    }}
                  />
                  <span style={{ left: "80%" }} />
                </div>
                <div className="iv-row-between">
                  <small>{format(actual)} actual</small>
                  <small>{format(b.amount)} target</small>
                </div>
                <p className="iv-footnote">
                  {b.start} – {b.end} · {b.measure} · {b.status}
                  {over ? ` · ${format(actual - b.amount)} over target` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
      <p className="iv-footnote">
        Actuals use each target’s own period and scope, through the selected
        cutoff. Targets are independent and may overlap; they are not added
        together. Person and project filters do not change a saved target.
      </p>
    </>
  );
}
export function RecurringCommitments({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const [party, setParty] = useState(""),
    [direction, setDirection] = useState("pay");
  const who = party || filters.entity;
  const schedules = data.schedules.filter(
    (s) =>
      s.currency === filters.currency &&
      s.start <= filters.end &&
      (!s.end || s.end > filters.end) &&
      (!who || (direction === "pay" ? s.debtor === who : s.creditor === who)),
  );
  const monthly = (s: (typeof schedules)[number]) =>
    s.amount === undefined
      ? 0
      : (s.amount / s.interval) *
        ({
          daily: 365.25 / 12,
          weekly: 52.1775 / 12,
          monthly: 1,
          yearly: 1 / 12,
          once: 0,
        }[s.frequency] ?? 0);
  return (
    <>
      <div className="iv-control-row">
        <label>
          Perspective{" "}
          <select value={who} onChange={(e) => setParty(e.target.value)}>
            <option value="">All parties · gross commitments</option>
            {data.entities
              .filter((e) =>
                data.schedules.some(
                  (s) => s.creditor === e.id || s.debtor === e.id,
                ),
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        <select
          aria-label="Commitment direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="pay">To pay</option>
          <option value="receive">To receive</option>
        </select>
      </div>
      <RankedBars
        data={schedules
          .filter((s) => s.amount !== undefined && s.frequency !== "once")
          .map((s) => ({
            id: s.id,
            label: s.name,
            value: Math.round(monthly(s)),
            detail: `${format(s.amount!)} every ${s.interval} ${s.frequency} period${s.interval > 1 ? "s" : ""}`,
          }))}
        format={format}
      />
      <p className="iv-footnote">
        Approximate monthly equivalents of current fixed schedules, not a
        payment calendar.{" "}
        {schedules.filter((s) => s.amount === undefined).length} variable and{" "}
        {schedules.filter((s) => s.frequency === "once").length} one-time
        schedules excluded from bars. Currency and perspective apply; chart and
        project filters do not.
      </p>
    </>
  );
}
function MoneyInput({
  label,
  value,
  set,
  factor,
  min,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  factor: number;
  min?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step={1 / factor}
        min={min}
        max="1000000000000"
        value={value / factor}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value) * factor);
          if (
            Number.isSafeInteger(n) &&
            Math.abs(n) <= 1e14 &&
            (min === undefined || n >= min * factor)
          )
            set(n);
        }}
      />
    </label>
  );
}
export function WhatIf({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const factor = 10 ** (currencyScales[filters.currency] ?? 2);
  const baseline = useMemo(() => {
    const cash = new Set(data.accounts.filter(cashAccount).map((a) => a.id));
    const end = monthShift(filters.end, 0),
      start = monthShift(filters.end, -3);
    const journals = new Map<string, number>();
    for (const p of scopedPostings(data, { ...filters, start, end }))
      if (cash.has(p.account) && p.date < end)
        journals.set(p.journal, (journals.get(p.journal) ?? 0) + p.amount);
    return {
      opening: balances(data, filters)
        .filter((a) => cash.has(a.id))
        .reduce((s, a) => s + a.value, 0),
      income: Math.round(
        [...journals.values()].filter((n) => n > 0).reduce((s, n) => s + n, 0) /
          3,
      ),
      expense: Math.round(
        -[...journals.values()]
          .filter((n) => n < 0)
          .reduce((s, n) => s + n, 0) / 3,
      ),
      start,
      end,
    };
  }, [data, filters]);
  const [opening, setOpening] = useState<number | null>(null),
    [income, setIncome] = useState<number | null>(null),
    [expense, setExpense] = useState<number | null>(null);
  const [months, setMonths] = useState(12),
    [incomeChange, setIncomeChange] = useState(0),
    [expenseChange, setExpenseChange] = useState(0),
    [growth, setGrowth] = useState(0),
    [shock, setShock] = useState(0),
    [reserve, setReserve] = useState(10000 * factor);
  const rows = project({
    opening: opening ?? baseline.opening,
    monthlyIncome: income ?? baseline.income,
    monthlyExpense: expense ?? baseline.expense,
    incomeChange,
    expenseChange,
    annualGrowth: growth,
    shock,
    months,
    start: filters.end,
  });
  const final = rows.at(-1)!,
    breach = rows.find((r) => r.adjusted < reserve);
  return (
    <>
      <div className="iv-scenario-controls">
        <MoneyInput
          label={`Starting cash · ${filters.currency}`}
          value={opening ?? baseline.opening}
          set={setOpening}
          factor={factor}
        />
        <MoneyInput
          label="Monthly cash in"
          value={income ?? baseline.income}
          set={setIncome}
          factor={factor}
          min={0}
        />
        <MoneyInput
          label="Monthly cash out"
          value={expense ?? baseline.expense}
          set={setExpense}
          factor={factor}
          min={0}
        />
        <label>
          Horizon
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {[6, 12, 24, 36, 60].map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </label>
      </div>
      <Plot
        rows={rows}
        series={[
          { key: "base", label: "Baseline", color: "#82928b", dashed: true },
          {
            key: "adjusted",
            label: "Your scenario",
            color: COLORS[0],
            dashed: true,
          },
          {
            key: "stress",
            label: "10% lower inflow",
            color: COLORS[3],
            dashed: true,
          },
        ]}
        label="Exploratory cash projection"
        mode="line"
        format={format}
      />
      <div className="iv-scenario-sliders">
        {[
          {
            label: "Inflow change",
            value: incomeChange,
            set: setIncomeChange,
            min: -100,
            max: 100,
          },
          {
            label: "Outflow change",
            value: expenseChange,
            set: setExpenseChange,
            min: -100,
            max: 100,
          },
          {
            label: "Annual outflow growth",
            value: growth,
            set: setGrowth,
            min: 0,
            max: 20,
          },
        ].map((s) => (
          <label key={s.label}>
            <span>
              {s.label}
              <strong>
                {s.value > 0 ? "+" : ""}
                {s.value}%
              </strong>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              value={s.value}
              onChange={(e) => s.set(Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <div className="iv-control-row">
        <MoneyInput
          label="One-time cost · first month"
          value={shock}
          set={setShock}
          factor={factor}
          min={0}
        />
        <MoneyInput
          label="Minimum cash reserve"
          value={reserve}
          set={setReserve}
          factor={factor}
          min={0}
        />
        <button
          className="iv-button"
          onClick={() => {
            setOpening(null);
            setIncome(null);
            setExpense(null);
            setIncomeChange(0);
            setExpenseChange(0);
            setGrowth(0);
            setShock(0);
          }}
        >
          Reset to records
        </button>
      </div>
      <div className="iv-scenario-outcome">
        <div>
          <span>Scenario ending cash</span>
          <strong>{format(final.adjusted)}</strong>
        </div>
        <div>
          <span>Change from baseline</span>
          <strong>{format(final.adjusted - final.base)}</strong>
        </div>
        <div>
          <span>Reserve threshold</span>
          <strong className={breach ? "iv-warning" : ""}>
            {breach
              ? `Below in ${breach.label === "Start" ? "starting balance" : breach.label}`
              : "Maintained"}
          </strong>
        </div>
      </div>
      <DataTable
        headings={["Month", "Baseline", "Scenario", "Lower inflow"]}
        rows={rows.map((r) => [
          r.key,
          detailMoney(r.base, filters),
          detailMoney(r.adjusted, filters),
          detailMoney(r.stress, filters),
        ])}
      />
      <p className="iv-footnote">
        Exploration only; no plan or ledger records are changed. Defaults
        average net movements per journal in designated cash accounts over the 3
        complete months from {baseline.start} to {baseline.end} (exclusive),
        including zero-activity months. Opening cash is the book balance at
        cutoff. No investment returns, taxes, automatic schedule expansion, or
        explicit expected flows are added. Sliders change monthly amounts;
        stress subtracts another 10% of baseline inflow. Edit defaults if
        records are incomplete.
      </p>
    </>
  );
}
export function SavingsGoal({
  filters,
  format,
}: {
  filters: Filters;
  format: MoneyFormatter;
}) {
  const factor = 10 ** (currencyScales[filters.currency] ?? 2);
  const [name, setName] = useState("Our next family adventure"),
    [current, setCurrent] = useState(0),
    [target, setTarget] = useState(10000 * factor),
    [monthly, setMonthly] = useState(500 * factor);
  const months = goalMonths(current, target, monthly),
    percent = target ? Math.min(100, (current / target) * 100) : 100;
  const rows = Array.from(
    { length: Math.min(months ?? 12, 60) + 1 },
    (_, i) => ({
      label: i === 0 ? "Now" : `Month ${i}`,
      saved: current + i * monthly,
      goal: target,
    }),
  );
  return (
    <>
      <label className="iv-goal-name">
        Goal name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </label>
      <div className="iv-goal-hero">
        <div
          className="iv-goal-ring"
          role="img"
          aria-label={`${Math.round(percent)} percent funded`}
          style={{
            background: `conic-gradient(#147d73 ${percent}%, #eaf0e9 0)`,
          }}
        >
          <span>
            {Math.round(percent)}
            <small>% funded</small>
          </span>
        </div>
        <div>
          <span className="iv-eyebrow">{name || "Your goal"}</span>
          <h3>
            {months === null
              ? "Set a monthly contribution"
              : months === 0
                ? "You’re already there"
                : `${months.toLocaleString()} months to go`}
          </h3>
          <p>
            {months !== null && months > 0 && months < 1200
              ? `Around ${niceDate(monthShift(filters.end, months))}`
              : `${format(Math.max(0, target - current))} left to save`}
          </p>
        </div>
      </div>
      <div className="iv-scenario-controls">
        <MoneyInput
          label={`Saved so far · ${filters.currency}`}
          value={current}
          set={setCurrent}
          factor={factor}
          min={0}
        />
        <MoneyInput
          label="Target amount"
          value={target}
          set={setTarget}
          factor={factor}
          min={0}
        />
        <MoneyInput
          label="Monthly contribution"
          value={monthly}
          set={setMonthly}
          factor={factor}
          min={0}
        />
      </div>
      <Plot
        label="Illustrative savings goal progress"
        rows={rows}
        series={[
          {
            key: "saved",
            label: "Contributions",
            color: COLORS[0],
            dashed: true,
          },
          { key: "goal", label: "Goal", color: COLORS[1], dashed: true },
        ]}
        format={format}
        mode="area"
      />
      <p className="iv-footnote">
        An unsaved illustration using your inputs, starting at the selected
        cutoff. No interest or investment growth assumed. Chart shows at most 60
        months; completion estimate uses the full target.
      </p>
    </>
  );
}
export function DebtPayoff({
  data,
  filters,
  format,
}: {
  data: InsightData;
  filters: Filters;
  format: MoneyFormatter;
}) {
  const accounts = balances(data, { ...filters, entity: "", tag: "" }).filter(
    (a) => a.type === "Liability" && a.value > 0,
  );
  const [selected, setSelected] = useState("");
  const account =
    accounts.find((a) => a.id === selected) ??
    accounts.find((a) => a.financialKind === "mortgage") ??
    accounts[0];
  if (!account)
    return (
      <EmptyChart href="/dashboard/finance/accounts">
        Add a liability balance to explore a payoff schedule.
      </EmptyChart>
    );
  return (
    <>
      <div className="iv-inline-control">
        <label>
          Debt account
          <select
            value={account.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <DebtCalculator
        key={`${account.id}-${filters.currency}`}
        data={data}
        account={account}
        filters={filters}
        format={format}
      />
    </>
  );
}
function DebtCalculator({
  data,
  account,
  filters,
  format,
}: {
  data: InsightData;
  account: ReturnType<typeof balances>[number];
  filters: Filters;
  format: MoneyFormatter;
}) {
  const factor = 10 ** (currencyScales[filters.currency] ?? 2);
  const terms = data.measurements
    .filter(
      (m) =>
        m.subject === account.arrangement &&
        m.assertion === "contractual" &&
        m.date <= filters.end,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const rate = terms.find(
    (m) => /annual interest rate/i.test(m.name) && m.unit === "percent",
  )?.value;
  const original = terms.find(
    (m) => /original principal/i.test(m.name) && m.unit === filters.currency,
  )?.value;
  const term = terms.find(
    (m) => /original term/i.test(m.name) && m.unit === "months",
  )?.value;
  const [apr, setApr] = useState(rate === undefined ? "" : String(rate));
  const estimated =
    original && term && rate !== undefined
      ? Math.round(
          (rate === 0
            ? original / term
            : (original * rate) / 1200 / (1 - (1 + rate / 1200) ** -term)) *
            factor,
        )
      : null;
  const [payment, setPayment] = useState(
      estimated === null ? "" : String(estimated / factor),
    ),
    [extra, setExtra] = useState(0);
  const principal = account.value;
  const aprNumber = Number(apr),
    paymentNumber = Math.round(Number(payment) * factor);
  const valid =
    apr !== "" &&
    payment !== "" &&
    Number.isFinite(aprNumber) &&
    aprNumber >= 0 &&
    aprNumber <= 100 &&
    Number.isSafeInteger(paymentNumber) &&
    paymentNumber > 0 &&
    paymentNumber < 1e14;
  const base = valid
    ? amortizeDebt(principal, Math.round(aprNumber * 100), paymentNumber, 0)
    : null;
  const faster = valid
    ? amortizeDebt(principal, Math.round(aprNumber * 100), paymentNumber, extra)
    : null;
  const rows =
    base && faster
      ? Array.from(
          { length: Math.max(base.rows.length, faster.rows.length) },
          (_, i) => ({
            label: i === 0 ? "Now" : `${i} mo`,
            baseline: base.rows[i]?.balance ?? base.rows.at(-1)!.balance,
            extra: faster.rows[i]?.balance ?? faster.rows.at(-1)!.balance,
          }),
        )
      : [];
  return (
    <>
      <div className="iv-scenario-controls">
        <label>
          Book principal at cutoff
          <strong className="iv-debt-principal">{format(principal)}</strong>
        </label>
        <label>
          Fixed annual rate · %
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="Enter APR"
            value={apr}
            onChange={(e) => setApr(e.target.value)}
          />
        </label>
        <label>
          Monthly principal & interest
          <input
            type="number"
            min={1 / factor}
            max="1000000000000"
            step={1 / factor}
            placeholder="Enter payment"
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
          />
        </label>
        <MoneyInput
          label="Extra principal each month"
          value={extra}
          set={setExtra}
          factor={factor}
          min={0}
        />
      </div>
      {!valid ? (
        <EmptyChart>
          Enter a fixed annual rate (0–100%) and positive monthly payment to
          compare payoff paths.
        </EmptyChart>
      ) : (
        <>
          <Plot
            rows={rows}
            series={[
              {
                key: "baseline",
                label: "Regular payment",
                color: COLORS[2],
                dashed: true,
              },
              {
                key: "extra",
                label: "With extra principal",
                color: COLORS[0],
                dashed: true,
              },
            ]}
            format={format}
            label="Illustrative debt balance with and without extra principal"
            mode="area"
          />
          <div className="iv-scenario-outcome">
            <div>
              <span>Regular payoff</span>
              <strong>
                {base!.stalled
                  ? "Payment too low"
                  : base!.months === null
                    ? "Beyond 50 years"
                    : `${base!.months} months`}
              </strong>
            </div>
            <div>
              <span>With extra principal</span>
              <strong>
                {faster!.stalled
                  ? "Payment too low"
                  : faster!.months === null
                    ? "Beyond 50 years"
                    : `${faster!.months} months`}
              </strong>
            </div>
            <div>
              <span>Interest saved</span>
              <strong>
                {base!.months !== null && faster!.months !== null
                  ? format(base!.interest - faster!.interest)
                  : "Not yet calculable"}
              </strong>
            </div>
          </div>
          <DataTable
            headings={["Month", "Regular balance", "Extra-payment balance"]}
            rows={rows.map((r) => [
              r.label,
              detailMoney(r.baseline, filters),
              detailMoney(r.extra, filters),
            ])}
          />
        </>
      )}
      <p className="iv-footnote">
        Fixed-rate illustration from this account’s full book balance; chart,
        currency and cutoff apply, but person and project filters do not.{" "}
        {estimated !== null
          ? "Initial payment is estimated from recorded original principal, rate and term; verify it against your current terms."
          : "Enter the loan’s principal-and-interest payment, excluding escrow and fees."}{" "}
        Interest rounds monthly to minor units, the last payment is capped, and
        the calculation stops after 600 months. No fees, variable rates, taxes
        or prepayment penalties are modeled.
      </p>
    </>
  );
}
