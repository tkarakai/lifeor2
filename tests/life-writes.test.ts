/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { components, api } from "../convex/_generated/api";
import { localInstant } from "../convex/lib/lifeQueries/time";
const modules = import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js"]),
  authModules = import.meta.glob(
    "../node_modules/@convex-dev/better-auth/src/component/**/*.ts",
  );
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterAuth", authSchema, authModules);
  const now = Date.now();
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        name: "Writer",
        email: "writer@example.invalid",
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
        token: "writer-session",
        expiresAt: now + 86400000,
        createdAt: now,
        updatedAt: now,
      },
    },
  });
  const c = t.withIdentity({ subject: user._id, sessionId: session._id }),
    datasetId = await c.mutation(api.datasets.create, {
      name: "Write evaluation",
    });
  await t.run((ctx) =>
    ctx.db.patch(datasetId, { timezone: "America/Chicago" }),
  );
  const mutation = (name: string, args: Record<string, unknown>) =>
    c.mutation(makeFunctionReference<"mutation">(name), { datasetId, ...args });
  const query = (name: string, args: Record<string, unknown>) =>
    c.query(makeFunctionReference<"query">(name), { datasetId, ...args });
  return { t, c, datasetId, mutation, query };
}
test("civil time resolves daylight saving and refuses ambiguous/nonexistent appointments", () => {
  expect(
    new Date(
      localInstant("2026-09-20", "14:30", "America/Chicago"),
    ).toISOString(),
  ).toBe("2026-09-20T19:30:00.000Z");
  expect(() => localInstant("2026-03-08", "02:30", "America/Chicago")).toThrow(
    "does not exist",
  );
  expect(() => localInstant("2026-11-01", "01:30", "America/Chicago")).toThrow(
    "Ambiguous",
  );
  expect(
    new Date(
      localInstant("2026-11-01", "01:30", "America/Chicago", -360),
    ).toISOString(),
  ).toBe("2026-11-01T07:30:00.000Z");
});
test("rescheduling preserves subject links, hides superseded occurrences and rejects branching edits", async () => {
  const f = await setup(),
    person = await f.mutation("entities:create", {
      kind: "Person",
      display_name: "Avery",
    });
  const original = await f.mutation("agentWrites:recordEvent", {
    title: "Dentist",
    kind: "Appointment",
    date: "2026-09-20",
    time: "14:30",
    subjects: [{ kind: "entity", id: person }],
  });
  const next = await f.mutation("agentWrites:rescheduleEvent", {
    id: original.id,
    date: "2026-09-22",
    time: "09:00",
  });
  expect(next.correctsId).toBe(original.id);
  const list = await f.query("agentLife:events", {
    from: "2026-09-01",
    through: "2026-09-30",
    entityId: person,
  });
  expect(list.items.map((e: any) => e.id)).toEqual([next.id]);
  expect(list.items[0].occurredAt).toBe("2026-09-22T14:00:00.000Z");
  await expect(
    f.mutation("agentWrites:rescheduleEvent", {
      id: original.id,
      date: "2026-09-23",
      time: "09:00",
    }),
  ).rejects.toThrow("newer correction");
});
test("expense writes and reversals update the reporting index in the same transaction", async () => {
  const f = await setup(),
    chart = await f.mutation("finance:createChart", { name: "Household" });
  const cash = await f.mutation("finance:createAccount", {
      chartId: chart,
      name: "Checking",
      type: "Asset",
      normal_balance: "Debit",
      currency: "USD",
    }),
    expense = await f.mutation("finance:createAccount", {
      chartId: chart,
      name: "Groceries",
      type: "Expense",
      normal_balance: "Debit",
      currency: "USD",
    });
  const person = await f.mutation("entities:create", {
    kind: "Person",
    display_name: "Avery",
  });
  const created = await f.mutation("agentWrites:recordExpense", {
    date: "2026-09-17",
    amount: "7.25",
    currency: "USD",
    paidFromAccountId: cash,
    expenseAccountId: expense,
    memo: "Groceries",
    subjectId: person,
  });
  const args = {
    from: "2026-09-01",
    through: "2026-09-30",
    metric: "expenses",
    entityId: person,
  };
  const before = await f.query("agentFinance:summary", args);
  expect(before.examinedCells).toBeGreaterThan(0);
  expect(before.rows[0].minorUnits).toBe(725);
  await f.mutation("finance:reverseJournalEntry", {
    jeId: created.journalId,
    accounting_date: "2026-09-18",
    reason: "Duplicate receipt",
  });
  const after = await f.query("agentFinance:summary", args);
  expect(after.rows.reduce((n: number, r: any) => n + r.minorUnits, 0)).toBe(0);
  const another = await f.c.mutation(api.datasets.create, { name: "Other" });
  await expect(
    f.c.query(makeFunctionReference<"query">("agentFinance:summary"), {
      ...args,
      datasetId: another,
    }),
  ).rejects.toThrow();
});

