/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { api, components } from "../convex/_generated/api";

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
    return t.withIdentity({ subject: user._id, sessionId: session._id });
  }
  const alice = await login("alice@example.test");
  const bob = await login("bob@example.test");
  return { t, alice, bob };
}

async function financeFixture() {
  const fixture = await setup();
  const { alice } = fixture;
  const chart = await alice.mutation(api.finance.createChart, {
    name: "Main chart",
  });
  const event = await alice.mutation(api.events.create, {
    kind: "Purchase",
    occurred_at: 0,
    payload_json: "{}",
  });
  const account = await alice.mutation(api.finance.createAccount, {
    chartId: chart,
    name: "Cash",
    type: "Asset",
    normal_balance: "Debit",
    currency: "USD",
  });
  const equity = await alice.mutation(api.finance.createAccount, {
    chartId: chart,
    name: "Equity",
    type: "Equity",
    normal_balance: "Credit",
    currency: "USD",
  });
  const entry = {
    eventId: event,
    chartId: chart,
    memo: "Opening",
    postings: [
      { accountId: account, amount: 100, currency: "USD", description: "Cash" },
      {
        accountId: equity,
        amount: -100,
        currency: "USD",
        description: "Equity",
      },
    ],
  };
  return { ...fixture, chart, event, account, entry };
}

test("component user IDs support creation, and ownership protects reads/updates/deletes", async () => {
  const { alice, bob } = await setup();
  const id = await alice.mutation(api.entities.create, {
    kind: "Person",
    display_name: "Alice",
  });
  expect(await alice.query(api.entities.list)).toHaveLength(1);
  expect(await bob.query(api.entities.list)).toEqual([]);
  await expect(bob.query(api.entities.get, { id })).rejects.toThrow(
    "access denied",
  );
  await expect(
    bob.mutation(api.entities.update, { id, display_name: "Bob" }),
  ).rejects.toThrow("access denied");
  await expect(bob.mutation(api.entities.remove, { id })).rejects.toThrow(
    "access denied",
  );
  await alice.mutation(api.entities.update, { id, display_name: "Updated" });
  expect((await alice.query(api.entities.get, { id })).display_name).toBe(
    "Updated",
  );
  await alice.mutation(api.entities.remove, { id });
  expect(await alice.query(api.entities.list)).toEqual([]);
});

test("anonymous lists are empty, writes require a session", async () => {
  const { t } = await setup();
  for (const query of [
    api.entities.list,
    api.events.list,
    api.arrangements.list,
  ])
    expect(await t.query(query)).toEqual([]);
  await expect(
    t.mutation(api.entities.create, {
      kind: "Person",
      display_name: "Anonymous",
    }),
  ).rejects.toThrow();
});

test("roles and affected targets enforce ownership and restrict referenced deletes", async () => {
  const { alice, bob } = await setup();
  const entity = await alice.mutation(api.entities.create, {
    kind: "Person",
    display_name: "Alice",
  });
  const arrangement = await alice.mutation(api.arrangements.create, {
    kind: "Ownership",
    valid_from: -100,
    valid_to: 0,
  });
  expect(
    await alice.query(api.arrangements.listValidAt, { timestamp: 1 }),
  ).toEqual([]);
  await expect(
    bob.mutation(api.arrangements.addRole, {
      arrangementId: arrangement,
      entityId: entity,
      roleName: "Owner",
    }),
  ).rejects.toThrow();
  await alice.mutation(api.arrangements.addRole, {
    arrangementId: arrangement,
    entityId: entity,
    roleName: "Owner",
  });
  await alice.mutation(api.entities.remove, { id: entity });
  expect((await alice.query(api.entities.get, { id: entity })).archived).toBe(
    true,
  );
  const event = await alice.mutation(api.events.create, {
    kind: "Purchase",
    occurred_at: 0,
    payload_json: "{}",
  });
  await expect(
    alice.mutation(api.events.addAffects, {
      eventId: event,
      targetType: "entity",
      targetId: arrangement,
    }),
  ).rejects.toThrow("Invalid target");
  await alice.mutation(api.events.addAffects, {
    eventId: event,
    targetType: "entity",
    targetId: entity,
  });
  await expect(
    bob.query(api.events.getAffects, { eventId: event }),
  ).rejects.toThrow();
  await alice.mutation(api.events.remove, { id: event });
  await alice.mutation(api.arrangements.remove, { id: arrangement });
  await alice.mutation(api.entities.remove, { id: entity });
});

test("invalid JSON and dates fail before writes", async () => {
  const { alice } = await setup();
  await expect(
    alice.mutation(api.events.create, {
      kind: "Test",
      occurred_at: 0,
      payload_json: "{",
    }),
  ).rejects.toThrow("Invalid JSON");
  await expect(
    alice.mutation(api.arrangements.create, {
      kind: "Test",
      valid_from: 2,
      valid_to: 1,
    }),
  ).rejects.toThrow("End date");
});

test("balanced journal writes work; financial history and reads are protected", async () => {
  const { alice, bob, chart, event, account, entry } = await financeFixture();
  const jeId = await alice.mutation(api.finance.createJournalEntry, entry);
  expect(await alice.query(api.finance.getPostings, { jeId })).toHaveLength(2);
  expect(
    (await alice.query(api.finance.getAccountBalance, { accountId: account }))
      .balance,
  ).toBe(100);
  expect(
    (await alice.query(api.finance.getTrialBalance, { chartId: chart }))
      .isBalanced,
  ).toBe(true);
  await expect(
    bob.query(api.finance.getJournalEntry, { jeId }),
  ).rejects.toThrow();
  await expect(bob.query(api.finance.getPostings, { jeId })).rejects.toThrow();
  await expect(
    bob.query(api.finance.getAccountBalance, { accountId: account }),
  ).rejects.toThrow();
  await expect(
    bob.query(api.finance.listAccounts, { chartId: chart }),
  ).rejects.toThrow();
  await expect(
    bob.query(api.finance.listJournalEntries, { chartId: chart }),
  ).rejects.toThrow();
  await expect(
    bob.query(api.finance.getTrialBalance, { chartId: chart }),
  ).rejects.toThrow();
  await alice.mutation(api.events.remove, { id: event });
  expect((await alice.query(api.events.get, { id: event })).archived).toBe(
    true,
  );
  await alice.mutation(api.finance.updateChart, { id: chart, archived: true });
});

test("invalid postings are rejected atomically", async () => {
  const { alice, chart, entry } = await financeFixture();
  for (const amount of [99, 99.9995, NaN, Infinity, 0]) {
    await expect(
      alice.mutation(api.finance.createJournalEntry, {
        ...entry,
        postings: [{ ...entry.postings[0], amount }, entry.postings[1]],
      }),
    ).rejects.toThrow();
  }
  await expect(
    alice.mutation(api.finance.createJournalEntry, {
      ...entry,
      postings: entry.postings.map((p) => ({ ...p, currency: "EUR" })),
    }),
  ).rejects.toThrow("currency");
  const otherChart = await alice.mutation(api.finance.createChart, {
    name: "Main chart",
  });
  await expect(
    alice.mutation(api.finance.createJournalEntry, {
      ...entry,
      chartId: otherChart,
    }),
  ).rejects.toThrow("chart");
  expect(
    await alice.query(api.finance.listJournalEntries, { chartId: chart }),
  ).toEqual([]);
});
