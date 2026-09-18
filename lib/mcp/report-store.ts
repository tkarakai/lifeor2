import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
const TTL = 24 * 60 * 60 * 1000;
type Scope = { userId: string; connectionId: string; datasetId: string };
function directory(scope: Scope) {
  const key = createHash("sha256")
    .update(JSON.stringify([scope.userId, scope.connectionId, scope.datasetId]))
    .digest("hex");
  return path.join(
    process.env.LIFEOR_REPORT_DIRECTORY ?? ".convex/agent-reports",
    key,
  );
}
export async function saveReport(scope: Scope, report: unknown) {
  const dir = directory(scope);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const files = await readdir(dir),
    now = Date.now();
  const entries = (
    await Promise.all(
      files
        .filter((f) => /^[a-f0-9-]+\.json$/.test(f))
        .map(async (f) => {
          try {
            return { f, at: (await stat(path.join(dir, f))).mtimeMs };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        }),
    )
  ).filter((entry): entry is { f: string; at: number } => entry !== null);
  entries.sort((a, b) => b.at - a.at);
  await Promise.all(
    entries
      .filter((e, i) => now - e.at > TTL || i >= 127)
      .map(async (e) => {
        try {
          await unlink(path.join(dir, e.f));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }),
  );
  const reportId = randomUUID(),
    snapshotAt = new Date(now).toISOString(),
    text = JSON.stringify({ snapshotAt, expiresAt: now + TTL, report });
  if (Buffer.byteLength(text) > 8_000_000)
    throw new Error("Report exceeds storage budget; narrow query");
  await writeFile(path.join(dir, reportId + ".json"), text, {
    mode: 0o600,
    flag: "wx",
  });
  return { reportId, snapshotAt };
}
export async function readReport(scope: Scope, reportId: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      reportId,
    )
  )
    throw new Error("Unknown report");
  const data = JSON.parse(
    await readFile(path.join(directory(scope), reportId + ".json"), "utf8"),
  );
  if (data.expiresAt < Date.now())
    throw new Error("Report expired. Run a fresh query.");
  return data as { snapshotAt: string; report: Record<string, unknown> };
}
