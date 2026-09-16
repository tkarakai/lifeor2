/** Only explicitly unit-bearing shapes are converted; source JSON is never rewritten. */
import type { QueryCtx } from "../_generated/server";
import { owned } from "./access";
import { validateSchedule } from "../obligations";
export async function legacySchedule(
  ctx: QueryCtx,
  user: string,
  json: string,
) {
  const raw: unknown = JSON.parse(json);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p.kind !== "schedule") return null;
  const required = [
    "creditor_id",
    "debtor_id",
    "currency",
    "start_date",
    "timezone",
  ];
  if (
    required.some((k) => typeof p[k] !== "string") ||
    typeof p.valid_from !== "number" ||
    !p.recurrence ||
    typeof p.recurrence !== "object"
  )
    throw new Error("Incomplete explicit legacy schedule");
  const r = p.recurrence as Record<string, unknown>;
  if (
    !["once", "daily", "weekly", "monthly", "yearly"].includes(
      String(r.frequency),
    ) ||
    typeof r.interval !== "number" ||
    (r.day_of_month !== undefined && typeof r.day_of_month !== "number")
  )
    throw new Error("Unknown legacy recurrence rule");
  if (
    (p.end_date !== undefined && typeof p.end_date !== "string") ||
    (p.valid_to !== undefined && typeof p.valid_to !== "number")
  )
    throw new Error("Invalid legacy schedule period");
  if (
    p.variable_rule !== undefined &&
    p.variable_rule !== "manual_amount" &&
    p.variable_rule !== "metered_quantity"
  )
    throw new Error("Unknown legacy amount rule");
  const creditor = ctx.db.normalizeId("entity", String(p.creditor_id)),
    debtor = ctx.db.normalizeId("entity", String(p.debtor_id));
  if (!creditor || !debtor) throw new Error("Invalid legacy schedule parties");
  await owned(ctx, "entity", creditor, user);
  await owned(ctx, "entity", debtor, user);
  let amount: { minor_units: number; currency: string } | undefined;
  if (p.amount !== undefined) {
    if (!p.amount || typeof p.amount !== "object")
      throw new Error("Invalid legacy amount");
    const m = p.amount as Record<string, unknown>;
    if (typeof m.minor_units !== "number" || typeof m.currency !== "string")
      throw new Error(
        "Legacy schedule requires explicit minor units and currency",
      );
    amount = { minor_units: m.minor_units, currency: m.currency };
  }
  const result = {
    creditor_id: creditor,
    debtor_id: debtor,
    currency: p.currency as string,
    start_date: p.start_date as string,
    end_date: p.end_date as string | undefined,
    timezone: p.timezone as string,
    valid_from: p.valid_from as number,
    valid_to: p.valid_to as number | undefined,
    amount,
    variable_rule: p.variable_rule as
      | "manual_amount"
      | "metered_quantity"
      | undefined,
    recurrence: {
      frequency: r.frequency as
        | "once"
        | "daily"
        | "weekly"
        | "monthly"
        | "yearly",
      interval: r.interval,
      day_of_month: r.day_of_month as number | undefined,
    },
  };
  await validateSchedule(ctx, user, result);
  return result;
}
