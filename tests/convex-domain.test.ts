/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { api, components, internal } from "../convex/_generated/api";
import {
  parseMoney,
  add,
  allocate,
  changeTimeline,
  selectRevision,
} from "../convex/lib/domain";
import {
  filterByValidTime,
  filterByTimeRange,
  buildTimeline,
} from "../lib/temporal-queries";
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
          expiresAt: now + 86400000 * 1000,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
    return {
      client: t.withIdentity({ subject: user._id, sessionId: session._id }),
      userId: user._id,
    };
  }
  const a = await login("a@example.test"),
    b = await login("b@example.test");
  return { t, alice: a.client, bob: b.client, userId: a.userId };
}
async function fixture() {
  const f = await setup(),
    { alice } = f;
  const chart = await alice.mutation(api.finance.createChart, {
    name: "Household",
  });
  const entity = await alice.mutation(api.entities.create, {
    kind: "Person",
    display_name: "Owner",
  });
  const debtor = await alice.mutation(api.entities.create, {
    kind: "Person",
    display_name: "Tenant",
  });
  const house = await alice.mutation(api.entities.create, {
    kind: "House",
    display_name: "Oak Street",
  });
  const household = await alice.mutation(api.entities.create, {
    kind: "Group",
    display_name: "Household",
  });
  const arrangement = await alice.mutation(api.arrangements.create, {
    kind: "Banking",
    name: "Checking relationship",
    valid_from: 0,
  });
  const event = await alice.mutation(api.events.create, {
    kind: "Adjustment",
    occurred_at: 0,
  });
  async function account(
    name: string,
    type: "Asset" | "Liability" | "Equity" | "Income" | "Expense",
    currency = "USD",
  ) {
    return alice.mutation(api.finance.createAccount, {
      chartId: chart,
      name,
      type,
      normal_balance: ["Asset", "Expense"].includes(type) ? "Debit" : "Credit",
      currency,
    });
  }
  const cash = await account("Checking", "Asset"),
    equity = await account("Opening equity", "Equity"),
    expense = await account("Renovation", "Expense"),
    income = await account("Rent income", "Income"),
    receivable = await account("Rent receivable", "Asset");
  const financial = await alice.mutation(api.finance.createFinancialAccount, {
    arrangement_id: arrangement,
    ledger_account_id: cash,
    kind: "checking",
    currency: "USD",
  });
  async function entry(
    lines: { accountId: typeof cash; minor_units: number; currency?: string }[],
    status: "draft" | "posted" = "posted",
  ) {
    return alice.mutation(api.finance.createJournalEntry, {
      chartId: chart,
      eventId: event,
      memo: "Fixture",
      accounting_date: "2026-01-01",
      status,
      postings: lines.map((p) => ({
        ...p,
        currency: p.currency ?? "USD",
        description: "Fixture",
      })),
    });
  }
  return {
    ...f,
    chart,
    entity,
    debtor,
    house,
    household,
    arrangement,
    event,
    cash,
    equity,
    expense,
    income,
    receivable,
    financial,
    account,
    entry,
  };
}
afterEach(() => vi.useRealTimers());
test("exact scales, overflow, half-open zero ends, and isolated lineage", () => {
  expect(parseMoney("12.34", "USD")).toBe(1234);
  expect(parseMoney("12", "JPY")).toBe(12);
  expect(parseMoney("1.234", "KWD")).toBe(1234);
  expect(() => parseMoney("1.001", "USD")).toThrow("precision");
  expect(() => parseMoney("1e3", "USD")).toThrow();
  expect(() => add(Number.MAX_SAFE_INTEGER, 1)).toThrow();
  expect(filterByValidTime([{ valid_from: -10, valid_to: 0 }], 0)).toEqual([]);
  expect(filterByTimeRange([{ valid_from: -10, valid_to: 0 }], 0, 1)).toEqual(
    [],
  );
  expect(
    buildTimeline(
      [
        { _id: "a", valid_from: 0 },
        { _id: "b", valid_from: 1, supersedes_arrangement_id: "a" },
        { _id: "other", valid_from: 2 },
      ],
      { _id: "a", valid_from: 0 },
    ).map((x) => x._id),
  ).toEqual(["a", "b"]);
  expect(
    allocate(101, [
      { key: "a", bps: 5000 },
      { key: "b", bps: 5000 },
    ]),
  ).toEqual([
    { key: "a", minor_units: 51 },
    { key: "b", minor_units: 50 },
  ]);
});
test("late timeline correction preserves old knowledge", () => {
  const original = [{ valid_from: 0, facts: { rent: 200000 } }],
    corrected = changeTimeline(original, 20, { rent: 210000 });
  const revisions = [
    { revision: 1, recorded_at: 10, segments: original },
    { revision: 2, recorded_at: 30, segments: corrected },
  ];
  expect(selectRevision(revisions, 25, 29)?.facts).toEqual({ rent: 200000 });
  expect(selectRevision(revisions, 25, 30)?.facts).toEqual({ rent: 210000 });
  expect(selectRevision(revisions, 19, 30)?.facts).toEqual({ rent: 200000 });
});
test("custom templates copy once; local roles permit subjects and enforce owners", async () => {
  const { alice, bob } = await setup();
  const type = await alice.mutation(api.arrangements.createType, {
    name: "Custom tenancy",
    templates: [
      { name: "Tenant", participation: "participant" },
      {
        name: "Leased property",
        participation: "subject",
        eligibleKinds: ["House"],
      },
    ],
  });
  const arrangement = await alice.mutation(api.arrangements.create, {
    typeId: type,
    name: "Lease",
    valid_from: 0,
  });
  const roles = await alice.query(api.arrangements.getRoleDefinitions, {
    arrangementId: arrangement,
  });
  expect(roles).toHaveLength(2);
  await alice.mutation(api.arrangements.updateType, {
    id: type,
    templates: [{ name: "Replacement template", participation: "participant" }],
  });
  expect(
    (
      await alice.query(api.arrangements.getRoleDefinitions, {
        arrangementId: arrangement,
      })
    )[0].name,
  ).toBe("Tenant");
  const house = await alice.mutation(api.entities.create, {
      kind: "House",
      display_name: "Oak",
    }),
    person = await alice.mutation(api.entities.create, {
      kind: "Person",
      display_name: "Jane",
    });
  await expect(
    alice.mutation(api.arrangements.assignRole, {
      roleId: roles[1]._id,
      entityId: person,
      valid_from: 0,
    }),
  ).rejects.toThrow("ineligible");
  await alice.mutation(api.arrangements.assignRole, {
    roleId: roles[1]._id,
    entityId: house,
    valid_from: 0,
  });
  await alice.mutation(api.arrangements.assignRole, {
    roleId: roles[0]._id,
    entityId: person,
    valid_from: 0,
  });
  await expect(
    bob.mutation(api.arrangements.updateRole, { id: roles[0]._id, name: "No" }),
  ).rejects.toThrow();
  await expect(
    alice.mutation(api.arrangements.update, {
      id: arrangement,
      parent_arrangement_id: arrangement,
    }),
  ).rejects.toThrow("cycle");
});
test("future edits resolve at read time and retroactive ends retain old knowledge", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const { alice } = await setup();
  const id = await alice.mutation(api.arrangements.create, {
    kind: "Lease",
    name: "Old",
    valid_from: 0,
  });
  const role = await alice.mutation(api.arrangements.createRole, {
    arrangementId: id,
    name: "Tenant",
    participation: "participant",
  });
  const entity = await alice.mutation(api.entities.create, {
    kind: "Person",
    display_name: "Jane",
  });
  const assignment = await alice.mutation(api.arrangements.assignRole, {
    roleId: role,
    entityId: entity,
    valid_from: 0,
  });
  vi.setSystemTime(100010);
  await alice.mutation(api.arrangements.update, {
    id,
    name: "Future",
    effectiveAt: 200000,
  });
  await alice.mutation(api.arrangements.updateRole, {
    id: role,
    name: "Resident",
    effectiveAt: 200000,
  });
  expect((await alice.query(api.arrangements.get, { id })).name).toBe("Old");
  expect(
    (
      await alice.query(api.arrangements.getRoleDefinitions, {
        arrangementId: id,
      })
    )[0].name,
  ).toBe("Tenant");
  vi.setSystemTime(200001);
  expect((await alice.query(api.arrangements.get, { id })).name).toBe("Future");
  expect(
    (
      await alice.query(api.arrangements.getRoleDefinitions, {
        arrangementId: id,
      })
    )[0].name,
  ).toBe("Resident");
  await alice.mutation(api.arrangements.updateAssignment, {
    id: assignment,
    valid_to: 50000,
  });
  const old = await alice.query(api.arrangements.assignmentHistory, {
      id: assignment,
      effectiveAt: 60000,
      knownAt: 100005,
    }),
    current = await alice.query(api.arrangements.assignmentHistory, {
      id: assignment,
      effectiveAt: 60000,
      knownAt: 200001,
    });
  expect(old.selected?.facts).toMatchObject({ valid_from: 0 });
  expect(current.selected?.facts).toMatchObject({ valid_to: 50000 });
});
test("tag membership is unique, historied and owner checked; locators are stable", async () => {
  const { alice, bob } = await setup();
  const id = await alice.mutation(api.entities.create, {
    kind: "House",
    display_name: "Oak",
  });
  const tag = await alice.mutation(api.tags.create, { name: "Renovation" });
  const target = { kind: "entity" as const, id };
  const link = await alice.mutation(api.tags.assign, { tagId: tag, target });
  await expect(
    alice.mutation(api.tags.assign, { tagId: tag, target }),
  ).rejects.toThrow("Duplicate");
  await expect(
    bob.mutation(api.tags.assign, { tagId: tag, target }),
  ).rejects.toThrow();
  const doc = await alice.mutation(api.details.ensure, {
    target,
    repositoryKey: "content",
  });
  expect(
    (
      await alice.mutation(api.details.ensure, {
        target,
        repositoryKey: "content",
      })
    )._id,
  ).toBe(doc._id);
  expect(doc.path).toBe(`details/${doc._id}.md`);
  await alice.mutation(api.details.observe, {
    id: doc._id,
    availability: "missing",
  });
  await expect(
    alice.mutation(api.details.observe, {
      id: doc._id,
      availability: "available",
    }),
  ).rejects.toThrow();
  await expect(bob.query(api.details.get, { id: doc._id })).rejects.toThrow();
  await alice.mutation(api.tags.unassign, { id: link });
  expect(await alice.query(api.tags.getAssignments, { tagId: tag })).toEqual(
    [],
  );
});
test("exact ledger excludes drafts and reports currency-separated totals", async () => {
  const { alice, chart, cash, equity, account, entry } = await fixture();
  await entry([
    { accountId: cash, minor_units: 10001 },
    { accountId: equity, minor_units: -10001 },
  ]);
  await entry(
    [
      { accountId: cash, minor_units: 5000 },
      { accountId: equity, minor_units: -5000 },
    ],
    "draft",
  );
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: cash }))
      .minor_units,
  ).toBe(10001);
  const yen = await account("Yen", "Asset", "JPY"),
    yenEquity = await account("Yen equity", "Equity", "JPY");
  await entry([
    { accountId: yen, minor_units: 50, currency: "JPY" },
    { accountId: yenEquity, minor_units: -50, currency: "JPY" },
  ]);
  const trial = await alice.query(api.finance.getTrialBalance, {
    chartId: chart,
  });
  expect(trial.byCurrency).toEqual(
    expect.arrayContaining([
      {
        currency: "USD",
        totalDebit: 10001,
        totalCredit: 10001,
        isBalanced: true,
      },
      { currency: "JPY", totalDebit: 50, totalCredit: 50, isBalanced: true },
    ]),
  );
  await expect(
    entry([
      { accountId: cash, minor_units: 1.1 },
      { accountId: equity, minor_units: -1.1 },
    ]),
  ).rejects.toThrow("integer");
});
test("mixed card purchase partitions expense and reversal preserves analytical amounts", async () => {
  const { alice, house, household, expense, account, entry } = await fixture();
  const groceries = await account("Groceries", "Expense"),
    card = await account("Credit card", "Liability");
  const je = await entry([
    { accountId: expense, minor_units: 3000 },
    { accountId: groceries, minor_units: 9000 },
    { accountId: card, minor_units: -12000 },
  ]);
  const ps = await alice.query(api.finance.getPostings, { jeId: je }),
    p = ps.find((p) => p.account_id === expense)!;
  await alice.mutation(api.finance.replaceAttribution, {
    postingId: p._id,
    expectedRevision: 1,
    portions: [
      {
        minor_units: 3000,
        subject_entity_id: house,
        unclassified: false,
        beneficiaries: [
          { entity_id: household, unassigned: false, share_bps: 10000 },
        ],
      },
    ],
  });
  await expect(
    alice.mutation(api.finance.replaceAttribution, {
      postingId: p._id,
      expectedRevision: 1,
      portions: [],
    }),
  ).rejects.toThrow("Revision");
  const tag = await alice.mutation(api.tags.create, { name: "Kitchen" }),
    interpretation = await alice.query(api.finance.getAttribution, {
      postingId: p._id,
    });
  await alice.mutation(api.tags.assign, {
    tagId: tag,
    target: {
      kind: "posting_attribution",
      id: interpretation!.portions[0]._id,
    },
  });
  const reversal = await alice.mutation(api.finance.reverseJournalEntry, {
    jeId: je,
    accounting_date: "2026-02-01",
    reason: "Correction",
  });
  const rp = (
    await alice.query(api.finance.getPostings, { jeId: reversal })
  ).find((p) => p.account_id === expense)!;
  const reversed = await alice.query(api.finance.getAttribution, {
    postingId: rp._id,
  });
  expect(reversed!.portions[0]).toMatchObject({
    minor_units: -3000,
    subject_entity_id: house,
  });
  expect(reversed!.portions[0].beneficiaries[0].minor_units).toBe(-3000);
  expect(
    await alice.query(api.tags.getAssignments, { tagId: tag }),
  ).toHaveLength(2);
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: expense }))
      .minor_units,
  ).toBe(0);
  await expect(
    alice.mutation(api.finance.reverseJournalEntry, {
      jeId: je,
      accounting_date: "2026-02-01",
      reason: "Again",
    }),
  ).rejects.toThrow();
});
test("rent credit, partial cash settlement, capacity and reversal remain distinct", async () => {
  const f = await fixture(),
    {
      alice,
      entity,
      debtor,
      receivable,
      income,
      cash,
      event,
      chart,
      expense,
      entry,
    } = f;
  const recognition = await entry([
    { accountId: receivable, minor_units: 200000 },
    { accountId: income, minor_units: -200000 },
  ]);
  const recognitionPosting = (
    await alice.query(api.finance.getPostings, { jeId: recognition })
  ).find((p) => p.account_id === receivable)!;
  const obligation = await alice.mutation(api.obligations.create, {
    creditor_id: entity,
    debtor_id: debtor,
    due_date: "2026-01-01",
    minor_units: 200000,
    currency: "USD",
    recognition_posting_id: recognitionPosting._id,
  });
  await alice.mutation(api.obligations.adjust, {
    obligationId: obligation,
    minor_units: -20000,
    effective_date: "2026-01-02",
    reason: "Repair allowance",
    recognitionAccountId: receivable,
    journal: {
      eventId: event,
      chartId: chart,
      memo: "Allowance",
      accounting_date: "2026-01-02",
      postings: [
        {
          accountId: expense,
          minor_units: 20000,
          currency: "USD",
          description: "Allowance",
        },
        {
          accountId: receivable,
          minor_units: -20000,
          currency: "USD",
          description: "Credit",
        },
      ],
    },
  });
  const receipt = await entry([
      { accountId: cash, minor_units: 100000 },
      { accountId: receivable, minor_units: -100000 },
    ]),
    ps = await alice.query(api.finance.getPostings, { jeId: receipt }),
    capacity = ps.find((p) => p.account_id === cash)!,
    counterpart = ps.find((p) => p.account_id === receivable)!;
  await alice.mutation(api.obligations.settle, {
    obligationId: obligation,
    capacityPostingId: capacity._id,
    recognitionPostingId: counterpart._id,
    minor_units: 100000,
    settlement_date: "2026-01-03",
  });
  expect((await alice.query(api.obligations.list, {}))[0]).toMatchObject({
    outstanding_minor_units: 80000,
    settled_minor_units: 100000,
    approved_minor_units: 180000,
  });
  await expect(
    alice.mutation(api.obligations.settle, {
      obligationId: obligation,
      capacityPostingId: capacity._id,
      recognitionPostingId: counterpart._id,
      minor_units: 1,
      settlement_date: "2026-01-03",
    }),
  ).rejects.toThrow("capacity");
  await alice.mutation(api.finance.reverseJournalEntry, {
    jeId: receipt,
    accounting_date: "2026-01-04",
    reason: "Returned receipt",
  });
  expect(
    (await alice.query(api.obligations.list, {}))[0].outstanding_minor_units,
  ).toBe(180000);
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: cash }))
      .minor_units,
  ).toBe(0);
});
test("mortgage principal, interest and escrow stay on distinct accounts", async () => {
  const { alice, cash, account, entry } = await fixture();
  const mortgage = await account("Mortgage", "Liability"),
    interest = await account("Interest", "Expense"),
    escrow = await account("Escrow", "Asset");
  await entry([
    { accountId: cash, minor_units: -320000 },
    { accountId: mortgage, minor_units: 190000 },
    { accountId: interest, minor_units: 100000 },
    { accountId: escrow, minor_units: 30000 },
  ]);
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: cash }))
      .minor_units,
  ).toBe(-320000);
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: interest }))
      .minor_units,
  ).toBe(100000);
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: escrow }))
      .minor_units,
  ).toBe(30000);
});
test("observations do not post; reconciliation matches account portions with capacity", async () => {
  const { alice, cash, equity, financial, entry } = await fixture();
  const je = await entry([
      { accountId: cash, minor_units: 500000 },
      { accountId: equity, minor_units: -500000 },
    ]),
    p = (await alice.query(api.finance.getPostings, { jeId: je })).find(
      (p) => p.account_id === cash,
    )!;
  const evidence = await alice.mutation(api.evidence.create, {
    kind: "statement",
    namespace: "manual",
    content_ref: "attachment:sha256-fixture",
  });
  const statement = await alice.mutation(api.observations.createStatement, {
    financial_account_id: financial,
    evidence_id: evidence,
    period_start: "2026-01-01",
    period_end: "2026-02-01",
    closing: { minor_units: 500000, currency: "USD" },
  });
  const line = await alice.mutation(api.observations.addStatementLine, {
    statement_id: statement,
    external_key: "line1",
    posting_date: "2026-01-01",
    status: "posted",
    minor_units: 500000,
    currency: "USD",
    raw_source_ref: "line:1",
  });
  const observation = await alice.mutation(api.observations.observeBalance, {
    financial_account_id: financial,
    minor_units: 495000,
    currency: "USD",
    source_at: 100,
    kind: "current",
    pending: "unknown",
    evidence_id: evidence,
    raw_source_ref: "source:balance",
  });
  const provisional = await alice.mutation(api.observations.reconcile, {
    financial_account_id: financial,
    observation_id: observation,
  });
  const reconciliation = await alice.mutation(api.observations.reconcile, {
    financial_account_id: financial,
    statement_id: statement,
    cutoff: Date.parse("2026-02-01"),
  });
  await alice.mutation(api.observations.match, {
    reconciliation_id: reconciliation,
    line_id: line,
    posting_id: p._id,
    minor_units: 400000,
    reason: "First portion",
  });
  await expect(
    alice.mutation(api.observations.match, {
      reconciliation_id: reconciliation,
      line_id: line,
      posting_id: p._id,
      minor_units: 200000,
      reason: "Overfill",
    }),
  ).rejects.toThrow("capacity");
  const all = await alice.query(api.observations.list, {
    financialAccountId: financial,
  });
  expect(all.reconciliations.find((x) => x._id === provisional)).toMatchObject({
    state: "provisional",
    discrepancy_minor_units: -5000,
  });
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: cash }))
      .minor_units,
  ).toBe(500000);
});
test("migration reruns preserve original IDs/amounts and produce no duplicates", async () => {
  const { t, userId } = await setup();
  const source = await t.run(async (ctx) => {
    const entity = await ctx.db.insert("entity", {
        user_id: userId,
        kind: "Person",
        display_name: "Legacy owner",
      }),
      arr = await ctx.db.insert("arrangement", {
        user_id: userId,
        kind: "Ownership",
        valid_from: 0,
      }),
      chart = await ctx.db.insert("arrangement", {
        user_id: userId,
        kind: "ChartOfAccounts",
        valid_from: 0,
      });
    await ctx.db.insert("arrangement_role", {
      arrangement_id: arr,
      entity_id: entity,
      role_name: "Owner",
      share_json: '{"unknown":"preserve"}',
    });
    const cash = await ctx.db.insert("ledger_account", {
        user_id: userId,
        coa_arrangement_id: chart,
        name: "Cash",
        type: "Asset",
        normal_balance: "Debit",
        currency: "USD",
      }),
      equity = await ctx.db.insert("ledger_account", {
        user_id: userId,
        coa_arrangement_id: chart,
        name: "Equity",
        type: "Equity",
        normal_balance: "Credit",
        currency: "USD",
      }),
      event = await ctx.db.insert("event", {
        user_id: userId,
        kind: "Opening",
        occurred_at: 0,
        recorded_at: 0,
        payload_json: "{}",
      }),
      je = await ctx.db.insert("journal_entry", {
        user_id: userId,
        event_id: event,
        coa_arrangement_id: chart,
        memo: "Legacy",
        status: "posted",
      });
    const p = await ctx.db.insert("posting", {
      je_id: je,
      account_id: cash,
      amount: 123.45,
      currency: "USD",
      description: "Legacy",
    });
    await ctx.db.insert("posting", {
      je_id: je,
      account_id: equity,
      amount: -123.45,
      currency: "USD",
      description: "Legacy",
    });
    await ctx.db.insert("property", {
      user_id: userId,
      owner_type: "entity",
      owner_id: entity,
      name: "address",
      value_json: '"old"',
      valid_from: 0,
      recorded_at: 1,
    });
    await ctx.db.insert("property", {
      user_id: userId,
      owner_type: "entity",
      owner_id: entity,
      name: "address",
      value_json: '"new"',
      valid_from: 10,
      recorded_at: 20,
    });
    return { entity, arr, chart, cash, p };
  });
  const before = await t.query(internal.migrations.dryRun);
  expect(before.rejects).toEqual([]);
  async function run() {
    for (const stage of before.applyOrder) {
      let cursor: string | undefined;
      do {
        const result = await t.mutation(internal.migrations.applyBatch, {
          stage: stage as "entity",
          cursor,
          limit: 1,
        });
        expect(result.rejects).toEqual([]);
        cursor = result.cursor ?? undefined;
      } while (cursor);
    }
  }
  await run();
  const first = await t.query(internal.migrations.dryRun);
  await run();
  const second = await t.query(internal.migrations.dryRun);
  expect(second.existingMappings).toBe(first.existingMappings);
  expect(second.totals).toEqual(before.totals);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(source.p))!).toMatchObject({
      amount: 123.45,
      minor_units: 12345,
    });
    expect(await ctx.db.query("chart_of_accounts").collect()).toHaveLength(1);
    expect(
      await ctx.db.query("arrangement_role_assignment").collect(),
    ).toHaveLength(1);
    expect(await ctx.db.query("entity_revision").collect()).toHaveLength(1);
    expect(await ctx.db.query("property").collect()).toHaveLength(2);
    expect((await ctx.db.get(source.chart))!.migrated_to?.kind).toBe(
      "chart_of_accounts",
    );
  });
  expect(
    (await t.query(internal.migrations.exportLegacyProperties)).rows,
  ).toHaveLength(2);
});

