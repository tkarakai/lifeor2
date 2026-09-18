import type { LifeContext } from "./common";
import { referenceRows, civilDate, workspace } from "./common";
import {
  canonicalOccurrence,
  remaining,
  incurredObligation,
} from "../../planning";
import { outstanding } from "../../obligations";
import type { CashSchedule, CashRoute } from "../../../lib/insights/types";

async function currentClaims(ctx: LifeContext) {
  const w = await workspace(ctx);
  if (!w.dataset?.report_obligations_ready || ctx.scope.legacy)
    return referenceRows(ctx, "monetary_obligation");
  const [unpaid, future] = await Promise.all([
    ctx.db
      .query("agent_obligation_state")
      .withIndex("by_dataset_active", (q) =>
        q.eq("dataset_id", w.dataset!._id).eq("active", true),
      )
      .take(2001),
    ctx.db
      .query("agent_obligation_state")
      .withIndex("by_dataset_due", (q) =>
        q.eq("dataset_id", w.dataset!._id).gte("due_date", w.today),
      )
      .take(2001),
  ]);
  if (unpaid.length > 2000 || future.length > 2000)
    throw new Error(
      "QUERY_LIMIT: more than 2000 current/future claims. Narrow the planning workspace.",
    );
  const ids = [...new Set([...unpaid, ...future].map((s) => s.obligation_id))],
    rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return rows.filter((r): r is NonNullable<typeof r> => r !== null);
}
/** Load current planning evidence; settled historical claims stay outside the scan. */
export async function planningData(ctx: LifeContext, knownAt = Date.now()) {
  const [
    obligations,
    schedules,
    versions,
    revisions,
    routes,
    flows,
    assumptions,
    arrangements,
    entities,
  ] = await Promise.all([
    currentClaims(ctx),
    referenceRows(ctx, "commitment_schedule"),
    referenceRows(ctx, "commitment_schedule_version"),
    referenceRows(ctx, "commitment_schedule_revision"),
    referenceRows(ctx, "cash_flow_route"),
    referenceRows(ctx, "expected_flow"),
    referenceRows(ctx, "forecast_assumption"),
    referenceRows(ctx, "arrangement"),
    referenceRows(ctx, "entity"),
  ]);
  const name = (id: string | undefined) =>
    entities.find((e) => e._id === id)?.display_name ??
    arrangements.find((e) => e._id === id)?.name ??
    schedules.find((e) => e._id === id)?.name ??
    id ??
    "Unspecified";
  const claims = await Promise.all(
    obligations.map(async (o) => ({
      ...o,
      ...(await outstanding(ctx, o)),
      occurrence: await canonicalOccurrence(
        ctx,
        { obligation_id: o._id, occurrence_key: o.occurrence_key ?? "" },
        o.user_id,
      ),
    })),
  );
  const cashSchedules: CashSchedule[] = schedules
    .filter((s) => !s.archived)
    .flatMap((s) => {
      const latest = revisions
        .filter((r) => r.schedule_id === s._id && r.recorded_at <= knownAt)
        .sort((a, b) => b.revision - a.revision)[0];
      return (latest?.segments ?? []).flatMap((segment) => {
        const v = versions.find((v) => v._id === segment.facts.version_id);
        return v
          ? [
              {
                id: s._id,
                name: s.name,
                version: v._id,
                currency: v.currency,
                amount: v.amount?.minor_units,
                start: v.start_date,
                end: v.end_date,
                validFrom: civilDate(segment.valid_from, v.timezone),
                validTo:
                  segment.valid_to === undefined
                    ? undefined
                    : civilDate(segment.valid_to, v.timezone),
                frequency: v.recurrence.frequency,
                interval: v.recurrence.interval,
                day: v.recurrence.day_of_month,
                creditor: v.creditor_id,
                debtor: v.debtor_id,
                timezone: v.timezone,
              },
            ]
          : [];
      });
    });
  const latestRoutes = new Map<string, CashRoute & { id: string }>();
  for (const r of routes)
    if ((latestRoutes.get(r.source.id)?.revision ?? -1) < r.revision)
      latestRoutes.set(r.source.id, {
        id: r._id,
        source: r.source.id,
        kind: r.source.kind,
        from: r.from_account_id,
        to: r.to_account_id,
        amount: r.cash_minor_units,
        days: r.monthly_days,
        revision: r.revision,
        currency: r.currency,
      });
  const expected = await Promise.all(
    flows
      .filter(
        (f) =>
          !f.archived &&
          f.cancelled_at === undefined &&
          !flows.some((next) => next.supersedes_id === f._id),
      )
      .map(async (f) => {
        const claim = await incurredObligation(ctx, f, f.user_id);
        const version = versions.find((v) => v._id === f.schedule_version_id);
        return {
          ...f,
          remaining: claim?.archived ? 0 : await remaining(ctx, f),
          occurrence: await canonicalOccurrence(ctx, f, f.user_id),
          claim: claim
            ? {
                ...claim,
                ...(claims.find((c) => c._id === claim._id) ??
                  (await outstanding(ctx, claim))),
              }
            : null,
          version,
          assumption: assumptions.find((a) => a._id === f.assumption_id),
          name: claim
            ? name(claim.arrangement_id)
            : version
              ? name(version.schedule_id)
              : (assumptions.find((a) => a._id === f.assumption_id)?.name ??
                "Expected cash movement"),
        };
      }),
  );
  return {
    claims,
    cashSchedules,
    routes: latestRoutes,
    expected,
    name,
    scheduleName: (versionId: string | undefined) => {
      const version = versions.find((v) => v._id === versionId);
      return version ? name(version.schedule_id) : undefined;
    },
    entities,
    arrangements,
    assumptions,
  };
}
