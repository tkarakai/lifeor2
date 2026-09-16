/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { expect, test, vi, afterEach } from "vitest";
afterEach(() => vi.useRealTimers());
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { components } from "../convex/_generated/api";

const modules = import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js"]);
const authModules = import.meta.glob(
  "../node_modules/@convex-dev/better-auth/src/component/**/*.ts",
);

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterAuth", authSchema, authModules);
  async function login(email: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: email,
          email,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: user._id,
          token: email,
          expiresAt: now + 3600000,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
    return {
      id: user._id,
      client: t.withIdentity({ subject: user._id, sessionId: session._id }),
    };
  }
  return {
    t,
    alice: await login("planning-alice@example.test"),
    bob: await login("planning-bob@example.test"),
  };
}

const period = { period_start: "2026-01-01", period_end: "2026-12-31" };
const emptyManifest = () => ({
  inputs: [],
  git_revisions: [],
  resolved_tag_targets: [],
  actual_boundary: Date.now(),
});

test("published plans capture actual inputs and reject later mutation or cross-owner references", async () => {
  const { t, alice, bob } = await setup();
  const entity = await alice.client.mutation(anyApi.entities.create, {
    kind: "House",
    display_name: "Original house",
  });
  const plan = await alice.client.mutation(anyApi.planning.createPlan, {
    name: "January plan",
  });
  const version = await alice.client.mutation(
    anyApi.planning.createPlanVersion,
    {
      planId: plan,
      ...period,
      ...emptyManifest(),
      inputs: [
        { target: { kind: "entity", id: entity }, revision: 1, label: "House" },
      ],
    },
  );
  await alice.client.mutation(anyApi.planning.publishPlanVersion, {
    id: version,
  });
  await alice.client.mutation(anyApi.entities.update, {
    id: entity,
    display_name: "Corrected house",
  });
  const saved = await t.run((ctx) => ctx.db.get("plan_version", version));
  expect(
    JSON.parse(saved!.inputs[0].captured as string).record.display_name,
  ).toBe("Original house");
  await expect(
    bob.client.mutation(anyApi.planning.publishPlanVersion, { id: version }),
  ).rejects.toThrow("access denied");
  await expect(
    bob.client.mutation(anyApi.planning.createPlanVersion, {
      planId: plan,
      ...period,
      ...emptyManifest(),
    }),
  ).rejects.toThrow("access denied");
  await expect(
    alice.client.mutation(anyApi.planning.createPlanVersion, {
      planId: plan,
      ...period,
      ...emptyManifest(),
      inputs: [
        { target: { kind: "entity", id: entity }, revision: 1, label: "Stale" },
      ],
    }),
  ).rejects.toThrow("revision changed");
});

test("structural scenario requires published base and does not change actual arrangements", async () => {
  const { t, alice } = await setup();
  const type = await alice.client.mutation(anyApi.arrangements.createType, {
    name: "Household membership",
  });
  const arrangement = await alice.client.mutation(anyApi.arrangements.create, {
    typeId: type,
    name: "Child membership",
    valid_from: 0,
  });
  const plan = await alice.client.mutation(anyApi.planning.createPlan, {
    name: "Base",
  });
  const version = await alice.client.mutation(
    anyApi.planning.createPlanVersion,
    { planId: plan, ...period, ...emptyManifest() },
  );
  const scenario = await alice.client.mutation(anyApi.planning.createScenario, {
    name: "Move out",
  });
  const input = {
    scenarioId: scenario,
    base_plan_version_id: version,
    overrides: [
      {
        target: { kind: "arrangement", id: arrangement },
        value: { kind: "presence", included: false },
      },
    ],
  };
  await expect(
    alice.client.mutation(anyApi.planning.createScenarioVersion, input),
  ).rejects.toThrow("published base");
  await alice.client.mutation(anyApi.planning.publishPlanVersion, {
    id: version,
  });
  await alice.client.mutation(anyApi.planning.createScenarioVersion, input);
  expect(
    (await t.run((ctx) => ctx.db.get("arrangement", arrangement)))!.valid_to,
  ).toBeUndefined();
  expect(
    (await t.run((ctx) => ctx.db.get("arrangement", arrangement)))!.archived,
  ).toBeUndefined();
});

