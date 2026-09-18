/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { api, components } from "../convex/_generated/api";
import { collectFinance } from "../lib/life-reports/finance";
const modules = import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js"]);
const authModules = import.meta.glob(
  "../node_modules/@convex-dev/better-auth/src/component/**/*.ts",
);
const t = convexTest(schema, modules);
t.registerComponent("betterAuth", authSchema, authModules);
let alice: ReturnType<typeof t.withIdentity>, datasetId: string;
const ref = (name: string) => makeFunctionReference<"query">(name);
beforeAll(async () => {
  const now = Date.now(),
    u = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Life query test",
          email: "life-query@example.invalid",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  const s = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: {
        userId: u._id,
        token: "query-test",
        expiresAt: now + 86400000,
        createdAt: now,
        updatedAt: now,
      },
    },
  });
  alice = t.withIdentity({ subject: u._id, sessionId: s._id });
  datasetId = await alice.mutation(api.sampleData.prepare, {});
  for (let monthIndex = 0; monthIndex < 9; monthIndex++)
    await alice.mutation(api.sampleData.populateMonth, {
      datasetId: datasetId as never,
      monthIndex,
    });
}, 120000);
const query = (name: string, args: Record<string, unknown> = {}) =>
  alice.query(ref(name), { datasetId, ...args });