test("schedule changes preserve earlier and later effective terms and reject stale revisions", async () => {
  const f = await setup();
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.parse("2026-08-31T12:00:00Z"));
  try {
    const payer = await f.mutation("entities:create", {
        kind: "Person",
        display_name: "Avery",
      }),
      payee = await f.mutation("entities:create", {
        kind: "Organization",
        display_name: "Harbor",
      });
    const arrangement = await f.mutation("arrangements:create", {
      kind: "Rental",
      name: "Lease",
      valid_from: Date.parse("2026-01-01T06:00:00Z"),
    });
    const schedule = await f.mutation("obligations:createSchedule", {
      arrangement_id: arrangement,
      name: "Monthly rent",
      creditor_id: payee,
      debtor_id: payer,
      amount: { minor_units: 180000, currency: "USD" },
      currency: "USD",
      recurrence: { frequency: "monthly", interval: 1, day_of_month: 1 },
      start_date: "2026-01-01",
      timezone: "America/Chicago",
      valid_from: Date.parse("2026-01-01T06:00:00Z"),
    });
    await f.mutation("agentWrites:changeSchedule", {
      id: schedule,
      expectedRevision: 1,
      effectiveDate: "2026-12-01",
      amount: "2100.00",
      reason: "Winter renewal",
    });
    await f.mutation("agentWrites:changeSchedule", {
      id: schedule,
      expectedRevision: 2,
      effectiveDate: "2026-10-01",
      amount: "1950.00",
      reason: "Autumn agreement",
    });
    const editable = await f.query("agentLife:read", {
      kind: "commitment_schedule",
      id: schedule,
    });
    expect(editable.record.revision).toBe(3);
    expect(
      editable.periods.map((p: any) => [p.localEffectiveDate, p.amount]),
    ).toEqual([
      ["2026-01-01", "1800.00"],
      ["2026-10-01", "1950.00"],
      ["2026-12-01", "2100.00"],
    ]);
    expect(editable.revisionReason).toBe("Autumn agreement");
    const report = await f.query("agentTimeline:timeline", {
      from: "2026-09-01",
      through: "2026-12-31",
      includeEvents: false,
    });
    expect(
      report.items
        .filter((i: { kind: string }) => i.kind === "schedule_projection")
        .map((i: { date: string; amount: string }) => [i.date, i.amount]),
    ).toEqual([
      ["2026-09-01", "1800.00"],
      ["2026-10-01", "1950.00"],
      ["2026-11-01", "1950.00"],
      ["2026-12-01", "2100.00"],
    ]);
    await expect(
      f.mutation("agentWrites:changeSchedule", {
        id: schedule,
        expectedRevision: 2,
        effectiveDate: "2026-11-01",
        amount: "2000.00",
        reason: "Stale edit",
      }),
    ).rejects.toThrow();
  } finally {
    clock.mockRestore();
  }
});

test("beneficiary splits and later reclassification replace indexed contributions instead of accumulating them", async () => {
  const f = await setup(),
    chart = await f.mutation("finance:createChart", { name: "Family" });
  const cash = await f.mutation("finance:createAccount", {
      chartId: chart,
      name: "Checking",
      type: "Asset",
      normal_balance: "Debit",
      currency: "USD",
    }),
    expense = await f.mutation("finance:createAccount", {
      chartId: chart,
      name: "Lessons",
      type: "Expense",
      normal_balance: "Debit",
      currency: "USD",
    });
  const parent = await f.mutation("entities:create", {
      kind: "Person",
      display_name: "Parent",
    }),
    child = await f.mutation("entities:create", {
      kind: "Person",
      display_name: "Child",
    });
  const created = await f.mutation("agentWrites:recordExpense", {
    date: "2026-09-18",
    amount: "100.00",
    currency: "USD",
    paidFromAccountId: cash,
    expenseAccountId: expense,
    memo: "Lessons",
    subjectId: parent,
  });
  const postings = await f.query("finance:getPostings", {
      jeId: created.journalId,
    }),
    posting = postings.find(
      (p: { account_id: string }) => p.account_id === expense,
    );
  const classification = await f.query("finance:getAttribution", {
    postingId: posting._id,
  });
  await f.mutation("finance:replaceAttribution", {
    postingId: posting._id,
    expectedRevision: classification.set.revision,
    reason: "Recorded beneficiary split",
    portions: [
      {
        minor_units: 10000,
        unclassified: false,
        subject_entity_id: parent,
        beneficiaries: [
          { entity_id: child, unassigned: false, share_bps: 6000 },
          { entity_id: parent, unassigned: false, share_bps: 4000 },
        ],
      },
    ],
  });
  const args = {
    from: "2026-09-01",
    through: "2026-09-30",
    metric: "expenses",
  };
  const subject = await f.query("agentFinance:summary", {
      ...args,
      entityId: parent,
    }),
    benefit = await f.query("agentFinance:summary", {
      ...args,
      beneficiaryId: child,
    });
  expect(subject.rows[0].minorUnits).toBe(10000);
  expect(benefit.rows[0].minorUnits).toBe(6000);
});