test("budget targets freeze tag scope and cannot be appended after publication", async () => {
  const { t, alice } = await setup();
  const chart = await t.run((ctx) =>
    ctx.db.insert("chart_of_accounts", {
      user_id: alice.id,
      name: "Household",
    }),
  );
  const entity = await alice.client.mutation(anyApi.entities.create, {
    kind: "House",
    display_name: "House",
  });
  const tag = await alice.client.mutation(anyApi.tags.create, {
    name: "Renovation",
  });
  const link = await alice.client.mutation(anyApi.tags.assign, {
    tagId: tag,
    target: { kind: "entity", id: entity },
  });
  const plan = await alice.client.mutation(anyApi.planning.createPlan, {
    name: "Budget",
  });
  const version = await alice.client.mutation(
    anyApi.planning.createPlanVersion,
    { planId: plan, ...period, ...emptyManifest() },
  );
  const args = {
    plan_version_id: version,
    ...period,
    measure: "expense",
    chart_id: chart,
    tag_id: tag,
    amount: { minor_units: 10000, currency: "USD" },
  };
  const targetId = await alice.client.mutation(
    anyApi.planning.createBudgetTarget,
    args,
  );
  await alice.client.mutation(anyApi.planning.publishPlanVersion, {
    id: version,
  });
  await alice.client.mutation(anyApi.tags.unassign, { id: link });
  const target = await t.run((ctx) => ctx.db.get("budget_target", targetId));
  expect(target!.resolved_targets).toEqual([{ kind: "entity", id: entity }]);
  await expect(
    alice.client.mutation(anyApi.planning.createBudgetTarget, args),
  ).rejects.toThrow("immutable");
});

test("partial fulfillment consumes payment capacity once and rejects cross-owner payment", async () => {
  const { t, alice, bob } = await setup();
  const assumption = await alice.client.mutation(
    anyApi.planning.createAssumption,
    {
      name: "Receipt",
      source: "Manual estimate",
      value: {
        kind: "amount",
        amount: { minor_units: 30000, currency: "USD" },
      },
    },
  );
  const flow = await alice.client.mutation(anyApi.planning.createExpectedFlow, {
    expected_date: "2026-10-01",
    minor_units: 30000,
    currency: "USD",
    assumption_id: assumption,
    occurrence_key: "receipt-1",
    input_revision: 1,
  });
  const fixture = await t.run(async (ctx) => {
    const chart = await ctx.db.insert("chart_of_accounts", {
      user_id: alice.id,
      name: "Chart",
    });
    const account = await ctx.db.insert("ledger_account", {
      user_id: alice.id,
      chart_id: chart,
      name: "Checking",
      type: "Asset",
      normal_balance: "Debit",
      currency: "USD",
    });
    const event = await ctx.db.insert("event", {
      user_id: alice.id,
      kind: "Payment",
      occurred_at: Date.now(),
      recorded_at: Date.now(),
      payload_json: "{}",
    });
    const entry = await ctx.db.insert("journal_entry", {
      user_id: alice.id,
      event_id: event,
      chart_id: chart,
      memo: "Fixture",
      status: "posted",
    });
    const posting = await ctx.db.insert("posting", {
      user_id: alice.id,
      je_id: entry,
      account_id: account,
      minor_units: 10000,
      currency: "USD",
      description: "Receipt",
    });
    const income = await ctx.db.insert("ledger_account", {
      user_id: alice.id,
      chart_id: chart,
      name: "Income",
      type: "Income",
      normal_balance: "Credit",
      currency: "USD",
    });
    await ctx.db.insert("posting", {
      user_id: alice.id,
      je_id: entry,
      account_id: income,
      minor_units: -10000,
      currency: "USD",
      description: "Receipt income",
    });
    return { posting };
  });
  await expect(
    bob.client.mutation(anyApi.planning.fulfillExpectedFlow, {
      id: flow,
      postingId: fixture.posting,
      minor_units: 10000,
    }),
  ).rejects.toThrow("access denied");
  await alice.client.mutation(anyApi.planning.fulfillExpectedFlow, {
    id: flow,
    postingId: fixture.posting,
    minor_units: 10000,
  });
  expect(
    (await alice.client.query(anyApi.planning.listExpectedFlows, {}))[0]
      .remaining_minor_units,
  ).toBe(20000);
  await expect(
    alice.client.mutation(anyApi.planning.fulfillExpectedFlow, {
      id: flow,
      postingId: fixture.posting,
      minor_units: 1,
    }),
  ).rejects.toThrow("available amount");
});

