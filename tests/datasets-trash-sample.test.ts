/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { api, internal, components } from "../convex/_generated/api";
import { businessTables } from "../convex/lib/scoped";
import { loans, amortization, SAMPLE_AS_OF } from "../lib/family-fixture";
import type { Id } from "../convex/_generated/dataModel";
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
test("datasets isolate lists, direct IDs, relationships, history, documents and stale saves", async () => {
  const { t, alice, bob } = await setup();
  const live = await alice.mutation(api.datasets.initialize, {}),
    other = await alice.mutation(api.datasets.create, { name: "Experiments" });
  const entity = await alice.mutation(api.entities.create, {
    datasetId: live,
    display_name: "Original",
    kind: "Person",
  });
  const experimental = await alice.mutation(api.entities.create, {
    datasetId: other,
    display_name: "Fictional",
    kind: "Person",
  });
  const doc = await alice.mutation(api.details.ensure, {
    datasetId: live,
    target: { kind: "entity", id: entity },
    repositoryKey: "local",
  });
  await alice.mutation(api.datasets.select, { id: other });
  expect(
    (await alice.query(api.entities.list, { datasetId: other })).map(
      (x) => x._id,
    ),
  ).toEqual([experimental]);
  expect((await alice.query(api.entities.list, {})).map((x) => x._id)).toEqual([
    entity,
  ]);
  for (const operation of [
    () => alice.query(api.entities.get, { datasetId: other, id: entity }),
    () => alice.query(api.entities.history, { datasetId: other, id: entity }),
    () => alice.query(api.details.get, { datasetId: other, id: doc._id }),
    () => bob.query(api.entities.list, { datasetId: live }),
    () => bob.mutation(api.datasets.select, { id: other }),
  ])
    await expect(operation()).rejects.toThrow(/access denied/i);
  const tag = await alice.mutation(api.tags.create, {
    datasetId: other,
    name: "Test",
  });
  await expect(
    alice.mutation(api.tags.assign, {
      datasetId: other,
      tagId: tag,
      target: { kind: "entity", id: entity },
    }),
  ).rejects.toThrow();
  // Simulate a save initiated before the switch and arriving afterward.
  await alice.mutation(api.entities.update, {
    datasetId: live,
    id: entity,
    display_name: "Late save",
  });
  expect(
    (await alice.query(api.entities.get, { datasetId: live, id: entity }))
      .display_name,
  ).toBe("Late save");
  expect(
    (await alice.query(api.entities.list, { datasetId: other }))[0]
      .display_name,
  ).toBe("Fictional");
  await t.run(async (ctx) => {
    for (const table of businessTables)
      for (const row of await ctx.db.query(table).collect())
        expect(row.dataset_id).toBeTruthy();
  });
});
test("legacy migration preserves data and assigns ownerless children to the right Live dataset", async () => {
  const { t, alice, bob, userId, bobId } = await setup();
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("entity", {
      user_id: userId,
      kind: "Person",
      display_name: "A",
    });
    const b = await ctx.db.insert("entity", {
      user_id: bobId,
      kind: "Person",
      display_name: "B",
    });
    const event = await ctx.db.insert("event", {
      user_id: bobId,
      kind: "Test",
      occurred_at: 0,
      recorded_at: 0,
      payload_json: "{}",
    });
    const link = await ctx.db.insert("event_affects", {
      event_id: event,
      target_type: "entity",
      target_id: b,
    });
    return { a, b, event, link };
  });
  expect((await alice.query(api.entities.list, {})).map((x) => x._id)).toEqual([
    ids.a,
  ]);
  await expect(
    alice.query(api.events.getAffects, { eventId: ids.event }),
  ).rejects.toThrow();
  const first = await t.mutation(internal.datasets.migrateExisting, {});
  expect(first.migrated).toBe(4);
  expect(
    (await t.mutation(internal.datasets.migrateExisting, {})).migrated,
  ).toBe(0);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(ids.b))!.dataset_id).toBe(
      (await ctx.db.get(ids.link))!.dataset_id,
    );
    expect((await ctx.db.get(ids.a))!.display_name).toBe("A");
  });
  expect((await bob.query(api.entities.list, {})).map((x) => x._id)).toEqual([
    ids.b,
  ]);
});
test("Trash restores and removes archived unused records plus metadata, but protects references", async () => {
  const { t, alice, bob } = await setup();
  const entity = await alice.mutation(api.entities.create, {
      display_name: "Disposable",
      kind: "Person",
    }),
    target = { kind: "entity" as const, id: entity };
  await expect(
    alice.mutation(api.trash.permanentlyDelete, {
      target,
      confirmation: "DELETE",
    }),
  ).rejects.toThrow(/Archive/);
  const tag = await alice.mutation(api.tags.create, { name: "Temporary" });
  await alice.mutation(api.tags.assign, { tagId: tag, target });
  const doc = await alice.mutation(api.details.ensure, {
    target,
    repositoryKey: "local",
  });
  await alice.mutation(api.entities.remove, { id: entity });
  expect(await alice.query(api.trash.list, {})).toHaveLength(1);
  expect(
    (await alice.query(api.trash.inspect, { target })).blockers,
  ).toHaveLength(0);
  await expect(
    bob.mutation(api.trash.permanentlyDelete, {
      target,
      confirmation: "DELETE",
    }),
  ).rejects.toThrow();
  await expect(
    alice.mutation(api.trash.permanentlyDelete, {
      target,
      confirmation: "delete",
    }),
  ).rejects.toThrow(/Type DELETE/);
  await alice.mutation(api.trash.restore, { target });
  expect(await alice.query(api.entities.list, {})).toHaveLength(1);
  const event = await alice.mutation(api.events.create, {
    kind: "Meeting",
    occurred_at: 0,
    payload_json: "{}",
  });
  await alice.mutation(api.events.addAffects, {
    eventId: event,
    target,
    meaning: "attendee",
  });
  await alice.mutation(api.entities.remove, { id: entity });
  expect(
    (await alice.query(api.trash.inspect, { target })).blockers.some(
      (x) => x.kind === "event_affects",
    ),
  ).toBe(true);
  await expect(
    alice.mutation(api.trash.permanentlyDelete, {
      target,
      confirmation: "DELETE",
    }),
  ).rejects.toThrow(/dependent/);
  await alice.mutation(api.events.remove, { id: event });
  await alice.mutation(api.trash.permanentlyDelete, {
    target: { kind: "event", id: event },
    confirmation: "DELETE",
  });
  await alice.mutation(api.trash.permanentlyDelete, {
    target,
    confirmation: "DELETE",
  });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(entity)).toBeNull();
    expect(await ctx.db.get(doc._id)).toBeNull();
    expect(await ctx.db.query("entity_revision").collect()).toHaveLength(0);
    expect(await ctx.db.query("tag_assignment").collect()).toHaveLength(0);
    expect(await ctx.db.get(tag)).not.toBeNull();
  });
});
test("family sample is resumable, balanced, isolated and consistent with the requested loan history", async () => {
  const { t, alice, bob } = await setup();
  const liveEntity = await alice.mutation(api.entities.create, {
    kind: "Person",
    display_name: "Keep Live",
  });
  const datasetId = await alice.mutation(api.sampleData.prepare, {});
  expect(await alice.mutation(api.sampleData.prepare, {})).toBe(datasetId);
  await expect(
    bob.mutation(api.sampleData.populateMonth, { datasetId, monthIndex: 0 }),
  ).rejects.toThrow();
  await expect(
    alice.mutation(api.datasets.select, { id: datasetId }),
  ).rejects.toThrow(/prepared/);
  await expect(
    alice.mutation(api.sampleData.populateMonth, { datasetId, monthIndex: 1 }),
  ).rejects.toThrow(/order/);
  for (let monthIndex = 0; monthIndex < 9; monthIndex++)
    await alice.mutation(api.sampleData.populateMonth, {
      datasetId,
      monthIndex,
    });
  await alice.mutation(api.sampleData.populateMonth, {
    datasetId,
    monthIndex: 0,
  });
  const rows = await t.run(async (ctx) => ({
    records: await ctx.db.query("sample_record").collect(),
    entities: await ctx.db.query("entity").collect(),
    journals: await ctx.db.query("journal_entry").collect(),
    postings: await ctx.db.query("posting").collect(),
    accounts: await ctx.db.query("ledger_account").collect(),
    fas: await ctx.db.query("financial_account").collect(),
    obligations: await ctx.db.query("monetary_obligation").collect(),
    settlements: await ctx.db.query("obligation_settlement").collect(),
    observations: await ctx.db.query("balance_observation").collect(),
    events: await ctx.db.query("event").collect(),
    assignments: await ctx.db.query("arrangement_role_assignment").collect(),
    definitions: await ctx.db.query("arrangement_role_definition").collect(),
  }));
  const ref = (key: string) =>
    rows.records.find((x) => x.key === key)!.target.id;
  const balance = (key: string) =>
    rows.postings
      .filter((x) => x.account_id === ref(key))
      .reduce((sum, x) => sum + x.minor_units!, 0);
  expect((await alice.query(api.entities.list, {})).map((x) => x._id)).toEqual([
    liveEntity,
  ]);
  expect(
    rows.assignments.filter((x) => x.arrangement_id === ref("household")),
  ).toHaveLength(4);
  expect(
    rows.definitions.filter((x) => x.arrangement_id === ref("household")),
  ).toHaveLength(2);
  expect(rows.entities.filter((x) => x.kind === "Car")).toHaveLength(3);
  expect(rows.fas.filter((x) => x.kind === "checking")).toHaveLength(4);
  expect(rows.fas.filter((x) => x.kind === "credit_card")).toHaveLength(2);
  expect(rows.fas.filter((x) => x.kind === "mortgage")).toHaveLength(3);
  for (const loan of loans) {
    const schedule = amortization(loan.principal, loan.aprBps, loan.months);
    expect(balance(`liability-${loan.key}`)).toBe(
      -schedule[loan.paidAtOpening + 8].balance,
    );
    expect(schedule.at(-1)!.balance).toBe(0);
  }
  for (const je of rows.journals) {
    expect(
      rows.postings
        .filter((p) => p.je_id === je._id)
        .reduce((sum, p) => sum + p.minor_units!, 0),
    ).toBe(0);
    expect(je.accounting_date! <= SAMPLE_AS_OF).toBe(true);
  }
  expect(rows.journals.length).toBeGreaterThan(300);
  for (const key of [
    "checking1",
    "checking2",
    "checking-software",
    "checking-design",
  ])
    expect(balance(key)).toBeGreaterThan(0);
  expect(balance("square-clearing")).toBe(0);
  expect(balance("design-income")).toBeLessThan(0);
  expect(
    rows.accounts.filter(
      (x) => x.chart_id === ref("chart-software") && x.type === "Income",
    ),
  ).toHaveLength(0);
  expect(balance("remodel-asset")).toBe(5500000);
  expect(balance("contractor-payable")).toBe(-1500000);
  expect(balance("rent-receivable")).toBe(70000);
  const unpaid = rows.obligations
    .map(
      (o) =>
        o.original_minor_units -
        rows.settlements
          .filter((s) => s.obligation_id === o._id)
          .reduce((sum, s) => sum + s.minor_units, 0),
    )
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  expect(unpaid).toEqual([70000, 1500000]);
  for (const card of ["card1", "card2"]) {
    const payments = rows.journals.filter((j) =>
      j.memo.startsWith(
        card === "card1"
          ? "Cedar Visa · previous"
          : "Harbor Mastercard · previous",
      ),
    );
    expect(payments).toHaveLength(9);
    for (const je of payments)
      expect(
        rows.postings
          .filter((p) => p.je_id === je._id)
          .map((x) => x.account_id),
      ).toContain(ref(card === "card1" ? "checking1" : "checking2"));
  }
  expect(rows.observations).toHaveLength(10);
  expect(
    (await alice.query(api.sampleData.documents, { datasetId })).length,
  ).toBeGreaterThan(15);
  const archived = ref("alex") as Id<"entity">;
  await alice.mutation(api.entities.remove, { datasetId, id: archived });
  expect(
    (
      await alice.query(api.trash.inspect, {
        datasetId,
        target: { kind: "entity", id: archived },
      })
    ).blockers.length,
  ).toBeGreaterThan(0);
  await t.run(async (ctx) => {
    for (const table of businessTables)
      for (const row of await ctx.db.query(table).collect())
        expect(row.dataset_id).toBeTruthy();
  });
  await alice.mutation(api.datasets.select, { id: datasetId });
}, 60000);

