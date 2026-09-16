"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  EyeOff,
  LayoutGrid,
  Maximize2,
  RotateCcw,
  Settings2,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useDataset, useQuery, useMutation } from "@/lib/dataset";
import { currencyScales, formatMoney } from "@/components/money";
import type { Filters, InsightData } from "@/lib/insights/types";
import {
  balances,
  buckets,
  cashAccount,
  csv,
  dateNumber,
  DAY,
  filteredEvents,
  iso,
  monthShift,
  niceDate,
  scopedPostings,
  today,
} from "@/lib/insights/analytics";
import { COLORS, compact, Donut, EmptyChart } from "./charts";
import {
  BalanceComposition,
  BeneficiarySpending,
  CashMovement,
  Composition,
  Seasonality,
  SurplusBridge,
  Transactions,
  Worth,
  type Drill,
} from "./money-views";
import {
  ActivityCalendar,
  ArrangementTimeline,
  Connections,
  EventKinds,
  EventTimeline,
  MeasurementTrends,
  Ownership,
} from "./life-views";
import {
  BudgetProgress,
  DebtPayoff,
  ObligationPressure,
  RecurringCommitments,
  SavingsGoal,
  UpcomingFlows,
  WhatIf,
} from "./planning-views";
import {
  BankBalances,
  EntityIncomeSpending,
  type SaveCashRoute,
} from "./bank-views";
import type { Id } from "@/convex/_generated/dataModel";
import "./insights.css";

type Lens =
  | "overview"
  | "money"
  | "family"
  | "life"
  | "planning"
  | "favorites"
  | "gallery";
