/** Verify negative inference did not invent a household/timezone or mutate the calendar. */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../.convex/query-evaluation/", import.meta.url);
const c = JSON.parse(await readFile(new URL("write-final-credentials.json", root), "utf8"));
const snapshot = new URL("unconfigured-scope-snapshot.json", root);
const client = new Client({ name: "Unconfigured scope oracle", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"), { authProvider: { token: async () => c.token } }));
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: { datasetId: c.datasetId, ...args } });
  assert(!result.isError, name + " failed"); return result.structuredContent as any;
}
try {
  const context = await call("life.context");
  assert.equal(context.defaultHousehold, null);
  assert.equal(context.timezoneConfigured, false);
  assert.equal(context.timezone, "UTC");
  const events = await call("life.events");
  assert.equal(events.queryComplete, true);
  const state = { datasetId: c.datasetId, defaultHousehold: context.defaultHousehold, timezone: context.timezone, timezoneConfigured: context.timezoneConfigured, events: events.items };
  if (process.argv.includes("--before")) {
    await writeFile(snapshot, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ passed: true, phase: "before", configuredHousehold: false, configuredTimezone: false, currentEvents: events.items.length }));
  } else {
    assert.deepEqual(state, JSON.parse(await readFile(snapshot, "utf8")), "Scope configuration or calendar changed during a required clarification");
    console.log(JSON.stringify({ passed: true, phase: "after", scopeAndCalendarUnchanged: true, currentEvents: events.items.length }));
  }
} finally { await client.close(); }