test("current-claim index follows payment and reversal and ignores thousands of closed historical claims", async () => {
  const f = await setup(),
    chart = await f.mutation("finance:createChart", { name: "Claims" });
  const cash = await f.mutation("finance:createAccount", {
      chartId: chart,
      name: "Checking",
      type: "Asset",
      normal_balance: "Debit",
      currency: "USD",
    }),
    expense = await f.mutation("finance:createAccount", {
      chartId: chart,
      name: "Rent",
      type: "Expense",
      normal_balance: "Debit",
      currency: "USD",
    });
  const debtor = await f.mutation("entities:create", {
      kind: "Person",
      display_name: "Avery",
    }),
    creditor = await f.mutation("entities:create", {
      kind: "Organization",
      display_name: "Harbor",
    });
  const banking = await f.mutation("arrangements:create", {
    kind: "Banking",
    name: "Checking relationship",
    valid_from: 0,
  });
  await f.mutation("finance:createFinancialAccount", {
    arrangement_id: banking,
    ledger_account_id: cash,
    kind: "Checking",
    currency: "USD",
  });
  const claim = await f.mutation("obligations:create", {
    creditor_id: creditor,
    debtor_id: debtor,
    due_date: "2026-09-01",
    minor_units: 10000,
    currency: "USD",
  });
  const queryArgs = {
    from: "2026-09-18",
    through: "2026-09-30",
    includeEvents: false,
    includeProjections: false,
  };
  expect(
    (await f.query("agentTimeline:timeline", queryArgs)).items.map(
      (i: { id: string }) => i.id,
    ),
  ).toContain(claim);
  const payment = await f.mutation("agentWrites:recordExpense", {
    date: "2026-09-18",
    amount: "100.00",
    currency: "USD",
    paidFromAccountId: cash,
    expenseAccountId: expense,
    memo: "Rent paid",
  });
  const postings = await f.query("finance:getPostings", {
    jeId: payment.journalId,
  });
  await f.mutation("obligations:settle", {
    obligationId: claim,
    capacityPostingId: postings.find(
      (p: { account_id: string }) => p.account_id === cash,
    )._id,
    minor_units: 10000,
    settlement_date: "2026-09-18",
  });
  expect(
    (await f.query("agentTimeline:timeline", queryArgs)).items,
  ).toHaveLength(0);
  await f.mutation("finance:reverseJournalEntry", {
    jeId: payment.journalId,
    accounting_date: "2026-09-19",
    reason: "Bank rejected payment",
  });
  expect(
    (await f.query("agentTimeline:timeline", queryArgs)).items[0].amount,
  ).toBe("100.00");
  const { indexObligation } =
    await import("../convex/lib/lifeQueries/obligationIndex");
  await f.t.run(async (ctx) => {
    const dataset = await ctx.db.get(f.datasetId);
    for (let i = 0; i < 2100; i++) {
      const id = await ctx.db.insert("monetary_obligation", {
        dataset_id: f.datasetId,
        user_id: dataset!.user_id,
        created_at: 0,
        creditor_id: creditor,
        debtor_id: debtor,
        due_date: "2020-01-01",
        original_minor_units: 100,
        currency: "USD",
        voided_at: 1,
        void_reason: "Historical canceled claim",
      });
      await indexObligation(ctx, f.datasetId, id);
    }
  });
  const result = await f.query("agentTimeline:timeline", queryArgs);
  expect(result.queryComplete).toBe(true);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].id).toBe(claim);
}, 30000);

test("measurement lookup pages by date/subject, retains old owner references, and does not scan years of unrelated values", async () => {
  const f = await setup(),
    person = await f.mutation("entities:create", {
      kind: "Person",
      display_name: "Avery",
    });
  await f.t.run(async (ctx) => {
    const dataset = await ctx.db.get(f.datasetId),
      base = {
        user_id: dataset!.user_id,
        dataset_id: f.datasetId,
        created_at: 0,
        recorded_at: 0,
        m_type: "observed" as const,
      };
    for (let i = 0; i < 2100; i++)
      await ctx.db.insert("measurement", {
        ...base,
        subject: { kind: "entity", id: person },
        name: "Height",
        value: { decimal: "160", unit: "cm" },
        as_of: Date.UTC(2010, 0, 1) + i * 86400000,
      });
    await ctx.db.insert("measurement", {
      ...base,
      subject: { kind: "entity", id: person },
      name: "Height",
      value: { decimal: "170", unit: "cm" },
      as_of: Date.UTC(2026, 8, 18, 12),
    });
    await ctx.db.insert("measurement", {
      ...base,
      owner_type: "entity",
      owner_id: person,
      name: "Height",
      value: { decimal: "169", unit: "cm" },
      as_of: Date.UTC(2026, 8, 17, 12),
    });
  });
  let cursor: string | undefined;
  const values: string[] = [];
  do {
    const result = await f.query("agentLife:measurements", {
      from: "2026-09-01",
      through: "2026-09-30",
      subjectId: person,
      ...(cursor ? { cursor } : {}),
    });
    values.push(
      ...result.items.map(
        (r: { value: { decimal: string } }) => r.value.decimal,
      ),
    );
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  expect(values).toEqual(["170", "169"]);
}, 30000);
