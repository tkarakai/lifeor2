/** Isolated long profile with one independently known birthday near the end. */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../.convex/query-evaluation/", import.meta.url);
const c = JSON.parse(await readFile(new URL("mixed-debt-credentials.json", root), "utf8"));
const client = new Client({ name: "Profile source fixture", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"), { authProvider: { token: async () => c.token } }));
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: { datasetId: c.datasetId, ...args } });
  assert(!result.isError, name + " failed"); return result.structuredContent as any;
}
try {
  const id = await call("entities.create", { requestKey: ["profile", "source", "fixture", "quinn", "v1"].join("-"), kind: "Person", display_name: "Quinn Rowan" });
  const target = { kind: "entity", id };
  const source = "# Quinn Rowan\n\n" + "Archived address review: contact information unchanged.\n".repeat(1200) + "\nDate of birth: February 12, 1990. Birthday: February 12.\n";
  const before = await call("details.read", { target, detail: "metadata" });
  if (before.availability === "missing") await call("details.save", { target, source, expectedCommit: null });
  const metadata = await call("details.read", { target, detail: "metadata" });
  const actual = await call("details.revision", { target, commit: metadata.commit });
  assert.equal(actual.source, source, "Never overwrite an altered fixture source");
  const match = await call("details.read", { documentId: metadata.documentId, commit: metadata.commit, query: "birthday birth" });
  assert.equal(match.queryComplete, true); assert.equal(match.matchingLineCount, 1);
  assert(match.items[0].excerpts[0].text.includes("February 12, 1990"));
  assert(match.items[0].excerpts[0].start > 60000);
  assert.deepEqual(match.target, target);
  const absent = await call("details.read", { documentId: metadata.documentId, query: "birthplace city" });
  assert.equal(absent.queryComplete, true); assert.equal(absent.items.length, 0);
  await writeFile(new URL("profile-source-fixture.json", root), JSON.stringify({ passed: true, target, documentId: metadata.documentId, commit: metadata.commit, sourceLength: source.length, birthday: "1990-02-12" }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, sourceCharacters: source.length, matchingLines: 1, birthday: "1990-02-12", scopedAbsence: true }));
} finally { await client.close(); }