test("end-boundary corrections reopen intervals without losing earlier knowledge", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const { alice } = await setup();
  const id = await alice.mutation(api.arrangements.create, {
    kind: "Lease",
    name: "Lease",
    valid_from: 0,
    valid_to: 50000,
  });
  vi.setSystemTime(100010);
  await alice.mutation(api.arrangements.update, { id, valid_to: 80000 });
  expect(
    await alice.query(api.arrangements.listValidAt, {
      timestamp: 60000,
      knownAt: 100005,
    }),
  ).toHaveLength(0);
  expect(
    await alice.query(api.arrangements.listValidAt, {
      timestamp: 60000,
      knownAt: 100010,
    }),
  ).toHaveLength(1);
  expect(
    await alice.query(api.arrangements.listValidAt, { timestamp: 80000 }),
  ).toHaveLength(0);
});
test("scheduled parent edges cannot hide a future cycle", async () => {
  const { alice } = await setup();
  const a = await alice.mutation(api.arrangements.create, {
      kind: "Custom",
      valid_from: 0,
    }),
    b = await alice.mutation(api.arrangements.create, {
      kind: "Custom",
      valid_from: 0,
    });
  await alice.mutation(api.arrangements.update, {
    id: a,
    parent_arrangement_id: b,
    effectiveAt: Date.now() + 100000,
  });
  await expect(
    alice.mutation(api.arrangements.update, {
      id: b,
      parent_arrangement_id: a,
      effectiveAt: Date.now() + 100000,
    }),
  ).rejects.toThrow("cycle");
});
test("derived measurements capture immutable input facts and independent appraisals coexist", async () => {
  const { alice } = await setup();
  const house = await alice.mutation(api.entities.create, {
    kind: "House",
    display_name: "Oak",
  });
  const subject = { kind: "entity" as const, id: house };
  const one = await alice.mutation(api.measurements.create, {
    subject,
    name: "Appraisal",
    assertion: "observed",
    value: { decimal: "450000", unit: "USD", currency: "USD" },
    as_of: 0,
  });
  await alice.mutation(api.measurements.create, {
    subject,
    name: "Appraisal",
    assertion: "observed",
    value: { decimal: "470000", unit: "USD", currency: "USD" },
    as_of: 0,
  });
  await alice.mutation(api.measurements.create, {
    subject,
    name: "Derived",
    assertion: "derived",
    value: { decimal: "450000", unit: "USD", currency: "USD" },
    as_of: 0,
    input_references: [{ kind: "measurement", id: one }],
    calculation_version: "fixture-v1",
  });
  await alice.mutation(api.entities.update, {
    id: house,
    display_name: "Renamed",
  });
  const rows = await alice.query(api.measurements.list, {});
  expect(rows).toHaveLength(3);
  expect(rows[2].input_snapshot?.[0].captured).toContain('"decimal":"450000"');
});
test("migration rejects fractional money and unsafe owner references without altering source", async () => {
  const { t, userId } = await setup();
  const seeded = await t.run(async (ctx) => {
    const entity = await ctx.db.insert("entity", {
      user_id: "another-owner",
      kind: "Person",
      display_name: "Foreign",
    });
    const arrangement = await ctx.db.insert("arrangement", {
      user_id: userId,
      kind: "Ownership",
      valid_from: 0,
    });
    const role = await ctx.db.insert("arrangement_role", {
      arrangement_id: arrangement,
      entity_id: entity,
      role_name: "Owner",
    });
    const property = await ctx.db.insert("property", {
      user_id: userId,
      owner_type: "entity",
      owner_id: entity,
      name: "secret",
      value_json: "1",
      valid_from: 0,
      recorded_at: 0,
    });
    return { role, property };
  });
  const audit = await t.query(internal.migrations.dryRun);
  expect(audit.rejects.some((x) => x.id === seeded.role)).toBe(true);
  expect(audit.rejects.some((x) => x.id === seeded.property)).toBe(true);
  const first = await t.mutation(internal.migrations.applyBatch, {
    stage: "arrangement_role",
  });
  const second = await t.mutation(internal.migrations.applyBatch, {
    stage: "arrangement_role",
  });
  expect(first.rejects).toHaveLength(1);
  expect(second.rejects).toHaveLength(1);
  await t.run(async (ctx) => {
    expect(
      await ctx.db.query("arrangement_role_assignment").collect(),
    ).toHaveLength(0);
    expect(await ctx.db.query("migration_issue").collect()).toHaveLength(1);
    expect(await ctx.db.get(seeded.role)).not.toBeNull();
  });
});

