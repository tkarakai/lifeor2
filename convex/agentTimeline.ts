import { entityAt } from "./lib/history";
import { matchesText } from "./lib/lifeQueries/text";
import { v } from "convex/values";
import { query } from "./lib/scoped";
import { owned } from "./lib/access";
import {
  workspace,
  dateRange,
  money,
  page,
  civilDate,
} from "./lib/lifeQueries/common";
import { planningData } from "./lib/lifeQueries/planning";
import { occurrences } from "../lib/insights/cash-projection";

type Item = {
  id: string;
  date: string;
  time?: string;
  title: string;
  commitment?: string;
  kind: string;
  amount?: string;
  outstandingAmount?: string;
  currency?: string;
  direction?: string;
  status?: string;
  dueDate?: string;
  sourceIds: string[];
  parties?: string[];
  basis?: string;
  amountBasis?: string;
  contractAmount?: string;
  contractFrequency?: string;
  cashAmountPerPeriod?: string;
  cashPaymentCountPerPeriod?: number;
};
export const timeline = query({
  agent: { operation: "life.timeline", scope: "data:read" },
  args: {
    from: v.optional(v.string()),
    through: v.optional(v.string()),
    entityId: v.optional(v.id("entity")),
    perspectiveId: v.optional(v.id("entity")),
    query: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("overdue"), v.literal("due"), v.literal("expected")),
    ),
    direction: v.optional(
      v.union(v.literal("inflow"), v.literal("outflow"), v.literal("transfer")),
    ),
    includeEvents: v.optional(v.boolean()),
    includeOverdue: v.optional(v.boolean()),
    includeProjections: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const w = await workspace(ctx),
      from = a.from ?? w.today,
      through =
        a.through ??
        new Date(
          Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0),
        )
          .toISOString()
          .slice(0, 10);
    dateRange(from, through, 366);
    const subject = a.entityId ? await entityAt(ctx, await owned(ctx, "entity", a.entityId, w.user._id)) : undefined;
    if (a.perspectiveId) await owned(ctx, "entity", a.perspectiveId, w.user._id);
    const graph = await planningData(ctx),
      items: Item[] = [],
      blocked = new Set(graph.claims.map((o) => o.occurrence));
    const inRange = (date: string) => date >= from && date <= through;
    const affected = (ids: (string | undefined)[]) =>
      !a.entityId || ids.includes(a.entityId);
    const perspective = a.perspectiveId ?? w.household;
    if (a.direction && !perspective)
      throw new Error("No default household is configured. Specify perspectiveId for whose incoming/outgoing money is requested; entityId only filters the parties involved.");
    const customPerspective = a.perspectiveId && a.perspectiveId !== w.household;
    const claimDirection = (creditor: string, debtor: string) =>
      perspective === creditor
        ? "inflow"
        : perspective === debtor
          ? "outflow"
          : "unspecified";
    const expectedClaims = new Set<string>();
    if (a.includeProjections !== false && !["due", "overdue"].includes(a.status ?? ""))
      for (const f of graph.expected) {
        if (
          !f.remaining ||
          !inRange(f.expected_date) ||
          !affected([
            f.claim?.creditor_id,
            f.claim?.debtor_id,
            f.version?.creditor_id,
            f.version?.debtor_id,
            f.assumption?.context?.id,
          ])
        )
          continue;
        if (f.claim) expectedClaims.add(f.claim._id);
        blocked.add(f.occurrence);
        items.push({
          id: f._id,
          date: f.expected_date,
          title: f.name,
          commitment: graph.scheduleName(f.claim?.schedule_version_id ?? f.schedule_version_id),
          parties: f.claim
            ? [graph.name(f.claim.debtor_id), graph.name(f.claim.creditor_id)]
            : undefined,
          kind: f.claim
            ? "expected_obligation_payment"
            : f.version
              ? "scheduled_expectation"
              : "assumption",
          amount: money(Math.abs(f.remaining), f.currency),
          ...(f.claim ? { outstandingAmount: money(f.claim.outstanding_minor_units, f.currency) } : {}),
          currency: f.currency,
          direction: customPerspective && (f.claim || f.version)
            ? claimDirection((f.claim ?? f.version)!.creditor_id, (f.claim ?? f.version)!.debtor_id)
            : f.remaining < 0 ? "outflow" : "inflow",
          dueDate: f.claim?.due_date,
          status:
            f.claim ? (f.claim.due_date < w.today ? "overdue" : "due") : "expected",
          sourceIds: [
            f._id,
            ...(f.claim ? [f.claim._id] : []),
            ...(f.assumption ? [f.assumption._id] : []),
          ],
          basis: "Expected cash date; payment is not recorded as completed.",
        });
      }
    for (const o of graph.claims) {
      if (
        o.archived ||
        o.voided_at !== undefined ||
        o.outstanding_minor_units <= 0 ||
        expectedClaims.has(o._id) ||
        !affected([o.creditor_id, o.debtor_id])
      )
        continue;
      if (
        !inRange(o.due_date) &&
        !(a.includeOverdue !== false && o.due_date < from)
      )
        continue;
      items.push({
        id: o._id,
        date: o.due_date,
        dueDate: o.due_date,
        title: graph.name(o.arrangement_id),
        commitment: graph.scheduleName(o.schedule_version_id),
        kind: "obligation",
        direction: claimDirection(o.creditor_id, o.debtor_id),
        amount: money(o.outstanding_minor_units, o.currency),
        currency: o.currency,
        status: o.due_date < w.today ? "overdue" : "due",
        parties: [graph.name(o.debtor_id), graph.name(o.creditor_id)],
        sourceIds: [o._id],
        basis:
          "Outstanding after recorded adjustments and settlements; debtor owes creditor.",
      });
    }
    if (a.includeProjections !== false)
      for (const s of graph.cashSchedules) {
        if (!affected([s.creditor, s.debtor])) continue;
        const route = graph.routes.get(s.id),
          before = new Date(
            Date.parse(from > w.today ? from : w.today) - 86400000,
          )
            .toISOString()
            .slice(0, 10);
        for (const o of occurrences(s, route, before, through)) {
          if (blocked.has(o.key)) continue;
          items.push({
            id: `${s.id}:${o.date}`,
            date: o.date,
            title: s.name,
            kind: "schedule_projection",
            status: "expected",
            amount: money(o.amount, s.currency),
            currency: s.currency,
            direction: customPerspective ? claimDirection(s.creditor, s.debtor) :
              route?.from && route.to
                ? "transfer"
                : route?.from
                  ? "outflow"
                  : route?.to
                    ? "inflow"
                    : "unspecified",
            parties: [graph.name(s.debtor), graph.name(s.creditor)],
            sourceIds: [s.id, s.version, ...(route ? [route.id] : [])],
            amountBasis:
              route?.amount !== undefined
                ? "explicit_cash_amount"
                : "contract_amount",
            ...(route?.amount !== undefined && s.amount !== undefined
              ? {
                  contractAmount: money(s.amount, s.currency),
                  contractFrequency: s.frequency,
                  cashAmountPerPeriod: money(route.amount!, s.currency),
                  cashPaymentCountPerPeriod: route.days?.length ?? 1,
                }
              : {}),
            basis:
              route?.amount !== undefined
                ? "This amount is the explicit projected cash deposit/payment, NOT gross contract income. The schedule title may describe gross terms. Not a recorded payment."
                : "Contract amount; cash routing/take-home amount is unknown.",
          });
        }
      }
    let eventsComplete = true;
    if (a.includeEvents !== false) {
      // Wide UTC bounds followed by civil-date filtering retain boundary events in every timezone.
      const lo = Date.parse(from) - 86400000,
        hi = Date.parse(through) + 2 * 86400000;
      const q = ctx.scope.legacy
        ? ctx.db
            .query("event")
            .withIndex("by_occurred_at", (q) =>
              q.gte("occurred_at", lo).lt("occurred_at", hi),
            )
        : ctx.db
            .query("event")
            .withIndex("by_dataset_occurred", (q) =>
              q
                .eq("dataset_id", ctx.scope.datasetId)
                .gte("occurred_at", lo)
                .lt("occurred_at", hi),
            );
      const events = await q.take(501);
      eventsComplete = events.length <= 500;
      for (const e of events.slice(0, 500)) {
        if (
          e.archived ||
          e.voided_at !== undefined ||
          !inRange(civilDate(e.occurred_at, w.timezone))
        )
          continue;
        const correction = await ctx.db
          .query("event")
          .withIndex("by_corrects", (q) => q.eq("corrects_id", e._id))
          .first();
        if (correction) continue;
        if (a.entityId) {
          const links = await ctx.db
            .query("event_affects")
            .withIndex("by_event", (q) => q.eq("event_id", e._id))
            .take(101);
          if (!links.some((l) => (l.target?.id ?? l.target_id) === a.entityId))
            continue;
        }
        items.push({
          id: e._id,
          date: civilDate(e.occurred_at, w.timezone),
          time:
            eventDatePrecision(e.payload_json) === "day"
              ? undefined
              : new Intl.DateTimeFormat("en-GB", {
                  timeZone: w.timezone,
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                }).format(e.occurred_at),
          title: e.title ?? e.kind,
          kind: "recorded_event",
          sourceIds: [e._id],
          basis: e.kind,
        });
      }
    }
    const filtered = items
      .filter(
        (i) =>
          (!a.status ||
            (a.status === "due" ? !!i.dueDate && (inRange(i.dueDate) || (a.includeOverdue !== false && i.dueDate < from)) :
              a.status === "expected" ? ["expected_obligation_payment", "scheduled_expectation", "assumption", "schedule_projection"].includes(i.kind) :
              i.status === "overdue")) &&
          (!a.direction || i.direction === a.direction),
      )
      .filter(
        (i) =>
          !a.query ||
          matchesText(
            [i.title, i.commitment, i.kind, i.status, ...(i.parties ?? [])].join(" "),
            a.query,
          ),
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return {
      ...page(filtered, a.limit, a.offset),
      filters: { subject: subject?.display_name, perspective: graph.name(perspective), query: a.query, direction: a.direction, status: a.status },
      queryComplete: eventsComplete,
      from,
      through,
      today: w.today,
      timezone: w.timezone,
      coverage: {
        events: eventsComplete
          ? "complete_in_range"
          : "partial_500_event_limit",
        obligations: "complete",
        projections:
          a.includeProjections === false || ["due", "overdue"].includes(a.status ?? "")
            ? "excluded_by_request_or_debt_filter"
            : "current_recorded_schedules_and_expectations",
        sampleActualsThrough: w.dataset?.seed_as_of ?? null,
      },
      warnings: eventsComplete
        ? []
        : [
            "Recorded events exceeded the range limit. Narrow dates or set includeEvents=false for commitments only; do not claim a complete event list.",
          ],
      coverageStatement:
        "Only recorded commitments and configured projections are covered. Dataset completeness is unknown; do not say nothing else is scheduled or that this is every real-life commitment.",
      basis:
        "Dates are inclusive. Overdue claims are included by default. Cash views show linked expectations once while retaining due dates and unpaid balances. Due/overdue views report the full unpaid claim, not a partial expected payment. Recorded claims suppress duplicate schedule projections. Schedule projections start no earlier than today; past scheduled dates are not evidence of unpaid amounts. Projections are not confirmed future events.",
    };
  },
});

function eventDatePrecision(payload?: string) {
  try {
    return JSON.parse(payload ?? "{}").datePrecision;
  } catch {
    return undefined;
  }
}
