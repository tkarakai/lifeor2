import { v } from "convex/values";
import {
  mutation,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { query, scopedWriter, flushScopedWriter } from "./lib/scoped";
import { requireUser } from "./lib/access";
import { ensureLive } from "./datasets";
import { authComponent } from "./auth";
import type { Id, Doc } from "./_generated/dataModel";
import { writeJournal, attribution, accountBalance } from "./lib/ledger";
import {
  loans,
  amortization,
  SAMPLE_AS_OF,
  SAMPLE_VERSION,
  sampleNotes,
} from "../lib/family-fixture";
import { allocate } from "./lib/domain";
import type { Target } from "./lib/access";
const at = (date: string) => Date.parse(date + "T12:00:00Z");
const currency = "USD";
type Registry = Map<string, { kind: string; id: string }>;
function id<T extends Target["kind"]>(
  r: Registry,
  key: string,
  kind: T,
): Id<T> {
  const value = r.get(key);
  if (!value || value.kind !== kind)
    throw new Error(`Sample reference missing: ${key}`);
  return value.id as Id<T>;
}
async function context(
  raw: MutationCtx,
  userId: string,
  datasetId: Id<"dataset">,
) {
  const dataset = await raw.db.get(datasetId);
  if (
    !dataset ||
    dataset.user_id !== userId ||
    dataset.seed_version !== SAMPLE_VERSION
  )
    throw new Error("Not an owned family sample dataset");
  const ctx = {
    ...raw,
    db: scopedWriter(raw, { userId, datasetId, legacy: false }),
  };
  const registry: Registry = new Map(
    (await ctx.db.query("sample_record").collect()).map((x) => [
      x.key,
      x.target,
    ]),
  );
  return { ctx, registry, dataset };
}
export async function buildStructure(raw: MutationCtx, userId: string) {
  if (!(await authComponent.getAnyUserById(raw, userId)))
    throw new Error("Sample owner must be an existing signed-in user");
  await ensureLive(raw, userId);
  const datasets = await raw.db
    .query("dataset")
    .withIndex("by_user", (q) => q.eq("user_id", userId))
    .collect();
  const existing = datasets.find((x) => x.seed_version === SAMPLE_VERSION);
  if (existing) return existing._id;
  let name = "test-data1";
  let n = 2;
  while (datasets.some((x) => x.name.toLowerCase() === name))
    name = `test-data${n++}`;
  const datasetId = await raw.db.insert("dataset", {
    user_id: userId,
    name,
    kind: "test",
    is_default: false,
    created_at: Date.now(),
    seed_version: SAMPLE_VERSION,
    seed_as_of: SAMPLE_AS_OF,
    seed_status: "building",
    seed_next_month: 0,
  });
  const { ctx, registry: r } = await context(raw, userId, datasetId);
  const now = Date.now();
  const base = { user_id: userId, created_at: now };
  const remember = async (key: string, target: Target) => {
    r.set(key, target);
    await ctx.db.insert("sample_record", { user_id: userId, key, target });
  };
  const entity = async (key: string, display_name: string, kind: string) => {
    const facts = { display_name, kind };
    const value = await ctx.db.insert("entity", {
      ...base,
      ...facts,
      revision: 1,
    });
    await ctx.db.insert("entity_revision", {
      user_id: userId,
      root_id: value,
      revision: 1,
      recorded_at: now,
      actor: "sample:family-v1",
      segments: [{ valid_from: at("2021-01-01"), facts }],
    });
    await remember(key, { kind: "entity", id: value });
    return value;
  };
  const people: [string, string, string][] = [
    ["family", "Morgan family", "Household"],
    ["alex", "Alex Morgan", "Person"],
    ["jamie", "Jamie Morgan", "Person"],
    ["emma", "Emma Morgan", "Person"],
    ["noah", "Noah Morgan", "Person"],
    ["employer", "Northstar Analytics Inc.", "Corporation"],
    ["software", "Morgan Software LLC", "LLC"],
    ["design", "Juniper Design LLC", "LLC"],
    ["bank", "Prairie Community Bank", "Bank"],
    ["creditunion", "Lakeside Credit Union", "Credit union"],
    ["visa", "Cedar Card Services", "Card issuer"],
    ["mastercard", "Harbor Card Services", "Card issuer"],
    ["lender", "Heartland Mortgage Servicing", "Lender"],
    ["autolender", "Lakeside Auto Finance", "Lender"],
    ["square", "Square", "Payment processor"],
    ["contractor", "Cedar Craft Remodeling LLC", "Contractor"],
    ["tenant-oak", "Taylor Reed", "Person"],
    ["tenant-maple", "Casey Chen", "Person"],
    ["repair", "Reliable Property Care LLC", "Maintenance contractor"],
    ["garage", "Main Street Auto Service", "Garage"],
    ["civic", "2018 Honda Civic", "Car"],
    ["outback", "2016 Subaru Outback", "Car"],
    ["grocer", "Fresh Market Grocers", "Retailer"],
    ["utility", "Prairie Utilities", "Utility"],
    ["insurer", "Acorn Insurance", "Insurer"],
    ["cloud", "Cloud Harbor Hosting", "Cloud service"],
    ["client", "Willow Home Staging LLC", "LLC"],
  ];
  for (const row of people) await entity(...row);
  for (const l of loans)
    await entity(`asset-${l.key}`, l.asset, l.key === "car" ? "Car" : "House");
  const e = (key: string) => id(r, key, "entity");
  const types = new Map<string, Id<"arrangement_type">>();
  const arrangement = async (
    key: string,
    name: string,
    kind: string,
    start: string,
    roles: [string, string, "participant" | "subject"][],
    end?: string,
    parent?: Id<"arrangement">,
  ) => {
    let type = types.get(kind);
    if (!type) {
      type = await ctx.db.insert("arrangement_type", {
        ...base,
        name: kind,
        revision: 1,
        templates: [],
      });
      types.set(kind, type);
      await ctx.db.insert("arrangement_type_revision", {
        user_id: userId,
        root_id: type,
        name: kind,
        templates: [],
        revision: 1,
        recorded_at: now,
        actor: "sample:family-v1",
      });
    }
    const facts = {
      name,
      lifecycle: "active" as const,
      valid_from: at(start),
      valid_to: end ? at(end) : undefined,
      parent_arrangement_id: parent,
    };
    const value = await ctx.db.insert("arrangement", {
      ...base,
      ...facts,
      kind,
      type_id: type,
      revision: 1,
    });
    await ctx.db.insert("arrangement_revision", {
      user_id: userId,
      root_id: value,
      revision: 1,
      recorded_at: now,
      actor: "sample:family-v1",
      segments: [{ valid_from: at(start), facts }],
    });
    const localRoles = new Map<string, Id<"arrangement_role_definition">>();
    for (const [roleName, entityKey, participation] of roles) {
      const roleFacts = { name: roleName, participation };
      let role = localRoles.get(roleName);
      if (!role) {
        role = await ctx.db.insert("arrangement_role_definition", {
          ...base,
          ...roleFacts,
          arrangement_id: value,
          revision: 1,
        });
        await ctx.db.insert("role_definition_revision", {
          user_id: userId,
          root_id: role,
          revision: 1,
          recorded_at: now,
          actor: "sample:family-v1",
          segments: [{ valid_from: at(start), facts: roleFacts }],
        });
        localRoles.set(roleName, role);
      }
      const assignmentFacts = {
        entity_id: e(entityKey),
        valid_from: at(start),
        valid_to: end ? at(end) : undefined,
      };
      const assignment = await ctx.db.insert("arrangement_role_assignment", {
        ...base,
        ...assignmentFacts,
        arrangement_id: value,
        role_definition_id: role,
        revision: 1,
      });
      await ctx.db.insert("role_assignment_revision", {
        user_id: userId,
        root_id: assignment,
        revision: 1,
        recorded_at: now,
        actor: "sample:family-v1",
        segments: [{ valid_from: at(start), facts: assignmentFacts }],
      });
    }
    await remember(key, { kind: "arrangement", id: value });
    return value;
  };
  await arrangement(
    "household",
    "Morgan household",
    "Household membership",
    "2021-01-01",
    [
      ["Adult", "alex", "participant"],
      ["Adult", "jamie", "participant"],
      ["Child", "emma", "participant"],
      ["Child", "noah", "participant"],
    ],
  );
  await arrangement(
    "employment",
    "Alex · Northstar employment",
    "Employment",
    "2020-06-01",
    [
      ["Employee", "alex", "participant"],
      ["Employer", "employer", "participant"],
    ],
  );
  for (const [key, owner] of [
    ["software", "alex"],
    ["design", "jamie"],
  ])
    await arrangement(
      `ownership-${key}`,
      `${key === "software" ? "Alex" : "Jamie"} owns ${key === "software" ? "Morgan Software" : "Juniper Design"}`,
      "Business ownership",
      "2024-01-01",
      [
        ["Owner", owner, "participant"],
        ["Company", key, "subject"],
      ],
    );
  const charts = new Map<string, Id<"chart_of_accounts">>();
  for (const [key, name, reporting] of [
    ["household", "Morgan household · USD", "family"],
    ["software", "Morgan Software LLC · USD", "software"],
    ["design", "Juniper Design LLC · USD", "design"],
  ]) {
    const chart = await ctx.db.insert("chart_of_accounts", {
      ...base,
      name,
      reporting_entity_id: e(reporting),
    });
    charts.set(key, chart);
    await remember(`chart-${key}`, { kind: "chart_of_accounts", id: chart });
  }
  const account = async (
    key: string,
    name: string,
    type: "Asset" | "Liability" | "Equity" | "Income" | "Expense",
    chartKey = "household",
  ) => {
    const value = await ctx.db.insert("ledger_account", {
      ...base,
      name,
      type,
      currency,
      chart_id: charts.get(chartKey)!,
      normal_balance: ["Asset", "Expense"].includes(type) ? "Debit" : "Credit",
    });
    await remember(key, { kind: "ledger_account", id: value });
    return value;
  };
  for (const chart of ["household", "software", "design"])
    await account(
      `equity-${chart}`,
      "Opening balances / owner capital",
      "Equity",
      chart,
    );
  for (const [key, name, type] of [
    ["salary", "Gross salary", "Income"],
    ["withheld", "Payroll withholding and benefits", "Expense"],
    ["rent-oak", "Oak Street rent", "Income"],
    ["rent-maple", "Maple Avenue rent", "Income"],
    ["rent-receivable", "Tenant receivables", "Asset"],
    ["interest", "Mortgage interest", "Expense"],
    ["auto-interest", "Auto loan interest", "Expense"],
    ["repairs", "Rental maintenance", "Expense"],
    ["auto-maintenance", "Vehicle maintenance", "Expense"],
    ["groceries", "Groceries and household supplies", "Expense"],
    ["utilities", "Utilities and internet", "Expense"],
    ["insurance", "Auto and life insurance", "Expense"],
    ["fuel", "Fuel and transportation", "Expense"],
    ["dining", "Dining and entertainment", "Expense"],
    ["school", "School and children's activities", "Expense"],
    ["subscriptions", "Household subscriptions", "Expense"],
    ["health", "Medical and dental", "Expense"],
    ["property-tax", "Property tax", "Expense"],
    ["home-insurance", "Property insurance", "Expense"],
    ["remodel-asset", "Cedar Lane improvements in progress", "Asset"],
    ["contractor-payable", "Remodel contractor payable", "Liability"],
    ["civic-asset", "Honda Civic carrying value", "Asset"],
    ["outback-asset", "Subaru Outback carrying value", "Asset"],
  ] as const)
    await account(key, name, type);
  for (const chart of ["software", "design"]) {
    await account(
      `expenses-${chart}`,
      chart === "software"
        ? "Hosting, software and registration"
        : "Studio supplies and software",
      "Expense",
      chart,
    );
    await account(`draws-${chart}`, "Owner draws", "Equity", chart);
  }
  await account("design-income", "Design services revenue", "Income", "design");
  await account(
    "square-clearing",
    "Square funds awaiting payout",
    "Asset",
    "design",
  );
  await account("square-fees", "Square processing fees", "Expense", "design");
  await account(
    "design-contractors",
    "Design subcontractors",
    "Expense",
    "design",
  );
  const financials: [
    string,
    string,
    string,
    string,
    string,
    "Asset" | "Liability",
    string,
  ][] = [
    [
      "checking1",
      "Household bills checking · 1042",
      "family",
      "bank",
      "household",
      "Asset",
      "checking",
    ],
    [
      "checking2",
      "Household everyday checking · 2098",
      "family",
      "creditunion",
      "household",
      "Asset",
      "checking",
    ],
    [
      "checking-software",
      "Morgan Software checking · 3301",
      "software",
      "bank",
      "software",
      "Asset",
      "checking",
    ],
    [
      "checking-design",
      "Juniper Design checking · 4470",
      "design",
      "creditunion",
      "design",
      "Asset",
      "checking",
    ],
    [
      "card1",
      "Cedar Visa · 5512",
      "family",
      "visa",
      "household",
      "Liability",
      "credit_card",
    ],
    [
      "card2",
      "Harbor Mastercard · 8844",
      "family",
      "mastercard",
      "household",
      "Liability",
      "credit_card",
    ],
  ];
  for (const [key, name, owner, institution, chart, type, kind] of financials) {
    const arr = await arrangement(
      `arr-${key}`,
      name,
      kind === "checking" ? "Bank account" : "Credit card",
      "2024-01-01",
      [
        ["Account holder", owner, "participant"],
        ["Institution", institution, "participant"],
      ],
    );
    const ledger = await account(key, name, type, chart);
    const fa = await ctx.db.insert("financial_account", {
      ...base,
      arrangement_id: arr,
      ledger_account_id: ledger,
      institution_entity_id: e(institution),
      kind,
      currency,
      identifier: name.split(" · ")[1],
    });
    await remember(`fa-${key}`, { kind: "financial_account", id: fa });
  }
  const schedule = async (
    key: string,
    name: string,
    arr: Id<"arrangement">,
    creditor: string,
    debtor: string,
    amount: number,
    start: string,
    end?: string,
  ) => {
    const root = await ctx.db.insert("commitment_schedule", {
      ...base,
      arrangement_id: arr,
      name,
      revision: 1,
    });
    const version = await ctx.db.insert("commitment_schedule_version", {
      user_id: userId,
      schedule_id: root,
      revision: 1,
      recorded_at: now,
      actor: "sample:family-v1",
      creditor_id: e(creditor),
      debtor_id: e(debtor),
      amount: { minor_units: amount, currency },
      currency,
      recurrence: { frequency: "monthly", interval: 1, day_of_month: 1 },
      start_date: start,
      end_date: end,
      timezone: "America/Chicago",
      valid_from: at(start),
      valid_to: end ? at(end) : undefined,
    });
    await ctx.db.insert("commitment_schedule_revision", {
      user_id: userId,
      schedule_id: root,
      revision: 1,
      recorded_at: now,
      actor: "sample:family-v1",
      segments: [
        {
          valid_from: at(start),
          valid_to: end ? at(end) : undefined,
          facts: { version_id: version },
        },
      ],
    });
    await remember(key, { kind: "commitment_schedule_version", id: version });
    return root;
  };
  for (const loan of loans) {
    const ownership = await arrangement(
      `own-${loan.key}`,
      `Ownership · ${loan.asset}`,
      "Ownership",
      loan.start,
      [
        ["Owner", "alex", "participant"],
        ["Owner", "jamie", "participant"],
        ["Asset", `asset-${loan.key}`, "subject"],
      ],
    );
    for (const owner of ["alex", "jamie"])
      await ctx.db.insert("ownership_interest", {
        ...base,
        owner_entity_id: e(owner),
        asset_entity_id: e(`asset-${loan.key}`),
        arrangement_id: ownership,
        basis: "legal_title",
        share_bps: 5000,
        valid_from: at(loan.start),
      });
    const lender = loan.key === "car" ? "autolender" : "lender";
    const arr = await arrangement(
      `loan-${loan.key}`,
      loan.name,
      loan.key === "car" ? "Auto loan" : "Mortgage",
      loan.start,
      [
        ["Borrower", "alex", "participant"],
        ["Co-borrower", "jamie", "participant"],
        ["Lender", lender, "participant"],
        ["Collateral", `asset-${loan.key}`, "subject"],
      ],
      loan.end,
    );
    const liability = await account(
      `liability-${loan.key}`,
      loan.name,
      "Liability",
    );
    await account(`asset-ledger-${loan.key}`, loan.asset, "Asset");
    const fa = await ctx.db.insert("financial_account", {
      ...base,
      arrangement_id: arr,
      ledger_account_id: liability,
      institution_entity_id: e(lender),
      kind: loan.key === "car" ? "auto_loan" : "mortgage",
      currency,
    });
    await remember(`fa-loan-${loan.key}`, {
      kind: "financial_account",
      id: fa,
    });
    if (loan.escrow)
      await account(`escrow-${loan.key}`, `Escrow · ${loan.asset}`, "Asset");
    const terms: [
      [string, string, string],
      [string, string, string],
      [string, string, string],
    ] = [
      ["Original principal", (loan.principal / 100).toFixed(2), "USD"],
      ["Fixed annual interest rate", (loan.aprBps / 100).toFixed(2), "percent"],
      ["Original term", String(loan.months), "months"],
    ];
    for (const [name, decimal, unit] of terms)
      await ctx.db.insert("measurement", {
        ...base,
        subject: { kind: "arrangement", id: arr },
        name,
        m_type: "contractual",
        value: { decimal, unit, ...(unit === "USD" ? { currency } : {}) },
        as_of: at(loan.start),
        recorded_at: now,
        method: "Fictional fixed-rate loan contract",
      });
    await schedule(
      `schedule-loan-${loan.key}`,
      `${loan.name} · monthly P&I${loan.escrow ? " + escrow" : ""}`,
      arr,
      lender,
      "family",
      amortization(loan.principal, loan.aprBps, loan.months)[0].payment +
        loan.escrow,
      loan.first,
      loan.end,
    );
    if (loan.key === "oak" || loan.key === "maple") {
      const tenancy = await arrangement(
        `tenancy-${loan.key}`,
        `${loan.asset} · current tenancy`,
        "Tenancy",
        "2025-10-01",
        [
          ["Landlord", "alex", "participant"],
          ["Co-landlord", "jamie", "participant"],
          ["Tenant", `tenant-${loan.key}`, "participant"],
          ["Premises", `asset-${loan.key}`, "subject"],
        ],
      );
      await schedule(
        `schedule-rent-${loan.key}`,
        `${loan.asset} · rent`,
        tenancy,
        "family",
        `tenant-${loan.key}`,
        loan.key === "oak" ? 225000 : 270000,
        "2025-10-01",
      );
      await arrangement(
        `maintenance-${loan.key}`,
        `${loan.asset} · maintenance agreement`,
        "Maintenance agreement",
        "2025-01-01",
        [
          ["Customer", "family", "participant"],
          ["Contractor", "repair", "participant"],
          ["Maintained property", `asset-${loan.key}`, "subject"],
        ],
      );
    }
  }
  for (const car of ["asset-car", "civic", "outback"])
    await arrangement(
      `service-${car}`,
      `Service · ${r.get(car)?.id ? (await ctx.db.get(e(car)))!.display_name : car}`,
      "Vehicle service",
      "2025-01-01",
      [
        ["Owner", "family", "participant"],
        ["Garage", "garage", "participant"],
        ["Vehicle", car, "subject"],
      ],
    );
  await arrangement(
    "remodel-contract",
    "Cedar Craft · kitchen and bathroom contract",
    "Construction contract",
    "2026-06-01",
    [
      ["Customer", "family", "participant"],
      ["Contractor", "contractor", "participant"],
      ["Site", "asset-home", "subject"],
    ],
    "2026-12-01",
  );
  const project = await ctx.db.insert("tag", {
    ...base,
    name: "Cedar Lane remodel",
  });
  await remember("remodel-tag", { kind: "tag", id: project });
  for (const ref of [r.get("asset-home")!, r.get("remodel-contract")!])
    await ctx.db.insert("tag_assignment", {
      user_id: userId,
      tag_id: project,
      target: ref as Target,
      added_at: at("2026-06-01"),
    });
  await arrangement(
    "square-processing",
    "Juniper Design · Square processing",
    "Payment processing",
    "2024-01-01",
    [
      ["Merchant", "design", "participant"],
      ["Processor", "square", "participant"],
    ],
  );
  await schedule(
    "salary-schedule",
    "Alex monthly gross salary (two payroll deposits)",
    id(r, "employment", "arrangement"),
    "alex",
    "employer",
    1300000,
    "2026-01-01",
  );
  const a = (key: string) => id(r, key, "ledger_account");
  const opening: [string, number][] = [
    ["checking1", 6200000],
    ["checking2", 1000000],
    ["civic-asset", 1200000],
    ["outback-asset", 1000000],
    ["card1", -164000],
    ["card2", -92000],
  ];
  for (const loan of loans) {
    opening.push(
      [`asset-ledger-${loan.key}`, loan.price],
      [
        `liability-${loan.key}`,
        -amortization(loan.principal, loan.aprBps, loan.months)[
          loan.paidAtOpening - 1
        ].balance,
      ],
    );
    if (loan.escrow) opening.push([`escrow-${loan.key}`, loan.escrow * 3]);
  }
  opening.push([
    "equity-household",
    -opening.reduce((sum, x) => sum + x[1], 0),
  ]);
  const journal = async (
    chart: string,
    memo: string,
    lines: [string, number][],
  ) => {
    const eventId = await ctx.db.insert("event", {
      ...base,
      kind: "OpeningBalance",
      title: memo,
      occurred_at: at("2025-12-31"),
      recorded_at: now,
      payload_json: "{}",
    });
    return writeJournal(ctx, userId, {
      eventId,
      chartId: charts.get(chart)!,
      memo,
      accounting_date: "2025-12-31",
      postings: lines.map(([key, minor_units]) => ({
        accountId: a(key),
        minor_units,
        currency,
        description: memo,
      })),
    });
  };
  await journal(
    "household",
    "Opening balances · principal after historical amortization",
    opening,
  );
  await journal("software", "Opening owner-funded business cash", [
    ["checking-software", 800000],
    ["equity-software", -800000],
  ]);
  await journal("design", "Opening studio cash", [
    ["checking-design", 1400000],
    ["equity-design", -1400000],
  ]);
  await flushScopedWriter(ctx.db);
  await raw.db.patch(datasetId, {
    report_index_ready: true,
    report_obligations_ready: true,
    report_index_version: 1,
  });
  return datasetId;
}

/** One atomic month at a time keeps the seed resumable and below transaction limits. */
export async function appendMonth(
  raw: MutationCtx,
  userId: string,
  datasetId: Id<"dataset">,
  monthIndex: number,
) {
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 8)
    throw new Error("Invalid sample month");
  const { ctx, registry: r, dataset } = await context(raw, userId, datasetId);
  const next = dataset.seed_next_month ?? 0;
  if (monthIndex < next) {
    if (next === 9) await enhanceCashAndSubjects(raw, userId, datasetId);
    return { nextMonth: next, ready: next === 9 };
  }
  if (monthIndex !== next) throw new Error("Build sample months in order");
  const month = `2026-${String(monthIndex + 1).padStart(2, "0")}`;
  const now = Date.now(),
    base = { user_id: userId, created_at: now };
  const e = (key: string) => id(r, key, "entity"),
    a = (key: string) => id(r, key, "ledger_account"),
    arr = (key: string) => id(r, key, "arrangement");
  type Context = {
    subject?: string;
    arrangement?: string;
    counterparty?: string;
    children?: boolean;
    remodel?: boolean;
  };
  const journal = async (
    chart: string,
    memo: string,
    day: number,
    kind: string,
    lines: [string, number][],
    context: Context = {},
  ) => {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (date > SAMPLE_AS_OF)
      throw new Error("Sample actuals exceed as-of boundary");
    const eventId = await ctx.db.insert("event", {
      ...base,
      kind,
      title: memo,
      occurred_at: at(date),
      recorded_at: now,
      payload_json: "{}",
    });
    const result = await writeJournal(ctx, userId, {
      eventId,
      chartId: id(r, `chart-${chart}`, "chart_of_accounts"),
      memo,
      accounting_date: date,
      postings: lines.map(([key, minor_units]) => ({
        accountId: a(key),
        minor_units,
        currency,
        description: memo,
      })),
    });
    if (context.subject || context.arrangement || context.counterparty) {
      const portion = await attribution(
        ctx,
        userId,
        (await ctx.db.get(result.postingIds[0]))!,
        [
          {
            minor_units: lines[0][1],
            unclassified: false,
            subject_entity_id: context.subject ? e(context.subject) : undefined,
            arrangement_id: context.arrangement
              ? arr(context.arrangement)
              : undefined,
            counterparty_entity_id: context.counterparty
              ? e(context.counterparty)
              : undefined,
            beneficiaries: (context.children
              ? ["emma", "noah"]
              : chart === "household"
                ? ["alex", "jamie"]
                : [chart]
            ).map((key) => ({
              entity_id: e(key),
              unassigned: false,
              share_bps: chart === "household" ? 5000 : 10000,
            })),
          },
        ],
        "Fictional sample classification",
      );
      if (context.remodel)
        for (const p of await ctx.db
          .query("posting_attribution")
          .withIndex("by_set", (q) => q.eq("set_id", portion))
          .collect())
          await ctx.db.insert("tag_assignment", {
            user_id: userId,
            tag_id: id(r, "remodel-tag", "tag"),
            target: { kind: "posting_attribution", id: p._id },
            added_at: at(date),
          });
      for (const target of [
        context.subject
          ? { kind: "entity" as const, id: e(context.subject) }
          : null,
        context.arrangement
          ? { kind: "arrangement" as const, id: arr(context.arrangement) }
          : null,
      ].filter((x) => x !== null))
        await ctx.db.insert("event_affects", {
          event_id: eventId,
          target,
          target_type: target.kind,
          target_id: target.id,
          meaning: "financial activity",
        });
    }
    return { ...result, eventId, date };
  };
  const balance = async (key: string) =>
    (await accountBalance(ctx, (await ctx.db.get(a(key)))!)).minor_units;
  // Pay the previous cards' balances from different household checking accounts.
  for (const [card, checking] of [
    ["card1", "checking1"],
    ["card2", "checking2"],
  ]) {
    const amount = -(await balance(card));
    if (amount > 0)
      await journal(
        "household",
        `${card === "card1" ? "Cedar Visa" : "Harbor Mastercard"} · previous balance paid`,
        5,
        "CreditCardPayment",
        [
          [card, amount],
          [checking, -amount],
        ],
        { subject: "family", arrangement: `arr-${card}` },
      );
  }
  await journal(
    "household",
    "Transfer to everyday checking",
    3,
    "AccountTransfer",
    [
      ["checking2", 180000],
      ["checking1", -180000],
    ],
  );
  for (const loan of loans) {
    const installment = amortization(loan.principal, loan.aprBps, loan.months)[
      loan.paidAtOpening + monthIndex
    ];
    const lines: [string, number][] = [
      [`liability-${loan.key}`, installment.principal],
      [loan.key === "car" ? "auto-interest" : "interest", installment.interest],
    ];
    if (loan.escrow) lines.push([`escrow-${loan.key}`, loan.escrow]);
    lines.push(["checking1", -installment.payment - loan.escrow]);
    await journal(
      "household",
      `${loan.name} · payment ${installment.number}`,
      1,
      "LoanPayment",
      lines,
      {
        subject: `asset-${loan.key}`,
        arrangement: `loan-${loan.key}`,
        counterparty: loan.key === "car" ? "autolender" : "lender",
      },
    );
  }
  for (const day of [15, 28])
    if (`${month}-${day}` <= SAMPLE_AS_OF)
      await journal(
        "household",
        `Alex · ${day === 15 ? "mid-month" : "month-end"} payroll`,
        day,
        "PayrollDeposit",
        [
          ["checking1", 455000],
          ["withheld", 195000],
          ["salary", -650000],
        ],
        {
          subject: "alex",
          arrangement: "employment",
          counterparty: "employer",
        },
      );
  for (const key of ["oak", "maple"]) {
    const amount = key === "oak" ? 225000 : 270000;
    const recognized = await journal(
      "household",
      `${key === "oak" ? "Oak Street" : "Maple Avenue"} · rent due`,
      1,
      "RentAccrued",
      [
        ["rent-receivable", amount],
        [`rent-${key}`, -amount],
      ],
      {
        subject: `asset-${key}`,
        arrangement: `tenancy-${key}`,
        counterparty: `tenant-${key}`,
      },
    );
    const version = id(
        r,
        `schedule-rent-${key}`,
        "commitment_schedule_version",
      ),
      occurrence = `${version}:${month}-01`;
    const obligation = await ctx.db.insert("monetary_obligation", {
      ...base,
      creditor_id: e("family"),
      debtor_id: e(`tenant-${key}`),
      arrangement_id: arr(`tenancy-${key}`),
      event_id: recognized.eventId,
      due_date: `${month}-01`,
      original_minor_units: amount,
      currency,
      schedule_version_id: version,
      occurrence_key: occurrence,
      recognition_posting_id: recognized.postingIds[0],
    });
    const paid = key === "maple" && monthIndex === 8 ? 200000 : amount;
    const payment = await journal(
      "household",
      `${key === "oak" ? "Oak Street" : "Maple Avenue"} · ${paid < amount ? "partial " : ""}rent received`,
      3,
      "RentPayment",
      [
        ["checking1", paid],
        ["rent-receivable", -paid],
      ],
      {
        subject: `asset-${key}`,
        arrangement: `tenancy-${key}`,
        counterparty: `tenant-${key}`,
      },
    );
    await ctx.db.insert("obligation_settlement", {
      ...base,
      obligation_id: obligation,
      journal_entry_id: payment.id,
      capacity_posting_id: payment.postingIds[0],
      recognition_posting_id: payment.postingIds[1],
      minor_units: paid,
      currency,
      settlement_date: payment.date,
    });
    if (paid < amount)
      await ctx.db.insert("expected_flow", {
        ...base,
        expected_date: "2026-09-20",
        minor_units: amount - paid,
        currency,
        account_id: a("checking1"),
        obligation_id: obligation,
        occurrence_key: occurrence,
        input_revision: 1,
      });
  }
  const purchases: [string, number, string, number, Context][] = [
    [
      "groceries",
      98000 + monthIndex * 1100,
      "card1",
      8,
      { subject: "family", counterparty: "grocer" },
    ],
    [
      "fuel",
      24000 + (monthIndex % 3) * 1800,
      "card1",
      9,
      { subject: "family" },
    ],
    [
      "dining",
      23500 + (monthIndex % 4) * 2500,
      "card1",
      12,
      { subject: "family" },
    ],
    [
      "school",
      monthIndex === 7 ? 68000 : 22500,
      "card1",
      10,
      { subject: "family", children: true },
    ],
    [
      "utilities",
      37000 + (monthIndex % 4) * 2200,
      "checking2",
      10,
      { subject: "asset-home", counterparty: "utility" },
    ],
    [
      "insurance",
      27000,
      "checking2",
      12,
      { subject: "family", counterparty: "insurer" },
    ],
    ["subscriptions", 6497, "card2", 8, { subject: "family" }],
    [
      "health",
      monthIndex === 3 ? 32500 : 8000,
      "card2",
      12,
      { subject: "family" },
    ],
  ];
  for (const [expense, amount, payFrom, day, classification] of purchases)
    await journal(
      "household",
      `${month} · ${expense}`,
      day,
      "LivingExpense",
      [
        [expense, amount],
        [payFrom, -amount],
      ],
      classification,
    );
  if ([1, 4, 7].includes(monthIndex))
    for (const key of ["oak", "maple"]) {
      const amount =
        monthIndex === 4 && key === "oak"
          ? 65000
          : key === "oak"
            ? 25000
            : 42000;
      await journal(
        "household",
        `${key === "oak" ? "Oak Street" : "Maple Avenue"} · ${monthIndex === 4 ? "plumbing repair" : "seasonal maintenance"}`,
        14,
        "PropertyMaintenance",
        [
          ["repairs", amount],
          ["checking1", -amount],
        ],
        {
          subject: `asset-${key}`,
          arrangement: `maintenance-${key}`,
          counterparty: "repair",
        },
      );
    }
  for (const [index, car, amount] of [
    [1, "asset-car", 32000],
    [3, "civic", 48000],
    [6, "outback", 89000],
    [8, "asset-car", 18500],
  ] as const)
    if (index === monthIndex)
      await journal(
        "household",
        `${car === "asset-car" ? "Highlander" : car} · service and maintenance`,
        14,
        "VehicleMaintenance",
        [
          ["auto-maintenance", amount],
          ["card2", -amount],
        ],
        { subject: car, arrangement: `service-${car}`, counterparty: "garage" },
      );
  // Escrow cash is an asset, then becomes expense when taxes/insurance are paid.
  if (monthIndex === 5)
    for (const loan of loans.filter((x) => x.escrow))
      await journal(
        "household",
        `${loan.asset} · escrow property tax disbursement`,
        15,
        "EscrowDisbursement",
        [
          ["property-tax", loan.escrow * 5],
          [`escrow-${loan.key}`, -loan.escrow * 5],
        ],
        { subject: `asset-${loan.key}`, arrangement: `loan-${loan.key}` },
      );
  if (monthIndex === 7)
    for (const loan of loans.filter((x) => x.escrow))
      await journal(
        "household",
        `${loan.asset} · annual property insurance`,
        15,
        "EscrowDisbursement",
        [
          ["home-insurance", loan.escrow * 2],
          [`escrow-${loan.key}`, -loan.escrow * 2],
        ],
        {
          subject: `asset-${loan.key}`,
          arrangement: `loan-${loan.key}`,
          counterparty: "insurer",
        },
      );
  await journal(
    "software",
    "Morgan Software · hosting and developer tools",
    8,
    "BusinessExpense",
    [
      ["expenses-software", 15500],
      ["checking-software", -15500],
    ],
    { subject: "software", counterparty: "cloud" },
  );
  if (monthIndex === 2)
    await journal(
      "software",
      "Morgan Software · annual registration",
      12,
      "BusinessExpense",
      [
        ["expenses-software", 15000],
        ["checking-software", -15000],
      ],
      { subject: "software" },
    );
  // Separate sales recognition, processor fees, and net deposits, in the LLC chart.
  for (const day of [3, 10, 17])
    if (`${month}-${day.toString().padStart(2, "0")}` <= SAMPLE_AS_OF) {
      const gross = 350000 + monthIndex * 7000 + (day === 10 ? 65000 : 0),
        fee = Math.round((gross * 29) / 1000) + 30;
      await journal(
        "design",
        "Willow Home Staging · design services via Square",
        day,
        "CustomerPayment",
        [
          ["square-clearing", gross],
          ["design-income", -gross],
        ],
        {
          subject: "design",
          arrangement: "square-processing",
          counterparty: "client",
        },
      );
      // Use the following day for the payout (still inside the as-of boundary).
      await journal(
        "design",
        "Square · net payout and processing fee",
        day + 1,
        "ProcessorPayout",
        [
          ["checking-design", gross - fee],
          ["square-fees", fee],
          ["square-clearing", -gross],
        ],
        {
          subject: "design",
          arrangement: "square-processing",
          counterparty: "square",
        },
      );
    }
  await journal(
    "design",
    "Juniper Design · studio software and materials",
    8,
    "BusinessExpense",
    [
      ["expenses-design", 48000],
      ["checking-design", -48000],
    ],
    { subject: "design" },
  );
  await journal(
    "design",
    "Juniper Design · subcontract design work",
    12,
    "BusinessExpense",
    [
      ["design-contractors", 80000],
      ["checking-design", -80000],
    ],
    { subject: "design" },
  );
  await journal(
    "design",
    "Jamie · owner distribution to household",
    15,
    "OwnerDistribution",
    [
      ["draws-design", 450000],
      ["checking-design", -450000],
    ],
    { subject: "jamie" },
  );
  await journal(
    "household",
    "Jamie · owner distribution received",
    15,
    "OwnerDistribution",
    [
      ["checking1", 450000],
      ["equity-household", -450000],
    ],
    { subject: "jamie" },
  );
  if (monthIndex === 5)
    await journal(
      "household",
      "Cedar Lane remodel · completed demolition and initial materials",
      10,
      "RemodelProgress",
      [
        ["remodel-asset", 2500000],
        ["checking1", -2500000],
      ],
      {
        subject: "asset-home",
        arrangement: "remodel-contract",
        counterparty: "contractor",
        remodel: true,
      },
    );
  if (monthIndex === 8) {
    const invoice = await journal(
      "household",
      "Cedar Lane remodel · cabinetry and rough-in invoice",
      10,
      "ContractorInvoice",
      [
        ["remodel-asset", 3000000],
        ["contractor-payable", -3000000],
      ],
      {
        subject: "asset-home",
        arrangement: "remodel-contract",
        counterparty: "contractor",
        remodel: true,
      },
    );
    const obligation = await ctx.db.insert("monetary_obligation", {
      ...base,
      creditor_id: e("contractor"),
      debtor_id: e("family"),
      arrangement_id: arr("remodel-contract"),
      event_id: invoice.eventId,
      due_date: "2026-09-30",
      original_minor_units: 3000000,
      currency,
      recognition_posting_id: invoice.postingIds[1],
    });
    const payment = await journal(
      "household",
      "Cedar Lane remodel · partial progress payment",
      12,
      "ContractorPayment",
      [
        ["contractor-payable", 1500000],
        ["checking1", -1500000],
      ],
      {
        subject: "asset-home",
        arrangement: "remodel-contract",
        counterparty: "contractor",
      },
    );
    await ctx.db.insert("obligation_settlement", {
      ...base,
      obligation_id: obligation,
      journal_entry_id: payment.id,
      capacity_posting_id: payment.postingIds[1],
      recognition_posting_id: payment.postingIds[0],
      minor_units: 1500000,
      currency,
      settlement_date: payment.date,
    });
    await ctx.db.insert("expected_flow", {
      ...base,
      expected_date: "2026-09-30",
      minor_units: -1500000,
      currency,
      account_id: a("checking1"),
      obligation_id: obligation,
      occurrence_key: `obligation:${obligation}`,
      input_revision: 1,
    });
    const assumption = await ctx.db.insert("forecast_assumption", {
      ...base,
      name: "Cedar Lane · final $30,000 milestone expected in November",
      value: { kind: "amount", amount: { minor_units: 3000000, currency } },
      source:
        "Fictional $85,000 remodel contract; $55,000 incurred, $30,000 future work",
      context: { kind: "tag", id: id(r, "remodel-tag", "tag") },
    });
    await ctx.db.insert("expected_flow", {
      ...base,
      expected_date: "2026-11-15",
      minor_units: -3000000,
      currency,
      account_id: a("checking1"),
      assumption_id: assumption,
      occurrence_key: `assumption:${assumption}`,
      input_revision: 1,
    });
    for (const [key, ref] of r)
      if (ref.kind === "financial_account") {
        const fa = await ctx.db.get(id(r, key, "financial_account"));
        if (!fa) continue;
        const account = await ctx.db.get(fa.ledger_account_id);
        if (!account) continue;
        const total = (await accountBalance(ctx, account)).minor_units;
        const evidence = await ctx.db.insert("evidence_item", {
          ...base,
          kind: "sample_statement",
          namespace: "family-v1",
          captured_at: at(SAMPLE_AS_OF),
          source_date: SAMPLE_AS_OF,
          content_ref: `fictional:${key}:${SAMPLE_AS_OF}`,
        });
        const observation = await ctx.db.insert("balance_observation", {
          ...base,
          financial_account_id: fa._id,
          minor_units: total,
          currency,
          source_at: at(SAMPLE_AS_OF),
          kind: "current",
          pending: "excluded",
          cutoff: at(SAMPLE_AS_OF),
          evidence_id: evidence,
          raw_source_ref: `fictional:${key}`,
          recorded_at: now,
        });
        await ctx.db.insert("reconciliation", {
          ...base,
          financial_account_id: fa._id,
          observation_id: observation,
          cutoff: at(SAMPLE_AS_OF),
          observed_minor_units: total,
          ledger_minor_units: total,
          discrepancy_minor_units: 0,
          currency,
          state: "accepted",
          revision: 1,
          recorded_at: now,
        });
      }
  }
  await raw.db.patch(datasetId, {
    seed_next_month: monthIndex + 1,
    seed_status: monthIndex === 8 ? "ready" : "building",
  });
  await flushScopedWriter(ctx.db);
  if (monthIndex === 8) await enhanceCashAndSubjects(raw, userId, datasetId);
  return { nextMonth: monthIndex + 1, ready: monthIndex === 8 };
}
export const prepare = mutation({
  args: {},
  handler: async (ctx) => buildStructure(ctx, (await requireUser(ctx))._id),
});
export const populateMonth = mutation({
  args: { datasetId: v.id("dataset"), monthIndex: v.number() },
  handler: async (ctx, a) =>
    appendMonth(ctx, (await requireUser(ctx))._id, a.datasetId, a.monthIndex),
});
// Operator-only counterparts used by the local migration/seed command.
export const prepareForOwner = internalMutation({
  args: { userId: v.string() },
  handler: (ctx, a) => buildStructure(ctx, a.userId),
});
export const populateMonthForOwner = internalMutation({
  args: {
    userId: v.string(),
    datasetId: v.id("dataset"),
    monthIndex: v.number(),
  },
  handler: (ctx, a) => appendMonth(ctx, a.userId, a.datasetId, a.monthIndex),
});

