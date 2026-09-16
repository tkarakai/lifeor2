/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { components } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js"]);
const authModules = import.meta.glob("../node_modules/@convex-dev/better-auth/src/component/**/*.ts");
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterAuth", authSchema, authModules);
  async function login(email: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: email, email, emailVerified: true, createdAt: now, updatedAt: now } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId: user._id, token: email, expiresAt: now + 3600000, createdAt: now, updatedAt: now } } });
    return t.withIdentity({ subject: user._id, sessionId: session._id });
  }
  return { t, alice: await login("audit-alice@example.test"), bob: await login("audit-bob@example.test") };
}
async function fixture() {
  const base = await setup();
  const { alice } = base;
  const creditor = await alice.mutation(anyApi.entities.create, { kind: "Person", display_name: "Creditor" });
  const debtor = await alice.mutation(anyApi.entities.create, { kind: "Person", display_name: "Debtor" });
  const chart = await alice.mutation(anyApi.finance.createChart, { name: "Audit chart", reportingEntityId: creditor });
  async function account(name: string, type: "Asset" | "Income" | "Equity", currency = "USD") {
    return alice.mutation(anyApi.finance.createAccount, { chartId: chart, name, type, currency, normal_balance: type === "Asset" ? "Debit" : "Credit" });
  }
  const cash = await account("Checking", "Asset"), receivable = await account("Receivable", "Asset"), income = await account("Income", "Income");
  const arrangement = await alice.mutation(anyApi.arrangements.create, { kind: "Cash account", name: "Checking relationship", valid_from: 0 });
  const financialAccount = await alice.mutation(anyApi.finance.createFinancialAccount, { arrangement_id: arrangement, ledger_account_id: cash, kind: "Checking", currency: "USD" });
  async function journal(lines: { accountId: Id<"ledger_account">; minor_units: number; currency?: string }[], status: "draft" | "posted" = "posted") {
    const event = await alice.mutation(anyApi.events.create, { kind: "Audit", occurred_at: 0, payload_json: "{}" });
    const id = await alice.mutation(anyApi.finance.createJournalEntry, { chartId: chart, eventId: event, memo: "Audit journal", accounting_date: "2026-01-01", status, postings: lines.map(p => ({ currency: "USD", description: "Audit", ...p })) });
    const postings = await alice.query(anyApi.finance.getPostings, { jeId: id }) as { _id: Id<"posting">; account_id: Id<"ledger_account">; minor_units: number }[];
    return { id, postings, posting: (accountId: string) => postings.find(p => p.account_id === accountId)!._id };
  }
  async function obligation(amount = 10000, recognition?: Id<"posting">) {
    return alice.mutation(anyApi.obligations.create, { creditor_id: creditor, debtor_id: debtor, due_date: "2026-10-01", minor_units: amount, currency: "USD", ...(recognition ? { recognition_posting_id: recognition } : {}) });
  }
  async function expected(amount: number, key: string, obligationId?: Id<"monetary_obligation">) {
    const source = obligationId ? { obligation_id: obligationId } : { assumption_id: await alice.mutation(anyApi.planning.createAssumption, { name: key, source: "Audit estimate", value: { kind: "amount", amount: { minor_units: amount, currency: "USD" } } }) };
    return alice.mutation(anyApi.planning.createExpectedFlow, { expected_date: "2026-10-01", minor_units: amount, currency: "USD", account_id: cash, occurrence_key: key, input_revision: 1, ...source });
  }
  return { ...base, chart, creditor, debtor, cash, receivable, income, arrangement, financialAccount, account, journal, obligation, expected };
}

test("AUDIT-F1: reversing a recognition journal cannot leave an open obligation with zero receivable", async () => {
  const f = await fixture();
  const recognized = await f.journal([{ accountId: f.receivable, minor_units: 10000 }, { accountId: f.income, minor_units: -10000 }]);
  const obligation = await f.obligation(10000, recognized.posting(f.receivable));
  // Either reject the reversal or atomically reverse its obligation effect; never diverge.
  await f.alice.mutation(anyApi.finance.reverseJournalEntry, { jeId: recognized.id, accounting_date: "2026-01-02", reason: "Recognition correction" }).catch(() => null);
  const obligations = await f.alice.query(anyApi.obligations.list, {}) as { _id: string; outstanding_minor_units: number; voided_at?: number }[];
  const balance = await f.alice.query(anyApi.finance.getAccountBalance, { accountId: f.receivable });
  const current = obligations.find(o => o._id === obligation)!;
  expect(current.voided_at === undefined ? current.outstanding_minor_units : 0).toBe(balance.minor_units);
});