test("permanent deletion protects posted journals and published plan snapshots, including Git-only pins", async () => {
  const { t, alice, userId } = await setup();
  const datasetId = await alice.mutation(api.datasets.initialize, {});
  const ids = await t.run(async (ctx) => {
    const base = { user_id: userId, dataset_id: datasetId, archived: true };
    const event = await ctx.db.insert("event", {
      ...base,
      kind: "Payment",
      occurred_at: 0,
      recorded_at: 0,
      payload_json: "{}",
    });
    const je = await ctx.db.insert("journal_entry", {
      ...base,
      event_id: event,
      memo: "Posted history",
      status: "posted",
    });
    const plan = await ctx.db.insert("plan", {
      ...base,
      name: "Published plan",
    });
    const entity = await ctx.db.insert("entity", {
      ...base,
      kind: "Person",
      display_name: "Pinned notes",
    });
    const locator = await ctx.db.insert("details_document", {
      user_id: userId,
      dataset_id: datasetId,
      target: { kind: "entity", id: entity },
      repository_key: "local",
      path: "pending",
      availability: "missing",
      created_at: 0,
    });
    const path = `details/${locator}.md`;
    await ctx.db.patch(locator, { path });
    await ctx.db.insert("plan_version", {
      ...base,
      plan_id: plan,
      revision: 1,
      status: "published",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      inputs: [],
      git_revisions: [
        { repository_key: "local", path, commit: "a".repeat(40) },
      ],
      resolved_tag_targets: [],
      actual_boundary: 0,
    });
    return { je, plan, entity };
  });
  for (const target of [
    { kind: "journal_entry" as const, id: ids.je },
    { kind: "plan" as const, id: ids.plan },
    { kind: "entity" as const, id: ids.entity },
  ]) {
    expect(
      (await alice.query(api.trash.inspect, { datasetId, target })).blockers
        .length,
    ).toBeGreaterThan(0);
    await expect(
      alice.mutation(api.trash.permanentlyDelete, {
        datasetId,
        target,
        confirmation: "DELETE",
      }),
    ).rejects.toThrow(/protected/);
  }
});
