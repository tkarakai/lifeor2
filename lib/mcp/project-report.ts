import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { baseFinancialReport as financialReport } from "./financial-report";
import { saveReport, readReport } from "./report-store";
import { agentDetails } from "./details";
export async function projectReport(
  client: ConvexHttpClient,
  token: string,
  scope: { userId: string; connectionId: string; datasetId: string },
  args: Record<string, unknown>,
) {
  const snapshot = new ConvexHttpClient(client.url);
  const auth = { agentToken: token, datasetId: scope.datasetId };
  const matches = await snapshot.consistentQuery(
    makeFunctionReference<"query">("agentLife:search"),
    { ...auth, query: String(args.project), kind: "tag" },
  );
  if (matches.identityStatus !== "unique")
    return {
      status: "clarification_required",
      matches: matches.items,
      message:
        "Choose a unique project tag name; no project totals were calculated.",
    };
  const inputs = await snapshot.consistentQuery(
    makeFunctionReference<"query">("agentPlanning:project"),
    { ...auth, tagId: matches.items[0].id, ...(args.through ? { asOf: String(args.through) } : {}) },
  );
  const through = String(args.through ?? inputs.today),
    from = String(
      args.from ??
        inputs.arrangements.map((r: any) => r.from).sort()[0] ??
        through.slice(0, 4) + "-01-01",
    );
  const actuals = await financialReport(
    client,
    token,
    scope,
    {
      datasetId: scope.datasetId,
      tagId: matches.items[0].id,
      from,
      through,
      metric: "activity",
      groupBy: "total",
    },
    snapshot,
  );
  if (inputs.revision !== actuals.revision) throw new Error("DATA_CHANGED: project inputs changed during the financial query. Retry; no mixed-version project totals were supplied.");
  const completeActuals = (await readReport(scope, actuals.reportId)).report;
  const service = agentDetails(
      token,
      scope.datasetId,
      false,
      scope.connectionId,
    ),
    notes = [];
  for (const target of inputs.sourceTargets.slice(0, 4)) {
    const doc = await service.forTarget(target);
    if (doc.source)
      notes.push({
        target,
        commit: doc.commit,
        excerpt: doc.source.slice(0, 2200),
        complete: doc.source.length <= 2200,
      });
  }
  const result = {
    reportType: "project",
    status: "complete",
    hint: "This report already includes the complete financial query for the stated project and period. Answer from these records; do not repeat the same finances query.",
    project: inputs.project,
    from,
    through,
    actuals: completeActuals,
    obligations: inputs.obligations,
    obligationsAsOf: inputs.obligationsAsOf,
    expectations: inputs.expectations,
    notes,
    basis: inputs.basis,
    coverage: inputs.obligationsAsOf
      ? "Actuals use the requested accounting dates. Outstanding claims use recorded recognition, adjustment, settlement and reversal dates through the historical cutoff, using evidence known now. Claims lacking recognition dates are explicitly unknown. Expectations and source notes are current snapshots and may describe later events; they are not additional historical debt. Source-note budgets are not posted costs."
      : "Actuals use the requested accounting dates. Obligations/expectations are current outstanding records. Source notes may describe contract budget; they are not posted costs. The default from date is the earliest directly tagged arrangement start (or current year); state the returned period.",
  };
  const saved = await saveReport(scope, result);
  return { ...result, ...saved };
}
