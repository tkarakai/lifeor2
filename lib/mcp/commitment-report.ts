import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { saveReport } from "./report-store";
import { parseMoney, scale, add, date } from "../../convex/lib/domain";
import { decimal } from "../life-reports/finance";
export async function commitmentReport(
  client: ConvexHttpClient,
  token: string,
  scope: { userId: string; connectionId: string; datasetId: string },
  args: Record<string, unknown>,
) {
  const snapshot = new ConvexHttpClient(client.url);
  const query = (name: string, a: Record<string, unknown>) =>
    snapshot.consistentQuery(makeFunctionReference<"query">(name), {
      datasetId: scope.datasetId,
      agentToken: token,
      ...a,
    });
  const search = await query("agentLife:search", {
    query: String(args.schedule),
    kind: "schedule",
    limit: 50,
  });
  if (search.identityStatus !== "unique")
    return {
      ...search,
      needsClarification: true,
      message:
        "Choose one recurring commitment by its unique name before comparing terms.",
    };
  const read = await query("agentLife:read", {
    kind: "commitment_schedule",
    id: search.items[0].id,
  });
  const hypothetical = [];
  if (args.hypotheticalAmount !== undefined) {
    if (typeof args.effectiveDate !== "string")
      throw new Error(
        "QUERY_LIMIT: specify the effectiveDate for a hypothetical commitment amount",
      );
    const effectiveDate = args.effectiveDate;
    date(effectiveDate);
    const p = read.periods.find(
      (p: any) =>
        p.localEffectiveDate <= effectiveDate &&
        (p.localLastEffectiveDate === null ||
          effectiveDate <= p.localLastEffectiveDate),
    );
    if (!p?.amount)
      throw new Error(
        "QUERY_LIMIT: no recorded fixed amount covers that effective date; no difference was computed",
      );
    const proposed = parseMoney(String(args.hypotheticalAmount), p.currency),
      recorded = parseMoney(p.amount, p.currency);
    if (proposed < 0)
      throw new Error(
        "QUERY_LIMIT: hypothetical recurring amount must not be negative",
      );
    hypothetical.push({
      effectiveDate: args.effectiveDate,
      recordedAmount: p.amount,
      proposedAmount: decimal(proposed, scale(p.currency)),
      difference: decimal(add(proposed, -recorded), scale(p.currency)),
      currency: p.currency,
      frequency: p.recurrence.frequency,
      interval: p.recurrence.interval ?? 1,
      sourceVersionId: p.versionId,
    });
  }
  const result = {
    reportType: "commitment",
    name: read.record.name,
    recordId: read.record._id,
    revision: read.record.revision,
    periods: read.periods,
    reason: read.revisionReason,
    hypothetical,
    queryComplete: true,
    basis:
      "Recorded recurring terms, not evidence of payment or newly incurred debt. This report reads the recorded revisions without modifying them. Any hypothetical amounts are comparisons only.",
  };
  return { ...result, ...(await saveReport(scope, result)) };
}
