import { v } from "convex/values";
import { mutation, query } from "./lib/scoped";
import { target } from "./schema/shared";
import { owned, ownedTarget, requireUser, evidence } from "./lib/access";
import { decimal, nonempty, instant, scale } from "./lib/domain";
export const create = mutation({
  args: {
    subject: target,
    name: v.string(),
    assertion: v.union(
      v.literal("observed"),
      v.literal("expected"),
      v.literal("derived"),
      v.literal("contractual"),
    ),
    value: v.object({
      decimal: v.string(),
      unit: v.string(),
      currency: v.optional(v.string()),
    }),
    as_of: v.number(),
    method: v.optional(v.string()),
    evidence_ids: v.optional(v.array(v.id("evidence_item"))),
    corrects_id: v.optional(v.id("measurement")),
    assumption_id: v.optional(v.id("forecast_assumption")),
    input_references: v.optional(v.array(target)),
    calculation_version: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    await ownedTarget(ctx, a.subject, u._id);
    decimal(a.value.decimal);
    nonempty(a.value.unit);
    nonempty(a.name);
    instant(a.as_of);
    if (a.value.currency) scale(a.value.currency);
    await evidence(ctx, a.evidence_ids, u._id);
    if (a.corrects_id) await owned(ctx, "measurement", a.corrects_id, u._id);
    if (a.assumption_id)
      await owned(ctx, "forecast_assumption", a.assumption_id, u._id);
    if (a.assertion === "expected" && !a.assumption_id)
      throw new Error("Expected measurement requires assumption");
    if (
      a.assertion === "derived" &&
      (!a.input_references?.length || !a.calculation_version)
    )
      throw new Error(
        "Derived measurement requires pinned inputs and calculation version",
      );
    const input_snapshot = [];
    for (const ref of a.input_references ?? []) {
      const source = await ownedTarget(ctx, ref, u._id);
      input_snapshot.push({
        target: ref,
        label: "Derived measurement input",
        captured: JSON.stringify(source),
        revision:
          "revision" in source && typeof source.revision === "number"
            ? source.revision
            : undefined,
      });
    }
    const { assertion, ...fields } = a;
    return ctx.db.insert("measurement", {
      ...fields,
      input_snapshot,
      user_id: u._id,
      created_at: Date.now(),
      recorded_at: Date.now(),
      m_type: assertion,
    });
  },
});
export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    const converted = new Set(
      (await ctx.db.query("migration_map").collect())
        .filter(
          (x) =>
            x.source_table === "measurement" &&
            x.target_table === "commitment_schedule",
        )
        .map((x) => x.source_id),
    );
    return (await ctx.db.query("measurement").collect()).filter(
      (x) => x.user_id === u._id && !x.archived && !converted.has(x._id),
    );
  },
});