test("AUDIT-F2: reversing an already-settled increase cannot create negative outstanding", async () => {
  const f = await fixture();
  const recognized = await f.journal([{ accountId: f.receivable, minor_units: 10000 }, { accountId: f.income, minor_units: -10000 }]);
  const obligation = await f.obligation(10000, recognized.posting(f.receivable));
  const event = await f.alice.mutation(anyApi.events.create, { kind: "Audit", occurred_at: 0, payload_json: "{}" });
  const adjustment = await f.alice.mutation(anyApi.obligations.adjust, { obligationId: obligation, minor_units: 10000, effective_date: "2026-01-02", reason: "Additional approved charge", recognitionAccountId: f.receivable, journal: { chartId: f.chart, eventId: event, memo: "Increase", accounting_date: "2026-01-02", postings: [{ accountId: f.receivable, minor_units: 10000, currency: "USD", description: "Increase" }, { accountId: f.income, minor_units: -10000, currency: "USD", description: "Increase" }] } });
  const payment = await f.journal([{ accountId: f.cash, minor_units: 20000 }, { accountId: f.receivable, minor_units: -20000 }]);
  await f.alice.mutation(anyApi.obligations.settle, { obligationId: obligation, capacityPostingId: payment.posting(f.cash), recognitionPostingId: payment.posting(f.receivable), minor_units: 20000, settlement_date: "2026-01-03" });
  const adjustmentJournal = await f.t.run(async ctx => {
    const row = await ctx.db.get("obligation_adjustment", adjustment);
    return (await ctx.db.get("posting", row!.posting_id!))!.je_id;
  });
  await f.alice.mutation(anyApi.finance.reverseJournalEntry, { jeId: adjustmentJournal, accounting_date: "2026-01-04", reason: "Undo increase" }).catch(() => null);
  const rows = await f.alice.query(anyApi.obligations.list, {}) as { _id: string; outstanding_minor_units: number }[];
  expect(rows.find(o => o._id === obligation)!.outstanding_minor_units).toBeGreaterThanOrEqual(0);
});

test.each(["settle-first", "fulfill-first"])("AUDIT-P1: shared settlement/forecast payment capacity (%s)", async order => {
  const f = await fixture();
  const obligation = await f.obligation();
  await f.expected(10000, "obligation-receipt", obligation);
  const standalone = await f.expected(10000, "independent-receipt");
  const receipt = await f.journal([{ accountId: f.cash, minor_units: 10000 }, { accountId: f.income, minor_units: -10000 }]);
  const settle = () => f.alice.mutation(anyApi.obligations.settle, { obligationId: obligation, capacityPostingId: receipt.posting(f.cash), minor_units: 10000, settlement_date: "2026-01-01" });
  const fulfill = () => f.alice.mutation(anyApi.planning.fulfillExpectedFlow, { id: standalone, postingId: receipt.posting(f.cash), minor_units: 10000 });
  await (order === "settle-first" ? settle() : fulfill());
  await (order === "settle-first" ? fulfill() : settle()).catch(() => null);
  const flows = await f.alice.query(anyApi.planning.listExpectedFlows, {}) as { remaining_minor_units: number }[];
  expect(flows.reduce((sum, flow) => sum + flow.remaining_minor_units, 0)).toBe(10000);
});

test("AUDIT-P2: actual manifest inputs exclude draft journals", async () => {
  const f = await fixture();
  const draft = await f.journal([{ accountId: f.cash, minor_units: 10000 }, { accountId: f.income, minor_units: -10000 }], "draft");
  const plan = await f.alice.mutation(anyApi.planning.createPlan, { name: "Draft exclusion" });
  await expect(f.alice.mutation(anyApi.planning.createPlanVersion, { planId: plan, period_start: "2026-01-01", period_end: "2026-12-31", inputs: [{ target: { kind: "journal_entry", id: draft.id }, label: "Actual cash receipt" }], git_revisions: [], resolved_tag_targets: [], actual_boundary: Date.now() })).rejects.toThrow();
});

