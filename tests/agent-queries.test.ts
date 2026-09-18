/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { makeFunctionReference } from "convex/server";
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
const income = makeFunctionReference<"query">("agentQueries:incomeSummary");
const search = makeFunctionReference<"query">("agentQueries:searchJournals");
async function ledgerFixture() {
  const f = await setup();
  const records = await f.t.run(async (ctx) => {
    const base = { user_id: f.userId, created_at: 1 };
    const person = await ctx.db.insert("entity", {
      ...base,
      kind: "Person",
      display_name: "Alex Morgan",
    });
    const other = await ctx.db.insert("entity", {
      ...base,
      kind: "Person",
      display_name: "Jamie Morgan",
    });
    const chart = await ctx.db.insert("chart_of_accounts", {
      ...base,
      name: "Household",
    });
    const cash = await ctx.db.insert("ledger_account", {
      ...base,
      chart_id: chart,
      name: "Checking",
      type: "Asset",
      normal_balance: "Debit",
      currency: "USD",
    });
    const salary = await ctx.db.insert("ledger_account", {
      ...base,
      chart_id: chart,
      name: "Salary",
      type: "Income",
      normal_balance: "Credit",
      currency: "USD",
    });
    const ids = [];
    for (const [month, amount, status, subject] of [
      ["06", 1200000, "posted", person],
      ["07", 1500000, "posted", person],
      ["08", 1800000, "posted", person],
      ["08", -300000, "posted", person],
      ["08", 999999, "draft", person],
      ["08", 999999, "posted", other],
    ] as const) {
      const event = await ctx.db.insert("event", {
        ...base,
        kind: "Payroll",
        occurred_at: 1,
        recorded_at: 1,
        payload_json: "{}",
      });
      const je = await ctx.db.insert("journal_entry", {
        ...base,
        chart_id: chart,
        event_id: event,
        memo: "Payroll",
        status,
        accounting_date: `2026-${month}-15`,
      });
      ids.push(je);
      const posting = await ctx.db.insert("posting", {
        user_id: f.userId,
        je_id: je,
        account_id: cash,
        minor_units: amount,
        currency: "USD",
        description: "Cash",
      });
      await ctx.db.insert("posting", {
        user_id: f.userId,
        je_id: je,
        account_id: salary,
        minor_units: -amount,
        currency: "USD",
        description: "Gross salary",
      });
      const set = await ctx.db.insert("posting_attribution_set", {
        user_id: f.userId,
        posting_id: posting,
        revision: 1,
        recorded_at: 1,
        actor: f.userId,
      });
      await ctx.db.insert("posting_attribution", {
        ...base,
        set_id: set,
        minor_units: amount,
        currency: "USD",
        subject_entity_id: subject,
        unclassified: false,
      });
    }
    return { person, other, chart, ids };
  });
  return { ...f, ...records };
}
test("income uses actual postings, cash-leg subject attribution, signed corrections and excludes drafts/other people", async () => {
  const f = await ledgerFixture();
  const result = await f.alice.query(income, {
    entityId: f.person,
    fromMonth: "2026-06",
    toMonth: "2026-08",
  });
  expect(
    result.currencies[0].months.map(
      (m: { minorUnits: number }) => m.minorUnits,
    ),
  ).toEqual([1200000, 1500000, 1500000]);
  expect(result.currencies[0].totalMinorUnits).toBe(4200000);
  expect(result.status).toBe("recorded_income");
  expect(result.currencies[0].totalAmount).toBe("42000.00");
  expect(result.currencies[0].averageMonthlyAmount).toBe("14000.00");
  expect(result.currencies[0].months[0].amount).toBe("12000.00");
  expect(result.currencies[0].averageExact).toEqual({
    numeratorMinorUnits: 4200000,
    denominatorMonths: 3,
  });
  expect(result.basis).toContain("NOT take-home pay");
  await expect(
    f.bob.query(income, {
      entityId: f.person,
      fromMonth: "2026-06",
      toMonth: "2026-08",
    }),
  ).rejects.toThrow();
});
test("missing months are explicit and date ranges validated", async () => {
  const f = await ledgerFixture();
  const result = await f.alice.query(income, {
    entityId: f.person,
    fromMonth: "2026-05",
    toMonth: "2026-06",
  });
  expect(result.currencies[0].months[0]).toMatchObject({
    minorUnits: 0,
    hasRecordedIncome: false,
    sourceCount: 0,
  });
  expect(result.coverage).toContain("not confirmed zero");
  await expect(
    f.alice.query(income, {
      entityId: f.person,
      fromMonth: "2026-13",
      toMonth: "2026-14",
    }),
  ).rejects.toThrow();
});
test("journal pagination retains complete postings and returns all matching records", async () => {
  const f = await ledgerFixture();
  let cursor: string | undefined;
  const records = [];
  do {
    const page = await f.alice.query(search, {
      from: "2026-06-01",
      to: "2026-08-31",
      entityId: f.person,
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    records.push(...page.records);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(records).toHaveLength(5);
  expect(records.every((r) => r.postings.length === 2)).toBe(true);
  expect(
    await f.bob.query(search, { from: "2026-06-01", to: "2026-08-31" }),
  ).toMatchObject({ records: [], complete: true });
});
test("indexed memo search finds an old receipt without guessed dates and preserves owner/date filters", async () => {
  const f = await ledgerFixture();
  await f.t.run(ctx => ctx.db.patch(f.ids[0], { memo: "Pine Street Market receipt", accounting_date: "2012-02-20" }));
  const result = await f.alice.query(search, { text: "Pine receipt", limit: 1 });
  expect(result.records).toHaveLength(1);
  expect(result.records[0]).toMatchObject({ id: f.ids[0], date: "2012-02-20" });
  expect(result.records[0].postings.map((p: any) => p.amount).sort()).toEqual(["-12000.00", "12000.00"]);
  expect(result.ordering).toBe("memo_relevance");
  if (result.nextCursor) {
    await expect(f.alice.query(search, { text: "Pine receipt", from: "2026-01-01", cursor: result.nextCursor })).rejects.toThrow("does not match");
    const end = await f.alice.query(search, { text: "Pine receipt", limit: 1, cursor: result.nextCursor });
    expect(end).toMatchObject({ records: [], complete: true });
  } else expect(result.complete).toBe(true);
  expect((await f.alice.query(search, { text: "Pine receipt", from: "2026-01-01" })).records).toEqual([]);
  expect(await f.bob.query(search, { text: "Pine receipt" })).toMatchObject({ records: [], complete: true });
  await f.t.run(ctx => ctx.db.patch(f.ids[1], { memo: "Undated market receipt", accounting_date: undefined }));
  expect((await f.alice.query(search, { text: "Undated receipt" })).records).toHaveLength(1);
  expect((await f.alice.query(search, { text: "Undated receipt", to: "2026-12-31" })).records).toEqual([]);
});
test("multiple currencies stay separate and mixed subject journals are excluded instead of guessed", async () => {
  const f = await ledgerFixture();
  await f.t.run(async (ctx) => {
    const je = await ctx.db.get(f.ids[0]);
    const lines = await ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", f.ids[0]))
      .collect();
    for (const line of lines) {
      const old = await ctx.db.get(line.account_id);
      const account = await ctx.db.insert("ledger_account", {
        user_id: f.userId,
        created_at: 1,
        chart_id: f.chart,
        name: old!.name + " EUR",
        type: old!.type,
        normal_balance: old!.normal_balance,
        currency: "EUR",
      });
      await ctx.db.patch(line._id, { currency: "EUR", account_id: account });
    }
    const cash = lines.find((p) => p.minor_units! > 0)!;
    const set = await ctx.db
      .query("posting_attribution_set")
      .withIndex("by_posting", (q) => q.eq("posting_id", cash._id))
      .first();
    const part = await ctx.db
      .query("posting_attribution")
      .withIndex("by_set", (q) => q.eq("set_id", set!._id))
      .first();
    await ctx.db.patch(part!._id, { currency: "EUR" });
    expect(je).not.toBeNull();
  });
  const result = await f.alice.query(income, {
    entityId: f.person,
    fromMonth: "2026-06",
    toMonth: "2026-08",
  });
  expect(
    result.currencies.map((c: { currency: string }) => c.currency).sort(),
  ).toEqual(["EUR", "USD"]);
  expect(
    result.currencies.find((c: { currency: string }) => c.currency === "EUR")
      .totalMinorUnits,
  ).toBe(1200000);
  await f.t.run(async (ctx) => {
    const lines = await ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", f.ids[1]))
      .collect();
    const cash = lines.find((p) => p.minor_units! > 0)!;
    const set = await ctx.db
      .query("posting_attribution_set")
      .withIndex("by_posting", (q) => q.eq("posting_id", cash._id))
      .first();
    const part = await ctx.db
      .query("posting_attribution")
      .withIndex("by_set", (q) => q.eq("set_id", set!._id))
      .first();
    await ctx.db.patch(part!._id, { minor_units: 750000 });
    await ctx.db.insert("posting_attribution", {
      user_id: f.userId,
      created_at: 1,
      set_id: set!._id,
      minor_units: 750000,
      currency: "USD",
      subject_entity_id: f.other,
      unclassified: false,
    });
  });
  const mixed = await f.alice.query(income, {
    entityId: f.person,
    fromMonth: "2026-07",
    toMonth: "2026-07",
  });
  expect(mixed.currencies).toEqual([]);
  expect(mixed.status).toBe("no_recorded_income");
  expect(mixed.queryComplete).toBe(true);
  expect(mixed.warnings.join(" ")).toContain("mixed subject");
});
test("archiving posted history does not erase recognized income", async () => {
  const f = await ledgerFixture();
  await f.t.run((ctx) => ctx.db.patch(f.ids[0], { archived: true }));
  const result = await f.alice.query(income, {
    entityId: f.person,
    fromMonth: "2026-06",
    toMonth: "2026-06",
  });
  expect(result.currencies[0].totalMinorUnits).toBe(1200000);
});

test("income requires authentication and rejects a person from another dataset of the same owner", async () => {
  const f = await ledgerFixture();
  const createDataset = makeFunctionReference<"mutation">("datasets:create");
  const otherDataset = await f.alice.mutation(createDataset, { name: "Other" });
  await expect(
    f.alice.query(income, {
      datasetId: otherDataset,
      entityId: f.person,
      fromMonth: "2026-06",
      toMonth: "2026-08",
    }),
  ).rejects.toThrow();
  await expect(
    f.t.query(income, {
      entityId: f.person,
      fromMonth: "2026-06",
      toMonth: "2026-08",
    }),
  ).rejects.toThrow("Unauthenticated");
});

test("decimal amounts preserve signed cents and round averages half away from zero", async () => {
  const f = await ledgerFixture();
  for (const minor of [-1, 1]) {
    await f.t.run(async (ctx) => {
      const postings = await ctx.db
        .query("posting")
        .withIndex("by_je", (q) => q.eq("je_id", f.ids[0]))
        .collect();
      for (const p of postings) {
        const account = await ctx.db.get(p.account_id);
        await ctx.db.patch(p._id, {
          minor_units: account?.type === "Income" ? -minor : minor,
        });
        const sets = await ctx.db
          .query("posting_attribution_set")
          .withIndex("by_posting", (q) => q.eq("posting_id", p._id))
          .collect();
        for (const set of sets) {
          const parts = await ctx.db
            .query("posting_attribution")
            .withIndex("by_set", (q) => q.eq("set_id", set._id))
            .collect();
          for (const part of parts)
            await ctx.db.patch(part._id, { minor_units: minor });
        }
      }
    });
    const result = await f.alice.query(income, {
      entityId: f.person,
      fromMonth: "2026-05",
      toMonth: "2026-06",
    });
    const expected = minor < 0 ? "-0.01" : "0.01";
    expect(result.currencies[0].totalAmount).toBe(expected);
    expect(result.currencies[0].averageMonthlyAmount).toBe(expected);
    expect(result.currencies[0].averageExact.denominatorMonths).toBe(2);
  }
});

test("named-dataset person search does not page through unrelated datasets", async () => {
  const f = await setup();
  const create = makeFunctionReference<"mutation">("datasets:create");
  const foreign = await f.alice.mutation(create, { name: "Other records" });
  const target = await f.alice.mutation(create, { name: "Requested records" });
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 100; i++)
      await ctx.db.insert("entity", {
        user_id: f.userId,
        dataset_id: foreign,
        created_at: i,
        kind: "Person",
        display_name: "Alex elsewhere",
      });
    for (let i = 0; i < 31; i++)
      await ctx.db.insert("entity", {
        user_id: f.userId,
        dataset_id: target,
        created_at: i + 100,
        kind: "Person",
        display_name: i === 0 ? "Alex here" : `Person ${i}`,
      });
  });
  const result = await f.alice.query(
    makeFunctionReference<"query">("agentQueries:searchEntities"),
    { datasetId: target, query: "Alex" },
  );
  expect(result.records.map((p: { name: string }) => p.name)).toEqual([
    "Alex here",
  ]);
  expect(result.complete).toBe(true);
  expect(result.nextCursor).toBeNull();
});