function source(name: string, body: string) {
  return `---\nfictional: true\nas_of: "${SAMPLE_AS_OF}"\n---\n\n# ${name}\n\n${body}\n`;
}
export const documents = query({
  agent: { operation: "sampleData.documents", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const result: { target: Target; source: string }[] = [];
    const sampleIds = new Set(
      (await ctx.db.query("sample_record").collect()).map((x) => x.target.id),
    );
    for (const kind of ["entity", "arrangement", "tag"] as const)
      for (const row of await ctx.db.query(kind).collect()) {
        const name = "display_name" in row ? row.display_name : row.name;
        if (sampleIds.has(row._id) && name && sampleNotes[name])
          result.push({
            target: { kind, id: row._id } as Target,
            source: source(name, sampleNotes[name]),
          });
      }
    return result;
  },
});
export const prepareDocumentsForOwner = internalMutation({
  args: {
    userId: v.string(),
    datasetId: v.id("dataset"),
    repositoryKey: v.string(),
  },
  handler: async (raw, a) => {
    const { ctx } = await context(raw, a.userId, a.datasetId);
    const result: { id: Id<"details_document">; source: string }[] = [];
    const existing = await ctx.db.query("details_document").collect();
    for (const kind of ["entity", "arrangement", "tag"] as const)
      for (const row of await ctx.db.query(kind).collect()) {
        const name = "display_name" in row ? row.display_name : row.name;
        if (!name || !sampleNotes[name]) continue;
        let locator = existing.find((x) => x.target.id === row._id)?._id;
        if (!locator) {
          locator = await ctx.db.insert("details_document", {
            user_id: a.userId,
            target: { kind, id: row._id } as Target,
            repository_key: a.repositoryKey,
            path: "pending",
            availability: "missing",
            created_at: Date.now(),
          });
          await ctx.db.patch(locator, { path: `details/${locator}.md` });
          await ctx.db.patch(row._id, { details_document_id: locator });
        }
        result.push({ id: locator, source: source(name, sampleNotes[name]) });
      }
    return result;
  },
});