test("AUDIT-P3: an incurred schedule occurrence cannot be forecast a second time under an obligation alias", async () => {
  const f = await fixture();
  const schedule = await f.alice.mutation(anyApi.obligations.createSchedule, { arrangement_id: f.arrangement, name: "Recurring receipt", creditor_id: f.creditor, debtor_id: f.debtor, amount: { minor_units: 10000, currency: "USD" }, currency: "USD", recurrence: { frequency: "monthly", interval: 1 }, start_date: "2026-01-01", timezone: "UTC", valid_from: 0 });
  const schedules = await f.alice.query(anyApi.obligations.listSchedules, {}) as { _id: string; versions: { _id: Id<"commitment_schedule_version"> }[] }[];
  const version = schedules.find(s => s._id === schedule)!.versions[0]._id;
  const occurrence = `${version}:2026-10`;
  await f.alice.mutation(anyApi.planning.createExpectedFlow, { expected_date: "2026-10-01", minor_units: 10000, currency: "USD", account_id: f.cash, schedule_version_id: version, occurrence_key: occurrence, input_revision: 1 });
  const obligation = await f.alice.mutation(anyApi.obligations.create, { creditor_id: f.creditor, debtor_id: f.debtor, due_date: "2026-10-01", minor_units: 10000, currency: "USD", schedule_version_id: version, occurrence_key: occurrence });
  await expect(f.expected(10000, "different-client-alias", obligation)).rejects.toThrow();
});

test("AUDIT-C1: settlement over-capacity and foreign access are rejected, and payment reversal restores outstanding", async () => {
  const f = await fixture();
  const first = await f.obligation(10000), second = await f.obligation(10000);
  const receipt = await f.journal([{ accountId: f.cash, minor_units: 10000 }, { accountId: f.income, minor_units: -10000 }]);
  const args = { obligationId: first, capacityPostingId: receipt.posting(f.cash), minor_units: 10000, settlement_date: "2026-01-01" };
  await expect(f.bob.mutation(anyApi.obligations.settle, args)).rejects.toThrow("access denied");
  await expect(f.bob.mutation(anyApi.finance.reverseJournalEntry, { jeId: receipt.id, accounting_date: "2026-01-02", reason: "Foreign reversal" })).rejects.toThrow("access denied");
  await f.alice.mutation(anyApi.obligations.settle, args);
  await expect(f.alice.mutation(anyApi.obligations.settle, { ...args, obligationId: second, minor_units: 1 })).rejects.toThrow("capacity");
  await f.alice.mutation(anyApi.finance.reverseJournalEntry, { jeId: receipt.id, accounting_date: "2026-01-02", reason: "Returned receipt" });
  const rows = await f.alice.query(anyApi.obligations.list, {}) as { _id: string; outstanding_minor_units: number }[];
  expect(rows.find(o => o._id === first)!.outstanding_minor_units).toBe(10000);
  await expect(f.alice.mutation(anyApi.finance.reverseJournalEntry, { jeId: receipt.id, accounting_date: "2026-01-03", reason: "Duplicate" })).rejects.toThrow();
});

test("AUDIT-C2: drafts do not affect actual balances and mixed-currency imbalance is atomic", async () => {
  const f = await fixture();
  const draft = await f.journal([{ accountId: f.cash, minor_units: 10000 }, { accountId: f.income, minor_units: -10000 }], "draft");
  expect((await f.alice.query(anyApi.finance.getAccountBalance, { accountId: f.cash })).minor_units).toBe(0);
  const euro = await f.account("Euro income", "Income", "EUR");
  await expect(f.journal([{ accountId: f.cash, minor_units: 10000 }, { accountId: euro, minor_units: -10000, currency: "EUR" }])).rejects.toThrow("per currency");
  expect(await f.alice.query(anyApi.finance.listJournalEntries, { chartId: f.chart })).toHaveLength(1);
  await f.alice.mutation(anyApi.finance.postDraft, { jeId: draft.id });
  expect((await f.alice.query(anyApi.finance.getAccountBalance, { accountId: f.cash })).minor_units).toBe(10000);
});

test("AUDIT-P4: an actual-data boundary cannot claim to predate a captured posted journal", async () => {
  const f = await fixture();
  const receipt = await f.journal([{ accountId: f.cash, minor_units: 10000 }, { accountId: f.income, minor_units: -10000 }]);
  const plan = await f.alice.mutation(anyApi.planning.createPlan, { name: "Historical knowledge cutoff" });
  await expect(f.alice.mutation(anyApi.planning.createPlanVersion, { planId: plan, period_start: "2026-01-01", period_end: "2026-12-31", inputs: [{ target: { kind: "journal_entry", id: receipt.id }, label: "Actual receipt recorded today" }], git_revisions: [], resolved_tag_targets: [], actual_boundary: 0 })).rejects.toThrow();
});