test("context identifies the sample by metadata, uses local calendar and resolves household", async () => {
  const c = await query("agentLife:context");
  expect(c.timezone).toBe("America/Chicago");
  expect(c.defaultHousehold.name).toBe("Morgan family");
  expect(c.sampleActualsThrough).toBeTruthy();
  const financial = await query("agentFinance:summary", { scope: "household", metric: "income", from: "2026-08-01", through: "2026-08-31" });
  expect(financial.versioned).toBe(true);
});
test("upcoming month excludes settled claims, deduplicates remodel, and retains overdue due date", async () => {
  const r = await query("agentTimeline:timeline", {
    from: "2026-09-17",
    through: "2026-09-30",
    limit: 50,
  });
  expect(r.queryComplete).toBe(true);
  expect(r.nextOffset).toBeNull();
  const amount = (n: string) => r.items.filter((i: any) => i.amount === n);
  expect(amount("15000.00")).toHaveLength(1);
  expect(amount("30000.00")).toHaveLength(0);
  expect(amount("700.00")).toHaveLength(1);
  expect(amount("700.00")[0]).toMatchObject({
    date: "2026-09-20",
    dueDate: "2026-09-01",
  });
  expect(amount("4550.00")).toHaveLength(1);
  expect(amount("4550.00")[0].date).toBe("2026-09-28");
  expect(r.items.every((i: any) => i.status !== "settled")).toBe(true);
  expect(JSON.stringify(r).length).toBeLessThan(10000);
});
test("due filters retain claims with linked cash expectations and expected filters include scheduled receipts", async () => {
  const bills = await query("agentTimeline:timeline", { from: "2026-09-18", through: "2026-09-30", status: "due", direction: "outflow", includeEvents: false });
  expect(bills.items).toHaveLength(1);
  expect(bills.items[0]).toMatchObject({ amount: "15000.00", status: "due", dueDate: "2026-09-30", kind: "obligation" });
  const receipts = await query("agentTimeline:timeline", { from: "2026-09-18", through: "2026-09-30", status: "expected", direction: "inflow", includeEvents: false });
  expect(receipts.items.map((r: any) => r.amount).sort()).toEqual(["4550.00", "700.00"]);
  expect(receipts.items.find((r: any) => r.amount === "700.00").status).toBe("overdue");
  const due = await query("agentTimeline:timeline", { from: "2026-09-18", through: "2026-09-30", status: "due", includeEvents: false });
  expect(due.items.map((r: any) => r.amount).sort()).toEqual(["15000.00", "700.00"]);
  const tenant = (await query("agentLife:search", { query: "Casey Chen", kind: "entity" })).items[0].id;
  const tenantDue = await query("agentTimeline:timeline", { from: "2026-09-18", through: "2026-09-30", entityId: tenant, perspectiveId: tenant, direction: "outflow", includeEvents: false });
  expect(tenantDue.items).toHaveLength(1);
  expect(tenantDue.items[0].amount).toBe("700.00");
  const householdReceipt = await query("agentTimeline:timeline", { entityId: tenant, direction: "inflow", status: "due", query: "Maple Avenue rent", from: "2026-09-18", through: "2026-09-30" });
  expect(householdReceipt.items).toHaveLength(1);
  expect(householdReceipt.items[0]).toMatchObject({ amount: "700.00", dueDate: "2026-09-01", direction: "inflow" });
  expect(householdReceipt.filters.perspective).toBe("Morgan family");
});
test("a partial cash expectation must not shrink the reported unpaid debt", async () => {
  const all = await query("agentTimeline:timeline", { from: "2026-09-18", through: "2026-09-30", direction: "outflow", includeEvents: false });
  const flowId = all.items.find((i: any) => i.amount === "15000.00").id as import("../convex/_generated/dataModel").Id<"expected_flow">;
  const before = await t.run(ctx => ctx.db.get(flowId));
  await t.run(ctx => ctx.db.patch(flowId, { minor_units: -500000 }));
  try {
    const due = await query("agentTimeline:timeline", { from: "2026-09-18", through: "2026-09-30", status: "due", direction: "outflow", includeEvents: false });
    expect(due.items).toHaveLength(1);
    expect(due.items[0].amount).toBe("15000.00");
    const expected = await query("agentTimeline:timeline", { from: "2026-09-18", through: "2026-09-30", status: "expected", direction: "outflow", includeEvents: false });
    expect(expected.items[0]).toMatchObject({ amount: "5000.00", outstandingAmount: "15000.00" });
  } finally { await t.run(ctx => ctx.db.patch(flowId, { minor_units: before!.minor_units })); }
});
test("project ledger totals include capital costs and cash payments separately, not expenses", async () => {
  const search = await query("agentLife:search", {
    query: "Cedar Lane remodel",
    kind: "tag",
  });
  expect(search.identityStatus).toBe("unique");
  const args = {
    from: "2026-01-01",
    through: "2026-09-16",
    groupBy: "total",
    tagId: search.items[0].id,
  };
  const report = await collectFinance((cursor) =>
    query("agentFinance:summary", {
      ...args,
      metric: "activity",
      ...(cursor ? { cursor } : {}),
    }),
  );
  expect(report.examinedCells).toBeGreaterThan(0);
  expect(report.queryComplete).toBe(true);
  expect(
    report.rows
      .filter((r) => r.account.toLowerCase().includes("improvement"))
      .reduce((n, r) => n + r.minorUnits, 0),
  ).toBe(5500000);
  expect(
    report.rows.filter((r) => r.cash).reduce((n, r) => n + r.minorUnits, 0),
  ).toBe(-4000000);
  const expense = await collectFinance((cursor) =>
    query("agentFinance:summary", {
      ...args,
      metric: "expenses",
      ...(cursor ? { cursor } : {}),
    }),
  );
  expect(expense.rows).toEqual([]);
}, 120000);
test("historical project debt excludes later payments and explicitly marks undated claims unknown", async () => {
  const tagId = (await query("agentLife:search", { query: "Cedar Lane remodel", kind: "tag" })).items[0].id;
  const beforeInvoice = await query("agentPlanning:project", { tagId, asOf: "2026-09-09" });
  expect(beforeInvoice.obligations).toEqual([]);
  const beforePayment = await query("agentPlanning:project", { tagId, asOf: "2026-09-11" });
  expect(beforePayment.obligations).toHaveLength(1);
  expect(beforePayment.obligations[0]).toMatchObject({ amount: "30000.00", recognitionDate: "2026-09-10", historicalState: "known" });
  const afterPayment = await query("agentPlanning:project", { tagId, asOf: "2026-09-12" });
  expect(afterPayment.obligations[0].amount).toBe("15000.00");
  const unknownId = await t.run(async ctx => {
    const claim = await ctx.db.get(beforePayment.obligations[0].id as import("../convex/_generated/dataModel").Id<"monetary_obligation">);
    if (!claim) throw new Error("Missing fixture claim");
    return ctx.db.insert("monetary_obligation", { user_id: claim.user_id, dataset_id: claim.dataset_id,
      created_at: Date.now(), creditor_id: claim.creditor_id, debtor_id: claim.debtor_id,
      arrangement_id: claim.arrangement_id, original_minor_units: 1000, currency: "USD", due_date: "2026-09-30" });
  });
  try {
    const incomplete = await query("agentPlanning:project", { tagId, asOf: "2026-09-11" });
    expect(incomplete.obligations.find((o: any) => o.id === unknownId)).toMatchObject({ amount: null, historicalState: "unknown" });
  } finally { await t.run(ctx => ctx.db.delete(unknownId)); }
});
test("financial reducers reject changing data and non-progress rather than publish incomplete totals", async () => {
  const p = {
    revision: 1,
    rows: [],
    nextCursor: "again",
    examinedJournals: 100,
    warnings: [],
    queryComplete: false,
    datasetCompleteness: "unknown",
    from: "2026-01-01",
    through: "2026-09-30",
  };
  let calls = 0;
  await expect(
    collectFinance(async () => ({ ...p, revision: ++calls })),
  ).rejects.toThrow("DATA_CHANGED");
  await expect(collectFinance(async () => p)).rejects.toThrow("no progress");
  await expect(
    collectFinance(async () => ({ ...p, nextCursor: null })),
  ).rejects.toThrow("Incomplete");
});

