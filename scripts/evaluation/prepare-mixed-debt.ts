/** Add one balanced, recognized overdue payable beside the sample's overdue receivable. */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../.convex/query-evaluation/", import.meta.url);
const c = JSON.parse(await readFile(new URL("mixed-debt-credentials.json", root), "utf8"));
const client = new Client({ name: "Mixed debt fixture", version: "1" }, {
  versionNegotiation: { mode: { pin: "2026-07-28" } },
});
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"), {
  authProvider: { token: async () => c.token },
}));
async function call(name: string, args: Record<string, unknown>, key?: string) {
  const r = await client.callTool({ name, arguments: {
    datasetId: c.datasetId, ...args, ...(key ? { requestKey: "mixed-debt-fixture-v1-" + key } : {}),
  } });
  assert(!r.isError, name + " failed: " + JSON.stringify(r.structuredContent));
  return r.structuredContent as any;
}
try {
  const context = await call("life.context", {});
  const household = context.defaultHousehold.id;
  const chartId = context.charts.find((x: any) => x.name === "Morgan household · USD").id;
  const expense = await call("life.search", { query: "Rental maintenance", kind: "account" });
  assert.equal(expense.identityStatus, "unique");
  const vendor = await call("entities.create", { display_name: "Garden Services", kind: "Organization" }, "vendor");
  const payable = await call("finance.createAccount", {
    chartId, name: "Garden invoices payable", type: "Liability", normal_balance: "Credit", currency: "USD",
  }, "payable");
  const arrangementId = await call("arrangements.create", {
    kind: "Service", name: "Garden repair invoice", valid_from: Date.parse("2026-09-01T05:00:00Z"),
  }, "agreement");
  const eventId = await call("events.create", {
    kind: "PropertyMaintenance", title: "Garden repair invoice incurred", occurred_at: Date.parse("2026-09-01T15:00:00Z"),
  }, "event");
  const journalId = await call("finance.createJournalEntry", {
    chartId, eventId, memo: "Garden repair invoice incurred, unpaid", accounting_date: "2026-09-01", status: "posted",
    postings: [
      { accountId: expense.items[0].id, minor_units: 55555, currency: "USD", description: "Incurred garden repair" },
      { accountId: payable, minor_units: -55555, currency: "USD", description: "Garden invoice payable" },
    ],
  }, "journal");
  const postings = await call("finance.getPostings", { jeId: journalId });
  assert.equal(postings.reduce((sum: number, p: any) => sum + p.minor_units, 0), 0);
  const recognition = postings.find((p: any) => p.account_id === payable);
  assert.equal(recognition.minor_units, -55555);
  const claimId = await call("obligations.create", {
    creditor_id: vendor, debtor_id: household, due_date: "2026-09-10", minor_units: 55555,
    currency: "USD", arrangement_id: arrangementId, event_id: eventId, recognition_posting_id: recognition._id,
  }, "claim");
  const incoming = await call("life.obligations", { scope: "household", creditorQuery: "Morgan family", overdueOnly: true });
  const outgoing = await call("life.obligations", { scope: "household", debtorQuery: "Morgan family", overdueOnly: true });
  const all = await call("life.obligations", { scope: "household" });
  assert.equal(incoming.items.length, 1); assert.equal(incoming.items[0].amount, "700.00");
  assert.equal(incoming.items[0].debtor, "Casey Chen");
  assert.equal(outgoing.items.length, 1); assert.equal(outgoing.items[0].amount, "555.55");
  assert.equal(outgoing.items[0].creditor, "Garden Services");
  assert.equal(all.items.length, 3);
  assert.deepEqual(all.items.map((x: any) => x.amount).sort(), ["15000.00", "555.55", "700.00"]);
  const result = { passed: true, at: new Date().toISOString(), household, vendor, payable, journalId, claimId,
    incoming: incoming.items, outgoing: outgoing.items, all: all.items };
  await writeFile(new URL("mixed-debt-fixture.json", root), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, balancedInvoice: "555.55 USD", overdueReceivable: "700.00 USD", unpaidClaims: 3 }));
} finally { await client.close(); }
