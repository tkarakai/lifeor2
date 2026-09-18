import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { saveReport } from "./report-store";
import { QueryError } from "./query-error";
type TimelinePage = {
  items: Record<string, unknown>[];
  nextOffset: number | null;
  queryComplete: boolean;
  [key: string]: unknown;
};
/** Consume UI-sized pages on the server; give the model a preview and stable handle. */
export async function timelineReport(
  client: ConvexHttpClient,
  token: string,
  scope: { userId: string; connectionId: string; datasetId: string },
  args: Record<string, unknown>,
) {
  const snapshot = new ConvexHttpClient(client.url),
    items: Record<string, unknown>[] = [];
  let first: TimelinePage | undefined,
    offset = 0;
  for (let page = 0; ; page++) {
    if (page >= 100)
      throw new Error(
        "QUERY_LIMIT: timeline exceeds 5000 items. Narrow the date range or filters.",
      );
    const result = (await snapshot.consistentQuery(
      makeFunctionReference<"query">("agentTimeline:timeline"),
      { ...args, agentToken: token, limit: 50, offset },
    )) as TimelinePage;
    if (!result.queryComplete)
      throw new QueryError(
        "incomplete_timeline",
        "Timeline coverage is incomplete. Narrow the dates or use includeEvents=false for a commitments-only question. No report was saved; do not infer absence or totals from this attempt.",
      );
    first ??= result;
    items.push(...result.items);
    if (result.nextOffset === null) break;
    if (result.nextOffset <= offset)
      throw new Error("Timeline pagination made no progress");
    offset = result.nextOffset;
  }
  const full = {
    ...first,
    reportType: "timeline",
    items,
    itemsComplete: true,
    nextOffset: null,
  };
  // Like empty calendar searches, a complete empty timeline is absence evidence,
  // not a monetary report to keep selecting after a subsequent query repairs scope.
  if (!items.length) return { ...full, hint: "No matching recorded items in this scope. No report handle was created. If these filters were only a lookup attempt, correct them before answering the user's question." };
  const saved = await saveReport(scope, full);
  return {
    ...full,
    ...saved,
    items: items.slice(0, 12),
    itemsComplete: items.length <= 12,
    previewOnly: items.length > 12,
    hint: "The saved report includes all matched items covered by queryComplete. Use present_report to display it. reports.read can inspect detail; do not reconstruct the report from the preview.",
  };
}