test("obligation-backed forecast derives credits and settlements rather than duplicating fulfillment", async () => {
  const { t, alice } = await setup();
  const obligation = await t.run(async (ctx) => {
    const creditor = await ctx.db.insert("entity", {
      user_id: alice.id,
      kind: "Person",
      display_name: "Creditor",
    });
    const debtor = await ctx.db.insert("entity", {
      user_id: alice.id,
      kind: "Person",
      display_name: "Debtor",
    });
    const id = await ctx.db.insert("monetary_obligation", {
      user_id: alice.id,
      creditor_id: creditor,
      debtor_id: debtor,
      due_date: "2026-10-01",
      original_minor_units: 200000,
      currency: "USD",
    });
    await ctx.db.insert("obligation_adjustment", {
      user_id: alice.id,
      obligation_id: id,
      minor_units: -20000,
      currency: "USD",
      effective_date: "2026-09-01",
      reason: "Agreed repair credit",
    });
    return id;
  });
  await alice.client.mutation(anyApi.planning.createExpectedFlow, {
    expected_date: "2026-10-01",
    minor_units: 200000,
    currency: "USD",
    obligation_id: obligation,
    occurrence_key: "rent-1",
    input_revision: 1,
  });
  expect(
    (await alice.client.query(anyApi.planning.listExpectedFlows, {}))[0]
      .remaining_minor_units,
  ).toBe(180000);
  await expect(
    alice.client.mutation(anyApi.planning.createExpectedFlow, {
      expected_date: "2026-10-02",
      minor_units: 200000,
      currency: "USD",
      obligation_id: obligation,
      occurrence_key: "different-key",
      input_revision: 1,
    }),
  ).rejects.toThrow("Duplicate active");
});

async function financialFixture() {
  const f = await setup(),
    alice = f.alice.client;
  const chart = await alice.mutation(anyApi.finance.createChart, {
    name: "Snapshot chart",
  });
  const cash = await alice.mutation(anyApi.finance.createAccount, {
    chartId: chart,
    name: "Cash",
    type: "Asset",
    normal_balance: "Debit",
    currency: "USD",
  });
  const income = await alice.mutation(anyApi.finance.createAccount, {
    chartId: chart,
    name: "Income",
    type: "Income",
    normal_balance: "Credit",
    currency: "USD",
  });
  const creditor = await alice.mutation(anyApi.entities.create, {
      kind: "Person",
      display_name: "Creditor",
    }),
    debtor = await alice.mutation(anyApi.entities.create, {
      kind: "Person",
      display_name: "Debtor",
    });
  const arrangement = await alice.mutation(anyApi.arrangements.create, {
    kind: "Banking",
    valid_from: 0,
  });
  const account = await alice.mutation(anyApi.finance.createFinancialAccount, {
    arrangement_id: arrangement,
    ledger_account_id: cash,
    kind: "checking",
    currency: "USD",
  });
  async function journal(
    amount = 10000,
    status: "posted" | "draft" = "posted",
  ) {
    const event = await alice.mutation(anyApi.events.create, {
      kind: "Receipt",
      occurred_at: 0,
    });
    const id = await alice.mutation(anyApi.finance.createJournalEntry, {
      chartId: chart,
      eventId: event,
      memo: "Receipt",
      accounting_date: "2026-01-01",
      status,
      postings: [
        {
          accountId: cash,
          minor_units: amount,
          currency: "USD",
          description: "Cash",
        },
        {
          accountId: income,
          minor_units: -amount,
          currency: "USD",
          description: "Income",
        },
      ],
    });
    const postings = (await alice.query(anyApi.finance.getPostings, {
      jeId: id,
    })) as { _id: string; account_id: string }[];
    return {
      id,
      posting: postings.find((p) => p.account_id === cash)!._id,
      event,
    };
  }
  return {
    ...f,
    chart,
    cash,
    income,
    creditor,
    debtor,
    arrangement,
    account,
    journal,
  };
}

type Bundle = {
  record: Record<string, unknown>;
  records: {
    target: { kind: string; id: string };
    record: Record<string, unknown>;
    children: Record<string, unknown>;
  }[];
};

