import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { readFile, writeFile } from "node:fs/promises";
const c = JSON.parse(
  await readFile(
    new URL("../../.convex/query-evaluation/credentials.json", import.meta.url),
    "utf8",
  ),
);
const client = new Client(
  { name: "Evaluation direct checks", version: "1" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"), {
    authProvider: { token: async () => c.token },
  }),
);
const start = Date.now(),
  r = await client.callTool({
    name: process.argv[2],
    arguments: {
      datasetId: c.datasetId,
      ...JSON.parse(process.argv[3] ?? "{}"),
    },
  });
const result = {
  elapsedMs: Date.now() - start,
  isError: r.isError ?? false,
  result: r.structuredContent,
};
if (process.argv[4]) {
  await writeFile(process.argv[4], JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      elapsedMs: result.elapsedMs,
      isError: result.isError,
      file: process.argv[4],
    }),
  );
} else console.log(JSON.stringify(result));
await client.close();
