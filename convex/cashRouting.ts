import { v } from "convex/values";
import { mutation } from "./lib/scoped";
import { owned, requireUser } from "./lib/access";
import { integer, money } from "./lib/domain";
export const routeSource = v.union(
  v.object({
    kind: v.literal("monetary_obligation"),
    id: v.id("monetary_obligation"),
  }),
  v.object({
    kind: v.literal("commitment_schedule"),
    id: v.id("commitment_schedule"),
  }),
);
/** Payment instructions, not a change to the underlying claim or ledger. Revisions are retained. */
export const save = mutation({
  agent: { operation: "cashRouting.save", scope: "finance:write", revision: true },
  args: {
    source: routeSource,
    from_account_id: v.optional(v.id("ledger_account")),
    to_account_id: v.optional(v.id("ledger_account")),
    cash_minor_units: v.optional(v.number()),
    monthly_days: v.optional(v.array(v.number())),
    expectedRevision: v.number(),
  },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx);
    const source = await owned(ctx, a.source.kind, a.source.id, user._id);
    if (source.archived) throw new Error("Source is archived");
    const versions =
      a.source.kind === "commitment_schedule"
        ? await ctx.db
            .query("commitment_schedule_version")
            .withIndex("by_schedule", (q) =>
              q.eq(
                "schedule_id",
                a.source
                  .id as import("./_generated/dataModel").Id<"commitment_schedule">,
              ),
            )
            .collect()
        : [];
    const currency =
      "currency" in source
        ? source.currency
        : versions.sort((x, y) => y.revision - x.revision)[0]?.currency;
    if (!currency)
      throw new Error(
        "A schedule version is required before assigning accounts",
      );
    if (a.from_account_id && a.from_account_id === a.to_account_id)
      throw new Error("Outgoing and incoming accounts must differ");
    for (const id of [a.from_account_id, a.to_account_id])
      if (id) {
        const account = await owned(ctx, "ledger_account", id, user._id);
        const maps = await ctx.db
          .query("financial_account")
          .withIndex("by_ledger", (q) => q.eq("ledger_account_id", id))
          .collect();
        if (
          account.archived ||
          account.type !== "Asset" ||
          account.currency !== currency ||
          !maps.some(
            (m) =>
              !m.archived &&
              /checking|savings|cash|deposit|money.?market/i.test(m.kind),
          )
        )
          throw new Error(
            "Choose a designated bank/cash account in the same currency",
          );
      }
    if (
      a.source.kind === "monetary_obligation" &&
      (a.cash_minor_units !== undefined || a.monthly_days !== undefined)
    )
      throw new Error(
        "Claim amounts and due dates cannot be overridden by bank routing",
      );
    if (
      a.cash_minor_units !== undefined &&
      money(a.cash_minor_units, currency) <= 0
    )
      throw new Error("Cash amount must be positive");
    if (
      a.monthly_days !== undefined &&
      (!a.monthly_days.length ||
        a.monthly_days.length > 4 ||
        new Set(a.monthly_days).size !== a.monthly_days.length ||
        a.monthly_days.some((d) => integer(d) < 1 || d > 31))
    )
      throw new Error("Enter one to four distinct payment days from 1 to 31");
    if (
      a.monthly_days &&
      versions.some((x) => x.recurrence.frequency !== "monthly")
    )
      throw new Error("Payment-day splitting requires a monthly schedule");
    const prior = (await ctx.db.query("cash_flow_route").collect())
      .filter((r) => r.source.id === a.source.id)
      .sort((x, y) => y.revision - x.revision)[0];
    if ((prior?.revision ?? 0) !== a.expectedRevision)
      throw new Error("Routing changed. Reload and try again");
    return ctx.db.insert("cash_flow_route", {
      user_id: user._id,
      created_at: Date.now(),
      source: a.source,
      currency,
      from_account_id: a.from_account_id,
      to_account_id: a.to_account_id,
      cash_minor_units: a.cash_minor_units,
      monthly_days: a.monthly_days?.sort((x, y) => x - y),
      revision: (prior?.revision ?? 0) + 1,
    });
  },
});