test("published journal snapshot freezes postings, attribution beneficiaries, and reversal boundary", async () => {
  const f = await financialFixture(),
    alice = f.alice.client,
    receipt = await f.journal();
  const plan = await alice.mutation(anyApi.planning.createPlan, {
    name: "Frozen receipt",
  });
  const version = await alice.mutation(anyApi.planning.createPlanVersion, {
    planId: plan,
    ...period,
    ...emptyManifest(),
    inputs: [
      {
        target: { kind: "journal_entry", id: receipt.id },
        label: "Receipt actual",
      },
    ],
  });
  await alice.mutation(anyApi.planning.publishPlanVersion, { id: version });
  const saved = await f.t.run((ctx) => ctx.db.get("plan_version", version));
  const bundle = JSON.parse(saved!.inputs[0].captured as string) as Bundle;
  expect(
    bundle.records.filter((n) => n.target.kind === "posting"),
  ).toHaveLength(2);
  expect(
    bundle.records.filter((n) => n.target.kind === "posting_attribution_set"),
  ).toHaveLength(2);
  const portion = bundle.records.find(
    (n) => n.target.kind === "posting_attribution",
  )!;
  expect(portion.children.beneficiaries).toEqual(
    expect.arrayContaining([expect.objectContaining({ share_bps: 10000 })]),
  );
  await alice.mutation(anyApi.finance.replaceAttribution, {
    postingId: receipt.posting,
    expectedRevision: 1,
    portions: [
      {
        minor_units: 10000,
        subject_entity_id: f.creditor,
        unclassified: false,
        beneficiaries: [
          { entity_id: f.creditor, unassigned: false, share_bps: 10000 },
        ],
      },
    ],
  });
  const reversal = await alice.mutation(anyApi.finance.reverseJournalEntry, {
    jeId: receipt.id,
    accounting_date: "2026-01-02",
    reason: "Return after saved plan",
  });
  const run = await alice.mutation(anyApi.planning.createForecastRun, {
    plan_version_id: version,
    engine_version: "inputs-only-v1",
    horizon_start: "2026-01-01",
    horizon_end: "2026-12-31",
    timezone: "UTC",
    anchor_ids: [],
  });
  const frozen = await f.t.run((ctx) => ctx.db.get("forecast_run", run));
  expect(frozen!.inputs[0].captured).toBe(saved!.inputs[0].captured);
  expect(frozen!.inputs[0].captured).not.toContain(reversal);
  const newer = await alice.mutation(anyApi.planning.createPlanVersion, {
    planId: plan,
    ...period,
    ...emptyManifest(),
    inputs: [
      {
        target: { kind: "journal_entry", id: receipt.id },
        label: "Corrected receipt actual",
      },
    ],
  });
  const current = await f.t.run((ctx) => ctx.db.get("plan_version", newer));
  const corrected = JSON.parse(current!.inputs[0].captured as string) as Bundle;
  expect(
    corrected.records.filter((n) => n.target.kind === "journal_entry"),
  ).toHaveLength(2);
  expect(
    corrected.records
      .filter((n) => n.target.kind === "posting")
      .reduce((sum, n) => sum + Number(n.record.minor_units), 0),
  ).toBe(0);
});

