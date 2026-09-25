import type { CashRoute, CashSchedule } from "../insights/types";
import { add, date, parseMoney, scale } from "../../convex/lib/domain";
import { matchesText } from "../../convex/lib/lifeQueries/text";
import { decimal } from "./finance";
import { QueryError } from "../mcp/query-error";
export type RecurringChange = { schedule: string; effectiveDate: string; mode: "change_by" | "set_amount"; amount: string };
/** Replace only future schedule amounts in a copy; claims/payments and routes stay authoritative. */
export function recurringScenario(schedules: CashSchedule[], routes: CashRoute[], changes: RecurringChange[], cutoff: string, through: string) {
  let result = structuredClone(schedules);
  const evidence: { schedule: string; scheduleId: string; effectiveDate: string; recordedAmount: string; proposedAmount: string; difference: string; currency: string; frequency: string; interval: number }[] = [];
  const changed = new Set<string>();
  for (const change of changes) {
    date(change.effectiveDate);
    if (change.effectiveDate < cutoff || change.effectiveDate > through) throw new QueryError("invalid_scenario", "Use an effective date from the projection cutoff through its end. Recorded opening cash is unchanged.");
    const candidates = result.filter(s => matchesText(s.name, change.schedule) && s.start <= through && s.validFrom <= through && (!s.validTo || s.validTo > change.effectiveDate) && (!s.end || s.end > change.effectiveDate));
    const ids = [...new Set(candidates.map(s => s.id))];
    if (ids.length !== 1) throw new QueryError("ambiguous_schedule", "Choose one uniquely named recurring commitment. No scenario was calculated.");
    const id = ids[0];
    if (changed.has(id)) throw new QueryError("invalid_scenario", "Use one proposed change per recurring commitment in a scenario.");
    changed.add(id);
    const route = routes.find(r => r.source === id);
    if (!route || (!route.from && !route.to)) throw new QueryError("missing_cash_route", "This commitment has no explicit cash route; its cash impact is unknown.");
    if (route.amount !== undefined) throw new QueryError("unknown_net_cash", "This commitment has a separate configured cash amount. A contract change does not establish its net cash change (for example payroll withholding). Supply an explicit additional net cash assumption instead.");
    result = result.flatMap(s => {
      if (s.id !== id || s.start > through || s.validFrom > through || (s.validTo && s.validTo <= change.effectiveDate) || (s.end && s.end <= change.effectiveDate)) return [s];
      if (s.amount === undefined) throw new QueryError("unknown_amount", "The recorded recurring amount is variable or missing; a change from it cannot be calculated.");
      const amount = parseMoney(change.amount, s.currency);
      const proposed = change.mode === "change_by" ? add(s.amount, amount) : amount;
      if (proposed < 0) throw new QueryError("invalid_scenario", "The proposed recurring amount must not be negative.");
      const effectiveDate = s.validFrom > change.effectiveDate ? s.validFrom : change.effectiveDate;
      evidence.push({ schedule: s.name, scheduleId: id, effectiveDate, recordedAmount: decimal(s.amount, scale(s.currency)), proposedAmount: decimal(proposed, scale(s.currency)), difference: decimal(add(proposed, -s.amount), scale(s.currency)), currency: s.currency, frequency: s.frequency, interval: s.interval });
      return [...(s.validFrom < effectiveDate ? [{ ...s, validTo: effectiveDate }] : []), { ...s, validFrom: effectiveDate, amount: proposed }];
    });
  }
  return { schedules: result, evidence };
}