const lenses: { id: Lens; label: string; number: string }[] = [
  { id: "overview", label: "Overview", number: "01" },
  { id: "money", label: "Money", number: "02" },
  { id: "family", label: "Family & assets", number: "03" },
  { id: "life", label: "Life timeline", number: "04" },
  { id: "planning", label: "Planning", number: "05" },
];
const cards = [
  {
    id: "bank-balances",
    title: "Your cash, yesterday and tomorrow",
    subtitle: "Actual bank balances meet obligation-based projections",
    lens: "money",
    overview: true,
    kind: "Actual + projected",
    wide: true,
  },
  {
    id: "entity-contribution",
    title: "Who earns. What costs.",
    subtitle:
      "Income and spending attributed to people, houses, cars, and the family",
    lens: "family",
    overview: true,
    kind: "Recorded",
    wide: true,
  },
  {
    id: "flow",
    title: "The rhythm of your finances",
    subtitle: "Income, expenses, and what remains",
    lens: "money",
    overview: true,
    kind: "Recorded",
    style: "plot",
  },
  {
    id: "spending",
    title: "Where it all goes",
    subtitle: "Your spending, in proportion",
    lens: "money",
    overview: true,
    kind: "Recorded",
    style: "composition",
  },
  {
    id: "worth",
    title: "The bigger picture",
    subtitle: "Assets, liabilities, and book net assets over time",
    lens: "money",
    overview: true,
    kind: "Recorded",
    style: "plot",
  },
  {
    id: "bridge",
    title: "From income to surplus",
    subtitle: "A waterfall of this period’s result",
    lens: "money",
    kind: "Recorded",
  },
  {
    id: "income",
    title: "Your income mix",
    subtitle: "The sources supporting your family",
    lens: "money",
    kind: "Recorded",
    style: "composition",
  },
  {
    id: "seasonality",
    title: "Patterns across the months",
    subtitle: "Find seasonal peaks and unusual spending",
    lens: "money",
    kind: "Recorded",
    wide: true,
  },
  {
    id: "cash",
    title: "Cash in motion",
    subtitle: "What changed in your cash accounts",
    lens: "money",
    kind: "Recorded",
  },
  {
    id: "beneficiaries",
    title: "Who it supports",
    subtitle: "Expenses allocated to people and other beneficiaries",
    lens: "family",
    kind: "Recorded",
  },
  {
    id: "assets",
    title: "What you have",
    subtitle: "The composition of recorded assets",
    lens: "family",
    kind: "Snapshot",
    style: "composition",
  },
  {
    id: "debt",
    title: "What you owe",
    subtitle: "Liabilities, from mortgages to credit cards",
    lens: "family",
    kind: "Snapshot",
    style: "composition",
  },
  {
    id: "connections",
    title: "A connected life",
    subtitle: "The people, places, and agreements around you",
    lens: "family",
    overview: true,
    kind: "Snapshot",
    wide: true,
  },
  {
    id: "ownership",
    title: "A share of the picture",
    subtitle: "Documented ownership, asset by asset",
    lens: "family",
    kind: "Snapshot",
  },
  {
    id: "inventory",
    title: "Your family’s world",
    subtitle: "People, organizations, and things you track",
    lens: "family",
    kind: "Snapshot",
  },
  {
    id: "activity",
    title: "A year in little moments",
    subtitle: "A calendar of recorded activity",
    lens: "life",
    kind: "Recorded",
    wide: true,
  },
  {
    id: "timeline",
    title: "Your life, unfolding",
    subtitle: "Explore the story behind your records",
    lens: "life",
    kind: "Recorded",
    wide: true,
  },
  {
    id: "eventKinds",
    title: "The shape of everyday life",
    subtitle: "Which kinds of events fill your timeline",
    lens: "life",
    kind: "Recorded",
  },
  {
    id: "arrangements",
    title: "The chapters of your life",
    subtitle: "Relationships and agreements across time",
    lens: "life",
    kind: "Recorded",
    wide: true,
  },
  {
    id: "measurements",
    title: "Things worth measuring",
    subtitle: "Compare observations, terms, and expectations",
    lens: "life",
    kind: "Mixed",
    wide: true,
  },
  {
    id: "pressure",
    title: "On the horizon",
    subtitle: "Outstanding obligations and when they are due",
    lens: "planning",
    overview: true,
    kind: "Commitments",
  },
  {
    id: "expected",
    title: "What’s expected next",
    subtitle: "Recorded future movements, in and out",
    lens: "planning",
    kind: "Expected",
  },
  {
    id: "budget",
    title: "The plan meets reality",
    subtitle: "Actual results against a selected budget",
    lens: "planning",
    kind: "Plan vs actual",
  },
  {
    id: "recurring",
    title: "Your recurring commitments",
    subtitle: "A monthly view of fixed schedules",
    lens: "planning",
    kind: "Commitments",
  },
  {
    id: "whatif",
    title: "A little change. A different future.",
    subtitle: "Explore how your choices could change cash ahead",
    lens: "planning",
    overview: true,
    kind: "What-if",
    wide: true,
  },
  {
    id: "payoff",
    title: "A shorter road to debt-free",
    subtitle: "Compare regular payments with a little extra principal",
    lens: "planning",
    kind: "What-if",
    wide: true,
  },
  {
    id: "goal",
    title: "Make room for something good",
    subtitle: "An interactive savings-goal calculator",
    lens: "planning",
    kind: "What-if",
    wide: true,
  },
];
type Preferences = {
  lens: Lens;
  filters: Filters;
  preset: string;
  group: string;
  hidden: string[];
  favorites: string[];
  order: string[];
  styles: Record<string, string>;
  wide: string[];
  density: string;
  theme: string;
  exact: boolean;
  cashAccounts: string[];
};
const defaults = (data: InsightData): Preferences => {
  const end = today();
  return {
    lens: "overview",
    filters: {
      start: `${end.slice(0, 4)}-01-01`,
      end,
      currency: data.accounts[0]?.currency ?? data.flows[0]?.currency ?? "USD",
      chart: "",
      entity: "",
      tag: "",
    },
    preset: "ytd",
    group: "month",
    hidden: [],
    favorites: [],
    order: cards.map((c) => c.id),
    styles: {},
    wide: [],
    density: "comfortable",
    theme: "sage",
    exact: false,
    cashAccounts: data.accounts.filter(cashAccount).map((a) => a.id),
  };
};
function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["\ufeff" + text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`iv-dialog ${wide ? "iv-dialog-wide" : ""}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="iv-dialog-header">
        <div>
          <span className="iv-eyebrow">Family observatory</span>
          <h2>{title}</h2>
        </div>
        <button
          className="iv-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function InsightsExplorer() {
  const data = useQuery(api.insights.snapshot);
  const saveRouting = useMutation(api.cashRouting.save);
  const { id, datasets } = useDataset();
  if (!data)
    return (
      <div className="iv-root">
        <div className="iv-loading" role="status">
          <span className="iv-eyebrow">Family observatory</span>
          <h1>Bringing your world into focus…</h1>
          <div />
          <div />
          <div />
        </div>
      </div>
    );
  return (
    <Explorer
      key={id}
      data={data}
      datasetId={id}
      saveCashRoute={(r) =>
        saveRouting({
          source:
            r.kind === "monetary_obligation"
              ? { kind: r.kind, id: r.source as Id<"monetary_obligation"> }
              : { kind: r.kind, id: r.source as Id<"commitment_schedule"> },
          from_account_id: r.from as Id<"ledger_account"> | undefined,
          to_account_id: r.to as Id<"ledger_account"> | undefined,
          cash_minor_units: r.amount,
          monthly_days: r.days,
          expectedRevision: r.revision,
        })
      }
      datasetName={datasets.find((d) => d._id === id)?.name ?? "Dataset"}
    />
  );
}
export function Explorer({
  data,
  datasetId,
  datasetName,
  saveCashRoute,
}: {
  data: InsightData;
  datasetId: string;
  datasetName: string;
  saveCashRoute?: SaveCashRoute;
}) {
  const storageKey = `lifeor.insights.v1.${datasetId}`;
  const [prefs, setPrefs] = useState(() => defaults(data)),
    [loaded, setLoaded] = useState(false),
    [customize, setCustomize] = useState(false),
    [details, setDetails] = useState<{
      title: string;
      headings: string[];
      rows: (string | number)[][];
      href?: string;
    } | null>(null),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (stored && typeof stored === "object") {
        const base = defaults(data);
        const ids = new Set(cards.map((c) => c.id));
        const strings = (value: unknown) =>
          Array.isArray(value)
            ? value.filter(
                (x): x is string => typeof x === "string" && ids.has(x),
              )
            : [];
        const f = stored.filters;
        const validDate = (v: unknown): v is string =>
          typeof v === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(v) &&
          Number.isFinite(dateNumber(v)) &&
          iso(dateNumber(v)) === v;
        setPrefs({
          ...base,
          lens: [...lenses.map((l) => l.id), "favorites", "gallery"].includes(
            stored.lens,
          )
            ? stored.lens
            : base.lens,
          preset: ["ytd", "12m", "all", "custom"].includes(stored.preset)
            ? stored.preset
            : "custom",
          filters:
            f && validDate(f.start) && validDate(f.end) && f.start <= f.end
              ? {
                  start: f.start,
                  end: f.end,
                  currency:
                    typeof f.currency === "string" &&
                    Object.hasOwn(currencyScales, f.currency)
                      ? f.currency
                      : base.filters.currency,
                  chart: data.charts.some((c) => c.id === f.chart)
                    ? f.chart
                    : "",
                  entity: data.entities.some((e) => e.id === f.entity)
                    ? f.entity
                    : "",
                  tag: data.tags.some((t) => t.id === f.tag) ? f.tag : "",
                }
              : base.filters,
          group: ["month", "quarter", "year"].includes(stored.group)
            ? stored.group
            : "month",
          cashAccounts: Array.isArray(stored.cashAccounts)
            ? stored.cashAccounts.filter(
                (id: unknown) =>
                  typeof id === "string" &&
                  data.accounts.some((a) => a.id === id && cashAccount(a)),
              )
            : base.cashAccounts,
          hidden: strings(stored.hidden),
          favorites: strings(stored.favorites),
          wide: strings(stored.wide),
          order: [...new Set([...strings(stored.order), ...base.order])],
          styles:
            stored.styles && typeof stored.styles === "object"
              ? (Object.fromEntries(
                  Object.entries(stored.styles).filter(
                    ([id, value]) =>
                      ids.has(id) &&
                      [
                        "area",
                        "line",
                        "bar",
                        "donut",
                        "mosaic",
                        "bars",
                      ].includes(String(value)),
                  ),
                ) as Record<string, string>)
              : {},
          density: stored.density === "compact" ? "compact" : "comfortable",
          theme: stored.theme === "ink" ? "ink" : "sage",
          exact: stored.exact === true,
        });
      }
    } catch {
      /* Storage is optional in private browsing. */
    }
    setLoaded(true);
    // Preferences load only when changing dataset. Live updates do not overwrite edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(storageKey, JSON.stringify(prefs));
      } catch {
        /* Exploration still works without storage. */
      }
  }, [prefs, loaded, storageKey]);
  const patch = (values: Partial<Preferences>) =>
    setPrefs((p) => ({ ...p, ...values }));
  const filter = (values: Partial<Filters>) =>
    setPrefs((p) => ({ ...p, filters: { ...p.filters, ...values } }));
  const f = prefs.filters;
  const valid =
    f.start <= f.end &&
    Number.isFinite(dateNumber(f.start)) &&
    Number.isFinite(dateNumber(f.end)) &&
    dateNumber(f.end) - dateNumber(f.start) <= DAY * 36525;
  const factor = 10 ** (currencyScales[f.currency] ?? 2);
  const format = (value: number) =>
    prefs.exact
      ? formatMoney(Math.round(value), f.currency)
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: f.currency,
          notation: Math.abs(value / factor) >= 10000 ? "compact" : "standard",
          minimumFractionDigits: 0,
          maximumFractionDigits: Math.abs(value / factor) >= 10000 ? 1 : 0,
        }).format(value / factor);
  const drill: Drill = (title, headings, rows, href) => {
    setSearch("");
    setDetails({ title, headings, rows, href });
  };
  const accountBalances = useMemo(
    () => (valid ? balances(data, f) : []),
    [data, f, valid],
  );
  const period = useMemo(
    () => (valid ? buckets(data, f, prefs.group) : []),
    [data, f, prefs.group, valid],
  );
  const income = period.reduce((s, x) => s + x.income, 0),
    expenses = period.reduce((s, x) => s + x.expense, 0);
  const bookWorth = accountBalances
    .filter((a) => ["Asset", "Liability"].includes(a.type))
    .reduce((s, a) => s + (a.type === "Asset" ? a.value : -a.value), 0);
  const cash = accountBalances
    .filter(cashAccount)
    .reduce((s, a) => s + a.value, 0);
  const events = useMemo(
    () => (valid ? filteredEvents(data, f) : []),
    [data, f, valid],
  );
  const priorEnd = valid ? iso(dateNumber(f.start) - DAY) : f.end,
    priorStart = valid
      ? iso(dateNumber(priorEnd) - (dateNumber(f.end) - dateNumber(f.start)))
      : f.start;
  const prior = valid
    ? buckets(data, { ...f, start: priorStart, end: priorEnd }, "year")
    : [];
  const priorNet = prior.reduce((s, r) => s + r.net, 0);
  const hasPriorActivity =
    valid &&
    scopedPostings(data, { ...f, start: priorStart, end: priorEnd }).some((p) =>
      ["Income", "Expense"].includes(p.accountInfo.type),
    );
  const hasRecords =
    data.postings.length +
      data.events.length +
      data.entities.length +
      data.measurements.length +
      data.flows.length >
    0;
  const visible = prefs.order
    .map((id) => cards.find((c) => c.id === id)!)
    .filter(
      (c) =>
        c &&
        !prefs.hidden.includes(c.id) &&
        (prefs.lens === "gallery" || prefs.lens === "favorites"
          ? prefs.lens === "gallery" || prefs.favorites.includes(c.id)
          : prefs.lens === "overview"
            ? c.overview
            : c.lens === prefs.lens ||
              (c.id === "bank-balances" && prefs.lens === "planning")),
    );
  const toggle = (key: "hidden" | "favorites" | "wide", id: string) =>
    setPrefs((p) => ({
      ...p,
      [key]: p[key].includes(id)
        ? p[key].filter((x) => x !== id)
        : [...p[key], id],
    }));
  const move = (id: string, delta: number) => {
    const order = [...prefs.order],
      i = order.indexOf(id),
      next = i + delta;
    if (next >= 0 && next < order.length) {
      [order[i], order[next]] = [order[next], order[i]];
      patch({ order });
    }
  };
  const preset = (value: string) => {
    const end = today();
    const earliest =
      [
        ...data.postings.map((p) => p.date),
        ...data.events.map((e) => e.date),
        ...data.measurements.map((m) => m.date),
        ...data.arrangements.map((a) => a.start),
      ].sort()[0] ?? `${end.slice(0, 4)}-01-01`;
    patch({
      preset: value,
      filters: {
        ...f,
        start:
          value === "ytd"
            ? `${end.slice(0, 4)}-01-01`
            : value === "12m"
              ? monthShift(end, -11)
              : earliest < end
                ? earliest
                : end,
        end,
      },
    });
  };
  const exportSummary = () => {
    download(
      `lifeor-${f.start}-${f.end}-${f.currency}.csv`,
      csv([
        ["Dataset", datasetName],
        ["Currency", f.currency],
        [
          "Chart",
          data.charts.find((c) => c.id === f.chart)?.name ??
            "All charts (not consolidated)",
        ],
        [
          "Person / entity",
          data.entities.find((e) => e.id === f.entity)?.name ?? "All",
        ],
        ["Project / tag", data.tags.find((t) => t.id === f.tag)?.name ?? "All"],
        [
          "Period",
          "Income (minor units)",
          "Expenses (minor units)",
          "Surplus (minor units)",
          "Book net assets (minor units)",
        ],
        ...period.map((p) => [p.key, p.income, p.expense, p.net, p.worth]),
      ]),
    );
    setMessage(
      "Summary exported with filters, currency, and exact minor-unit amounts.",
    );
  };
  const renderCard = (id: string) => {
    const common = { data, filters: f, format, drill };
    const style =
      prefs.styles[id] ??
      (id === "spending" || id === "income"
        ? "donut"
        : id === "assets"
          ? "mosaic"
          : id === "debt"
            ? "bars"
            : id === "flow"
              ? "bar"
              : "area");
    switch (id) {
      case "bank-balances":
        return (
          <BankBalances
            {...common}
            selectedAccounts={prefs.cashAccounts}
            setSelectedAccounts={(cashAccounts) => patch({ cashAccounts })}
            saveRoute={saveCashRoute}
          />
        );
      case "entity-contribution":
        return <EntityIncomeSpending {...common} />;
      case "flow":
        return (
          <Transactions
            {...common}
            group={prefs.group}
            style={style as "area" | "line" | "bar"}
          />
        );
      case "spending":
      case "income":
        return (
          <Composition
            {...common}
            type={id === "income" ? "Income" : "Expense"}
            mode={style}
          />
        );
      case "worth":
        return (
          <Worth
            {...common}
            group={prefs.group}
            style={style as "area" | "line" | "bar"}
          />
        );
      case "bridge":
        return <SurplusBridge {...common} />;
      case "seasonality":
        return <Seasonality {...common} />;
      case "cash":
        return <CashMovement {...common} />;
      case "beneficiaries":
        return <BeneficiarySpending {...common} />;
      case "assets":
      case "debt":
        return (
          <BalanceComposition
            {...common}
            type={id === "assets" ? "Asset" : "Liability"}
            mode={style}
          />
        );
      case "connections":
        return (
          <Connections
            data={data}
            end={f.end}
            entity={f.entity}
            onEntity={(entity) => filter({ entity })}
          />
        );
      case "ownership":
        return <Ownership data={data} end={f.end} entity={f.entity} />;
      case "inventory": {
        const groups = new Map<string, number>();
        data.entities
          .filter((e) => !f.entity || e.id === f.entity)
          .forEach((e) => groups.set(e.kind, (groups.get(e.kind) ?? 0) + 1));
        return (
          <>
            <Donut
              data={[...groups].map(([label, value]) => ({
                id: label,
                label,
                value,
              }))}
              format={compact}
              center="Records"
              onSelect={(kind) =>
                drill(
                  kind,
                  ["Name", "Type"],
                  data.entities
                    .filter(
                      (e) =>
                        e.kind === kind && (!f.entity || e.id === f.entity),
                    )
                    .map((e) => [e.name, e.kind]),
                  "/dashboard/entities",
                )
              }
            />
            <p className="iv-footnote">
              Current unarchived entities. Person filter applies; date,
              currency, chart and project filters do not.
            </p>
          </>
        );
      }
      case "activity":
        return (
          <ActivityCalendar
            events={events}
            end={f.end}
            onSelect={(date) =>
              drill(
                `Events · ${niceDate(date)}`,
                ["Date", "Event", "Kind"],
                events
                  .filter((e) => e.date === date)
                  .map((e) => [e.date, e.name, e.kind]),
                "/dashboard/events",
              )
            }
          />
        );
      case "timeline":
        return <EventTimeline data={data} filters={f} />;
      case "eventKinds":
        return <EventKinds events={events} />;
      case "arrangements":
        return <ArrangementTimeline data={data} filters={f} />;
      case "measurements":
        return <MeasurementTrends data={data} filters={f} />;
      case "pressure":
        return <ObligationPressure {...common} />;
      case "expected":
        return <UpcomingFlows {...common} />;
      case "budget":
        return <BudgetProgress {...common} />;
      case "recurring":
        return <RecurringCommitments {...common} />;
      case "whatif":
        return (
          <WhatIf
            key={`${f.currency}-${f.chart}-${f.entity}-${f.tag}`}
            {...common}
          />
        );
      case "payoff":
        return <DebtPayoff {...common} />;
      case "goal":
        return <SavingsGoal key={f.currency} filters={f} format={format} />;
      default:
        return null;
    }
  };
  const detailRows =
    details?.rows.filter((row) =>
      row.some((v) => String(v).toLowerCase().includes(search.toLowerCase())),
    ) ?? [];
  if (!loaded)
    return (
      <div className="iv-root iv-loading" role="status">
        Opening your observatory…
      </div>
    );
  return (
    <div
      className={`iv-root iv-theme-${prefs.theme} iv-density-${prefs.density}`}
    >
      <header className="iv-hero">
        <div className="iv-hero-top">
          <span className="iv-eyebrow">
            <span className="iv-live-dot" /> FAMILY OBSERVATORY{" "}
            <span className="iv-dataset">/ {datasetName}</span>
          </span>
          <div className="iv-actions">
            <button
              className="iv-button"
              onClick={exportSummary}
              disabled={!valid}
            >
              <Download size={14} />
              Export
            </button>
            <button className="iv-button" onClick={() => setCustomize(true)}>
              <Settings2 size={14} />
              Make it yours
            </button>
          </div>
        </div>
        <div className="iv-hero-heading">
          <div>
            <h1>
              Your life,
              <br />
              <em>in perspective.</em>
            </h1>
            <p>
              A little clarity for the everyday.
              <br />A bigger picture for everything ahead.
            </p>
          </div>
          <div className="iv-orbit" aria-hidden="true">
            <div />
            <div />
            <div />
            <i />
            <i />
            <i />
            <span>
              PAST <b>·</b> PRESENT <b>·</b> POSSIBILITY
            </span>
          </div>
        </div>
        <div className="iv-hero-bottom">
          <span>
            <i />
            Connected to your records
          </span>
          <span>
            {cards.length} ways to see your world{" "}
            <span className="iv-divider">/</span> Private to this dataset
          </span>
        </div>
      </header>
      <nav className="iv-lenses" aria-label="Visualization lenses">
        {lenses.map((l) => (
          <button
            key={l.id}
            className={prefs.lens === l.id ? "active" : ""}
            aria-current={prefs.lens === l.id ? "page" : undefined}
            onClick={() => patch({ lens: l.id })}
          >
            <small>{l.number}</small>
            {l.label}
          </button>
        ))}
        <button
          className={prefs.lens === "favorites" ? "active" : ""}
          onClick={() => patch({ lens: "favorites" })}
        >
          <Star size={14} />
          My collection{" "}
          {prefs.favorites.length > 0 && (
            <small>{prefs.favorites.length}</small>
          )}
        </button>
        <button
          className={prefs.lens === "gallery" ? "active" : ""}
          onClick={() => patch({ lens: "gallery" })}
        >
          <LayoutGrid size={14} />
          All views
        </button>
      </nav>
      <section className="iv-filters" aria-label="Filter visualizations">
        <div className="iv-filter-primary">
          <label>
            Time window
            <select
              value={prefs.preset}
              onChange={(e) =>
                e.target.value === "custom"
                  ? patch({ preset: "custom" })
                  : preset(e.target.value)
              }
            >
              <option value="ytd">This year</option>
              <option value="12m">Last 12 months</option>
              <option value="all">All recorded history</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={f.start}
              onChange={(e) => {
                filter({ start: e.target.value });
                patch({ preset: "custom" });
              }}
            />
          </label>
          <label>
            Through / cutoff
            <input
              type="date"
              value={f.end}
              onChange={(e) => {
                filter({ end: e.target.value });
                patch({ preset: "custom" });
              }}
            />
          </label>
          <label>
            Currency
            <select
              value={f.currency}
              onChange={(e) => filter({ currency: e.target.value })}
            >
              {[
                ...new Set([
                  f.currency,
                  ...data.accounts.map((a) => a.currency),
                  ...data.flows.map((x) => x.currency),
                  ...data.obligations.map((x) => x.currency),
                ]),
              ]
                .sort()
                .map((c) => (
                  <option key={c}>{c}</option>
                ))}
            </select>
          </label>
          <label>
            Group trends
            <select
              value={prefs.group}
              onChange={(e) => patch({ group: e.target.value })}
            >
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly</option>
              <option value="year">Yearly</option>
            </select>
          </label>
        </div>
        <details className="iv-more-filters">
          <summary>
            <Settings2 size={13} /> Focus your view{" "}
            {(f.chart || f.entity || f.tag) && (
              <span className="iv-badge">
                {[f.chart, f.entity, f.tag].filter(Boolean).length} active
              </span>
            )}
            <ChevronDown size={13} />
          </summary>
          <div className="iv-filter-secondary">
            <label>
              Financial chart
              <select
                value={f.chart}
                onChange={(e) => filter({ chart: e.target.value })}
              >
                <option value="">All charts · combined</option>
                {data.charts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Person or entity
              <select
                value={f.entity}
                onChange={(e) => filter({ entity: e.target.value })}
              >
                <option value="">Everyone & everything</option>
                {data.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project or tag
              <select
                value={f.tag}
                onChange={(e) => filter({ tag: e.target.value })}
              >
                <option value="">All projects & tags</option>
                {data.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="iv-text-button"
              onClick={() => filter({ chart: "", entity: "", tag: "" })}
            >
              Clear focus
            </button>
          </div>
          <p className="iv-footnote">
            Financial charts and currencies filter money views. Person filters
            use explicit subjects, counterparties or beneficiary shares; project
            filters use record and attribution tags. Family maps, ownership,
            relationship timelines and measurements use the person and relevant
            dates, with no project filter. Life events use dates, person and
            project. Planning cards explain their own scope.
          </p>
        </details>
      </section>
      {!valid ? (
        <div role="alert" className="iv-notice">
          Choose a valid start and end date in chronological order, covering no
          more than 100 years.
        </div>
      ) : (
        <>
          {!hasRecords && (
            <div className="iv-welcome">
              <Sparkles size={22} />
              <div>
                <h2>Your story starts with a few records.</h2>
                <p>
                  Add your family’s records or switch to the fictional Morgan
                  family dataset to explore the gallery with a complete example.
                </p>
                <Link href="/dashboard/datasets">
                  Choose a dataset <ArrowUpRight size={14} />
                </Link>
              </div>
            </div>
          )}
          <section className="iv-metrics" aria-label="Period summary">
            {[
              {
                label: "Period surplus",
                value: income - expenses,
                note: hasPriorActivity
                  ? `${format(income - expenses - priorNet)} vs previous ${Math.round((dateNumber(f.end) - dateNumber(f.start)) / DAY) + 1} days`
                  : "No income or expenses recorded in prior period",
                type: "money",
              },
              {
                label:
                  f.entity || f.tag
                    ? "Attributed net assets"
                    : "Book net assets",
                value: bookWorth,
                note: `Cumulative through ${niceDate(f.end)}`,
                type: "money",
              },
              {
                label:
                  f.entity || f.tag ? "Attributed cash" : "Cash on the books",
                value: cash,
                note: "Designated cash accounts at cutoff",
                type: "money",
              },
              {
                label: "Moments recorded",
                value: events.length,
                note: `${new Set(events.map((e) => e.kind)).size} kinds of events in this window`,
                type: "count",
              },
            ].map((m, i) => (
              <div className="iv-metric" key={m.label}>
                <span>
                  <i style={{ background: COLORS[i] }} />
                  {m.label}
                </span>
                <strong>
                  {m.type === "count"
                    ? m.value.toLocaleString()
                    : format(m.value)}
                </strong>
                <small>{m.note}</small>
              </div>
            ))}
          </section>
          <div className="iv-section-heading">
            <div>
              <span className="iv-eyebrow">
                {prefs.lens === "overview"
                  ? "THE BIG PICTURE"
                  : prefs.lens === "favorites"
                    ? "CURATED BY YOU"
                    : prefs.lens === "gallery"
                      ? "EXPLORE THE POSSIBILITIES"
                      : lenses
                          .find((l) => l.id === prefs.lens)
                          ?.label.toUpperCase()}
              </span>
              <h2>
                {prefs.lens === "overview"
                  ? "A few things worth seeing."
                  : prefs.lens === "favorites"
                    ? "Your personal collection."
                    : prefs.lens === "gallery"
                      ? "Every angle. Your choice."
                      : prefs.lens === "money"
                        ? "Understand the ebb and flow."
                        : prefs.lens === "family"
                          ? "Everything that connects you."
                          : prefs.lens === "life"
                            ? "The story behind the numbers."
                            : "Make space for what’s next."}
              </h2>
            </div>
            <span>
              {visible.length} views <span className="iv-divider">/</span>{" "}
              <button
                className="iv-text-button"
                onClick={() => setCustomize(true)}
              >
                Customize
              </button>
            </span>
          </div>
          {prefs.lens === "favorites" && !visible.length && (
            <EmptyChart>
              Star any view to build your collection. Hidden favorites can be
              restored in “Make it yours”.
            </EmptyChart>
          )}
          {!visible.length && prefs.lens !== "favorites" && (
            <EmptyChart>
              These views are hidden. Restore them in “Make it yours”.
            </EmptyChart>
          )}
          <div className="iv-card-grid">
            {visible.map((card, index) => (
              <article
                key={card.id}
                id={`view-${card.id}`}
                className={`iv-card ${card.wide || prefs.wide.includes(card.id) ? "iv-card-wide" : ""}`}
                style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
              >
                <header className="iv-card-header">
                  <div>
                    <span
                      className={`iv-badge ${card.kind === "What-if" ? "iv-badge-scenario" : card.kind === "Recorded" ? "iv-badge-actual" : ""}`}
                    >
                      {card.kind}
                    </span>
                    <h3>{card.title}</h3>
                    <p>{card.subtitle}</p>
                  </div>
                  <div className="iv-card-actions">
                    <button
                      className={`iv-icon-button ${prefs.favorites.includes(card.id) ? "iv-starred" : ""}`}
                      aria-label={`${prefs.favorites.includes(card.id) ? "Unstar" : "Star"} ${card.title}`}
                      aria-pressed={prefs.favorites.includes(card.id)}
                      onClick={() => toggle("favorites", card.id)}
                    >
                      <Star
                        size={15}
                        fill={
                          prefs.favorites.includes(card.id)
                            ? "currentColor"
                            : "none"
                        }
                      />
                    </button>
                    {!card.wide && (
                      <button
                        className="iv-icon-button"
                        aria-label={`Toggle wide view for ${card.title}`}
                        aria-pressed={prefs.wide.includes(card.id)}
                        onClick={() => toggle("wide", card.id)}
                      >
                        <Maximize2 size={14} />
                      </button>
                    )}
                    <button
                      className="iv-icon-button"
                      aria-label={`Hide ${card.title}`}
                      onClick={() => {
                        toggle("hidden", card.id);
                        setMessage(
                          `“${card.title}” hidden. Restore it in Make it yours.`,
                        );
                      }}
                    >
                      <EyeOff size={14} />
                    </button>
                  </div>
                </header>
                {card.style && (
                  <div
                    className="iv-chart-style"
                    aria-label={`${card.title} presentation`}
                  >
                    {(card.style === "plot"
                      ? [
                          ["bar", "Bars"],
                          ["line", "Lines"],
                          ["area", "Area"],
                        ]
                      : [
                          ["donut", "Ring"],
                          ["mosaic", "Mosaic"],
                          ["bars", "Ranking"],
                        ]
                    ).map(([value, label]) => {
                      const current =
                        prefs.styles[card.id] ??
                        (card.id === "spending" || card.id === "income"
                          ? "donut"
                          : card.id === "assets"
                            ? "mosaic"
                            : card.id === "debt"
                              ? "bars"
                              : card.id === "flow"
                                ? "bar"
                                : "area");
                      return (
                        <button
                          key={value}
                          aria-pressed={current === value}
                          onClick={() =>
                            patch({
                              styles: { ...prefs.styles, [card.id]: value },
                            })
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="iv-card-body">{renderCard(card.id)}</div>
              </article>
            ))}
          </div>
        </>
      )}
      <footer className="iv-methods">
        <details>
          <summary>
            About these numbers <span>Sources, scope & interpretation</span>
          </summary>
          <div>
            <p>
              Money comes from posted journals in this dataset. Draft journals (
              {data.coverage.draftJournals}) are excluded; original postings and
              reversals both remain in the ledger and net out. All money stays
              in one selected currency, with no exchange-rate assumptions.
              Values in charts may be rounded; choose exact amounts in
              presentation settings, or export exact minor units.
            </p>
            <p>
              Period flows use the selected dates. Balance views include the
              full posting history through cutoff; the bank timeline instead
              uses full account balances through today and its own future
              horizon. Multiple financial charts are combined without
              intercompany eliminations. Person and project filters show
              attributed amounts and may omit unclassified records (
              {data.coverage.unclassifiedPostings} postings have no classified
              context). These are not complete personal balance sheets.
            </p>
            <p>
              Events and measurements exclude archived, voided and superseded
              corrections. Family views use current recorded facts, not “what we
              knew then” history. {data.coverage.untypedMeasurements} legacy
              measurements without a typed quantity are omitted. Latest posted
              accounting date: {data.coverage.latestPosting ?? "none"}.
            </p>
            <p>
              Expected movements and current outstanding obligations are
              distinct from actuals. What-if and savings views are local
              illustrations; saved planning scenarios are not automatically
              evaluated. Preferences are saved in this browser per dataset.
              Sandbox inputs reset when their view is closed. Bank routing is
              saved explicitly as a planning instruction; it does not post or
              settle money.
            </p>
            <Link href="/dashboard/finance/reports">
              Open financial reports →
            </Link>
          </div>
        </details>
      </footer>
      {message && (
        <div role="status" className="iv-toast">
          <Check size={16} />
          {message}
          <button
            className="iv-icon-button"
            aria-label="Dismiss notification"
            onClick={() => setMessage("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {customize && (
        <Modal
          title="Make room for your favorites."
          onClose={() => setCustomize(false)}
        >
          <p className="iv-modal-intro">
            Keep what helps. Hide the rest. Your collection, order, filters, and
            presentation are remembered in this browser for this dataset.
          </p>
          <div className="iv-settings-row">
            <label>
              Atmosphere
              <select
                value={prefs.theme}
                onChange={(e) => patch({ theme: e.target.value })}
              >
                <option value="sage">Botanical · warm & calm</option>
                <option value="ink">Ink · cool & crisp</option>
              </select>
            </label>
            <label>
              Density
              <select
                value={prefs.density}
                onChange={(e) => patch({ density: e.target.value })}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label>
              Amounts
              <select
                value={prefs.exact ? "exact" : "compact"}
                onChange={(e) => patch({ exact: e.target.value === "exact" })}
              >
                <option value="compact">Compact</option>
                <option value="exact">Exact currency amounts</option>
              </select>
            </label>
          </div>
          <div className="iv-row-between">
            <h3>
              Visualization library <small>{cards.length} views</small>
            </h3>
            <button
              className="iv-text-button"
              onClick={() => patch({ hidden: [] })}
            >
              Show all
            </button>
          </div>
          <div className="iv-library">
            {prefs.order.map((id, index) => {
              const c = cards.find((x) => x.id === id)!;
              return (
                <div key={id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!prefs.hidden.includes(id)}
                      onChange={() => toggle("hidden", id)}
                    />
                    <span>
                      <strong>{c.title}</strong>
                      <small>
                        {c.lens} · {c.kind}
                      </small>
                    </span>
                  </label>
                  <button
                    className={`iv-icon-button ${prefs.favorites.includes(id) ? "iv-starred" : ""}`}
                    aria-label={`${prefs.favorites.includes(id) ? "Unstar" : "Star"} ${c.title}`}
                    onClick={() => toggle("favorites", id)}
                  >
                    <Star
                      size={15}
                      fill={
                        prefs.favorites.includes(id) ? "currentColor" : "none"
                      }
                    />
                  </button>
                  <button
                    className="iv-icon-button"
                    aria-label={`Move ${c.title} up`}
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="iv-icon-button"
                    aria-label={`Move ${c.title} down`}
                    disabled={index === prefs.order.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="iv-modal-bottom">
            <button
              className="iv-button"
              onClick={() => {
                setPrefs(defaults(data));
                setMessage("Default layout and filters restored.");
              }}
            >
              <RotateCcw size={14} />
              Restore defaults
            </button>
            <button
              className="iv-button iv-button-primary"
              onClick={() => setCustomize(false)}
            >
              Done <Check size={15} />
            </button>
          </div>
        </Modal>
      )}
      {details && (
        <Modal title={details.title} onClose={() => setDetails(null)} wide>
          <div className="iv-control-row">
            <input
              aria-label="Search underlying records"
              placeholder="Search these records…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span>{detailRows.length} records</span>
            <button
              className="iv-button"
              onClick={() =>
                download(
                  "lifeor-records.csv",
                  csv([details.headings, ...detailRows]),
                )
              }
            >
              <Download size={14} />
              Export these rows
            </button>
            {details.href && (
              <Link className="iv-text-button" href={details.href}>
                Open records <ArrowUpRight size={14} />
              </Link>
            )}
          </div>
          <div className="iv-table-scroll iv-detail-table">
            <table>
              <thead>
                <tr>
                  {details.headings.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!detailRows.length && (
              <EmptyChart>No matching records.</EmptyChart>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
