/** Serve production MCP against the disposable local evaluation backend. */
import { readFile } from "node:fs/promises";
const root = new URL("../../.convex/query-evaluation/", import.meta.url);
const credentials = JSON.parse(
  await readFile(new URL("credentials.json", root), "utf8"),
);
process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:3340";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3300";
process.env.DETAILS_REPOSITORY_PATH = new URL("details.git", root).pathname;
process.env.LIFEOR_REPORT_DIRECTORY = new URL("reports", root).pathname;
const { handleMcp } = await import("../../lib/mcp/server");
declare const Bun: {
  serve(options: {
    port: number;
    hostname: string;
    idleTimeout: number;
    fetch: (req: Request) => Promise<Response>;
  }): { port: number };
};
const server = Bun.serve({
  port: 3300,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  fetch: async (req) => {
    if (new URL(req.url).pathname !== "/mcp")
      return new Response("Local isolated evaluation");
    return handleMcp(req);
  },
});
console.log(
  `Production MCP evaluation endpoint: http://localhost:${server.port}/mcp (${credentials.datasetIds.length} isolated dataset)`,
);
