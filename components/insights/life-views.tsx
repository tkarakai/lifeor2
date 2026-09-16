"use client";
import { useMemo, useState } from "react";
import type { Filters, InsightData, LifeEvent } from "@/lib/insights/types";
import {
  dateNumber,
  DAY,
  filteredEvents,
  iso,
  niceDate,
} from "@/lib/insights/analytics";
import { COLORS, DataTable, EmptyChart, Plot, RankedBars } from "./charts";
export function Connections({
  data,
  end,
  entity,
  onEntity,
}: {
  data: InsightData;
  end: string;
  entity: string;
  onEntity: (id: string) => void;
}) {
  const [focus, setFocus] = useState("");
  const [query, setQuery] = useState("");
  const [selectedArrangement, setSelectedArrangement] = useState("");
  const people = data.entities.filter((e) => e.kind.toLowerCase() === "person");
  const selected = entity || focus || people[0]?.id || data.entities[0]?.id;
  const center = data.entities.find((e) => e.id === selected);
  const links = data.links.filter(
    (l) => l.start <= end && (!l.end || l.end > end),
  );
  const arrangementIds = new Set(
    links.filter((l) => l.entity === selected).map((l) => l.arrangement),
  );
  const arrangements = data.arrangements.filter(
    (a) =>
      arrangementIds.has(a.id) &&
      a.start <= end &&
      (!a.end || a.end > end) &&
      a.lifecycle === "active" &&
      `${a.name} ${a.kind}`.toLowerCase().includes(query.toLowerCase()),
  );
  if (!center)
    return (
      <EmptyChart href="/dashboard/entities">
        Add people and relationships to build your family map.
      </EmptyChart>
    );
  const shown = arrangements.slice(0, 12),
    height = Math.max(250, shown.length * 66 + 20);
  return (
    <>
      <div className="iv-control-row">
        <label>
          Center on{" "}
          <select
            value={selected}
            onChange={(e) => {
              setFocus(e.target.value);
              onEntity("");
            }}
          >
            {data.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="Search connections"
          placeholder="Find a relationship…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {!shown.length ? (
        <EmptyChart>
          No active relationships for this person at the selected cutoff.
        </EmptyChart>
      ) : (
        <div className="iv-network-scroll">
          <svg
            viewBox={`0 0 760 ${height}`}
            className="iv-network"
            role="img"
            aria-label={`Active relationships of ${center.name}`}
          >
            <rect
              x="20"
              y={height / 2 - 38}
              width="195"
              height="76"
              rx="16"
              fill="#143e3a"
            />
            <text
              x="118"
              y={height / 2 - 4}
              textAnchor="middle"
              fill="white"
              fontSize="15"
            >
              {center.name.length > 23
                ? center.name.slice(0, 21) + "…"
                : center.name}
            </text>
            <text
              x="118"
              y={height / 2 + 19}
              textAnchor="middle"
              fill="#a9cdc5"
              fontSize="11"
            >
              {center.kind} · {arrangements.length} connections
            </text>
            {shown.map((a, i) => {
              const y = 16 + (i * (height - 32)) / shown.length,
                others = links.filter(
                  (l) => l.arrangement === a.id && l.entity !== selected,
                ),
                role = links.find(
                  (l) => l.arrangement === a.id && l.entity === selected,
                )?.role;
              return (
                <g key={a.id}>
                  <path
                    d={`M215,${height / 2} C290,${height / 2} 290,${y + 25} 345,${y + 25}`}
                    fill="none"
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth="1.5"
                    opacity=".5"
                    pointerEvents="none"
                  />
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Explore ${a.name}`}
                    onClick={() => setSelectedArrangement(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedArrangement(a.id);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x="345"
                      y={y}
                      width="390"
                      height="52"
                      rx="9"
                      fill="#f1f4ef"
                    />
                    <circle
                      cx="361"
                      cy={y + 17}
                      r="4"
                      fill={COLORS[i % COLORS.length]}
                    />
                    <text x="375" y={y + 21} fontSize="12" fill="#24473f">
                      {a.name.length > 49 ? a.name.slice(0, 47) + "…" : a.name}
                    </text>
                    <text x="360" y={y + 40} fontSize="10" fill="#60736d">
                      {role} · {others.length} other{" "}
                      {others.length === 1 ? "participant" : "participants"}
                    </text>
                    <title>
                      {a.name}: {role}.{" "}
                      {others
                        .map(
                          (l) =>
                            `${data.entities.find((e) => e.id === l.entity)?.name ?? "Entity"} (${l.role})`,
                        )
                        .join(", ")}
                    </title>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {selectedArrangement &&
        arrangements.some((a) => a.id === selectedArrangement) && (
          <div className="iv-network-detail">
            <strong>
              {arrangements.find((a) => a.id === selectedArrangement)?.name}
            </strong>
            <p>Select a participant to center the map on them.</p>
            <div>
              {links
                .filter((l) => l.arrangement === selectedArrangement)
                .map((l, i) => (
                  <button
                    className="iv-button"
                    key={`${l.entity}-${i}`}
                    onClick={() => {
                      setFocus(l.entity);
                      onEntity("");
                      setSelectedArrangement("");
                    }}
                  >
                    {data.entities.find((e) => e.id === l.entity)?.name ??
                      "Archived entity"}{" "}
                    <small>{l.role}</small>
                  </button>
                ))}
            </div>
          </div>
        )}
      <p className="iv-footnote">
        Select a relationship to explore its participants. Current recorded
        relationship facts, active at {niceDate(end)}.{" "}
        {arrangements.length > 12
          ? "First 12 matches drawn; all matches are listed below."
          : ""}
      </p>
      <DataTable
        headings={["Relationship", "Person / entity", "Role"]}
        rows={arrangements.flatMap((a) =>
          links
            .filter((l) => l.arrangement === a.id)
            .map((l) => [
              a.name,
              data.entities.find((e) => e.id === l.entity)?.name ??
                "Archived entity",
              l.role,
            ]),
        )}
      />
    </>
  );
}
export function Ownership({
  data,
  end,
  entity,
}: {
  data: InsightData;
  end: string;
  entity: string;
}) {
  const name = (id: string) =>
    data.entities.find((e) => e.id === id)?.name ?? "Archived entity";
  const active = data.ownership.filter(
    (o) => o.start <= end && (!o.end || o.end > end),
  );
  const assets = [
    ...new Set(
      active
        .filter((o) => !entity || o.owner === entity || o.asset === entity)
        .map((o) => o.asset),
    ),
  ];
  if (!assets.length)
    return (
      <EmptyChart>No recorded ownership interests at this cutoff.</EmptyChart>
    );
  return (
    <div className="iv-ownership">
      {assets.map((asset) => {
        const rows = active.filter((o) => o.asset === asset),
          total = rows.reduce((s, o) => s + o.share, 0);
        return (
          <div key={asset}>
            <div className="iv-row-between">
              <strong>{name(asset)}</strong>
              <small>{total / 100}% documented</small>
            </div>
            <div className="iv-ownership-bar">
              {rows.map((o, i) => (
                <span
                  key={`${o.owner}-${i}`}
                  style={{
                    width: `${(o.share / Math.max(10000, total)) * 100}%`,
                    background: COLORS[i % COLORS.length],
                  }}
                  title={`${name(o.owner)}: ${o.share / 100}%`}
                >
                  {o.share >= 1500 ? `${o.share / 100}%` : ""}
                </span>
              ))}
            </div>
            <div className="iv-legend">
              {rows.map((o, i) => (
                <span key={`${o.owner}-${i}`}>
                  <i style={{ background: COLORS[i % COLORS.length] }} />
                  {name(o.owner)} · {o.share / 100}%
                </span>
              ))}
              {total < 10000 && (
                <span>Undocumented · {(10000 - total) / 100}%</span>
              )}
              {total > 10000 && (
                <span className="iv-warning">
                  Overlapping interests exceed 100%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function ActivityCalendar({
  events,
  end,
  onSelect,
}: {
  events: LifeEvent[];
  end: string;
  onSelect: (date: string) => void;
}) {
  const start = dateNumber(end) - DAY * 363,
    gridStart = start - new Date(start).getUTCDay() * DAY;
  const counts = new Map<string, number>();
  events.forEach((e) => counts.set(e.date, (counts.get(e.date) ?? 0) + 1));
  const max = Math.max(...counts.values(), 1);
  const days = Array.from(
    { length: Math.ceil((dateNumber(end) - gridStart) / DAY / 7) * 7 + 7 },
    (_, i) => iso(gridStart + i * DAY),
  ).filter((d) => d <= end);
  return (
    <>
      <div className="iv-calendar-scroll">
        <div className="iv-calendar-labels">
          <span>Sun</span>
          <span>Tue</span>
          <span>Thu</span>
          <span>Sat</span>
        </div>
        <div className="iv-calendar">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              aria-label={`${niceDate(d)}: ${counts.get(d) ?? 0} events`}
              title={`${niceDate(d)} · ${counts.get(d) ?? 0} events`}
              onClick={() => onSelect(d)}
              style={{
                background: counts.has(d)
                  ? `color-mix(in srgb, #147d73 ${25 + (counts.get(d)! / max) * 75}%, #eef1eb)`
                  : "#eef1eb",
              }}
            />
          ))}
        </div>
      </div>
      <div className="iv-row-between iv-footnote">
        <span>
          Up to 12 months ending {niceDate(end)} · selected events only
        </span>
        <span>Less ░ ▒ ▓ More</span>
      </div>
      <DataTable
        headings={["Date", "Events"]}
        rows={[...counts].sort((a, b) => a[0].localeCompare(b[0]))}
      />
    </>
  );
}
export function EventTimeline({
  data,
  filters,
}: {
  data: InsightData;
  filters: Filters;
}) {
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [sort, setSort] = useState("newest"),
    [limit, setLimit] = useState(25);
  const events = filteredEvents(data, filters);
  const kinds = [...new Set(events.map((e) => e.kind))].sort();
  const filtered = events
    .filter(
      (e) =>
        (!kind || e.kind === kind) &&
        `${e.name} ${e.kind}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "oldest"
        ? a.date.localeCompare(b.date)
        : b.date.localeCompare(a.date),
    );
  return (
    <>
      <div className="iv-control-row">
        <input
          aria-label="Search life timeline"
          placeholder="Search your story…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Event type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Every event type</option>
          {kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select
          aria-label="Timeline order"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      {!filtered.length ? (
        <EmptyChart href="/dashboard/events">
          No events match these filters.
        </EmptyChart>
      ) : (
        <div className="iv-timeline">
          {filtered.slice(0, limit).map((e) => (
            <div key={e.id} className="iv-timeline-row">
              <time>{niceDate(e.date)}</time>
              <i
                style={{
                  background: COLORS[kinds.indexOf(e.kind) % COLORS.length],
                }}
              />
              <div>
                <strong>{e.name}</strong>
                <p>
                  {e.kind.replace(/([a-z])([A-Z])/g, "$1 $2")}
                  {e.targets.length > 0 &&
                    ` · ${e.targets
                      .map(
                        (id) =>
                          data.entities.find((x) => x.id === id)?.name ??
                          data.arrangements.find((x) => x.id === id)?.name,
                      )
                      .filter(Boolean)
                      .join(", ")}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      {filtered.length > limit && (
        <button className="iv-text-button" onClick={() => setLimit(limit + 50)}>
          Show 50 more ({filtered.length - limit} remaining)
        </button>
      )}
    </>
  );
}
export function ArrangementTimeline({
  data,
  filters,
}: {
  data: InsightData;
  filters: Filters;
}) {
  const [kind, setKind] = useState("");
  const personArrangements = new Set(
    data.links
      .filter((l) => l.entity === filters.entity)
      .map((l) => l.arrangement),
  );
  const rows = data.arrangements
    .filter(
      (a) =>
        a.start <= filters.end &&
        (!a.end || a.end > filters.start) &&
        (!filters.entity || personArrangements.has(a.id)) &&
        (!kind || a.kind === kind),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const span = Math.max(1, dateNumber(filters.end) - dateNumber(filters.start));
  const pct = (d: string) =>
    Math.min(
      100,
      Math.max(0, ((dateNumber(d) - dateNumber(filters.start)) / span) * 100),
    );
  return (
    <>
      <div className="iv-inline-control">
        <label>
          Relationship type{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {[...new Set(data.arrangements.map((a) => a.kind))]
              .sort()
              .map((k) => (
                <option key={k}>{k}</option>
              ))}
          </select>
        </label>
      </div>
      {rows.length ? (
        <div className="iv-gantt">
          {rows.map((a, i) => (
            <div key={a.id} className="iv-gantt-row">
              <span title={a.name}>{a.name}</span>
              <div className="iv-gantt-track">
                <button
                  type="button"
                  title={`${a.name}: ${niceDate(a.start)} → ${a.end ? niceDate(a.end) + " (exclusive)" : "open-ended"} · ${a.lifecycle}`}
                  style={{
                    left: `${pct(a.start)}%`,
                    width: `${Math.max(0.7, pct(a.end ?? filters.end) - pct(a.start))}%`,
                    background: COLORS[i % COLORS.length],
                    opacity: a.lifecycle === "draft" ? 0.45 : 1,
                  }}
                  aria-label={`${a.name}, ${a.start} to ${a.end ?? "open-ended"}, ${a.lifecycle}`}
                >
                  {a.kind}
                </button>
              </div>
            </div>
          ))}
          <div className="iv-gantt-axis">
            <span>{niceDate(filters.start)}</span>
            <span>{niceDate(filters.end)}</span>
          </div>
        </div>
      ) : (
        <EmptyChart>No relationships overlap this period.</EmptyChart>
      )}
      <p className="iv-footnote">
        Recorded start and end dates; open-ended intervals extend to the edge.
        Faded bars are drafts. This is not a reconstruction of past revisions.
      </p>
    </>
  );
}
export function MeasurementTrends({
  data,
  filters,
}: {
  data: InsightData;
  filters: Filters;
}) {
  const [selection, setSelection] = useState(""),
    [assertion, setAssertion] = useState("");
  const keys = useMemo(
    () =>
      [
        ...new Set(
          data.measurements
            .filter((m) => !filters.entity || m.subject === filters.entity)
            .map((m) => `${m.name}\u0000${m.unit}`),
        ),
      ].sort(),
    [data.measurements, filters.entity],
  );
  const key = keys.includes(selection) ? selection : (keys[0] ?? "");
  const [name, unit] = key.split("\u0000");
  const points = data.measurements.filter(
    (m) =>
      m.name === name &&
      m.unit === unit &&
      m.date >= filters.start &&
      m.date <= filters.end &&
      (!filters.entity || m.subject === filters.entity) &&
      (!assertion || m.assertion === assertion),
  );
  const subjects = [...new Set(points.map((m) => m.subject))];
  const labels = (id: string) =>
    data.entities.find((e) => e.id === id)?.name ??
    data.arrangements.find((a) => a.id === id)?.name ??
    "Other subject";
  // Separate assertion and subject, retaining the distinction between observed and expected.
  const seriesKeys = [
    ...new Set(points.map((m) => `${m.subject}\u0000${m.assertion}`)),
  ];
  const rows = [...new Set(points.map((m) => m.date))].sort();
  return (
    <>
      <div className="iv-control-row">
        <label>
          Quantity{" "}
          <select value={key} onChange={(e) => setSelection(e.target.value)}>
            {keys.map((k) => (
              <option key={k} value={k}>
                {k.split("\u0000").join(" · ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Meaning{" "}
          <select
            value={assertion}
            onChange={(e) => setAssertion(e.target.value)}
          >
            <option value="">All meanings</option>
            {["observed", "contractual", "expected", "derived"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>
      {!points.length ? (
        <EmptyChart href="/dashboard/measurements">
          No typed measurements in this period. Try a wider date range.
        </EmptyChart>
      ) : (
        <>
          <div className="iv-measurement-small-multiples">
            {seriesKeys.map((seriesKey, i) => {
              const [subject, assertion] = seriesKey.split("\u0000"),
                seriesPoints = points
                  .filter(
                    (p) => p.subject === subject && p.assertion === assertion,
                  )
                  .sort((a, b) => a.date.localeCompare(b.date));
              return (
                <div key={seriesKey}>
                  <h4>
                    {labels(subject)}{" "}
                    <span className="iv-badge">{assertion}</span>
                  </h4>
                  <Plot
                    label={`${name} for ${labels(subject)}, ${assertion}, ${unit}`}
                    rows={seriesPoints.map((p) => ({
                      label: p.date,
                      value: p.value,
                    }))}
                    series={[
                      {
                        key: "value",
                        label: unit,
                        color: COLORS[i % COLORS.length],
                        dashed: assertion === "expected",
                      },
                    ]}
                    zero={false}
                  />
                </div>
              );
            })}
          </div>
          <DataTable
            headings={[
              "Date",
              "Subject",
              "Quantity",
              "Value",
              "Unit",
              "Meaning",
            ]}
            rows={points.map((m) => [
              m.date,
              labels(m.subject),
              m.name,
              m.value,
              m.unit,
              m.assertion,
            ])}
          />
        </>
      )}
      <p className="iv-footnote">
        Each panel shares one subject, unit, and meaning. Corrected observations
        are replaced; values are never summed across incompatible units.{" "}
        {subjects.length > 1 ? `${subjects.length} subjects compared.` : ""}{" "}
        {rows.length > 0
          ? "Points are equally spaced observations, not elapsed-time intervals."
          : ""}
      </p>
    </>
  );
}
export function EventKinds({ events }: { events: LifeEvent[] }) {
  const totals = new Map<string, number>();
  events.forEach((e) => totals.set(e.kind, (totals.get(e.kind) ?? 0) + 1));
  return (
    <RankedBars
      data={[...totals].map(([label, value]) => ({
        id: label,
        label: label.replace(/([a-z])([A-Z])/g, "$1 $2"),
        value,
      }))}
    />
  );
}
