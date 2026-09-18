/** Prepare/check the long-source acceptance fixture using scoped production operations. */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../.convex/query-evaluation/", import.meta.url),
  c = JSON.parse(
    await readFile(new URL("write-credentials.json", root), "utf8"),
  );
const client = new Client(
  { name: "Long source fixture", version: "1" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"), {
    authProvider: { token: async () => c.token },
  }),
);
const target = { kind: "arrangement", id: c.fixture.arrangementId };
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({
    name,
    arguments: { datasetId: c.datasetId, ...(name.startsWith("details.") ? { target } : {}), ...args },
  });
  assert(!r.isError, `${name} failed`);
  return r.structuredContent as any;
}
async function source(commit: string) {
  let offset = 0,
    text = "";
  do {
    const r = await call("details.read", { commit, offset, limit: 12000 });
    assert.equal(r.commit, commit);
    text += r.source;
    offset = r.nextOffset ?? -1;
  } while (offset >= 0);
  return text;
}
try {
  const file = new URL("long-note-baseline.json", root);
  if (process.argv[2] === "prepare") {
    try {
      await readFile(file);
      console.log("Long-note baseline already exists; preserving it.");
    } catch {
      const current = await call("details.read", { detail: "metadata" });
      const r = await call("details.append", {
        expectedCommit: current.commit,
        text:
          "## Isolated historical note volume fixture\n\n" +
          "Archived inspection entry: routine inspection completed; no change to lease terms.\n".repeat(
            600,
          ),
      });
      const text = await source(r.commit);
      assert(text.length > 40000);
      await writeFile(
        file,
        JSON.stringify({ commit: r.commit, length: text.length }),
        { mode: 0o600 },
      );
      console.log(JSON.stringify({ prepared: true, characters: text.length }));
    }
  } else {
    const base = JSON.parse(await readFile(file, "utf8")),
      before = await source(base.commit),
      current = await call("details.read", { detail: "metadata" }),
      after = await source(current.commit);
    const expected =
      "The landlord requires advance notice for overnight guests.";
    assert.equal(
      after,
      before +
        (before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") +
        expected +
        "\n",
    );
    const person = await call("life.search", { query: "Riley Ellis", kind: "entity" });
    assert.equal(person.identityStatus, "unique");
    assert.equal(person.items[0].name, "Riley Ellis");
    const note = await call("details.read", { target: { kind: "entity", id: person.items[0].id } });
    assert(note.source.includes("Riley prefers email for appointment reminders."));
    const links = await call("life.relationships", { entityId: person.items[0].id, limit: 50 });
    assert.equal(links.items.length, 0, "No relationship was requested for the new person");
    console.log(
      JSON.stringify({
        passed: true,
        originalCharacters: before.length,
        finalCharacters: after.length,
        unchangedPrefix: true,
        exactlyOneAppend: true,
        newPersonAndSourceVerified: true,
      }),
    );
  }
} finally {
  await client.close();
}
