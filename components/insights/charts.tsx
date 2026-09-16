"use client";
import { useId, useState, type ReactNode } from "react";
import type { ChartDatum } from "@/lib/insights/types";
export const COLORS = [
  "#147d73",
  "#e2a34b",
  "#637fc3",
  "#c36c64",
  "#8a779e",
  "#659895",
  "#bb8758",
  "#86a253",
  "#667882",
];
export const compact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export function EmptyChart({
  children,
  href,
}: {
  children: ReactNode;
  href?: string;
}) {
  return (
    <div className="iv-empty">
      <span className="iv-empty-symbol">＋</span>
      <p>{children}</p>
      {href && <a href={href}>Add or review records →</a>}
    </div>
  );
}
export function Legend({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  return (
    <div className="iv-legend">
      {items.map((x) => (
        <span key={x.label}>
          <i style={{ background: x.color }} />
          {x.label}
        </span>
      ))}
    </div>
  );
}
export function DataTable({
  label = "View underlying data",
  headings,
  rows,
}: {
  label?: string;
  headings: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="iv-data">
      <summary>
        {label} <span>{rows.length} rows</span>
      </summary>
      <div className="iv-table-scroll">
        <table>
          <thead>
            <tr>
              {headings.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((value, j) => (
                  <td key={j}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
export type Series = {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
};
export function Plot({
  rows,
  series,
  format = compact,
  mode = "line",
  onSelect,
  label,
  zero = true,
}: {
  rows: { label: string; [key: string]: string | number }[];
  series: Series[];
  format?: (n: number) => string;
  mode?: "line" | "area" | "bar";
  onSelect?: (index: number) => void;
  label: string;
  zero?: boolean;
}) {
  const uid = useId().replaceAll(":", "");
  const [hidden, setHidden] = useState<string[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const shown = series.filter((s) => !hidden.includes(s.key));
  if (!rows.length)
    return <EmptyChart>No records in this date range.</EmptyChart>;
  const values = rows.flatMap((r) => shown.map((s) => Number(r[s.key]) || 0));
  const min = Math.min(...values, ...(zero ? [0] : [])),
    max = Math.max(...values, ...(zero ? [0] : []));
  const spread = max - min || Math.max(Math.abs(max), 1);
  const lo = min < 0 ? min - spread * 0.08 : zero ? 0 : min - spread * 0.1,
    hi = max + spread * 0.12;
  const W = 760,
    H = 290,
    left = Math.min(
      165,
      Math.max(
        68,
        format(Math.abs(max) > Math.abs(min) ? max : min).length * 7 + 15,
      ),
    ),
    right = 20,
    top = 22,
    bottom = 45,
    w = W - left - right,
    h = H - top - bottom;
  const x = (i: number) => left + ((i + 0.5) / rows.length) * w;
  const y = (v: number) => top + h - ((v - lo) / (hi - lo || 1)) * h;
  const path = (s: Series) =>
    rows
      .map((r, i) => `${i ? "L" : "M"}${x(i)},${y(Number(r[s.key]) || 0)}`)
      .join(" ");
  const selected = active !== null ? rows[active] : undefined;
  return (
    <>
      <div className="iv-plot-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={label}
          className="iv-plot"
        >
          <defs>
            {shown.map((s) => (
              <linearGradient
                key={s.key}
                id={`${uid}-${s.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity=".22" />
                <stop offset="100%" stopColor={s.color} stopOpacity=".01" />
              </linearGradient>
            ))}
          </defs>
          {Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4).map(
            (v, i) => (
              <g key={i}>
                <line
                  x1={left}
                  x2={W - right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="currentColor"
                  className="iv-gridline"
                />
                <text
                  x={left - 10}
                  y={y(v) + 4}
                  textAnchor="end"
                  className="iv-axis"
                >
                  {format(v)}
                </text>
              </g>
            ),
          )}
          {min < 0 && (
            <line
              x1={left}
              x2={W - right}
              y1={y(0)}
              y2={y(0)}
              stroke="#9faeaa"
            />
          )}
          {shown.map((s, si) =>
            mode === "bar" ? (
              <g key={s.key}>
                {rows.map((r, i) => {
                  const value = Number(r[s.key]) || 0,
                    bw = Math.min(
                      35,
                      ((w / rows.length) * 0.72) / Math.max(1, shown.length),
                    );
                  return (
                    <rect
                      key={i}
                      x={x(i) - (bw * shown.length) / 2 + si * bw}
                      y={Math.min(y(0), y(value))}
                      width={Math.max(1, bw - 2)}
                      height={Math.max(
                        value === 0 ? 0 : 2,
                        Math.abs(y(0) - y(value)),
                      )}
                      rx="3"
                      fill={s.color}
                      opacity={active !== null && active !== i ? 0.4 : 1}
                    />
                  );
                })}
              </g>
            ) : (
              <g key={s.key}>
                {mode === "area" && (
                  <path
                    d={`${path(s)} L${x(rows.length - 1)},${y(Math.max(lo, 0))} L${x(0)},${y(Math.max(lo, 0))} Z`}
                    fill={`url(#${uid}-${s.key})`}
                  />
                )}
                <path
                  d={path(s)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.8"
                  strokeDasharray={s.dashed ? "7 5" : undefined}
                  strokeLinejoin="round"
                />
                {rows.length === 1 && (
                  <circle
                    cx={x(0)}
                    cy={y(Number(rows[0][s.key]))}
                    r="4"
                    fill={s.color}
                  />
                )}
              </g>
            ),
          )}
          {active !== null && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={top}
                y2={H - bottom}
                stroke="#859793"
                strokeDasharray="3 4"
              />
              {mode !== "bar" &&
                shown.map((s) => (
                  <circle
                    key={s.key}
                    cx={x(active)}
                    cy={y(Number(rows[active][s.key]) || 0)}
                    r="4.5"
                    fill={s.color}
                    stroke="white"
                    strokeWidth="2"
                  />
                ))}
            </g>
          )}
          {rows.map((r, i) => (
            <g key={i}>
              {(i % Math.max(1, Math.ceil(rows.length / 8)) === 0 ||
                i === rows.length - 1) && (
                <text
                  x={x(i)}
                  y={H - 15}
                  textAnchor="middle"
                  className="iv-axis"
                >
                  {r.label}
                </text>
              )}
              <rect
                x={x(i) - w / rows.length / 2}
                y={top}
                width={w / rows.length}
                height={h}
                fill="transparent"
                tabIndex={0}
                role={onSelect ? "button" : "img"}
                aria-label={`${r.label}: ${shown.map((s) => `${s.label} ${format(Number(r[s.key]))}`).join(", ")}${onSelect ? ". Open details" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => onSelect?.(i)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && onSelect) {
                    e.preventDefault();
                    onSelect(i);
                  }
                  if (e.key === "Escape") setActive(null);
                }}
              >
                <title>
                  {r.label}:{" "}
                  {shown
                    .map((s) => `${s.label} ${format(Number(r[s.key]))}`)
                    .join(" · ")}
                </title>
              </rect>
            </g>
          ))}
        </svg>
        <div className="iv-chart-readout" aria-live="polite">
          {selected ? (
            <>
              <strong>{selected.label}</strong>
              {shown.map((s) => (
                <span key={s.key}>
                  <i style={{ background: s.color }} />
                  {s.label} <b>{format(Number(selected[s.key]))}</b>
                </span>
              ))}
            </>
          ) : (
            <span>
              {onSelect
                ? "Select a period to explore its records"
                : "Hover or focus a point to explore"}
            </span>
          )}
        </div>
      </div>
      <div className="iv-legend">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={!hidden.includes(s.key)}
            className={hidden.includes(s.key) ? "iv-muted-series" : ""}
            onClick={() =>
              setHidden((old) =>
                old.includes(s.key)
                  ? old.filter((x) => x !== s.key)
                  : old.length < series.length - 1
                    ? [...old, s.key]
                    : old,
              )
            }
          >
            <i style={{ background: s.color }} />
            {s.label}
            {s.dashed && " · projection"}
          </button>
        ))}
      </div>
    </>
  );
}
export function RankedBars({
  data,
  format = compact,
  onSelect,
  limit = 10,
}: {
  data: ChartDatum[];
  format?: (n: number) => string;
  onSelect?: (id: string) => void;
  limit?: number;
}) {
  const [sort, setSort] = useState("value");
  const [expanded, setExpanded] = useState(false);
  const sorted = [...data].sort((a, b) =>
    sort === "name"
      ? a.label.localeCompare(b.label)
      : sort === "low"
        ? a.value - b.value
        : b.value - a.value,
  );
  const max = Math.max(...data.map((x) => Math.abs(x.value)), 1);
  if (!data.length) return <EmptyChart>No matching values yet.</EmptyChart>;
  return (
    <>
      <div className="iv-inline-control">
        <label>
          Sort{" "}
          <select
            aria-label="Sort chart values"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="value">Largest first</option>
            <option value="low">Smallest first</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
        <span>{data.length} categories</span>
      </div>
      <div className="iv-ranked">
        {sorted.slice(0, expanded ? undefined : limit).map((d, i) => (
          <button
            type="button"
            key={d.id}
            disabled={!onSelect}
            className="iv-rank-row"
            onClick={() => onSelect?.(d.id)}
            title={`${d.label}: ${format(d.value)}${d.detail ? ` · ${d.detail}` : ""}`}
          >
            <span className="iv-rank-label">{d.label}</span>
            <strong>{format(d.value)}</strong>
            <span className="iv-rank-track">
              <i
                style={{
                  width: `${(Math.abs(d.value) / max) * 100}%`,
                  background: d.color ?? COLORS[i % COLORS.length],
                }}
              />
            </span>
            {d.detail && <small>{d.detail}</small>}
          </button>
        ))}
      </div>
      {data.length > limit && (
        <button
          className="iv-text-button"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : `Show all ${data.length}`}
        </button>
      )}
    </>
  );
}
export function Donut({
  data,
  format = compact,
  onSelect,
  center = "Total",
}: {
  data: ChartDatum[];
  format?: (n: number) => string;
  onSelect?: (id: string) => void;
  center?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const positive = data.filter((x) => x.value > 0),
    total = positive.reduce((s, x) => s + x.value, 0);
  if (!total) return <EmptyChart>No positive values to compose.</EmptyChart>;
  let offset = 0;
  const selected = positive.find((x) => x.id === active);
  return (
    <div className="iv-donut-layout">
      <svg
        className="iv-donut"
        viewBox="0 0 240 240"
        role="img"
        aria-label={`${center}: ${format(total)}`}
      >
        <circle
          cx="120"
          cy="120"
          r="85"
          fill="none"
          stroke="#edf0ec"
          strokeWidth="26"
        />
        {positive.map((d, i) => {
          const share = d.value / total,
            start = offset;
          offset += share;
          return (
            <circle
              key={d.id}
              cx="120"
              cy="120"
              r="85"
              pathLength="100"
              fill="none"
              stroke={d.color ?? COLORS[i % COLORS.length]}
              strokeWidth={active === d.id ? 34 : 26}
              strokeDasharray={`${Math.max(0.03, share * 100 - 0.55)} ${100 - Math.max(0.03, share * 100 - 0.55)}`}
              strokeDashoffset={-start * 100}
              transform="rotate(-90 120 120)"
              tabIndex={0}
              role={onSelect ? "button" : "img"}
              aria-label={`${d.label}: ${format(d.value)}, ${(share * 100).toFixed(1)}%`}
              onFocus={() => setActive(d.id)}
              onBlur={() => setActive(null)}
              onMouseEnter={() => setActive(d.id)}
              onMouseLeave={() => setActive(null)}
              onClick={() => onSelect?.(d.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect?.(d.id);
              }}
            >
              <title>
                {d.label}: {format(d.value)} ({(share * 100).toFixed(1)}%)
              </title>
            </circle>
          );
        })}
        <text
          x="120"
          y="115"
          textAnchor="middle"
          className="iv-donut-total"
          style={{
            fontSize:
              format(selected?.value ?? total).length > 13
                ? 14
                : format(selected?.value ?? total).length > 9
                  ? 18
                  : 28,
          }}
        >
          {format(selected?.value ?? total)}
        </text>
        <text x="120" y="140" textAnchor="middle" className="iv-axis">
          {selected
            ? `${((selected.value / total) * 100).toFixed(1)}% of total`
            : center}
        </text>
      </svg>
      <div className="iv-donut-labels">
        {positive.map((d, i) => (
          <button
            type="button"
            key={d.id}
            onClick={() => onSelect?.(d.id)}
            onMouseEnter={() => setActive(d.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(d.id)}
            onBlur={() => setActive(null)}
          >
            <i style={{ background: d.color ?? COLORS[i % COLORS.length] }} />
            <span>{d.label}</span>
            <strong>{((d.value / total) * 100).toFixed(1)}%</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
export function Mosaic({
  data,
  format = compact,
  onSelect,
}: {
  data: ChartDatum[];
  format?: (n: number) => string;
  onSelect?: (id: string) => void;
}) {
  const positive = data.filter((d) => d.value > 0),
    total = positive.reduce((s, x) => s + x.value, 0);
  if (!total) return <EmptyChart>No positive values to compose.</EmptyChart>;
  // A proportional strip treemap: every tile area is exactly proportional to value.
  const rows: ChartDatum[][] = [[], [], []];
  const sums = [0, 0, 0];
  [...positive]
    .sort((a, b) => b.value - a.value)
    .forEach((d) => {
      const i = sums.indexOf(Math.min(...sums));
      rows[i].push(d);
      sums[i] += d.value;
    });
  return (
    <div
      className="iv-mosaic"
      role="group"
      aria-label="Proportional category treemap"
    >
      {rows
        .filter((row) => row.length)
        .map((row, i) => (
          <div className="iv-mosaic-row" key={i} style={{ flex: sums[i] }}>
            {row.map((d) => (
              <button
                type="button"
                key={d.id}
                style={{
                  flex: d.value,
                  background:
                    d.color ?? COLORS[positive.indexOf(d) % COLORS.length],
                }}
                onClick={() => onSelect?.(d.id)}
                title={`${d.label}: ${format(d.value)} (${((d.value / total) * 100).toFixed(1)}%)`}
              >
                <span>{d.label}</span>
                <strong>{format(d.value)}</strong>
                <small>{((d.value / total) * 100).toFixed(1)}%</small>
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}
export function Waterfall({
  income,
  expense,
  format,
}: {
  income: number;
  expense: number;
  format: (n: number) => string;
}) {
  const net = income - expense,
    max = Math.max(Math.abs(income), Math.abs(expense), Math.abs(net), 1),
    min = Math.min(0, net, income),
    high = Math.max(income, net, 0);
  const y = (v: number) => 28 + ((high - v) / (high - min || max)) * 165;
  return (
    <svg
      viewBox="0 0 560 265"
      role="img"
      aria-label={`Income ${format(income)}, expenses ${format(expense)}, surplus ${format(net)}`}
      className="iv-plot"
    >
      <line x1="32" x2="530" y1={y(0)} y2={y(0)} stroke="#cbd3ce" />
      {[
        { label: "Income", a: 0, b: income, color: COLORS[0], value: income },
        {
          label: "Expenses",
          a: net,
          b: income,
          color: COLORS[1],
          value: -expense,
        },
        {
          label: net < 0 ? "Shortfall" : "Surplus",
          a: 0,
          b: net,
          color: net < 0 ? COLORS[3] : COLORS[2],
          value: net,
        },
      ].map((d, i) => (
        <g key={d.label}>
          <rect
            x={65 + i * 175}
            y={Math.min(y(d.a), y(d.b))}
            width="88"
            height={Math.max(2, Math.abs(y(d.a) - y(d.b)))}
            rx="5"
            fill={d.color}
          />
          <text
            x={109 + i * 175}
            y={Math.min(y(d.a), y(d.b)) - 10}
            textAnchor="middle"
            className="iv-chart-value"
          >
            {format(d.value)}
          </text>
          <text
            x={109 + i * 175}
            y="233"
            textAnchor="middle"
            className="iv-axis"
          >
            {d.label}
          </text>
          {i < 2 && (
            <line
              x1={153 + i * 175}
              x2={240 + i * 175}
              y1={y(i === 0 ? income : net)}
              y2={y(i === 0 ? income : net)}
              stroke="#94a39e"
              strokeDasharray="4 4"
            />
          )}
        </g>
      ))}
    </svg>
  );
}
