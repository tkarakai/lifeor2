/** Local operator: bun run seed:family -- <Better Auth user ID> */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { GitDetailsRepository } from "../lib/details/git";
const userId = process.argv.slice(2).find((arg) => arg !== "--");
if (!userId || userId.startsWith("-"))
  throw new Error(
    "Usage: bun run seed:family -- <Better Auth user ID>. The backend must already be running.",
  );
function call<T>(name: string, args: Record<string, unknown>): T {
  const output = execFileSync(
    path.resolve("node_modules/.bin/convex"),
    ["run", name, JSON.stringify(args)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output) as T;
}
const datasetId = call<string>("sampleData:prepareForOwner", { userId });
for (let monthIndex = 0; monthIndex < 9; monthIndex++) {
  call("sampleData:populateMonthForOwner", { userId, datasetId, monthIndex });
  console.log(`Sample month ${monthIndex + 1}/9 ready`);
}
const docs = call<{ id: string; source: string }[]>(
  "sampleData:prepareDocumentsForOwner",
  {
    userId,
    datasetId,
    repositoryKey: process.env.DETAILS_REPOSITORY_KEY ?? "local",
  },
);
const repository = new GitDetailsRepository({
  directory: path.resolve(
    process.env.DETAILS_REPOSITORY_PATH ?? ".convex/details-content.git",
  ),
  branch: process.env.DETAILS_GIT_BRANCH ?? "main",
  authorName: process.env.DETAILS_GIT_AUTHOR_NAME,
  authorEmail: process.env.DETAILS_GIT_AUTHOR_EMAIL,
});
let written = 0;
for (const doc of docs) {
  const existing = await repository.read(doc.id);
  if (existing.availability === "missing") {
    await repository.save(doc.id, doc.source, existing.commit);
    written++;
  }
}
console.log(
  JSON.stringify(
    {
      datasetId,
      documents: docs.length,
      written,
      asOf: "2026-09-16",
      note: "Existing sample data and document edits were preserved; current dataset selection unchanged.",
    },
    null,
    2,
  ),
);
