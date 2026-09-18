import { readFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const c = JSON.parse(
  await readFile(
    new URL("../../.convex/query-evaluation/credentials.json", import.meta.url),
    "utf8",
  ),
);
const client = new ConvexHttpClient("http://127.0.0.1:3340");
const start = Date.now();
const result = await client.query(
  makeFunctionReference<"query">(process.argv[2] ?? "agentTimeline:timeline"),
  {
    agentToken: c.token,
    datasetId: c.datasetId,
    ...JSON.parse(process.argv[3] ?? "{}"),
  },
);
console.log(JSON.stringify({ elapsedMs: Date.now() - start, result }));
