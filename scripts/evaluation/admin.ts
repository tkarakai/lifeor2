import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const root = new URL("../../.convex/query-evaluation/", import.meta.url),
  creds = JSON.parse(await readFile(new URL("credentials.json", root), "utf8"));
const env = { ...process.env };
for (const key of [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
])
  delete env[key];
for (const line of (
  await readFile(new URL("workspace/.env.local", root), "utf8")
).split("\n")) {
  const at = line.indexOf("=");
  if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
}
if (env.CONVEX_SELF_HOSTED_URL !== "http://127.0.0.1:3340")
  throw new Error("Refusing non-evaluation backend");
const run = (name: string, args: unknown) =>
  JSON.parse(
    execFileSync(
      "node_modules/.bin/convex",
      ["run", name, JSON.stringify(args)],
      {
        cwd: new URL("workspace/", root),
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
for (const name of process.argv.includes("--obligations-only")
  ? ["backfillObligations"]
  : ["backfill", "backfillObligations"]) {
  let cursor: string | undefined,
    done = 0;
  do {
    const page = run("reportIndex:" + name, {
      datasetId: creds.datasetId,
      ...(cursor ? { cursor } : {}),
    });
    done += page.indexed;
    cursor = page.nextCursor ?? undefined;
    console.log(`${name}: indexed ${done}${cursor ? "" : "; ready"}`);
  } while (cursor);
}
