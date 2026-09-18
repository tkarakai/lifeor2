import { v } from "convex/values";
import { query, mutation, businessTables, type QueryCtx } from "./lib/scoped";
import { ownedTarget, requireUser } from "./lib/access";
import { target } from "./schema/shared";
import type { Doc, Id } from "./_generated/dataModel";
import { changeTimeline } from "./lib/domain";
const roots = [
  "entity",
  "arrangement",
  "arrangement_type",
  "arrangement_role_definition",
  "event",
  "measurement",
  "tag",
  "chart_of_accounts",
  "ledger_account",
  "financial_account",
  "journal_entry",
  "evidence_item",
  "commitment_schedule",
  "monetary_obligation",
  "plan",
  "scenario",
  "forecast_assumption",
] as const;
type Row = Doc<(typeof businessTables)[number]>;
function name(row: Row) {
  for (const key of [
    "display_name",
    "name",
    "title",
    "memo",
    "kind",
    "due_date",
  ]) {
    const value = (row as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return row._id;
}
export const list = query({
  agent: { operation: "trash.list", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const result = [];
    for (const kind of roots)
      for (const row of await ctx.db.query(kind).collect()) {
        if (row.archived)
          result.push({ target: { kind, id: row._id }, name: name(row) });
      }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});
function references(value: unknown, ids: Set<string>): boolean {
  if (typeof value === "string") {
    if (ids.has(value)) return true;
    // Immutable input manifests store captured records as JSON text.
    if (value.startsWith("{") || value.startsWith("[")) {
      try {
        return references(JSON.parse(value), ids);
      } catch {
        return false;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some((x) => references(x, ids));
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).some((x) => references(x, ids))
  );
}
async function deletionPlan(
  ctx: QueryCtx,
  ref: Parameters<typeof ownedTarget>[1],
) {
  const user = await requireUser(ctx),
    root = await ownedTarget(ctx, ref, user._id);
  if (!("archived" in root) || !root.archived)
    throw new Error("Archive the record before permanently deleting it");
  if (!(roots as readonly string[]).includes(ref.kind))
    throw new Error("This record is managed through its parent");
  const rows: { table: (typeof businessTables)[number]; row: Row }[] = [];
  for (const table of businessTables)
    for (const row of await ctx.db.query(table).collect())
      rows.push({ table, row });
  const ids = new Set<string>([ref.id]);
  const owns: Record<string, string[]> = {
    entity_revision: ["root_id"],
    arrangement_revision: ["root_id"],
    arrangement_type_revision: ["root_id"],
    arrangement_role_definition: ["arrangement_id"],
    arrangement_role_assignment: ["arrangement_id", "role_definition_id"],
    arrangement_role: ["arrangement_id"],
    role_definition_revision: ["root_id"],
    role_assignment_revision: ["root_id"],
    event_affects: ["event_id"],
    posting: ["je_id"],
    posting_attribution_set: ["posting_id"],
    posting_attribution: ["set_id"],
    attribution_beneficiary: ["attribution_id"],
    commitment_schedule_version: ["schedule_id"],
    commitment_schedule_revision: ["schedule_id"],
    plan_version: ["plan_id"],
    budget_target: ["plan_version_id"],
    scenario_version: ["scenario_id"],
    property: ["owner_id"],
    migration_map: ["source_id", "target_id"],
    migration_issue: ["source_id"],
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const { table, row } of rows) {
      if (ids.has(row._id)) continue;
      const record = row as Record<string, unknown>;
      const attached =
        (owns[table] ?? []).some(
          (key) =>
            typeof record[key] === "string" && ids.has(record[key] as string),
        ) ||
        ([
          "tag_assignment",
          "evidence_link",
          "details_document",
          "sample_record",
        ].includes(table) &&
          (references(record.target, ids) ||
            ["tag_id", "evidence_id"].some((k) => ids.has(String(record[k])))));
      if (attached) {
        ids.add(row._id);
        grew = true;
      }
    }
  }
  const protectedRefs = new Set(ids);
  for (const { table, row } of rows)
    if (table === "details_document" && ids.has(row._id) && "path" in row)
      protectedRefs.add(row.path);
  const blockers: { kind: string; name: string; reason: string }[] = [];
  for (const { table, row } of rows) {
    if (ids.has(row._id)) {
      if (
        table === "journal_entry" &&
        "status" in row &&
        row.status === "posted"
      )
        blockers.push({
          kind: table,
          name: name(row),
          reason: "Posted accounting history must be reversed, not erased.",
        });
      if (
        table === "plan_version" &&
        "status" in row &&
        row.status === "published"
      )
        blockers.push({
          kind: table,
          name: name(row),
          reason: "Published snapshots are immutable.",
        });
      continue;
    }
    if (references(row, protectedRefs))
      blockers.push({
        kind: table,
        name: name(row),
        reason: "Still refers to this record or its history.",
      });
  }
  return { ids, rows, blockers, rootName: name(root as Row) };
}
export const inspect = query({
  agent: { operation: "trash.inspect", scope: "data:read" },
  args: { target },
  handler: async (ctx, args) => {
    const result = await deletionPlan(ctx, args.target);
    return {
      name: result.rootName,
      recordCount: result.ids.size,
      blockers: result.blockers,
    };
  },
});
export const restore = mutation({
  agent: { operation: "trash.restore", scope: "data:write" },
  args: { target },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx),
      row = await ownedTarget(ctx, args.target, user._id);
    if (!(roots as readonly string[]).includes(args.target.kind))
      throw new Error("Unsupported archive record");
    if (!("archived" in row) || !row.archived)
      throw new Error("Record is not archived");
    if (args.target.kind === "tag" && "name" in row) {
      const tags = await ctx.db.query("tag").collect();
      if (
        tags.some(
          (x) => !x.archived && x._id !== row._id && x.name === row.name,
        )
      )
        throw new Error("An active tag already has this name");
    }
    if (args.target.kind === "arrangement_role_definition") {
      const role = await ctx.db.get(args.target.id);
      if (!role) throw new Error("Role missing");
      const revisions = await ctx.db
        .query("role_definition_revision")
        .withIndex("by_root", (q) => q.eq("root_id", role._id))
        .collect();
      const prior = revisions.sort((a, b) => b.revision - a.revision)[0];
      const now = Date.now();
      const base =
        prior?.segments.find(
          (s) =>
            s.valid_from <= now &&
            (s.valid_to === undefined || s.valid_to > now),
        )?.facts ?? role;
      const facts = {
        name: base.name,
        participation: base.participation,
        eligibleKinds: base.eligibleKinds,
        archived: false,
      };
      await ctx.db.insert("role_definition_revision", {
        user_id: user._id,
        root_id: role._id,
        revision: role.revision + 1,
        actor: user._id,
        recorded_at: now,
        segments: changeTimeline(prior?.segments ?? [], now, facts),
      });
      await ctx.db.patch(role._id, {
        archived: false,
        revision: role.revision + 1,
      });
    } else await ctx.db.patch(args.target.id, { archived: false } as never);
  },
});
export const permanentlyDelete = mutation({
  agent: { operation: "trash.permanentlyDelete", scope: "data:delete" },
  args: { target, confirmation: v.string() },
  handler: async (ctx, args) => {
    const result = await deletionPlan(ctx, args.target);
    if (args.confirmation !== "DELETE")
      throw new Error("Type DELETE to confirm permanent deletion");
    if (result.blockers.length)
      throw new Error(
        `Cannot delete: ${result.blockers.length} dependent or protected records remain. Review the dependencies first.`,
      );
    for (const id of result.ids)
      await ctx.db.delete(id as Id<(typeof businessTables)[number]>);
    // Historical Git commits are deliberately retained. Without a locator these
    // documents are no longer reachable through authenticated application APIs.
    return { deleted: result.ids.size };
  },
});