test("schedule late correction is half-open, retains both sides and old knowledge", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const { alice } = await setup();
  const creditor = await alice.mutation(api.entities.create, {
      kind: "Person",
      display_name: "Creditor",
    }),
    debtor = await alice.mutation(api.entities.create, {
      kind: "Person",
      display_name: "Debtor",
    });
  const arrangement = await alice.mutation(api.arrangements.create, {
    kind: "Lease",
    valid_from: 0,
  });
  const fields = {
    creditor_id: creditor,
    debtor_id: debtor,
    amount: { minor_units: 200000, currency: "USD" },
    currency: "USD",
    recurrence: { frequency: "monthly" as const, interval: 1 },
    start_date: "2026-01-01",
    timezone: "UTC",
    valid_from: 0,
  };
  const schedule = await alice.mutation(api.obligations.createSchedule, {
    ...fields,
    arrangement_id: arrangement,
    name: "Rent",
  });
  vi.setSystemTime(100010);
  await alice.mutation(api.obligations.reviseSchedule, {
    ...fields,
    id: schedule,
    expectedRevision: 1,
    reason: "Corrected term",
    valid_from: 20,
    valid_to: 30,
    amount: { minor_units: 210000, currency: "USD" },
  });
  expect(
    (
      await alice.query(api.obligations.scheduleAt, {
        id: schedule,
        effectiveAt: 25,
        knownAt: 100005,
      })
    )?.amount?.minor_units,
  ).toBe(200000);
  expect(
    (
      await alice.query(api.obligations.scheduleAt, {
        id: schedule,
        effectiveAt: 25,
      })
    )?.amount?.minor_units,
  ).toBe(210000);
  expect(
    (
      await alice.query(api.obligations.scheduleAt, {
        id: schedule,
        effectiveAt: 19,
      })
    )?.amount?.minor_units,
  ).toBe(200000);
  expect(
    (
      await alice.query(api.obligations.scheduleAt, {
        id: schedule,
        effectiveAt: 30,
      })
    )?.amount?.minor_units,
  ).toBe(200000);
});
test("legacy scalar measurement conversion preserves unknown shapes and source bytes", async () => {
  const { t, userId } = await setup();
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("entity", {
      user_id: userId,
      kind: "House",
      display_name: "Oak",
    });
    const base = {
      user_id: userId,
      owner_type: "entity" as const,
      owner_id: owner,
      name: "Appraisal",
      m_type: "observed" as const,
      as_of: 0,
      recorded_at: 10,
    };
    const known = await ctx.db.insert("measurement", {
        ...base,
        value_json: '{"amount":"450000.00","currency":"USD"}',
      }),
      unknown = await ctx.db.insert("measurement", {
        ...base,
        value_json: '{"recurrence":"unrecognized"}',
      });
    return { known, unknown };
  });
  await t.mutation(internal.migrations.applyBatch, { stage: "measurement" });
  await t.mutation(internal.migrations.applyBatch, { stage: "measurement" });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(ids.known)).toMatchObject({
      value: { decimal: "450000.00", unit: "USD", currency: "USD" },
      value_json: '{"amount":"450000.00","currency":"USD"}',
    });
    expect((await ctx.db.get(ids.unknown))!.value).toBeUndefined();
    expect(await ctx.db.query("evidence_item").collect()).toHaveLength(1);
    expect(await ctx.db.query("migration_issue").collect()).toHaveLength(1);
  });
});

