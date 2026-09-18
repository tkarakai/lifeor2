/** Inspect raw postings after actual-model writes on the 1,000× fixture. */
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const root = new URL("../../.convex/query-evaluation/", import.meta.url);
const c = JSON.parse(await readFile(new URL("credentials.json", root), "utf8"));
const client = new ConvexHttpClient("http://127.0.0.1:3340");
const records: any[] = [];
let cursor: string | undefined;
do {
  const page = await client.query(makeFunctionReference<"query">("agentQueries:searchJournals"), {
    agentToken: c.token, datasetId: c.datasetId,
    from: "2026-09-18", to: "2026-09-18", limit: 50,
    ...(cursor ? { cursor } : {}),
  });
  records.push(...page.records);
  cursor = page.nextCursor ?? undefined;
} while (cursor);
assert.equal(records.length, 4, "Exactly the two requested expenses and their reversals may be recorded on this otherwise empty day");
for (const spec of [{ memo: "Scale acceptance grocery receipt", amount: 1234, type: "Asset", account: /1042/ }, { memo: "Scale acceptance card receipt", amount: 4250, type: "Liability", account: /5512/ }]) {
const original = records.find(r => r.memo === spec.memo && !r.reversesId);
assert(original, "Missing original grocery receipt");
const reversal = records.find(r => r.reversesId === original.id);
assert(reversal, "Missing compensating journal linked to the original");
assert.equal(original.status, "posted");
assert.equal(reversal.status, "posted");
assert.equal(original.postings.length, 2);
assert.equal(reversal.postings.length, 2);
assert.equal(original.postings.reduce((n: number, p: any) => n + p.minorUnits, 0), 0);
const expense = original.postings.find((p: any) => p.type === "Expense");
const cash = original.postings.find((p: any) => p.type === spec.type);
assert.equal(expense.minorUnits, spec.amount);
assert.equal(cash.minorUnits, -spec.amount);
assert.match(expense.account, /grocer/i);
assert.match(cash.account, spec.account);
for (const p of original.postings) {
  assert.equal(p.currency, "USD");
  const matching = reversal.postings.filter((r: any) => r.accountId === p.accountId && r.currency === p.currency);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].minorUnits, -p.minorUnits);
}
}
const result = { at: new Date().toISOString(), passed: true, existingJournals: 308000,
  addedJournals: 4, journals: records.map(r => ({ id: r.id, memo: r.memo, reversesId: r.reversesId })),
  postedExpenses: ["12.34 USD bank", "42.50 USD card"], netAfterReversal: "0.00 USD" };
await writeFile(new URL("scale-write-oracle.json", root), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