test("indexed financial answers reconcile to source scans across filters and account types", async () => {
  const alex = (
    await query("agentLife:search", { query: "Alex", kind: "entity" })
  ).items[0].id;
  for (const scope of [{}, { entityId: alex }])
    for (const metric of [
      "income",
      "expenses",
      "balances",
      "cash_balances",
      "activity",
    ]) {
      const args = {
        from: "2026-06-01",
        through: "2026-08-31",
        metric,
        ...scope,
      };
      const indexed = await collectFinance((cursor) =>
        query("agentFinance:summary", {
          ...args,
          ...(cursor ? { cursor } : {}),
        }),
      );
      await t.run((ctx) =>
        ctx.db.patch(datasetId as never, { report_index_ready: false }),
      );
      let raw;
      try {
        raw = await collectFinance((cursor) =>
          query("agentFinance:summary", {
            ...args,
            ...(cursor ? { cursor } : {}),
          }),
        );
      } finally {
        await t.run((ctx) =>
          ctx.db.patch(datasetId as never, { report_index_ready: true }),
        );
      }
      const amounts = (r: typeof indexed) =>
        r.rows.map(({ key, minorUnits }) => ({ key, minorUnits }));
      expect(amounts(indexed)).toEqual(amounts(raw!));
    }
}, 120000);

test("household and category filters cannot silently include company books", async () => {
  const groceries = await collectFinance((cursor) =>
    query("agentFinance:summary", {
      scope: "household",
      accountQuery: "groceries household supplies",
      from: "2026-07-01",
      through: "2026-07-31",
      metric: "expenses",
      groupBy: "total",
      ...(cursor ? { cursor } : {}),
    }),
  );
  expect(groceries.rows).toHaveLength(1);
  expect(groceries.rows[0].minorUnits).toBe(104600);
  const household = await collectFinance((cursor) =>
    query("agentFinance:summary", {
      scope: "household",
      from: "2026-08-01",
      through: "2026-08-31",
      metric: "expenses",
      groupBy: "total",
      ...(cursor ? { cursor } : {}),
    }),
  );
  expect(household.rows.reduce((sum, r) => sum + r.minorUnits, 0)).toBe(
    1501392,
  );
  expect(household.rows.some((r) => r.account.includes("subcontractors"))).toBe(
    false,
  );
  const none = await collectFinance((cursor) =>
    query("agentFinance:summary", {
      scope: "household",
      currency: "EUR",
      from: "2026-07-01",
      through: "2026-07-31",
      metric: "expenses",
      ...(cursor ? { cursor } : {}),
    }),
  );
  expect(none.rows).toEqual([]);
});


test("focused relationship results include verified counterpart roles and honor local civil dates", async () => {
  const alex = (await query("agentLife:search", { query: "Alex", kind: "entity" })).items[0].id;
  const result = await query("agentLife:relationships", { entityId: alex, role: "Owner", arrangementQuery: "Morgan Software", asOf: "2026-09-18" });
  expect(result.asOf).toBe("2026-09-19T04:59:59.999Z");
  expect(result.itemsComplete).toBe(true);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].role).toBe("Owner");
  expect(result.filters).toMatchObject({entity:"Alex Morgan",roleWords:"Owner",arrangementWords:"Morgan Software"});
  expect(result.coverage).toContain("filtered result is not a complete ownership");
  const owners = await query("agentLife:relationships", {role:"Owner",asOf:"2026-09-18"});
  expect(owners.items.some((r: any) => r.kind === "role" && r.entity.name === "Jamie Morgan")).toBe(true);
  expect(result.items[0].participantsComplete).toBe(true);
  expect(result.items[0].participants.some((p: any) => p.entity.name === "Morgan Software LLC")).toBe(true);
  const cars = await query("agentLife:search", { query: "", kind: "entity", entityType: "Car" });
  expect(cars.items.map((r: any) => r.name).sort()).toEqual(["2016 Subaru Outback", "2018 Honda Civic", "2022 Toyota Highlander"]);
});


