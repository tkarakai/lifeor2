/** Resume synthetic history growth on the isolated evaluation deployment only. */
import { readFile, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const root = new URL("../../.convex/query-evaluation/", import.meta.url),
  creds = JSON.parse(await readFile(new URL("credentials.json", root), "utf8"));
const env = { ...process.env };
for (const k of [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
])
  delete env[k];
for (const line of (
  await readFile(new URL("workspace/.env.local", root), "utf8")
).split("\n")) {
  const at = line.indexOf("=");
  if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
}
if (env.CONVEX_SELF_HOSTED_URL !== "http://127.0.0.1:3340")
  throw new Error("Refusing non-evaluation backend");
const log = new URL("growth.jsonl", root);
let history: any[] = [];
try {
  history = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s));
} catch {}
let start = history.at(-1)?.next ?? 0;
const target = Number(process.argv[2] ?? 3080) - 308,
  began = Date.now();
while (start < target) {
  let count = Math.min(50, target - start),
    result: { next: number; [key: string]: unknown } | undefined;
  const at = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      result = JSON.parse(
        execFileSync(
          "node_modules/.bin/convex",
          [
            "run",
            "evaluationFixture:grow",
            JSON.stringify({ datasetId: creds.datasetId, start, count }),
          ],
          {
            cwd: new URL("workspace/", root),
            env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );
      break;
    } catch (error) {
      const message = String((error as { stderr?: string }).stderr ?? error);
      if (
        attempt === 5 ||
        !/OptimisticConcurrencyControlFailure|ExecutionTime|execution time|CPU time/i.test(
          message,
        )
      )
        throw error;
      if (/ExecutionTime|execution time|CPU time/i.test(message))
        count = Math.max(1, Math.floor(count / 2));
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (!result || result.next <= start)
    throw new Error("Growth made no progress");
  await appendFile(
    log,
    JSON.stringify({ ...result, elapsedMs: Date.now() - at }) + "\n",
  );
  start = result.next;
  if (history.length++ % 40 === 0 || start === target)
    console.log(
      JSON.stringify({
        journals: 308 + start,
        target: 308 + target,
        elapsedMs: Date.now() - began,
      }),
    );
}
