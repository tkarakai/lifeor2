/** Independent postconditions for natural relative dates and conversational corrections. */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../.convex/query-evaluation/", import.meta.url);
const tag = process.argv.find((a) => a.startsWith("--tag="))?.slice(6) ?? "";
assert(/^[a-z0-9-]{0,40}$/.test(tag), "Use a simple fixture tag");
const suffix = tag ? "-" + tag : "";
const f = JSON.parse(await readFile(new URL(`relative-calendar-fixture${suffix}.json`, root), "utf8"));
const credentialFile = f.credentials ?? "write-credentials.json";
assert(/^[a-z0-9-]+\.json$/.test(credentialFile));
const c = JSON.parse(await readFile(new URL(credentialFile, root), "utf8"));
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
assert.equal(today, f.localToday, "The suite must run within the prepared Chicago civil day");
const client = new Client({ name: "Relative calendar postconditions", version: "1" }, {
  versionNegotiation: { mode: { pin: "2026-07-28" } },
});
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"), {
  authProvider: { token: async () => c.token },
}));
async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: { datasetId: c.datasetId, ...args } });
  assert(!r.isError, name + " failed");
  return r.structuredContent as any;
}
try {
  const person = await call("life.search", { query: f.personName ?? "Robin Hayes", kind: "entity" });
  assert.equal(person.identityStatus, "unique");
  assert.equal(person.items[0].id, f.personId);
  const events = await call("life.events", { entityId: f.personId, query: f.title, limit: 50 });
  assert.equal(events.queryComplete, true);
  if (process.argv.includes("--before")) {
    assert.equal(events.items.length, 0, "Existing appointment: inspect before replaying creates");
    console.log(JSON.stringify({ passed: true, phase: "before", localToday: today }));
  } else {
    assert.equal(events.items.length, 1);
    assert.equal(events.items[0].occurredAt, f.instants[2]);
    assert.equal(events.items[0].title, f.title);
    let id = events.items[0].id;
    const chain = [];
    for (let i = 2; i >= 0; i--) {
      const r = await call("life.read", { kind: "event", id });
      assert.equal(new Date(r.record.occurred_at).toISOString(), f.instants[i]);
      assert.equal(r.record.title, f.title);
      chain.push({ id, occurredAt: f.instants[i] });
      if (i) {
        assert(r.record.corrects_id, "Every requested move must preserve its prior event");
        id = r.record.corrects_id;
      } else assert(!r.record.corrects_id, "Exactly two corrections of one original event");
    }
    const result = { passed: true, at: new Date().toISOString(), localToday: today, chain };
    await writeFile(new URL(`relative-calendar-postconditions${suffix}.json`, root), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result));
  }
} finally { await client.close(); }
