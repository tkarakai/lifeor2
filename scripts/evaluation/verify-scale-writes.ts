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
assert.equal(records.length, 2, "Exactly the requested expense and reversal may be recorded on the fixture's otherwise empty day");
const original = records.find(r => r.memo === "Scale acceptance grocery receipt" && !r.reversesId);
assert(original, "Missing original grocery receipt");
const reversal = records.find(r => r.reversesId === original.id);
assert(reversal, "Missing compensating journal linked to the original");
assert.equal(original.status, "posted");
assert.equal(reversal.status, "posted");
assert.equal(original.postings.length, 2);
assert.equal(reversal.postings.length, 2);
assert.equal(original.postings.reduce((n: number, p: any) => n + p.minorUnits, 0), 0);
const expense = original.postings.find((p: any) => p.type === "Expense");
const cash = original.postings.find((p: any) => p.type === "Asset");
assert.equal(expense.minorUnits, 1234);
assert.equal(cash.minorUnits, -1234);
assert.match(expense.account, /grocer/i);
assert.match(cash.account, /1042/);
for (const p of original.postings) {
  assert.equal(p.currency, "USD");
  const matching = reversal.postings.filter((r: any) => r.accountId === p.accountId && r.currency === p.currency);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].minorUnits, -p.minorUnits);
}
const result = { at: new Date().toISOString(), passed: true, existingJournals: 308000,
  addedJournals: 2, originalJournal: original.id, reversalJournal: reversal.id,
  postedExpense: "12.34 USD", netAfterReversal: "0.00 USD" };
await writeFile(new URL("scale-write-oracle.json", root), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
