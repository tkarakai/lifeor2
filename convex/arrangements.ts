import { arrangementAt, roleAt, assignmentAt } from "./lib/history";
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./lib/scoped";
import type { Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { owned, requireUser, expected } from "./lib/access";
import {
  nonempty,
  period,
  changeTimeline,
  selectRevision,
  integer,
} from "./lib/domain";
import { participation, template } from "./schema/shared";
const excluded = new Set([
  "ChartOfAccounts",
  "Project",
  "Budget",
  "Plan",
  "Scenario",
  "Valuation",
  "FXObservation",
  "PipelineOpportunity",
]);
const isExcluded = (name: string) =>
  [...excluded].some(
    (x) =>
      x.replace(/[\s_-]/g, "").toLowerCase() ===
      name.replace(/[\s_-]/g, "").toLowerCase(),
  );
async function createTypeImpl(
  ctx: MutationCtx,
  user: string,
  name: string,
  templates: {
    name: string;
    participation: "participant" | "subject";
    eligibleKinds?: string[];
  }[],
) {
  name = nonempty(name);
  if (isExcluded(name))
    throw new Error("This kind has a dedicated domain, not an arrangement");
  for (const t of templates) nonempty(t.name);
  const id = await ctx.db.insert("arrangement_type", {
    user_id: user,
    name,
    templates,
    revision: 1,
    created_at: Date.now(),
  });
  await ctx.db.insert("arrangement_type_revision", {
    user_id: user,
    root_id: id,
    name,
    templates,
    revision: 1,
    recorded_at: Date.now(),
    actor: user,
  });
  return id;
}
export const listTypes = query({
  args: {},
  handler: async (ctx) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    return u
      ? (
          await ctx.db
            .query("arrangement_type")
            .withIndex("by_user", (q) => q.eq("user_id", u._id))
            .collect()
        ).filter((x) => !x.archived)
      : [];
  },
});
export const createType = mutation({
  args: { name: v.string(), templates: v.optional(v.array(template)) },
  handler: async (ctx, a) =>
    createTypeImpl(
      ctx,
      (await requireUser(ctx))._id,
      a.name,
      a.templates ?? [],
    ),
});
export const updateType = mutation({
  args: {
    id: v.id("arrangement_type"),
    name: v.optional(v.string()),
    templates: v.optional(v.array(template)),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      old = await owned(ctx, "arrangement_type", a.id, u._id);
    expected(old.revision, a.expectedRevision);
    const name = nonempty(a.name ?? old.name),
      templates = a.templates ?? old.templates;
    if (isExcluded(name)) throw new Error("Reserved domain kind");
    for (const t of templates) nonempty(t.name);
    await ctx.db.patch(a.id, { name, templates, revision: old.revision + 1 });
    await ctx.db.insert("arrangement_type_revision", {
      user_id: u._id,
      root_id: a.id,
      name,
      templates,
      revision: old.revision + 1,
      recorded_at: Date.now(),
      actor: u._id,
    });
    return a.id;
  },
});
export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    return u
      ? Promise.all(
          (
            await ctx.db
              .query("arrangement")
              .withIndex("by_user", (q) => q.eq("user_id", u._id))
              .collect()
          )
            .filter((x) => !x.archived && !x.migrated_to && !isExcluded(x.kind))
            .map((x) => arrangementAt(ctx, x)),
        )
      : [];
  },
});
export const get = query({
  args: { id: v.id("arrangement") },
  handler: async (ctx, a) =>
    arrangementAt(
      ctx,
      await owned(ctx, "arrangement", a.id, (await requireUser(ctx))._id),
    ),
});
export const listValidAt = query({
  args: { timestamp: v.number(), knownAt: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const u = await authComponent.safeGetAuthUser(ctx);
    if (!u) return [];
    const roots = await ctx.db
      .query("arrangement")
      .withIndex("by_user", (q) => q.eq("user_id", u._id))
      .collect();
    const result = [];
    for (const r of roots) {
      if (r.archived || r.migrated_to || isExcluded(r.kind)) continue;
      const revisions = await ctx.db
        .query("arrangement_revision")
        .withIndex("by_root", (q) => q.eq("root_id", r._id))
        .collect();
      const selected = selectRevision(
        revisions,
        a.timestamp,
        a.knownAt ?? Date.now(),
      );
      const facts = selected?.facts as typeof r | undefined;
      const value = facts ? { ...r, ...facts } : revisions.length ? null : r;
      if (
        value &&
        value.valid_from <= a.timestamp &&
        (value.valid_to === undefined || a.timestamp < value.valid_to)
      )
        result.push(value);
    }
    return result;
  },
});
async function createRoleImpl(
  ctx: MutationCtx,
  user: string,
  arrangementId: Id<"arrangement">,
  facts: {
    name: string;
    participation: "participant" | "subject";
    eligibleKinds?: string[];
  },
  lineage?: {
    template_revision_id: Id<"arrangement_type_revision">;
    template_index: number;
  },
) {
  const arr = await owned(ctx, "arrangement", arrangementId, user);
  const id = await ctx.db.insert("arrangement_role_definition", {
    user_id: user,
    arrangement_id: arrangementId,
    ...facts,
    name: nonempty(facts.name),
    revision: 1,
    created_at: Date.now(),
    ...lineage,
  });
  await ctx.db.insert("role_definition_revision", {
    user_id: user,
    root_id: id,
    revision: 1,
    recorded_at: Date.now(),
    actor: user,
    segments: [{ valid_from: arr.valid_from, facts }],
  });
  return id;
}
export const create = mutation({
  args: {
    typeId: v.optional(v.id("arrangement_type")),
    kind: v.optional(v.string()),
    name: v.optional(v.string()),
    valid_from: v.number(),
    valid_to: v.optional(v.number()),
    parent_arrangement_id: v.optional(v.id("arrangement")),
    supersedes_arrangement_id: v.optional(v.id("arrangement")),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    period(a.valid_from, a.valid_to);
    let typeId = a.typeId;
    if (!typeId) {
      const name = nonempty(a.kind ?? "");
      const found = (
        await ctx.db
          .query("arrangement_type")
          .withIndex("by_user", (q) => q.eq("user_id", u._id))
          .collect()
      ).find((t) => t.name === name && !t.archived);
      typeId = found?._id ?? (await createTypeImpl(ctx, u._id, name, []));
    }
    const type = await owned(ctx, "arrangement_type", typeId, u._id);
    if (type.archived) throw new Error("Type archived");
    for (const id of [a.parent_arrangement_id, a.supersedes_arrangement_id])
      if (id) await owned(ctx, "arrangement", id, u._id);
    const facts = {
      name: nonempty(a.name ?? type.name),
      lifecycle: "active" as const,
      valid_from: a.valid_from,
      valid_to: a.valid_to,
      parent_arrangement_id: a.parent_arrangement_id,
      supersedes_arrangement_id: a.supersedes_arrangement_id,
    };
    const id = await ctx.db.insert("arrangement", {
      ...facts,
      kind: type.name,
      type_id: typeId,
      user_id: u._id,
      revision: 1,
      created_at: Date.now(),
    });
    await ctx.db.insert("arrangement_revision", {
      root_id: id,
      user_id: u._id,
      revision: 1,
      recorded_at: Date.now(),
      actor: u._id,
      segments: [{ valid_from: a.valid_from, facts }],
    });
    const tr = (
      await ctx.db
        .query("arrangement_type_revision")
        .withIndex("by_root", (q) => q.eq("root_id", typeId!))
        .collect()
    ).find((x) => x.revision === type.revision);
    for (const [index, t] of type.templates.entries())
      await createRoleImpl(
        ctx,
        u._id,
        id,
        t,
        tr
          ? { template_revision_id: tr._id, template_index: index }
          : undefined,
      );
    return id;
  },
});
export const update = mutation({
  args: {
    id: v.id("arrangement"),
    name: v.optional(v.string()),
    lifecycle: v.optional(
      v.union(v.literal("draft"), v.literal("active"), v.literal("ended")),
    ),
    valid_to: v.optional(v.number()),
    parent_arrangement_id: v.optional(v.id("arrangement")),
    effectiveAt: v.optional(v.number()),
    expectedRevision: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      old = await owned(ctx, "arrangement", a.id, u._id);
    expected(old.revision, a.expectedRevision);
    if (a.parent_arrangement_id) {
      // Consider scheduled parent edges too: future edits must not hide a cycle.
      const visited = new Set<string>();
      const pending: Id<"arrangement">[] = [a.parent_arrangement_id];
      while (pending.length) {
        const id = pending.pop()!;
        if (id === a.id) throw new Error("Arrangement cycle");
        if (visited.has(id)) continue;
        visited.add(id);
        const parent = await owned(ctx, "arrangement", id, u._id);
        const history = await ctx.db
          .query("arrangement_revision")
          .withIndex("by_root", (q) => q.eq("root_id", id))
          .collect();
        const latest = history.sort((x, y) => y.revision - x.revision)[0];
        const refs = latest
          ? latest.segments.map((s) => s.facts.parent_arrangement_id)
          : [parent.parent_arrangement_id];
        for (const ref of refs) if (ref) pending.push(ref);
      }
    }
    const revisions = await ctx.db
      .query("arrangement_revision")
      .withIndex("by_root", (q) => q.eq("root_id", a.id))
      .collect();
    const prev = revisions.sort((a, b) => b.revision - a.revision)[0];
    const fallback = {
      name: old.name ?? old.kind,
      lifecycle: old.lifecycle ?? ("active" as const),
      valid_from: old.valid_from,
      valid_to: old.valid_to,
      parent_arrangement_id: old.parent_arrangement_id,
      supersedes_arrangement_id: old.supersedes_arrangement_id,
    };
    const at = a.effectiveAt ?? a.valid_to ?? Date.now();
    const segments = prev?.segments ?? [
      { valid_from: old.valid_from, facts: fallback },
    ];
    const base =
      segments.find(
        (s) =>
          s.valid_from <= at && (s.valid_to === undefined || at < s.valid_to),
      )?.facts ?? fallback;
    const facts = {
      ...base,
      name: nonempty(a.name ?? base.name),
      lifecycle: a.lifecycle ?? base.lifecycle,
      valid_to: a.valid_to ?? base.valid_to,
      parent_arrangement_id:
        a.parent_arrangement_id ?? base.parent_arrangement_id,
    };
    period(facts.valid_from, facts.valid_to);
    // End-boundary corrections revise the complete known interval, including reopening
    // a previously ended period. Merely changing facts at the new end leaves a gap.
    const bounded =
      a.valid_to === undefined
        ? segments
        : segments.map((s) => ({
            ...s,
            facts: { ...s.facts, valid_to: a.valid_to },
          }));
    const onlyBoundary =
      a.valid_to !== undefined &&
      a.name === undefined &&
      a.lifecycle === undefined &&
      a.parent_arrangement_id === undefined;
    const timeline = onlyBoundary
      ? bounded
      : changeTimeline(bounded, at, facts);
    const revision = (old.revision ?? 0) + 1;
    await ctx.db.insert("arrangement_revision", {
      root_id: a.id,
      user_id: u._id,
      revision,
      recorded_at: Date.now(),
      actor: u._id,
      reason: a.reason,
      prior_id: prev?._id,
      segments: timeline,
    });
    const current =
      timeline.find(
        (s) =>
          s.valid_from <= Date.now() &&
          (s.valid_to === undefined || Date.now() < s.valid_to),
      )?.facts ?? fallback;
    await ctx.db.patch(a.id, { ...current, revision });
    return a.id;
  },
});
export const getRoleDefinitions = query({
  args: { arrangementId: v.id("arrangement") },
  handler: async (ctx, a) => {
    await owned(
      ctx,
      "arrangement",
      a.arrangementId,
      (await requireUser(ctx))._id,
    );
    return Promise.all(
      (
        await ctx.db
          .query("arrangement_role_definition")
          .withIndex("by_arrangement", (q) =>
            q.eq("arrangement_id", a.arrangementId),
          )
          .collect()
      ).map((r) => roleAt(ctx, r)),
    );
  },
});
export const getRoles = query({
  args: { arrangementId: v.id("arrangement") },
  handler: async (ctx, a) => {
    await owned(
      ctx,
      "arrangement",
      a.arrangementId,
      (await requireUser(ctx))._id,
    );
    const assignments = await ctx.db
      .query("arrangement_role_assignment")
      .withIndex("by_arrangement", (q) =>
        q.eq("arrangement_id", a.arrangementId),
      )
      .collect();
    return Promise.all(
      assignments.map(async (x) => ({
        ...(await assignmentAt(ctx, x)),
        role_name: (
          await roleAt(ctx, (await ctx.db.get(x.role_definition_id))!)
        ).name,
      })),
    );
  },
});
export const createRole = mutation({
  args: {
    arrangementId: v.id("arrangement"),
    name: v.string(),
    participation,
    eligibleKinds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, a) => {
    const { arrangementId, ...facts } = a;
    return createRoleImpl(
      ctx,
      (await requireUser(ctx))._id,
      arrangementId,
      facts,
    );
  },
});
export const updateRole = mutation({
  args: {
    id: v.id("arrangement_role_definition"),
    name: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    participation: v.optional(participation),
    eligibleKinds: v.optional(v.array(v.string())),
    effectiveAt: v.optional(v.number()),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      old = await owned(ctx, "arrangement_role_definition", a.id, u._id);
    expected(old.revision, a.expectedRevision);
    const revisions = await ctx.db
      .query("role_definition_revision")
      .withIndex("by_root", (q) => q.eq("root_id", a.id))
      .collect();
    const prev = revisions.sort((a, b) => b.revision - a.revision)[0];
    const at = a.effectiveAt ?? Date.now();
    const base =
      prev.segments.find(
        (s) =>
          s.valid_from <= at && (s.valid_to === undefined || at < s.valid_to),
      )?.facts ?? old;
    const facts = {
      name: nonempty(a.name ?? base.name),
      participation: a.participation ?? base.participation,
      eligibleKinds: a.eligibleKinds ?? base.eligibleKinds,
      archived: a.archived ?? base.archived,
    };
    if (a.eligibleKinds?.length) {
      const assignments = await ctx.db
        .query("arrangement_role_assignment")
        .withIndex("by_role", (q) => q.eq("role_definition_id", a.id))
        .collect();
      for (const assignment of assignments) {
        if ((assignment.valid_to ?? Infinity) <= at) continue;
        const entity = await owned(ctx, "entity", assignment.entity_id, u._id);
        if (!a.eligibleKinds.includes(entity.kind))
          throw new Error("Existing assignment violates eligible kinds");
      }
    }

    await ctx.db.insert("role_definition_revision", {
      user_id: u._id,
      root_id: a.id,
      revision: old.revision + 1,
      recorded_at: Date.now(),
      actor: u._id,
      segments: changeTimeline(
        prev.segments,
        a.effectiveAt ?? Date.now(),
        facts,
      ),
    });
    const current = await roleAt(ctx, { ...old, revision: old.revision + 1 });
    await ctx.db.patch(a.id, {
      name: current.name,
      archived: current.archived,
      participation: current.participation,
      eligibleKinds: current.eligibleKinds,
      revision: old.revision + 1,
    });
    return a.id;
  },
});
async function assign(
  ctx: MutationCtx,
  user: string,
  roleId: Id<"arrangement_role_definition">,
  entityId: Id<"entity">,
  from: number,
  to?: number,
) {
  period(from, to);
  const role = await roleAt(
      ctx,
      await owned(ctx, "arrangement_role_definition", roleId, user),
      from,
    ),
    entity = await owned(ctx, "entity", entityId, user);
  if (role.archived || entity.archived) throw new Error("Archived reference");
  if (role.eligibleKinds?.length && !role.eligibleKinds.includes(entity.kind))
    throw new Error("Entity kind is ineligible");
  const facts = { entity_id: entityId, valid_from: from, valid_to: to };
  const id = await ctx.db.insert("arrangement_role_assignment", {
    user_id: user,
    arrangement_id: role.arrangement_id,
    role_definition_id: roleId,
    ...facts,
    revision: 1,
    created_at: Date.now(),
  });
  await ctx.db.insert("role_assignment_revision", {
    user_id: user,
    root_id: id,
    revision: 1,
    recorded_at: Date.now(),
    actor: user,
    segments: [{ valid_from: from, facts }],
  });
  return id;
}
export const assignRole = mutation({
  args: {
    roleId: v.id("arrangement_role_definition"),
    entityId: v.id("entity"),
    valid_from: v.number(),
    valid_to: v.optional(v.number()),
  },
  handler: async (ctx, a) =>
    assign(
      ctx,
      (await requireUser(ctx))._id,
      a.roleId,
      a.entityId,
      a.valid_from,
      a.valid_to,
    ),
});
export const addRole = mutation({
  args: {
    arrangementId: v.id("arrangement"),
    roleName: v.string(),
    entityId: v.id("entity"),
    shareJson: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    if (a.shareJson !== undefined)
      throw new Error("Use typed ownership interests, not share JSON");
    const arr = await owned(ctx, "arrangement", a.arrangementId, u._id);
    const roles = await ctx.db
      .query("arrangement_role_definition")
      .withIndex("by_arrangement", (q) =>
        q.eq("arrangement_id", a.arrangementId),
      )
      .collect();
    const id =
      roles.find((r) => r.name === a.roleName && !r.archived)?._id ??
      (await createRoleImpl(ctx, u._id, a.arrangementId, {
        name: a.roleName,
        participation: "participant",
      }));
    return assign(ctx, u._id, id, a.entityId, arr.valid_from, arr.valid_to);
  },
});
export const updateAssignment = mutation({
  args: {
    id: v.id("arrangement_role_assignment"),
    valid_to: v.optional(v.number()),
    effectiveAt: v.optional(v.number()),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx),
      old = await owned(ctx, "arrangement_role_assignment", a.id, u._id);
    expected(old.revision, a.expectedRevision);
    const facts = {
      entity_id: old.entity_id,
      valid_from: old.valid_from,
      valid_to: a.valid_to ?? old.valid_to,
    };
    period(facts.valid_from, facts.valid_to);
    const prev = (
      await ctx.db
        .query("role_assignment_revision")
        .withIndex("by_root", (q) => q.eq("root_id", a.id))
        .collect()
    ).sort((a, b) => b.revision - a.revision)[0];
    await ctx.db.insert("role_assignment_revision", {
      user_id: u._id,
      root_id: a.id,
      revision: old.revision + 1,
      recorded_at: Date.now(),
      actor: u._id,
      segments: prev.segments.map((s) => ({
        ...s,
        facts: { ...s.facts, valid_to: facts.valid_to },
      })),
    });
    const current = await assignmentAt(ctx, {
      ...old,
      revision: old.revision + 1,
    });
    await ctx.db.patch(a.id, {
      valid_from: current.valid_from,
      valid_to: current.valid_to,
      revision: old.revision + 1,
    });
    return a.id;
  },
});
export const remove = mutation({
  args: { id: v.id("arrangement") },
  handler: async (ctx, a) => {
    await owned(ctx, "arrangement", a.id, (await requireUser(ctx))._id);
    await ctx.db.patch(a.id, { archived: true });
  },
});
export const createOwnershipInterest = mutation({
  args: {
    owner_entity_id: v.id("entity"),
    asset_entity_id: v.id("entity"),
    arrangement_id: v.id("arrangement"),
    assignment_id: v.optional(v.id("arrangement_role_assignment")),
    basis: v.string(),
    share_bps: v.number(),
    valid_from: v.number(),
    valid_to: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx);
    period(a.valid_from, a.valid_to);
    integer(a.share_bps);
    if (a.share_bps <= 0 || a.share_bps > 10000)
      throw new Error("Invalid ownership share");
    await owned(ctx, "entity", a.owner_entity_id, u._id);
    await owned(ctx, "entity", a.asset_entity_id, u._id);
    await owned(ctx, "arrangement", a.arrangement_id, u._id);
    if (a.assignment_id) {
      const r = await owned(
        ctx,
        "arrangement_role_assignment",
        a.assignment_id,
        u._id,
      );
      if (
        r.arrangement_id !== a.arrangement_id ||
        r.entity_id !== a.owner_entity_id
      )
        throw new Error("Ownership assignment mismatch");
    }
    const all = (
      await ctx.db
        .query("ownership_interest")
        .withIndex("by_asset", (q) =>
          q.eq("asset_entity_id", a.asset_entity_id),
        )
        .collect()
    ).filter((x) => x.basis === a.basis);
    const boundaries = [
      a.valid_from,
      ...all
        .map((x) => x.valid_from)
        .filter((t) => t >= a.valid_from && t < (a.valid_to ?? Infinity)),
    ];
    for (const t of boundaries)
      if (
        a.share_bps +
          all
            .filter((x) => x.valid_from <= t && t < (x.valid_to ?? Infinity))
            .reduce((s, x) => s + x.share_bps, 0) >
        10000
      )
        throw new Error("Ownership shares exceed 10000 basis points");
    return ctx.db.insert("ownership_interest", {
      ...a,
      basis: nonempty(a.basis),
      user_id: u._id,
      created_at: Date.now(),
    });
  },
});
export const history = query({
  args: {
    id: v.id("arrangement"),
    effectiveAt: v.number(),
    knownAt: v.number(),
  },
  handler: async (ctx, a) => {
    await owned(ctx, "arrangement", a.id, (await requireUser(ctx))._id);
    const revisions = await ctx.db
      .query("arrangement_revision")
      .withIndex("by_root", (q) => q.eq("root_id", a.id))
      .collect();
    return {
      revisions,
      selected: selectRevision(revisions, a.effectiveAt, a.knownAt),
    };
  },
});
export const assignmentHistory = query({
  args: {
    id: v.id("arrangement_role_assignment"),
    effectiveAt: v.number(),
    knownAt: v.number(),
  },
  handler: async (ctx, a) => {
    await owned(
      ctx,
      "arrangement_role_assignment",
      a.id,
      (await requireUser(ctx))._id,
    );
    const revisions = await ctx.db
      .query("role_assignment_revision")
      .withIndex("by_root", (q) => q.eq("root_id", a.id))
      .collect();
    return {
      revisions,
      selected: selectRevision(revisions, a.effectiveAt, a.knownAt),
    };
  },
});
