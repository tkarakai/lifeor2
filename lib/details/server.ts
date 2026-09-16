import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { makeFunctionReference } from "convex/server";
import path from "node:path";
import { GitDetailsRepository } from "./git";
import { DetailsService, type DetailsBackend } from "./service";
import { DetailsError, documentPath, MAX_DOCUMENT_BYTES, validateCommit, type DetailsLocator, type DetailsTarget } from "./types";

const targetKinds = new Set([
  "entity", "arrangement", "arrangement_type", "arrangement_role_definition", "arrangement_role_assignment",
  "event", "measurement", "tag", "chart_of_accounts", "ledger_account", "journal_entry", "posting", "financial_account",
  "posting_attribution", "evidence_item", "statement", "statement_line", "balance_observation", "reconciliation",
  "commitment_schedule", "monetary_obligation", "plan", "plan_version", "scenario", "scenario_version", "forecast_assumption",
  "expected_flow", "forecast_run", "budget_target", "ownership_interest", "obligation_adjustment", "obligation_settlement",
  "entity_revision", "arrangement_revision", "arrangement_type_revision", "role_definition_revision", "role_assignment_revision",
  "commitment_schedule_version", "commitment_schedule_revision", "posting_attribution_set",
]);
export function parseTarget(value: unknown): DetailsTarget {
  if (!value || typeof value !== "object") throw new DetailsError("invalid_target", "A typed target is required.");
  const target = value as Record<string, unknown>;
  if (typeof target.kind !== "string" || !targetKinds.has(target.kind) || typeof target.id !== "string") throw new DetailsError("invalid_target", "Unsupported details target.");
  documentPath(target.id);
  return { kind: target.kind, id: target.id };
}
export function detailsService(datasetId?: string | null) {
  const scope = datasetId ? { datasetId } : {};
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!convexUrl || !convexSiteUrl) throw new DetailsError("configuration", "Authentication service is not configured.", 503);
  const auth = convexBetterAuthNextJs({ convexUrl, convexSiteUrl });
  // Typed function references allow independent server/backend builds without weakening the wire contract.
  const currentUser = makeFunctionReference<"query", Record<string, never>, { _id: string } | null>("auth:getCurrentUser");
  const get = makeFunctionReference<"query", { id: string; datasetId?: string }, DetailsLocator | null>("details:get");
  const forTarget = makeFunctionReference<"query", { target: DetailsTarget; datasetId?: string }, DetailsLocator | null>("details:forTarget");
  const ensure = makeFunctionReference<"mutation", { target: DetailsTarget; repositoryKey: string; datasetId?: string }, DetailsLocator>("details:ensure");
  const observe = makeFunctionReference<"mutation", { id: string; datasetId?: string; commit?: string; availability: "available" | "missing" | "unreadable" }, unknown>("details:observe");
  const backend: DetailsBackend = {
    currentUser: () => auth.fetchAuthQuery(currentUser, {}),
    get: id => auth.fetchAuthQuery(get, { id, ...scope }),
    forTarget: target => auth.fetchAuthQuery(forTarget, { target, ...scope }),
    ensure: (target, repositoryKey) => auth.fetchAuthMutation(ensure, { target, repositoryKey, ...scope }),
    observe: async (id, commit, availability) => { await auth.fetchAuthMutation(observe, { ...scope, id, ...(commit ? { commit } : {}), availability }); },
  };
  const repositoryKey = process.env.DETAILS_REPOSITORY_KEY ?? "local";
  const repository = new GitDetailsRepository({
    directory: path.resolve(process.env.DETAILS_REPOSITORY_PATH ?? ".convex/details-content.git"),
    branch: process.env.DETAILS_GIT_BRANCH ?? "main",
    authorName: process.env.DETAILS_GIT_AUTHOR_NAME,
    authorEmail: process.env.DETAILS_GIT_AUTHOR_EMAIL,
  });
  return new DetailsService(backend, repository, repositoryKey);
}
export async function jsonResult(operation: () => Promise<unknown>): Promise<Response> {
  try { return Response.json(await operation(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof DetailsError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    const message = error instanceof Error ? error.message : "";
    const denied = /unauthenticated|unauthorized|not authenticated|not found|not owned|access denied|forbidden/i.test(message);
    return Response.json({ error: denied ? "You cannot access this details record." : "The details service is unavailable. Keep your draft and retry.", code: denied ? "access_denied" : "service_unavailable" }, { status: denied ? 403 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
export async function saveBody(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new DetailsError("cross_origin", "Cross-origin document writes are not allowed.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new DetailsError("invalid_body", "Send an application/json request.", 415);
  // Bound the encoded request as well as decoded Markdown, without trusting Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new DetailsError("invalid_body", "A request body is required.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_DOCUMENT_BYTES * 6 + 4096) { await reader.cancel(); throw new DetailsError("document_too_large", "Request exceeds the document size limit.", 413); }
    chunks.push(value);
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new DetailsError("invalid_body", "Invalid JSON request."); }
  if (!body || typeof body !== "object" || typeof body.source !== "string" || !(body.expectedCommit === null || typeof body.expectedCommit === "string")) throw new DetailsError("invalid_body", "source and expectedCommit (full commit ID or null) are required.");
  if (Buffer.byteLength(body.source, "utf8") > MAX_DOCUMENT_BYTES) throw new DetailsError("document_too_large", "Document exceeds 1 MiB.", 413);
  if (typeof body.expectedCommit === "string") validateCommit(body.expectedCommit);
  return { source: body.source, expectedCommit: body.expectedCommit, target: body.target };
}