test("run includes immutable budget children and scenario baseline after actual edits", async () => {
  const f = await financialFixture(),
    alice = f.alice.client;
  const plan = await alice.mutation(anyApi.planning.createPlan, {
    name: "Household plan",
  });
  const version = await alice.mutation(anyApi.planning.createPlanVersion, {
    planId: plan,
    ...period,
    ...emptyManifest(),
    inputs: [
      {
        target: { kind: "arrangement", id: f.arrangement },
        label: "Banking baseline",
      },
    ],
  });
  const budget = await alice.mutation(anyApi.planning.createBudgetTarget, {
    plan_version_id: version,
    ...period,
    measure: "income",
    chart_id: f.chart,
    account_id: f.income,
    amount: { minor_units: 30000, currency: "USD" },
  });
  await alice.mutation(anyApi.planning.publishPlanVersion, { id: version });
  const scenario = await alice.mutation(anyApi.planning.createScenario, {
    name: "Hypothetical change",
  });
  const sv = await alice.mutation(anyApi.planning.createScenarioVersion, {
    scenarioId: scenario,
    base_plan_version_id: version,
    overrides: [
      {
        target: { kind: "arrangement", id: f.arrangement },
        value: { kind: "presence", included: false },
      },
    ],
  });
  await alice.mutation(anyApi.arrangements.update, {
    id: f.arrangement,
    name: "Changed actual",
  });
  const run = await alice.mutation(anyApi.planning.createForecastRun, {
    plan_version_id: version,
    scenario_version_id: sv,
    engine_version: "inputs-only",
    horizon_start: "2026-01-01",
    horizon_end: "2026-12-31",
    timezone: "UTC",
    anchor_ids: [],
  });
  const saved = await f.t.run((ctx) => ctx.db.get("forecast_run", run));
  const planBundle = JSON.parse(
    saved!.inputs.find((x) => x.target.kind === "plan_version")!
      .captured as string,
  ) as Bundle;
  expect(planBundle.records[0].children.budget_targets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        _id: budget,
        amount: { minor_units: 30000, currency: "USD" },
      }),
    ]),
  );
  const scenarioBundle = JSON.parse(
    saved!.inputs.find((x) => x.target.kind === "scenario_version")!
      .captured as string,
  ) as Bundle;
  expect(
    scenarioBundle.records[0].children.published_override_baselines,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        target: { kind: "arrangement", id: f.arrangement },
      }),
    ]),
  );
  expect(JSON.stringify(scenarioBundle)).not.toContain("Changed actual");
});

test("mutable planning roots and draft plan budgets cannot be snapshot inputs", async () => {
  const f = await financialFixture(),
    alice = f.alice.client;
  const plan = await alice.mutation(anyApi.planning.createPlan, {
      name: "Draft",
    }),
    scenario = await alice.mutation(anyApi.planning.createScenario, {
      name: "Mutable scenario",
    });
  const draft = await alice.mutation(anyApi.planning.createPlanVersion, {
    planId: plan,
    ...period,
    ...emptyManifest(),
  });
  const budget = await alice.mutation(anyApi.planning.createBudgetTarget, {
    plan_version_id: draft,
    ...period,
    measure: "income",
    chart_id: f.chart,
    amount: { minor_units: 10, currency: "USD" },
  });
  for (const target of [
    { kind: "plan", id: plan },
    { kind: "scenario", id: scenario },
    { kind: "plan_version", id: draft },
    { kind: "budget_target", id: budget },
  ])
    await expect(
      alice.mutation(anyApi.planning.createPlanVersion, {
        planId: plan,
        ...period,
        ...emptyManifest(),
        inputs: [{ target, label: "Unsafe input" }],
      }),
    ).rejects.toThrow(/Mutable|Draft|draft/);
  await alice.mutation(anyApi.planning.publishPlanVersion, { id: draft });
  const id = await alice.mutation(anyApi.planning.createPlanVersion, {
    planId: plan,
    ...period,
    ...emptyManifest(),
    inputs: [
      { target: { kind: "plan_version", id: draft }, label: "Published base" },
    ],
  });
  expect(await f.t.run((ctx) => ctx.db.get("plan_version", id))).not.toBeNull();
});

