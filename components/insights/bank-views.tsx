"use client";
import { useMemo, useState } from "react";
import type { CashRoute, Filters, InsightData } from "@/lib/insights/types";
import {
  bankProjection,
  entityContribution,
  type CashPoint,
} from "@/lib/insights/cash-projection";
import {
  cashAccount,
  dateNumber,
  DAY,
  iso,
  monthShift,
  niceDate,
  today,
} from "@/lib/insights/analytics";
import {
  currencyScales,
  formatMoney,
  moneyInput,
  parseMoney,
} from "@/components/money";
import { COLORS, DataTable, EmptyChart, Legend } from "./charts";
import type { Drill } from "./money-views";
export type SaveCashRoute = (route: {
  source: string;
  kind: CashRoute["kind"];
  from?: string;
  to?: string;
  amount?: number;
  days?: number[];
  revision: number;
}) => Promise<unknown>;
function BalanceLines({
  points,
  series,
  cutoff,
  reserve,
  step,
  format,
  onSelect,
}: {
  points: CashPoint[];
  series: { id: string; name: string; color: string }[];
  cutoff: string;
  reserve?: number;
  step: boolean;
  format: (n: number) => string;
  onSelect: (date: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (!points.length || !series.length)
    return <EmptyChart>Select at least one bank account.</EmptyChart>;
  const value = (p: CashPoint, id: string) =>
    id === "total" ? p.total : (p.values[id] ?? 0);
  const values = points.flatMap((p) => series.map((s) => value(p, s.id)));
  const min = Math.min(0, reserve ?? 0, ...values),
    max = Math.max(reserve ?? 0, ...values),
    span = max - min || 1;
  const W = 1000,
    H = 330,
    L = Math.max(100, Math.min(180, format(max).length * 7 + 15)),
    R = 28,
    T = 30,
    B = 45;
  const x = (d: string) =>
    L +
    ((dateNumber(d) - dateNumber(points[0].date)) /
      Math.max(
        DAY,
        dateNumber(points[points.length - 1].date) - dateNumber(points[0].date),
      )) *
      (W - L - R);
  const y = (v: number) =>
    T + ((max + span * 0.08 - v) / (span * 1.16)) * (H - T - B);
  const path = (rows: CashPoint[], id: string) =>
    rows
      .map(
        (p, i) =>
          `${!i ? "M" : step ? "H" : "L"}${x(p.date)}${i && step ? " V" : ","}${y(value(p, id))}`,
      )
      .join(" ");
  const past = points.filter((p) => p.date <= cutoff),
    future = points.filter((p) => p.date >= cutoff),
    boundary = x(cutoff);
  const selected = active === null ? undefined : points[active];
  return (
    <>
      <div className="iv-bank-chart">
        <svg
          className="iv-plot"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Bank balances: solid history and dashed obligation-based future, plotted by actual calendar date"
        >
          <rect
            x={boundary}
            y={T}
            width={Math.max(0, W - R - boundary)}
            height={H - T - B}
            fill="#147d7309"
          />
          {Array.from({ length: 5 }, (_, i) => min + (span * i) / 4).map(
            (v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#dce4db" />
                <text
                  x={L - 10}
                  y={y(v) + 4}
                  textAnchor="end"
                  className="iv-axis"
                >
                  {format(v)}
                </text>
              </g>
            ),
          )}
          {reserve !== undefined && (
            <g>
              <line
                x1={L}
                x2={W - R}
                y1={y(reserve)}
                y2={y(reserve)}
                stroke="#b86554"
                strokeDasharray="3 5"
              />
              <text
                x={W - R}
                y={y(reserve) - 7}
                textAnchor="end"
                className="iv-axis"
              >
                Combined reserve · {format(reserve)}
              </text>
            </g>
          )}
          <line
            x1={boundary}
            x2={boundary}
            y1={T}
            y2={H - B}
            stroke="#789387"
            strokeDasharray="3 4"
          />
          <text x={boundary + 6} y={17} className="iv-axis">
            Today · projections begin
          </text>
          {series.map((s) => (
            <g key={s.id}>
              <path
                d={path(past, s.id)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.id === "total" ? 3 : 2}
              />
              <path
                d={path(future, s.id)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.id === "total" ? 3 : 2}
                strokeDasharray="7 5"
              />
            </g>
          ))}
          {Array.from({ length: 7 }, (_, i) =>
            iso(
              dateNumber(points[0].date) +
                ((dateNumber(points[points.length - 1].date) -
                  dateNumber(points[0].date)) *
                  i) /
                  6,
            ),
          ).map((d, i) => (
            <text
              key={i}
              x={x(d)}
              y={H - 13}
              textAnchor="middle"
              className="iv-axis"
            >
              {new Date(dateNumber(d)).toLocaleDateString("en-US", {
                month: "short",
                year: "2-digit",
                timeZone: "UTC",
              })}
            </text>
          ))}
          {points.map((p, i) => (
            <rect
              key={p.date}
              x={Math.max(
                L,
                x(p.date) - (i ? (x(p.date) - x(points[i - 1].date)) / 2 : 3),
              )}
              y={T}
              width={Math.max(
                3,
                ((i < points.length - 1
                  ? x(points[i + 1].date)
                  : x(p.date) + 6) -
                  (i ? x(points[i - 1].date) : x(p.date) - 6)) /
                  2,
              )}
              height={H - T - B}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${niceDate(p.date)}, ${p.date > cutoff ? "projected" : "recorded"}: ${series.map((s) => `${s.name} ${format(value(p, s.id))}`).join(", ")}. Open movements.`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => onSelect(p.date)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.date);
                }
              }}
            />
          ))}
          {selected && (
            <g pointerEvents="none">
              <line
                x1={x(selected.date)}
                x2={x(selected.date)}
                y1={T}
                y2={H - B}
                stroke="#799489"
              />
              {series.map((s) => (
                <circle
                  key={s.id}
                  cx={x(selected.date)}
                  cy={y(value(selected, s.id))}
                  r="4"
                  fill={s.color}
                  stroke="white"
                  strokeWidth="2"
                />
              ))}
            </g>
          )}
        </svg>
      </div>
      <div className="iv-chart-readout" aria-live="polite">
        {selected ? (
          <>
            <strong>{niceDate(selected.date)}</strong>
            {series.map((s) => (
              <span key={s.id}>
                <i style={{ background: s.color }} />
                {s.name}: {format(value(selected, s.id))}
              </span>
            ))}
          </>
        ) : (
          <span>
            Select a date to inspect the movements behind its balance. Solid =
            recorded; dashed = projected.
          </span>
        )}
      </div>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
    </>
  );
}
export function BankBalances({
  data,
  filters,
  selectedAccounts,
  setSelectedAccounts,
  format,
  drill,
  saveRoute,
}: {
  data: InsightData;
  filters: Filters;
  selectedAccounts: string[];
  setSelectedAccounts: (ids: string[]) => void;
  format: (n: number) => string;
  drill: Drill;
  saveRoute?: SaveCashRoute;
}) {
  const [horizon, setHorizon] = useState(12),
    [mode, setMode] = useState("both"),
    [step, setStep] = useState(true),
    [reserve, setReserve] = useState("0"),
    [schedules, setSchedules] = useState(true),
    [assumptions, setAssumptions] = useState(false),
    [overdue, setOverdue] = useState(true);
  const cutoff = today(),
    start = filters.start < cutoff ? filters.start : cutoff,
    end = iso(dateNumber(monthShift(cutoff, horizon + 1)) - DAY);
  const eligible = data.accounts.filter(
    (a) =>
      cashAccount(a) &&
      a.currency === filters.currency &&
      (!filters.chart || a.chart === filters.chart),
  );
  const accounts = eligible.filter((a) => selectedAccounts.includes(a.id));
  const projection = useMemo(
    () =>
      bankProjection(data, {
        accountIds: accounts.map((a) => a.id),
        start,
        cutoff,
        end,
        schedules,
        assumptions,
        overdue,
      }),
    [
      data,
      accounts.map((a) => a.id).join("|"),
      start,
      cutoff,
      end,
      schedules,
      assumptions,
      overdue,
    ],
  );
  const factor = 10 ** (currencyScales[filters.currency] ?? 2),
    threshold = Number.isFinite(Number(reserve))
      ? Math.round(Number(reserve) * factor)
      : 0;
  const series = [
    ...(mode !== "aggregate"
      ? accounts.map((a) => ({
          id: a.id,
          name: a.name,
          color:
            COLORS[eligible.findIndex((e) => e.id === a.id) % COLORS.length],
        }))
      : []),
    ...(mode !== "individual"
      ? [{ id: "total", name: "Selected accounts combined", color: "#253d37" }]
      : []),
  ];
  const future = projection.points.filter((p) => p.date >= cutoff),
    opening = future[0]?.total ?? 0,
    closing = future[future.length - 1]?.total ?? 0,
    low = future.reduce(
      (a, b) => (b.total < a.total ? b : a),
      future[0] ?? { total: 0, date: cutoff },
    );
  const breach = future.find((p) => p.total < threshold);
  const exact = (n: number) => formatMoney(n, filters.currency);
  return (
    <>
      <div className="iv-control-row">
        <label>
          Projection horizon
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
          >
            {[3, 6, 12, 24].map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </label>
        <label>
          Show balances
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="both">Individual + combined</option>
            <option value="individual">Individual accounts</option>
            <option value="aggregate">Combined only</option>
          </select>
        </label>
        <label>
          Path style
          <select
            value={step ? "step" : "line"}
            onChange={(e) => setStep(e.target.value === "step")}
          >
            <option value="step">Steps · payment jumps</option>
            <option value="line">Connected lines</option>
          </select>
        </label>
        <label>
          Combined cash reserve · {filters.currency}
          <input
            type="number"
            min="0"
            max="1000000000"
            value={reserve}
            onChange={(e) => {
              if (Number(e.target.value) >= 0 && Number(e.target.value) <= 1e9)
                setReserve(e.target.value);
            }}
          />
        </label>
      </div>
      <fieldset className="iv-account-picker">
        <legend>Choose exactly which accounts to compare and combine</legend>
        <div className="iv-row-between">
          <button
            className="iv-text-button"
            onClick={() => setSelectedAccounts(eligible.map((a) => a.id))}
          >
            Select all {eligible.length}
          </button>
          <button
            className="iv-text-button"
            onClick={() => setSelectedAccounts([])}
          >
            Clear
          </button>
        </div>
        <div>
          {eligible.map((a, i) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={selectedAccounts.includes(a.id)}
                onChange={() =>
                  setSelectedAccounts(
                    selectedAccounts.includes(a.id)
                      ? selectedAccounts.filter((id) => id !== a.id)
                      : [...selectedAccounts, a.id],
                  )
                }
              />
              <i style={{ background: COLORS[i % COLORS.length] }} />
              {a.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="iv-toggle-row">
        <label>
          <input
            type="checkbox"
            checked={schedules}
            onChange={(e) => setSchedules(e.target.checked)}
          />
          Include recurring commitments
        </label>
        <label>
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => setOverdue(e.target.checked)}
          />
          Pay overdue claims tomorrow
        </label>
        <label>
          <input
            type="checkbox"
            checked={assumptions}
            onChange={(e) => setAssumptions(e.target.checked)}
          />
          Also include assumptions
        </label>
      </div>
      {!eligible.length ? (
        <EmptyChart href="/dashboard/finance/accounts">
          Create a designated bank/cash account in this currency.
        </EmptyChart>
      ) : !accounts.length ? (
        <EmptyChart>
          Select accounts above to build a balance timeline.
        </EmptyChart>
      ) : (
        <>
          <BalanceLines
            points={projection.points}
            series={series}
            cutoff={cutoff}
            reserve={mode === "individual" ? undefined : threshold}
            step={step}
            format={format}
            onSelect={(date) =>
              drill(
                `Bank movements · ${niceDate(date)}`,
                ["Source", "Account", "Description", "Movement"],
                [
                  ...projection.historical
                    .filter((p) => p.date === date)
                    .map((p) => [
                      "Posted",
                      data.accounts.find((a) => a.id === p.account)?.name ??
                        p.account,
                      p.memo,
                      exact(p.amount),
                    ]),
                  ...projection.movements
                    .filter((m) => m.date === date)
                    .map((m) => [
                      m.kind + (m.overdue ? " · overdue catch-up" : ""),
                      data.accounts.find((a) => a.id === m.account)?.name ??
                        m.account,
                      m.name,
                      exact(m.amount),
                    ]),
                ],
                "/dashboard/finance/obligations",
              )
            }
          />
          <div className="iv-scenario-outcome">
            <div>
              <span>Recorded cash today</span>
              <strong>{format(opening)}</strong>
            </div>
            <div>
              <span>Projected ending cash</span>
              <strong>{format(closing)}</strong>
            </div>
            <div>
              <span>Lowest projected balance · {niceDate(low.date)}</span>
              <strong className={low.total < threshold ? "iv-warning" : ""}>
                {format(low.total)}
              </strong>
            </div>
          </div>
          <p className="iv-footnote">
            {breach
              ? `Combined reserve breached on ${niceDate(breach.date)}.`
              : "Combined reserve maintained over the modeled horizon."}{" "}
            {projection.movements.length} projected bank movements. Internal
            transfers cancel in the combined line when both sides are selected.
          </p>
          <DataTable
            label="Account balances and projected lows"
            headings={[
              "Account",
              "Recorded now",
              "Projected end",
              "Minimum projected",
              "Minimum date",
            ]}
            rows={accounts.map((a) => {
              const low = future.reduce(
                (m, p) =>
                  (p.values[a.id] ?? 0) < (m.values[a.id] ?? 0) ? p : m,
                future[0],
              );
              return [
                a.name,
                exact(future[0]?.values[a.id] ?? 0),
                exact(future[future.length - 1]?.values[a.id] ?? 0),
                exact(low?.values[a.id] ?? 0),
                low?.date ?? cutoff,
              ];
            })}
          />
          <DataTable
            label="Projected bank movements"
            headings={[
              "Expected date",
              "Account",
              "Source",
              "Description",
              "Cash movement",
            ]}
            rows={projection.movements.map((m) => [
              m.date,
              data.accounts.find((a) => a.id === m.account)?.name ?? m.account,
              m.kind,
              m.name,
              exact(m.amount),
            ])}
          />
        </>
      )}
      {projection.issues.length > 0 && (
        <div className="iv-notice">
          <strong>
            {projection.issues.length} sources need attention; the projection is
            incomplete.
          </strong>
          <ul>
            {projection.issues.map((i) => (
              <li key={`${i.source}-${i.reason}`}>
                {i.name}: {i.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="iv-data iv-routing">
        <summary>Assign bank accounts to obligations and schedules</summary>
        <p className="iv-footnote">
          Outgoing account pays the debtor’s side; incoming account receives the
          creditor’s side. Leave the other side blank for an external party.
          Neither selected means unassigned. These saved instructions do not
          settle a claim or post a transaction.
        </p>
        <RoutingEditor
          data={data}
          currency={filters.currency}
          save={saveRoute}
        />
      </details>
      <p className="iv-footnote">
        Full bank balances, including opening entries, in one currency. History
        starts at the selected From date; actuals run through today (
        {niceDate(cutoff)}). The global Through date, person and project filters
        do not reduce bank balances. Future uses current outstanding claims and
        known schedule versions, with explicit expectations replacing matching
        schedule occurrences. Linked claims are counted once, including
        partially paid ones. Missing account mappings and variable amounts are
        listed above. Scheduled cash overrides (for example net payroll) are
        planning instructions, not changes to gross contractual amounts. This
        does not include unrecorded future groceries, card purchases, interest,
        or bank fees.
      </p>
    </>
  );
}
function RoutingEditor({
  data,
  currency,
  save,
}: {
  data: InsightData;
  currency: string;
  save?: SaveCashRoute;
}) {
  const sources = [
    ...data.obligations
      .filter((o) => o.currency === currency && o.amount > 0)
      .map((o) => ({
        id: o.id,
        name: `Claim · ${o.name} · ${o.date}`,
        kind: "monetary_obligation" as const,
        monthly: false,
      })),
    ...[
      ...new Map(
        (data.cashSchedules ?? [])
          .filter((s) => s.currency === currency)
          .map((s) => [s.id, s]),
      ).values(),
    ].map((s) => ({
      id: s.id,
      name: `Schedule · ${s.name}`,
      kind: "commitment_schedule" as const,
      monthly: s.frequency === "monthly",
    })),
  ];
  return (
    <div className="iv-route-list">
      {sources.map((s) => (
        <RouteRow
          key={`${s.id}-${data.cashRoutes?.find((r) => r.source === s.id)?.revision ?? 0}`}
          data={data}
          currency={currency}
          source={s}
          current={data.cashRoutes?.find((r) => r.source === s.id)}
          save={save}
        />
      ))}
    </div>
  );
}
function RouteRow({
  data,
  currency,
  source,
  current,
  save,
}: {
  data: InsightData;
  currency: string;
  source: {
    id: string;
    name: string;
    kind: CashRoute["kind"];
    monthly: boolean;
  };
  current?: CashRoute;
  save?: SaveCashRoute;
}) {
  const [from, setFrom] = useState(current?.from ?? ""),
    [to, setTo] = useState(current?.to ?? ""),
    [amount, setAmount] = useState(
      current?.amount === undefined ? "" : moneyInput(current.amount, currency),
    ),
    [days, setDays] = useState(current?.days?.join(", ") ?? ""),
    [status, setStatus] = useState(""),
    [saving, setSaving] = useState(false);
  const accounts = data.accounts.filter(
    (a) => cashAccount(a) && a.currency === currency,
  );
  return (
    <div className="iv-route-row">
      <strong>{source.name}</strong>
      <div className="iv-control-row">
        <label>
          Outgoing bank
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">External / unassigned</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Incoming bank
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">External / unassigned</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {source.kind === "commitment_schedule" && (
          <label>
            Cash per period · optional
            <input
              placeholder="Use contractual amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        )}
        {source.monthly && (
          <label>
            Monthly payment days · optional
            <input
              placeholder="e.g. 15, 28"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
        )}
        <button
          className="iv-button"
          disabled={!save || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await save!({
                source: source.id,
                kind: source.kind,
                from: from || undefined,
                to: to || undefined,
                amount: amount ? parseMoney(amount, currency) : undefined,
                days: days
                  ? days.split(",").map((d) => Number(d.trim()))
                  : undefined,
                revision: current?.revision ?? 0,
              });
              setStatus("Saved");
            } catch (e) {
              setStatus(e instanceof Error ? e.message : "Could not save");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save routing"}
        </button>
      </div>
      {status && (
        <p role="status" className="iv-footnote">
          {status}
        </p>
      )}
      {current?.amount !== undefined && (
        <p className="iv-footnote">
          Cash override {formatMoney(current.amount, currency)} per period
          {current.days ? ` split across days ${current.days.join(", ")}` : ""}.
        </p>
      )}
    </div>
  );
}
export function EntityIncomeSpending({
  data,
  filters,
  format,
  drill,
}: {
  data: InsightData;
  filters: Filters;
  format: (n: number) => string;
  drill: Drill;
}) {
  const [basis, setBasis] = useState<"accrual" | "cash">("accrual"),
    [sort, setSort] = useState("expense"),
    [kind, setKind] = useState(""),
    [search, setSearch] = useState(""),
    [style, setStyle] = useState("paired");
  const result = entityContribution(data, { ...filters, basis });
  const rows = result.rows
    .filter(
      (r) =>
        (!kind || r.kind === kind) &&
        (!filters.entity || r.id === filters.entity) &&
        r.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b[sort as "income" | "expense" | "net"] -
          a[sort as "income" | "expense" | "net"],
    );
  const max = Math.max(
    1,
    ...rows.flatMap((r) => [
      Math.abs(r.income),
      Math.abs(r.expense),
      Math.abs(r.net),
    ]),
  );
  const exact = (n: number) => formatMoney(n, filters.currency);
  const select = (id: string) =>
    drill(
      `${rows.find((r) => r.id === id)?.name} · ${basis === "accrual" ? "income and expenses" : "bank cash movements"}`,
      [
        "Date",
        "Account",
        "Description",
        basis === "accrual" ? "Income" : "Received",
        basis === "accrual" ? "Expenses" : "Paid",
      ],
      result.lines
        .filter((l) => l.entity === id)
        .map((l) => [
          l.date,
          l.account,
          l.memo,
          exact(l.income),
          exact(l.expense),
        ]),
      "/dashboard/finance/entries",
    );
  return (
    <>
      <div className="iv-control-row">
        <label>
          Measure
          <select
            value={basis}
            onChange={(e) => setBasis(e.target.value as typeof basis)}
          >
            <option value="accrual">Income & expenses</option>
            <option value="cash">Bank cash received & paid</option>
          </select>
        </label>
        <label>
          Entity type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {[...new Set(result.rows.map((r) => r.kind))].sort().map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="expense">Largest cost / payment</option>
            <option value="income">Largest income / receipt</option>
            <option value="net">Largest net contribution</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
        <label>
          Presentation
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="paired">Income & spending bars</option>
            <option value="net">Net contribution</option>
          </select>
        </label>
        <input
          aria-label="Search income and spending entities"
          placeholder="Find a house, person, car…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Legend
        items={[
          {
            label: basis === "accrual" ? "Income" : "Cash received",
            color: COLORS[0],
          },
          {
            label: basis === "accrual" ? "Expenses" : "Cash paid",
            color: COLORS[3],
          },
        ]}
      />
      {!rows.length ? (
        <EmptyChart>No matching attributed activity in this period.</EmptyChart>
      ) : (
        <div className="iv-entity-bars">
          {rows.map((r) => (
            <button
              key={r.id}
              className="iv-entity-row"
              onClick={() => select(r.id)}
            >
              <div>
                <strong>{r.name}</strong>
                <small>{r.kind}</small>
              </div>
              {style === "paired" ? (
                <div className="iv-entity-pair">
                  <span>
                    <i
                      style={{
                        width: `${(Math.abs(r.income) / max) * 100}%`,
                        background: COLORS[0],
                      }}
                    />
                    <b>{format(r.income)}</b>
                  </span>
                  <span>
                    <i
                      style={{
                        width: `${(Math.abs(r.expense) / max) * 100}%`,
                        background: COLORS[3],
                      }}
                    />
                    <b>{format(r.expense)}</b>
                  </span>
                </div>
              ) : (
                <div className="iv-entity-net">
                  <span
                    style={{
                      left:
                        r.net >= 0
                          ? "50%"
                          : `${50 - (Math.abs(r.net) / max) * 50}%`,
                      width: `${(Math.abs(r.net) / max) * 50}%`,
                      background: r.net >= 0 ? COLORS[0] : COLORS[3],
                    }}
                  />
                  <b>{format(r.net)}</b>
                </div>
              )}
              <div className="iv-entity-total">
                <small>Net</small>
                <strong>{format(r.net)}</strong>
              </div>
            </button>
          ))}
        </div>
      )}
      <DataTable
        headings={[
          "Entity",
          "Type",
          basis === "accrual" ? "Income" : "Received",
          basis === "accrual" ? "Expenses" : "Paid",
          "Net",
        ]}
        rows={rows.map((r) => [
          r.name,
          r.kind,
          exact(r.income),
          exact(r.expense),
          exact(r.net),
        ])}
      />
      <p className="iv-footnote">
        Uses each posting portion’s subject: the person or asset that earned
        income or incurred a cost. A transaction can be split across several
        subjects without duplicating its amount. Beneficiaries and
        counterparties are not treated as the earner/cost subject.{" "}
        {basis === "accrual"
          ? "Income/expense mode includes salary, rent, mortgage interest, fuel and insurance; it excludes loan principal and capital asset purchases. Refunds and reversals keep their sign."
          : "Cash mode shows movements in designated bank accounts, including full loan payments, transfers and capital purchases. Card purchases appear when paid from a bank, under that payment’s own subject. Cash received is not necessarily earned income."}{" "}
        Unclassified amounts stay visible. Select a row to see its postings;
        edit their attribution in Journal entries.
      </p>
      <a className="iv-text-button" href="/dashboard/finance/entries">
        Assign or split an earner / cost subject in Journal entries →
      </a>
    </>
  );
}