test("AUDIT-C3: reconciliation matches enforce sign, source/posting capacity, ownership, and accepted immutability", async () => {
  const f = await fixture();
  const receipt = await f.journal([{ accountId: f.cash, minor_units: 10000 }, { accountId: f.income, minor_units: -10000 }]);
  const evidence = await f.alice.mutation(anyApi.evidence.create, { kind: "statement", namespace: "audit", external_key: "jan", content_ref: "immutable:jan" });
  const statement = await f.alice.mutation(anyApi.observations.createStatement, { financial_account_id: f.financialAccount, evidence_id: evidence, period_start: "2026-01-01", period_end: "2026-02-01", closing: { minor_units: 10000, currency: "USD" } });
  const line = await f.alice.mutation(anyApi.observations.addStatementLine, { statement_id: statement, external_key: "receipt", posting_date: "2026-01-01", status: "posted", minor_units: 10000, currency: "USD", raw_source_ref: "immutable:jan:receipt" });
  const reconciliation = await f.alice.mutation(anyApi.observations.reconcile, { financial_account_id: f.financialAccount, statement_id: statement, cutoff: Date.parse("2026-01-31T23:59:59Z") });
  const args = { reconciliation_id: reconciliation, line_id: line, posting_id: receipt.posting(f.cash), minor_units: 6000, reason: "Matched receipt portion" };
  await expect(f.bob.mutation(anyApi.observations.match, args)).rejects.toThrow("access denied");
  await expect(f.alice.mutation(anyApi.observations.match, { ...args, minor_units: -1 })).rejects.toThrow("sign");
  await f.alice.mutation(anyApi.observations.match, args);
  await expect(f.alice.mutation(anyApi.observations.match, args)).rejects.toThrow("capacity");
  const accepted = await f.alice.mutation(anyApi.observations.reconcile, { financial_account_id: f.financialAccount, statement_id: statement, cutoff: Date.parse("2026-01-31T23:59:59Z"), accept: true, supersedes_id: reconciliation });
  await expect(f.alice.mutation(anyApi.observations.match, { ...args, reconciliation_id: accepted, minor_units: 1 })).rejects.toThrow("immutable");
  await expect(f.bob.query(anyApi.observations.list, { financialAccountId: f.financialAccount })).rejects.toThrow("access denied");
});

test("AUDIT-C4: attribution replacement partitions funds atomically and reversal freezes the analytical effect", async () => {
  const f = await fixture();
  const receipt = await f.journal([{ accountId: f.cash, minor_units: 101 }, { accountId: f.income, minor_units: -101 }]);
  const postingId = receipt.posting(f.cash);
  const invalid = { postingId, expectedRevision: 1, portions: [{ minor_units: 102, unclassified: true, beneficiaries: [{ unassigned: true, share_bps: 10000 }] }] };
  await expect(f.alice.mutation(anyApi.finance.replaceAttribution, invalid)).rejects.toThrow("partition");
  await expect(f.bob.mutation(anyApi.finance.replaceAttribution, invalid)).rejects.toThrow("access denied");
  const valid = { postingId, expectedRevision: 1, portions: [{ minor_units: 101, subject_entity_id: f.creditor, unclassified: false, beneficiaries: [{ entity_id: f.creditor, unassigned: false, share_bps: 5000 }, { entity_id: f.debtor, unassigned: false, share_bps: 5000 }] }] };
  await f.alice.mutation(anyApi.finance.replaceAttribution, valid);
  await expect(f.alice.mutation(anyApi.finance.replaceAttribution, valid)).rejects.toThrow("Revision conflict");
  const before = await f.alice.query(anyApi.finance.getAttribution, { postingId });
  const reversed = await f.alice.mutation(anyApi.finance.reverseJournalEntry, { jeId: receipt.id, accounting_date: "2026-01-02", reason: "Return" });
  const postings = await f.alice.query(anyApi.finance.getPostings, { jeId: reversed }) as { _id: string; reverses_id?: string }[];
  const after = await f.alice.query(anyApi.finance.getAttribution, { postingId: postings.find(p => p.reverses_id === postingId)!._id });
  type Beneficiary = { entity_id?: string; minor_units: number };
  const beforeAmounts = Object.fromEntries((before.portions[0].beneficiaries as Beneficiary[]).map(b => [b.entity_id, b.minor_units]));
  for (const row of after.portions[0].beneficiaries as Beneficiary[]) expect(row.minor_units).toBe(-beforeAmounts[row.entity_id!]);
  await expect(f.alice.mutation(anyApi.finance.replaceAttribution, { ...valid, expectedRevision: 2 })).rejects.toThrow("frozen");
});