test("schedule forecast adopts incurred obligation settlements and rejects revised-version aliases", async () => {
  const f = await financialFixture(),
    alice = f.alice.client;
  const fields = {
    arrangement_id: f.arrangement,
    name: "Rent",
    creditor_id: f.creditor,
    debtor_id: f.debtor,
    amount: { minor_units: 20000, currency: "USD" },
    currency: "USD",
    recurrence: { frequency: "monthly", interval: 1 },
    start_date: "2026-01-01",
    timezone: "UTC",
    valid_from: 0,
  };
  const schedule = await alice.mutation(
    anyApi.obligations.createSchedule,
    fields,
  );
  const schedules = (await alice.query(
    anyApi.obligations.listSchedules,
    {},
  )) as { _id: string; versions: { _id: string }[] }[];
  const version = schedules.find((s) => s._id === schedule)!.versions[0]._id,
    key = `${version}:2026-10`;
  const flow = await alice.mutation(anyApi.planning.createExpectedFlow, {
    expected_date: "2026-10-01",
    minor_units: 20000,
    currency: "USD",
    schedule_version_id: version,
    occurrence_key: key,
    input_revision: 1,
    account_id: f.cash,
  });
  const obligation = await alice.mutation(anyApi.obligations.create, {
    creditor_id: f.creditor,
    debtor_id: f.debtor,
    minor_units: 20000,
    currency: "USD",
    due_date: "2026-10-01",
    schedule_version_id: version,
    occurrence_key: key,
  });
  const receipt = await f.journal(10000);
  await alice.mutation(anyApi.obligations.settle, {
    obligationId: obligation,
    capacityPostingId: receipt.posting,
    minor_units: 10000,
    settlement_date: "2026-10-01",
  });
  const flows = (await alice.query(anyApi.planning.listExpectedFlows, {})) as {
    _id: string;
    remaining_minor_units: number;
  }[];
  expect(flows.find((x) => x._id === flow)!.remaining_minor_units).toBe(10000);
  await expect(
    alice.mutation(anyApi.planning.fulfillExpectedFlow, {
      id: flow,
      postingId: receipt.posting,
      minor_units: 1,
    }),
  ).rejects.toThrow("Settle the linked");
  const { arrangement_id: _, name: __, ...terms } = fields;
  const revised = await alice.mutation(anyApi.obligations.reviseSchedule, {
    ...terms,
    id: schedule,
    expectedRevision: 1,
    reason: "New rent",
  });
  await expect(
    alice.mutation(anyApi.planning.createExpectedFlow, {
      expected_date: "2026-10-01",
      minor_units: 20000,
      currency: "USD",
      schedule_version_id: revised,
      occurrence_key: `${revised}:2026-10`,
      input_revision: 2,
    }),
  ).rejects.toThrow("Duplicate active");
});

test("historical account snapshots exclude journals posted after the knowledge cutoff", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const f = await financialFixture(),
    alice = f.alice.client;
  const receipt = await f.journal(10000, "draft");
  vi.setSystemTime(100100);
  await alice.mutation(anyApi.finance.postDraft, { jeId: receipt.id });
  const plan = await alice.mutation(anyApi.planning.createPlan, {
    name: "Historical snapshot",
  });
  const input = {
    planId: plan,
    ...period,
    inputs: [],
    git_revisions: [],
    resolved_tag_targets: [],
    actual_boundary: 100050,
  };
  await expect(
    alice.mutation(anyApi.planning.createPlanVersion, {
      ...input,
      inputs: [
        {
          target: { kind: "posting", id: receipt.posting },
          label: "Not posted at cutoff",
        },
      ],
    }),
  ).rejects.toThrow("boundary");
  const version = await alice.mutation(anyApi.planning.createPlanVersion, {
    ...input,
    inputs: [
      {
        target: { kind: "ledger_account", id: f.cash },
        label: "Cash as known before posting",
      },
    ],
  });
  const saved = await f.t.run((ctx) => ctx.db.get("plan_version", version));
  const bundle = JSON.parse(saved!.inputs[0].captured as string) as Bundle;
  expect(bundle.records.filter((n) => n.target.kind === "posting")).toEqual([]);
  expect(bundle.records[0].children.postings).toEqual([]);
});

