/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { entityContribution } from "../lib/insights/cash-projection";
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { api, components, internal } from "../convex/_generated/api";
import {
  accountTotals,
  balances,
  buckets,
  filteredFlows,
} from "../lib/insights/analytics";
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
      client: t.withIdentity({ subject: user._id, sessionId: session._id }),
      userId: user._id,
    };
  }
  const alice = await login("alice@example.test"),
    bob = await login("bob@example.test");
  return {
    t,
    alice: alice.client,
    bob: bob.client,
    userId: alice.userId,
    bobId: bob.userId,
  };
}
test("observatory snapshot is authenticated, isolated, and reconciles to the family sample", async () => {
  const { t, alice, bob, userId } = await setup();
  const live = await alice.mutation(api.datasets.initialize, {});
  await alice.mutation(api.entities.create, {
    datasetId: live,
    kind: "Person",
    display_name: "Only Live",
  });
  const datasetId = await alice.mutation(api.sampleData.prepare, {});
  for (let monthIndex = 0; monthIndex < 9; monthIndex++)
    await alice.mutation(api.sampleData.populateMonth, {
      datasetId,
      monthIndex,
    });
  const data = await alice.query(api.insights.snapshot, { datasetId });
  expect(data.entities.some((e) => e.name === "Only Live")).toBe(false);
  expect(data.postings.length).toBeGreaterThan(500);
  expect(data.accounts.length).toBeGreaterThan(20);
  expect(data.schedules.length).toBeGreaterThan(5);
  expect(data.measurements.length).toBeGreaterThan(5);
  expect(data.ownership.length).toBeGreaterThan(0);
  expect(
    data.flows
      .filter((f) => f.amount < 0)
      .map((f) => f.amount)
      .sort((a, b) => a - b),
  ).toEqual([-3000000, -1500000]);
  expect(data.flows.some((f) => f.amount > 0)).toBe(true);
  const f = {
    start: "2026-01-01",
    end: "2026-09-16",
    currency: "USD",
    chart: "",
    entity: "",
    tag: "",
  };
  const remodel = data.tags.find((t) => t.name === "Cedar Lane remodel")!;
  const projectScope = { ...f, tag: remodel.id };
  expect(accountTotals(data, projectScope, "Expense")).toEqual([]);
  expect(
    filteredFlows(data, projectScope)
      .map((f) => f.amount)
      .sort((a, b) => a - b),
  ).toEqual([-3000000, -1500000]);
  const balance = balances(data, f);
  // Every account type together forms a balanced double-entry trial balance.
  expect(balance.reduce((s, a) => s + a.raw, 0)).toBe(0);
  const periods = buckets(data, f);
  const last = periods.at(-1)!;
  expect(last.worth).toBe(
    balance.filter((a) => a.type === "Asset").reduce((s, a) => s + a.value, 0) -
      balance
        .filter((a) => a.type === "Liability")
        .reduce((s, a) => s + a.value, 0),
  );
  expect(
    data.postings.every(
      (p) => p.portions.reduce((s, a) => s + a.amount, 0) === p.amount,
    ),
  ).toBe(true);
  // Migration enriches classifications and payment instructions, never monetary history.
  expect(data.cashRoutes).toHaveLength(8);
  const contributions = entityContribution(data, { ...f, basis: "accrual" });
  const cashContributions = entityContribution(data, { ...f, basis: "cash" });
  expect(
    contributions.rows.some((r) => /Alex/.test(r.name) && r.income > 0),
  ).toBe(true);
  expect(
    contributions.rows.some((r) => /Emma/.test(r.name) && r.expense > 0),
  ).toBe(true);
  expect(
    contributions.rows.some((r) => /Civic/.test(r.name) && r.expense > 0),
  ).toBe(true);
  expect(
    contributions.rows.some(
      (r) => /Oak/.test(r.name) && r.income > 0 && r.expense > 0,
    ),
  ).toBe(true);
  expect(
    cashContributions.rows.some(
      (r) => /Oak/.test(r.name) && r.income > 0 && r.expense > 0,
    ),
  ).toBe(true);
  expect(
    await t.mutation(internal.sampleData.enhanceForOwner, {
      userId,
      datasetId,
    }),
  ).toEqual({ alreadyApplied: true, updatedPostings: 0, routes: 0 });
  await expect(
    t.mutation(internal.sampleData.enhanceForOwner, {
      userId,
      datasetId: live,
    }),
  ).rejects.toThrow();
  const route = data.cashRoutes!.find((r) => r.days?.length)!;
  const source = {
    kind: "commitment_schedule" as const,
    id: route.source as import("../convex/_generated/dataModel").Id<"commitment_schedule">,
  };
  const incoming =
    route.to as import("../convex/_generated/dataModel").Id<"ledger_account">;
  const routingArgs = {
    datasetId,
    source,
    to_account_id: incoming,
    cash_minor_units: 910000,
    monthly_days: [15, 28],
    expectedRevision: route.revision,
  };
  await expect(
    bob.mutation(api.cashRouting.save, routingArgs),
  ).rejects.toThrow();
  await expect(
    alice.mutation(api.cashRouting.save, { ...routingArgs, datasetId: live }),
  ).rejects.toThrow();
  await expect(t.mutation(api.cashRouting.save, routingArgs)).rejects.toThrow();
  await expect(
    alice.mutation(api.cashRouting.save, {
      ...routingArgs,
      from_account_id: incoming,
    }),
  ).rejects.toThrow(/must differ/);
  await expect(
    alice.mutation(api.cashRouting.save, {
      ...routingArgs,
      monthly_days: [15, 15],
    }),
  ).rejects.toThrow(/distinct/);
  const expense = data.accounts.find((a) => a.type === "Expense")!;
  await expect(
    alice.mutation(api.cashRouting.save, {
      ...routingArgs,
      to_account_id: expense.id as typeof incoming,
    }),
  ).rejects.toThrow(/bank/);
  const invalidBanks = await t.run(async (ctx) => {
    const bank = (await ctx.db.get(incoming))!;
    const mapping = (await ctx.db
      .query("financial_account")
      .withIndex("by_ledger", (q) => q.eq("ledger_account_id", incoming))
      .first())!;
    const { _id, _creationTime, ...facts } = bank;
    const euro = await ctx.db.insert("ledger_account", {
      ...facts,
      currency: "EUR",
    });
    const { _id: mid, _creationTime: mt, ...mapFacts } = mapping;
    await ctx.db.insert("financial_account", {
      ...mapFacts,
      ledger_account_id: euro,
      currency: "EUR",
    });
    const otherDataset = await ctx.db.insert("ledger_account", {
      ...facts,
      dataset_id: live,
    });
    return { euro, otherDataset };
  });
  for (const to_account_id of Object.values(invalidBanks))
    await expect(
      alice.mutation(api.cashRouting.save, { ...routingArgs, to_account_id }),
    ).rejects.toThrow();
  const claim = data.obligations.find((o) => o.amount > 0)!;
  await expect(
    alice.mutation(api.cashRouting.save, {
      ...routingArgs,
      source: {
        kind: "monetary_obligation",
        id: claim.id as import("../convex/_generated/dataModel").Id<"monetary_obligation">,
      },
      expectedRevision: 0,
    }),
  ).rejects.toThrow(/cannot be overridden/);
  await alice.mutation(api.cashRouting.save, routingArgs);
  await expect(
    alice.mutation(api.cashRouting.save, routingArgs),
  ).rejects.toThrow(/changed/);
  const afterRoute = await alice.query(api.insights.snapshot, { datasetId });
  expect(afterRoute.postings).toEqual(data.postings);
  expect(afterRoute.obligations).toEqual(data.obligations);
  const liveSnapshot = await alice.query(api.insights.snapshot, {
    datasetId: live,
  });
  expect(liveSnapshot.entities.map((e) => e.name)).toEqual(["Only Live"]);
  expect(liveSnapshot.postings).toEqual([]);
  await expect(bob.query(api.insights.snapshot, { datasetId })).rejects.toThrow(
    /access denied/,
  );
  await expect(t.query(api.insights.snapshot, { datasetId })).rejects.toThrow();
  // Optional fixture export for an isolated browser-rendering test. Never a live database read.
  if (process.env.INSIGHTS_FIXTURE_PATH) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.INSIGHTS_FIXTURE_PATH, JSON.stringify(data));
  }
}, 120000);
test("snapshot excludes draft financial activity and superseded, archived or voided observations", async () => {
  const { t, alice, userId } = await setup();
  const datasetId = await alice.mutation(api.datasets.initialize, {});
  const person = await alice.mutation(api.entities.create, {
    datasetId,
    kind: "Person",
    display_name: "Alex",
  });
  const ids = await t.run(async (ctx) => {
    const base = {
      user_id: userId,
      dataset_id: datasetId,
      created_at: Date.now(),
    };
    const event = await ctx.db.insert("event", {
      ...base,
      kind: "Visit",
      title: "Old title",
      occurred_at: Date.now(),
      recorded_at: Date.now(),
      payload_json: "{}",
    });
    const replacement = await ctx.db.insert("event", {
      ...base,
      kind: "Visit",
      title: "Corrected visit",
      occurred_at: Date.now(),
      recorded_at: Date.now(),
      payload_json: "{}",
      corrects_id: event,
    });
    await ctx.db.insert("event", {
      ...base,
      kind: "Visit",
      occurred_at: Date.now(),
      recorded_at: Date.now(),
      payload_json: "{}",
      voided_at: Date.now(),
    });
    const m = await ctx.db.insert("measurement", {
      ...base,
      subject: { kind: "entity", id: person },
      name: "Height",
      m_type: "observed",
      value: { decimal: "160", unit: "cm" },
      as_of: Date.now(),
      recorded_at: Date.now(),
    });
    const corrected = await ctx.db.insert("measurement", {
      ...base,
      subject: { kind: "entity", id: person },
      name: "Height",
      m_type: "observed",
      value: { decimal: "161", unit: "cm" },
      as_of: Date.now(),
      recorded_at: Date.now(),
      corrects_id: m,
    });
    const chart = await ctx.db.insert("chart_of_accounts", {
      ...base,
      name: "Home",
    });
    const account = await ctx.db.insert("ledger_account", {
      ...base,
      chart_id: chart,
      name: "Cash",
      type: "Asset",
      normal_balance: "Debit",
      currency: "USD",
    });
    const journal = await ctx.db.insert("journal_entry", {
      ...base,
      chart_id: chart,
      event_id: replacement,
      memo: "Draft",
      status: "draft",
    });
    await ctx.db.insert("posting", {
      user_id: userId,
      dataset_id: datasetId,
      je_id: journal,
      account_id: account,
      minor_units: 500,
      currency: "USD",
      description: "Draft",
    });
    return { replacement, corrected };
  });
  const data = await alice.query(api.insights.snapshot, { datasetId });
  expect(data.events.map((e) => e.id)).toEqual([ids.replacement]);
  expect(data.measurements.map((m) => [m.id, m.value])).toEqual([
    [ids.corrected, 161],
  ]);
  expect(data.postings).toEqual([]);
  expect(data.coverage.draftJournals).toBe(1);
});
