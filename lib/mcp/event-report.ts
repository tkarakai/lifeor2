import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { saveReport } from "./report-store";
/** Keep calendar facts and clock occurrences out of free-form model arithmetic. */
export async function eventReport(client: ConvexHttpClient, token: string, scope: { userId: string; connectionId: string; datasetId: string }, args: Record<string, unknown>) {
  const snapshot = new ConvexHttpClient(client.url);
  const items: Record<string, unknown>[] = [];
  let cursor = args.cursor as string | undefined;
  let first: Record<string, any> | undefined;
  const started = Date.now();
  for (let page = 0; ; page++) {
    if (page >= 100 || Date.now() - started > 45000) throw new Error("QUERY_LIMIT: too many event candidates. Narrow the title, subject or date range.");
    const result = await snapshot.consistentQuery(makeFunctionReference<"query">("agentLife:events"), { ...args, agentToken: token, limit: 50, ...(cursor ? { cursor } : {}) }) as Record<string, any>;
    first ??= result;
    items.push(...result.items);
    if (!result.nextCursor) break;
    if (result.nextCursor === cursor) throw new Error("Event pagination made no progress");
    cursor = result.nextCursor;
  }
  const full = { ...first, reportType: "events", items, matchedCount: items.length, itemsComplete: true, nextCursor: null, queryComplete: true, coverage: args.cursor ? "Continuation from the supplied cursor" : "Complete matching recorded events" };
  if (!items.length) return full;
  const saved = await saveReport(scope, full);
  return { ...full, ...saved, items: items.slice(0, 12), itemsComplete: items.length <= 12, previewOnly: items.length > 12, hint: "Use present_report for calendar answers: it renders dates, local time, UTC offsets and repeated-clock occurrences exactly. For an edit, use the returned event ID; a write or clarification supersedes this read report." };
}

/** A successful write supplies its own fresh evidence; never rephrase clock facts. */
export async function eventChangeReport(scope: { userId: string; connectionId: string; datasetId: string }, result: Record<string, unknown>) {
  if (!["recorded", "rescheduled"].includes(String(result.status))) return result;
  const report = { ...result, reportType: "event_change" };
  try {
    const saved = await saveReport(scope, report);
    return { ...report, ...saved, hint: "The calendar write is committed. Present this fresh report to confirm the exact date, weekday, clock time and linked participants. Do not repeat the write to obtain confirmation." };
  } catch {
    // Storage can fail after the atomic mutation succeeds. Preserve that success
    // and return a verified receipt instead of inviting a duplicate create.
    const { presentReport } = await import("./report-presentation");
    return { ...result, committedAnswer: presentReport(report), reportUnavailable: true };
  }
}