test("as-of measurements search all history without guessed start dates and name their subjects", async () => {
  const found = await query("agentLife:measurements", { through: "2026-09-16", query: "principal", limit: 50 });
  expect(found.queryComplete).toBe(true);
  expect(found.items.length).toBeGreaterThan(0);
  expect(found.items.every((m: any) => m.subject.name && m.assertion === "contractual")).toBe(true);
  const empty = await query("agentLife:measurements", { through: "2026-09-16", query: "valuation", limit: 50 });
  expect(empty.items).toEqual([]);
  expect(empty.queryComplete).toBe(true);
  expect(empty.filter.from).toBe("all recorded history");
});

test("current-debt lookup resolves creditor and debtor directly, without timeline bounds or forecast double counting", async () => {
  const due = await query("agentObligations:current", {scope:"household",debtorQuery:"Casey Chen",query:"Maple rent"});
  expect(due.items).toHaveLength(1);
  expect(due.items[0]).toMatchObject({debtor:"Casey Chen",creditor:"Morgan family",amount:"700.00",dueDate:"2026-09-01"});
  expect(due.totals[0]).toMatchObject({amount:"700.00",claimCount:1});
  const contractor = await query("agentObligations:current", {scope:"household",creditorQuery:"Cedar Craft"});
  expect(contractor.items).toHaveLength(1);
  expect(contractor.items[0]).toMatchObject({debtor:"Morgan family",amount:"15000.00",dueDate:"2026-09-30"});
  expect(contractor.items.every((r: any) => r.amount !== "30000.00")).toBe(true);
  expect(contractor.relatedPlanned).toHaveLength(1);
  expect(contractor.relatedPlanned[0]).toMatchObject({project:"Cedar Lane remodel",signedCash:"-30000.00",date:"2026-11-15"});
  expect(contractor.relatedPlanningComplete).toBe(true);
  expect(contractor.totals[0].amount).toBe("15000.00");
  expect(due.relatedPlanned).toEqual([]);
  await expect(query("agentObligations:current", {scope:"dataset",partyQuery:"Morgan"})).rejects.toThrow("matches");
  const cutoff = await query("agentObligations:current", {scope:"household",creditorQuery:"Cedar Craft",dueThrough:"2026-09-01"});
  expect(cutoff.items).toEqual([]);
  const tenant = (await query("agentLife:search", {query:"Casey Chen",kind:"entity"})).items[0].id;
  const household = (await query("agentLife:context")).defaultHousehold.id;
  const future = await alice.mutation(api.obligations.create, {datasetId:datasetId as never,debtor_id:tenant,creditor_id:household,due_date:"2028-01-15",minor_units:12345,currency:"USD"});
  try {
    const allDates = await query("agentObligations:current", {scope:"household",debtorQuery:"Casey Chen"});
    expect(allDates.items.some((r: any) => r.id === future && r.amount === "123.45")).toBe(true);
    expect(allDates.totals[0].amount).toBe("823.45");
    const beforeFuture = await query("agentObligations:current", {scope:"household",debtorQuery:"Casey Chen",dueThrough:"2026-12-31"});
    expect(beforeFuture.totals[0].amount).toBe("700.00");
  } finally {
    await t.run(async ctx => {
      await ctx.db.delete(future);
      const states = await ctx.db.query("agent_obligation_state").collect();
      for (const row of states.filter(s => s.obligation_id === future)) await ctx.db.delete(row._id);
    });
  }
});