test("full rent receipt gives zero outstanding and exactly 180000 cash after 20000 noncash credit", async () => {
  const { alice, entity, debtor, cash, income, entry } = await fixture();
  const obligation = await alice.mutation(api.obligations.create, {
    creditor_id: entity,
    debtor_id: debtor,
    due_date: "2026-01-01",
    minor_units: 200000,
    currency: "USD",
  });
  await alice.mutation(api.obligations.adjust, {
    obligationId: obligation,
    minor_units: -20000,
    effective_date: "2026-01-01",
    reason: "Unrecognized repair credit",
  });
  const receipt = await entry([
      { accountId: cash, minor_units: 180000 },
      { accountId: income, minor_units: -180000 },
    ]),
    p = (await alice.query(api.finance.getPostings, { jeId: receipt })).find(
      (x) => x.account_id === cash,
    )!;
  await alice.mutation(api.obligations.settle, {
    obligationId: obligation,
    capacityPostingId: p._id,
    minor_units: 180000,
    settlement_date: "2026-01-01",
  });
  expect((await alice.query(api.obligations.list, {}))[0]).toMatchObject({
    outstanding_minor_units: 0,
    settled_minor_units: 180000,
    approved_minor_units: 180000,
  });
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: cash }))
      .minor_units,
  ).toBe(180000);
});
test("ownership shares reject over-allocation only in overlapping basis periods", async () => {
  const { alice, entity, debtor, house, arrangement } = await fixture();
  const base = {
    asset_entity_id: house,
    arrangement_id: arrangement,
    basis: "legal title",
  };
  await alice.mutation(api.arrangements.createOwnershipInterest, {
    ...base,
    owner_entity_id: entity,
    share_bps: 6000,
    valid_from: 0,
    valid_to: 10,
  });
  await expect(
    alice.mutation(api.arrangements.createOwnershipInterest, {
      ...base,
      owner_entity_id: debtor,
      share_bps: 5000,
      valid_from: 5,
      valid_to: 15,
    }),
  ).rejects.toThrow("exceed");
  await alice.mutation(api.arrangements.createOwnershipInterest, {
    ...base,
    owner_entity_id: debtor,
    share_bps: 10000,
    valid_from: 10,
  });
});
test("attributions reject opposite signs, incomplete beneficiaries and foreign entities", async () => {
  const { alice, bob, cash, equity, entry } = await fixture();
  const journal = await entry([
    { accountId: cash, minor_units: 100 },
    { accountId: equity, minor_units: -100 },
  ]);
  const p = (
    await alice.query(api.finance.getPostings, { jeId: journal })
  ).find((x) => x.account_id === cash)!;
  const base = { postingId: p._id, expectedRevision: 1 };
  await expect(
    alice.mutation(api.finance.replaceAttribution, {
      ...base,
      portions: [
        {
          minor_units: 120,
          unclassified: true,
          beneficiaries: [{ unassigned: true, share_bps: 10000 }],
        },
        {
          minor_units: -20,
          unclassified: true,
          beneficiaries: [{ unassigned: true, share_bps: 10000 }],
        },
      ],
    }),
  ).rejects.toThrow("partition");
  await expect(
    alice.mutation(api.finance.replaceAttribution, {
      ...base,
      portions: [
        {
          minor_units: 100,
          unclassified: true,
          beneficiaries: [{ unassigned: true, share_bps: 9000 }],
        },
      ],
    }),
  ).rejects.toThrow("10000");
  const foreign = await bob.mutation(api.entities.create, {
    kind: "Person",
    display_name: "Foreign",
  });
  await expect(
    alice.mutation(api.finance.replaceAttribution, {
      ...base,
      portions: [
        {
          minor_units: 100,
          unclassified: false,
          subject_entity_id: foreign,
          beneficiaries: [{ unassigned: true, share_bps: 10000 }],
        },
      ],
    }),
  ).rejects.toThrow("access denied");
  expect(
    (await alice.query(api.finance.getAttribution, { postingId: p._id }))?.set
      .revision,
  ).toBe(1);
});