test("runs freeze accepted anchors and reject anchors recorded beyond the plan boundary", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const f = await financialFixture(),
    alice = f.alice.client;
  await f.journal();
  const plan = await alice.mutation(anyApi.planning.createPlan, {
    name: "Anchored plan",
  });
  const old = await alice.mutation(anyApi.planning.createPlanVersion, {
    planId: plan,
    ...period,
    ...emptyManifest(),
  });
  await alice.mutation(anyApi.planning.publishPlanVersion, { id: old });
  vi.setSystemTime(100100);
  const evidence = await alice.mutation(anyApi.evidence.create, {
    kind: "balance",
    namespace: "snapshot",
    content_ref: "immutable:balance-at-0",
  });
  const observation = await alice.mutation(anyApi.observations.observeBalance, {
    financial_account_id: f.account,
    minor_units: 10000,
    currency: "USD",
    source_at: 0,
    cutoff: 0,
    kind: "current",
    pending: "excluded",
    evidence_id: evidence,
    raw_source_ref: "immutable:balance-at-0",
  });
  const anchor = await alice.mutation(anyApi.observations.reconcile, {
    financial_account_id: f.account,
    observation_id: observation,
    accept: true,
  });
  const args = {
    engine_version: "inputs-only",
    horizon_start: "2026-01-01",
    horizon_end: "2026-12-31",
    timezone: "UTC",
    anchor_ids: [anchor],
  };
  await expect(
    alice.mutation(anyApi.planning.createForecastRun, {
      ...args,
      plan_version_id: old,
    }),
  ).rejects.toThrow("boundary");
  const version = await alice.mutation(anyApi.planning.createPlanVersion, {
    planId: plan,
    ...period,
    ...emptyManifest(),
    inputs: [
      {
        target: { kind: "reconciliation", id: anchor },
        label: "Pinned opening anchor",
      },
    ],
  });
  await alice.mutation(anyApi.planning.publishPlanVersion, { id: version });
  const run = await alice.mutation(anyApi.planning.createForecastRun, {
    ...args,
    plan_version_id: version,
  });
  const saved = await f.t.run((ctx) => ctx.db.get("forecast_run", run));
  const bundle = JSON.parse(
    saved!.inputs.find((x) => x.target.kind === "reconciliation")!
      .captured as string,
  ) as Bundle;
  expect(bundle.records.map((n) => n.target.kind)).toEqual(
    expect.arrayContaining([
      "reconciliation",
      "balance_observation",
      "evidence_item",
      "financial_account",
      "ledger_account",
      "journal_entry",
      "posting",
    ]),
  );
  expect(saved!.anchors[0]).toMatchObject({ cutoff: 0, minor_units: 10000 });
});

test("runs reject legacy parent-only captures instead of silently reading fresh children", async () => {
  const { t, alice } = await setup();
  const entity = await alice.client.mutation(anyApi.entities.create, {
    kind: "House",
    display_name: "House",
  });
  const legacy = await t.run(async (ctx) => {
    const plan = await ctx.db.insert("plan", {
      user_id: alice.id,
      name: "Legacy",
    });
    return ctx.db.insert("plan_version", {
      user_id: alice.id,
      plan_id: plan,
      revision: 1,
      status: "published",
      ...period,
      ...emptyManifest(),
      inputs: [
        {
          target: { kind: "entity", id: entity },
          label: "Incomplete old capture",
          captured: JSON.stringify({ record: { _id: entity } }),
        },
      ],
    });
  });
  await expect(
    alice.client.mutation(anyApi.planning.createForecastRun, {
      plan_version_id: legacy,
      engine_version: "inputs-only",
      horizon_start: "2026-01-01",
      horizon_end: "2026-12-31",
      timezone: "UTC",
      anchor_ids: [],
    }),
  ).rejects.toThrow("incomplete input");
});

test("monthly period aliases deduplicate while predicted settlement dates can move", async () => {
  const f = await financialFixture(),
    alice = f.alice.client;
  const schedule = await alice.mutation(anyApi.obligations.createSchedule, {
    arrangement_id: f.arrangement,
    name: "Monthly rent",
    creditor_id: f.creditor,
    debtor_id: f.debtor,
    amount: { minor_units: 10000, currency: "USD" },
    currency: "USD",
    recurrence: { frequency: "monthly", interval: 1 },
    start_date: "2026-01-01",
    timezone: "UTC",
    valid_from: 0,
  });
  const schedules = (await alice.query(
    anyApi.obligations.listSchedules,
    {},
  )) as { _id: string; versions: { _id: string }[] }[];
  const version = schedules.find((s) => s._id === schedule)!.versions[0]._id;
  const args = {
    expected_date: "2026-11-03",
    minor_units: 10000,
    currency: "USD",
    schedule_version_id: version,
    input_revision: 1,
  };
  await alice.mutation(anyApi.planning.createExpectedFlow, {
    ...args,
    occurrence_key: `${version}:2026-10`,
  });
  await expect(
    alice.mutation(anyApi.planning.createExpectedFlow, {
      ...args,
      occurrence_key: `${version}:2026-10-01`,
    }),
  ).rejects.toThrow("Duplicate active");
  await expect(
    alice.mutation(anyApi.planning.createExpectedFlow, {
      ...args,
      occurrence_key: `${version}:2026`,
    }),
  ).rejects.toThrow("Monthly occurrence");
});