test("financial timeline filters skip unrelated event scans even when calendar coverage would exceed its budget", async () => {
  const ids = await t.run(async ctx => {
    const original = await ctx.db.query("event").first();
    if (!original) throw new Error("Missing sample event");
    const {_id, _creationTime, ...fields} = original;
    const ids = [];
    for (let i=0;i<501;i++) ids.push(await ctx.db.insert("event", {...fields, dataset_id:datasetId as never,kind:"UnrelatedHistory",occurred_at:Date.parse("2026-09-20T12:00:00Z")}));
    return ids;
  });
  try {
    const due = await query("agentTimeline:timeline", {from:"2026-09-18",through:"2026-09-30",status:"due"});
    expect(due.queryComplete).toBe(true);
    expect(due.coverage.events).toBe("excluded_by_request_or_financial_filter");
    expect(due.items.map((r:any)=>r.amount).sort()).toEqual(["15000.00","700.00"]);
    const broad = await query("agentTimeline:timeline", {from:"2026-09-18",through:"2026-09-30"});
    expect(broad.queryComplete).toBe(false);
  } finally { await t.run(async ctx => {for (const id of ids) await ctx.db.delete(id);}); }
});


test("current claims require a named perspective for dataset directions and separate both household sides", async () => {
  const household = (await query("agentLife:context")).defaultHousehold.id;
  const contractor = (await query("agentLife:search", { query: "Cedar Craft", kind: "entity" })).items[0].id;
  const extra = await alice.mutation(api.obligations.create, { datasetId: datasetId as never, debtor_id: household, creditor_id: contractor, due_date: "2026-09-10", minor_units: 55555, currency: "USD" });
  try {
    const receivable = await query("agentObligations:current", { scope: "household", direction: "receivable" });
    expect(receivable.items).toHaveLength(1);
    expect(receivable.items[0]).toMatchObject({ debtor: "Casey Chen", creditor: "Morgan family", amount: "700.00" });
    const payable = await query("agentObligations:current", { scope: "household", direction: "payable" });
    expect(payable.items).toHaveLength(2);
    expect(payable.items.every((r: any) => r.debtor === "Morgan family")).toBe(true);
    expect(payable.items.map((r: any) => r.amount).sort()).toEqual(["15000.00", "555.55"]);
    expect(payable.filters).toMatchObject({ direction: "payable", perspective: "Morgan family" });
    const both = await query("agentObligations:current", { scope: "household", direction: "both" });
    expect(both.items).toHaveLength(3);
    const tenant = await query("agentObligations:current", { scope: "dataset", direction: "payable", perspectiveQuery: "Casey Chen" });
    expect(tenant.items).toHaveLength(1);
    expect(tenant.items[0]).toMatchObject({ debtor: "Casey Chen", amount: "700.00" });
    await expect(query("agentObligations:current", { scope: "dataset", direction: "payable" })).rejects.toThrow("perspectiveQuery");
    await expect(query("agentObligations:current", { scope: "dataset", direction: "receivable", perspectiveQuery: "Morgan" })).rejects.toThrow("matches");
  } finally {
    await t.run(async ctx => {
      await ctx.db.delete(extra);
      const states = await ctx.db.query("agent_obligation_state").collect();
      for (const row of states.filter(s => s.obligation_id === extra)) await ctx.db.delete(row._id);
    });
  }
});


test("calendar defaults must be configured or explicitly supplied before a timeline is read", async () => {
  const isolated = await alice.mutation(api.datasets.create, { name: "No calendar defaults" });
  const missing = await alice.query(ref("agentTimeline:timeline"), { datasetId: isolated });
  expect(missing).toMatchObject({ status: "needs_input", kind: "workspace_scope", missing: ["household", "timezone"], executed: false });
  expect(missing.items).toBeUndefined();
  const person = await alice.mutation(api.entities.create, { datasetId: isolated, kind: "Person", display_name: "Avery" });
  const noZone = await alice.query(ref("agentTimeline:timeline"), { datasetId: isolated, perspectiveId: person });
  expect(noZone.missing).toEqual(["timezone"]);
  const explicit = await alice.query(ref("agentTimeline:timeline"), { datasetId: isolated, perspectiveId: person, timezone: "America/Chicago", from: "2026-09-18", through: "2026-09-30" });
  expect(explicit).toMatchObject({ timezone: "America/Chicago", queryComplete: true, items: [] });
  const unchanged = await alice.query(ref("agentLife:context"), { datasetId: isolated });
  expect(unchanged).toMatchObject({ defaultHousehold: null, timezoneConfigured: false });
});