test("explicit legacy recurrence migrates once to a schedule with source evidence", async () => {
  const { t, alice, userId } = await setup();
  const creditor = await alice.mutation(api.entities.create, {
      kind: "Person",
      display_name: "Creditor",
    }),
    debtor = await alice.mutation(api.entities.create, {
      kind: "Person",
      display_name: "Debtor",
    }),
    arrangement = await alice.mutation(api.arrangements.create, {
      kind: "Tenancy",
      valid_from: 0,
    });
  const payload = JSON.stringify({
    kind: "schedule",
    creditor_id: creditor,
    debtor_id: debtor,
    amount: { minor_units: 200000, currency: "USD" },
    currency: "USD",
    recurrence: { frequency: "monthly", interval: 1 },
    start_date: "2026-01-01",
    timezone: "UTC",
    valid_from: 0,
  });
  const id = await t.run(async (ctx) =>
    ctx.db.insert("measurement", {
      user_id: userId,
      owner_type: "arrangement",
      owner_id: arrangement,
      name: "Legacy rent rule",
      m_type: "expected",
      value_json: payload,
      as_of: 0,
      recorded_at: 0,
    }),
  );
  expect(
    (await t.mutation(internal.migrations.applyBatch, { stage: "measurement" }))
      .rejects,
  ).toEqual([]);
  expect(
    (await t.mutation(internal.migrations.applyBatch, { stage: "measurement" }))
      .skipped,
  ).toBe(1);
  const schedules = await alice.query(api.obligations.listSchedules, {});
  expect(schedules).toHaveLength(1);
  expect(schedules[0].versions[0].amount?.minor_units).toBe(200000);
  expect(await alice.query(api.measurements.list, {})).toEqual([]);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(id))!.value_json).toBe(payload);
    expect(await ctx.db.query("evidence_item").collect()).toHaveLength(1);
  });
});

