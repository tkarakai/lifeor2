import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { selectRevision } from "./domain";
export async function entityAt(
  ctx: QueryCtx,
  root: Doc<"entity">,
  at = Date.now(),
  known = Date.now(),
) {
  const revisions = await ctx.db
    .query("entity_revision")
    .withIndex("by_root", (q) => q.eq("root_id", root._id))
    .collect();
  const selected = selectRevision(revisions, at, known);
  return selected
    ? { ...root, ...(selected.facts as { kind: string; display_name: string }) }
    : root;
}
export async function arrangementAt(
  ctx: QueryCtx,
  root: Doc<"arrangement">,
  at = Date.now(),
  known = Date.now(),
) {
  const revisions = await ctx.db
    .query("arrangement_revision")
    .withIndex("by_root", (q) => q.eq("root_id", root._id))
    .collect();
  const selected = selectRevision(revisions, at, known);
  return selected
    ? {
        ...root,
        ...(selected.facts as (typeof revisions)[number]["segments"][number]["facts"]),
      }
    : root;
}
export async function roleAt(
  ctx: QueryCtx,
  root: Doc<"arrangement_role_definition">,
  at = Date.now(),
  known = Date.now(),
) {
  const revisions = await ctx.db
    .query("role_definition_revision")
    .withIndex("by_root", (q) => q.eq("root_id", root._id))
    .collect();
  const selected = selectRevision(revisions, at, known);
  return selected
    ? {
        ...root,
        ...(selected.facts as (typeof revisions)[number]["segments"][number]["facts"]),
      }
    : root;
}
export async function assignmentAt(
  ctx: QueryCtx,
  root: Doc<"arrangement_role_assignment">,
  at = Date.now(),
  known = Date.now(),
) {
  const revisions = await ctx.db
    .query("role_assignment_revision")
    .withIndex("by_root", (q) => q.eq("root_id", root._id))
    .collect();
  const selected = selectRevision(revisions, at, known);
  return selected
    ? {
        ...root,
        ...(selected.facts as (typeof revisions)[number]["segments"][number]["facts"]),
      }
    : root;
}