/** Idempotent, test-only repair. Monetary values, journals, observations and settlements stay intact. */
async function enhanceCashAndSubjects(
  raw: MutationCtx,
  userId: string,
  datasetId: Id<"dataset">,
) {
  const { ctx, registry: r, dataset } = await context(raw, userId, datasetId);
  if (dataset.kind !== "test" || dataset.seed_status !== "ready")
    throw new Error("Only a ready fictional test dataset can be enhanced");
  const marker = "cash-subjects-v1";
  if (r.has(marker))
    return { updatedPostings: 0, routes: 0, alreadyApplied: true };
  const [journals, postings, sets, parts, beneficiaries, tags, routes] =
    await Promise.all([
      ctx.db.query("journal_entry").collect(),
      ctx.db.query("posting").collect(),
      ctx.db.query("posting_attribution_set").collect(),
      ctx.db.query("posting_attribution").collect(),
      ctx.db.query("attribution_beneficiary").collect(),
      ctx.db.query("tag_assignment").collect(),
      ctx.db.query("cash_flow_route").collect(),
    ]);
  const latest = new Map<string, Doc<"posting_attribution_set">>();
  for (const set of sets)
    if ((latest.get(set.posting_id)?.revision ?? 0) < set.revision)
      latest.set(set.posting_id, set);
  let updatedPostings = 0,
    routeCount = 0;
  const e = (key: string) => id(r, key, "entity"),
    a = (key: string) => id(r, key, "ledger_account");
  for (const journal of journals.filter(
    (j) => j.status === "posted" && !j.reverses_id,
  )) {
    const lines = postings.filter((p) => p.je_id === journal._id);
    const templateLine = lines.find(
      (p) => latest.get(p._id)?.reason === "Fictional sample classification",
    );
    if (!templateLine) continue;
    const template = parts.find(
      (p) => p.set_id === latest.get(templateLine._id)!._id,
    );
    if (!template) continue;
    const sourceBeneficiaries = beneficiaries
      .filter((b) => b.attribution_id === template._id)
      .map((b) => ({
        entity_id: b.entity_id,
        unassigned: b.unassigned,
        share_bps: b.share_bps,
      }));
    const sourceTags = tags.filter(
      (t) => t.target.id === template._id && t.removed_at === undefined,
    );
    const split = lines.some((p) => p.account_id === a("fuel"))
      ? [
          { key: "civic", bps: 4000 },
          { key: "outback", bps: 3000 },
          { key: "asset-car", bps: 3000 },
        ]
      : lines.some((p) => p.account_id === a("insurance"))
        ? [
            { key: "civic", bps: 2500 },
            { key: "outback", bps: 2500 },
            { key: "asset-car", bps: 2500 },
            { key: "family", bps: 2500 },
          ]
        : lines.some((p) => p.account_id === a("school"))
          ? [
              { key: "emma", bps: 5000 },
              { key: "noah", bps: 5000 },
            ]
          : null;
    for (const p of lines) {
      const prev = latest.get(p._id);
      if (
        prev &&
        prev.reason !== "Fictional sample classification" &&
        (prev.revision > 1 || prev.reason)
      )
        continue;
      if (p._id === templateLine._id && !split) continue;
      const amount = p.minor_units;
      if (amount === undefined) continue;
      const allocations = split
        ? allocate(amount, split)
        : [{ key: "original", minor_units: amount }];
      const newSet = await attribution(
        ctx,
        userId,
        p,
        allocations.map((portion) => ({
          minor_units: portion.minor_units,
          subject_entity_id:
            portion.key === "original"
              ? template.subject_entity_id
              : e(portion.key),
          arrangement_id: template.arrangement_id,
          counterparty_entity_id: template.counterparty_entity_id,
          unclassified: template.unclassified,
          beneficiaries: sourceBeneficiaries,
        })),
        "Fictional sample v2: classify every ledger leg; vehicle fuel 40/30/30, insurance 25% per car and 25% family life cover, school 50/50 children",
      );
      for (const part of await ctx.db
        .query("posting_attribution")
        .withIndex("by_set", (q) => q.eq("set_id", newSet))
        .collect())
        for (const tag of sourceTags)
          await ctx.db.insert("tag_assignment", {
            user_id: userId,
            tag_id: tag.tag_id,
            target: { kind: "posting_attribution", id: part._id },
            added_at: Date.now(),
          });
      updatedPostings++;
    }
  }
  const saveRoute = async (
    source:
      | { kind: "commitment_schedule"; id: Id<"commitment_schedule"> }
      | { kind: "monetary_obligation"; id: Id<"monetary_obligation"> },
    from?: Id<"ledger_account">,
    to?: Id<"ledger_account">,
    amount?: number,
    days?: number[],
  ) => {
    if (routes.some((r) => r.source.id === source.id)) return;
    await ctx.db.insert("cash_flow_route", {
      user_id: userId,
      created_at: Date.now(),
      source,
      currency: "USD",
      from_account_id: from,
      to_account_id: to,
      cash_minor_units: amount,
      monthly_days: days,
      revision: 1,
    });
    routeCount++;
  };
  for (const loan of loans) {
    const v = await ctx.db.get(
      id(r, `schedule-loan-${loan.key}`, "commitment_schedule_version"),
    );
    if (v)
      await saveRoute(
        { kind: "commitment_schedule", id: v.schedule_id },
        a("checking1"),
      );
  }
  for (const key of ["oak", "maple"]) {
    const v = await ctx.db.get(
      id(r, `schedule-rent-${key}`, "commitment_schedule_version"),
    );
    if (v)
      await saveRoute(
        { kind: "commitment_schedule", id: v.schedule_id },
        undefined,
        a("checking1"),
      );
  }
  const salary = await ctx.db.get(
    id(r, "salary-schedule", "commitment_schedule_version"),
  );
  if (salary)
    await saveRoute(
      { kind: "commitment_schedule", id: salary.schedule_id },
      undefined,
      a("checking1"),
      910000,
      [15, 28],
    );
  for (const o of await ctx.db.query("monetary_obligation").collect())
    if (o.arrangement_id === id(r, "remodel-contract", "arrangement"))
      await saveRoute(
        { kind: "monetary_obligation", id: o._id },
        a("checking1"),
      );
  await ctx.db.insert("sample_record", {
    user_id: userId,
    key: marker,
    target: {
      kind: "chart_of_accounts",
      id: id(r, "chart-household", "chart_of_accounts"),
    },
  });
  await flushScopedWriter(ctx.db);
  return { updatedPostings, routes: routeCount, alreadyApplied: false };
}
export const enhanceForOwner = internalMutation({
  args: { userId: v.string(), datasetId: v.id("dataset") },
  handler: (ctx, a) => enhanceCashAndSubjects(ctx, a.userId, a.datasetId),
});