test("reconciliation uses occurrence instants rather than coercing accounting dates", async () => {
  const { alice, chart, cash, equity, financial } = await fixture();
  const event = await alice.mutation(api.events.create, {
    kind: "Deposit",
    occurred_at: 200,
  });
  await alice.mutation(api.finance.createJournalEntry, {
    chartId: chart,
    eventId: event,
    memo: "Deposit",
    accounting_date: "1970-01-01",
    postings: [
      {
        accountId: cash,
        minor_units: 100,
        currency: "USD",
        description: "Cash",
      },
      {
        accountId: equity,
        minor_units: -100,
        currency: "USD",
        description: "Equity",
      },
    ],
  });
  const evidence = await alice.mutation(api.evidence.create, {
    kind: "balance",
    namespace: "manual",
    content_ref: "source:before-deposit",
  });
  const observation = await alice.mutation(api.observations.observeBalance, {
    financial_account_id: financial,
    minor_units: 0,
    currency: "USD",
    source_at: 100,
    cutoff: 100,
    kind: "current",
    pending: "excluded",
    evidence_id: evidence,
    raw_source_ref: "balance:100",
  });
  await alice.mutation(api.observations.reconcile, {
    financial_account_id: financial,
    observation_id: observation,
    accept: true,
  });
  expect(
    (
      await alice.query(api.observations.list, {
        financialAccountId: financial,
      })
    ).reconciliations[0],
  ).toMatchObject({ ledger_minor_units: 0, state: "accepted" });
});
