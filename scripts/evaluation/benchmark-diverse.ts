/** Validate varied 1,000× history against a separately computed arithmetic oracle. */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../.convex/query-evaluation/", import.meta.url);
const creds = JSON.parse(await readFile(new URL("diverse-credentials.json", root), "utf8"));
const oracle = JSON.parse(await readFile(new URL("diverse-oracle.json", root), "utf8"));
const progress = (await readFile(new URL("diverse-growth.jsonl", root), "utf8")).trim().split("\n").map(l => JSON.parse(l)).at(-1);
assert.equal(progress.next, 307692, "Stop growth at the exact target before measuring");
const client = new Client({ name: "Varied family benchmark", version: "1" }, { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: { pin: "2026-07-28" } } });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"), { authProvider: { token: async () => creds.token } }));
const cases: any[] = [];
const amount = (minor: number) => (minor / 100).toFixed(2);
async function call(name: string, args: Record<string, unknown>) {
 const start = performance.now();
 const r = await client.callTool({ name, arguments: { datasetId: creds.datasetId, ...args } }, { timeout: 180000 });
 assert(!r.isError, JSON.stringify(r.structuredContent));
 const data = r.structuredContent as any;
 cases.push({ name, args, elapsedMs: Math.round(performance.now()-start), bytes: JSON.stringify(data).length, pages: data.pages, examinedCells: data.examinedCells, examinedJournals: data.examinedJournals });
 return data;
}
try {
 const context = await call("life.context", {});
 const common = { scope: "household", from: "2010-01-01", through: "2025-12-31", groupBy: "year" };
 for (const metric of ["income", "expenses", "profit_loss"]) {
  const r = await call("reports.finances", { ...common, metric });
  assert.equal(r.queryComplete, true);
  const actual = metric === "profit_loss" ? r.profitLoss[0].netRecordedIncome : r.totals[0].amount;
  assert.equal(actual, metric === "profit_loss" ? "0.00" : amount(oracle.historicalExpenseMinor));
  cases.at(-1).actual = actual;
 }
 for (const name of ["Emma Morgan", "Noah Morgan"]) {
  const beneficiaryId = context.defaultHousehold.members.find((p: any) => p.name === name).id;
  const r = await call("reports.finances", { ...common, metric: "expenses", beneficiaryId });
  assert.equal(r.totals[0].amount, amount(oracle.beneficiariesMinor[name]));
  cases.at(-1).actual = r.totals[0].amount;
 }
 for (const [scope, expected] of [["household", "95719.77"], ["dataset", "164985.32"]]) {
  const r = await call("reports.finances", { scope, metric: "cash_balances", from: "2026-09-16", through: "2026-09-16" });
  assert.equal(r.cashSummary[0].cash, expected);
 }
 const alex = context.defaultHousehold.members.find((p: any) => p.name === "Alex Morgan").id;
 const recent = await call("life.events", { from: "2026-09-18", through: "2026-12-31", entityId: alex });
 assert.equal(recent.queryComplete, true); assert.equal(recent.items.length, 0);
 const result = { at: new Date().toISOString(), passed: true, modelInference: false, oracle, cases };
 await writeFile(new URL("diverse-benchmark.json", root), JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result, null, 2));
} finally { await client.close(); }
