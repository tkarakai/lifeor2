import { matchesText } from "./lib/lifeQueries/text";
import { v } from "convex/values";
import { query } from "./lib/scoped";
import { owned, requireUser } from "./lib/access";
import { entityAt, arrangementAt, assignmentAt, roleAt } from "./lib/history";
import {
  referenceRows,
  workspace,
  page,
  dateRange,
  civilDate,
  money,
  type LifeContext,
} from "./lib/lifeQueries/common";
import { date } from "./lib/domain";
import { clockFacts, localInstant } from "./lib/lifeQueries/time";

const paging = {
  limit: v.optional(v.number()),
  offset: v.optional(v.number()),
};
export const context = query({
  agent: { operation: "life.context", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    const w = await workspace(ctx);
    const charts = await referenceRows(ctx, "chart_of_accounts");
    const members = [];
    if (w.householdArrangement) {
      const links = await ctx.db
        .query("arrangement_role_assignment")
        .withIndex("by_arrangement", (q) =>
          q.eq("arrangement_id", w.householdArrangement!),
        )
        .take(101);
      if (links.length > 100)
        throw new Error("Household exceeds 100 members; use relationships");
      for (const root of links) {
        const link = await assignmentAt(ctx, root);
        if (
          link.archived ||
          link.valid_from > Date.now() ||
          (link.valid_to !== undefined && link.valid_to <= Date.now())
        )
          continue;
        const role = await ctx.db.get(link.role_definition_id);
        members.push({
          id: link.entity_id,
          name:
            w.entities.find((e) => e._id === link.entity_id)?.display_name ??
            link.entity_id,
          role: role?.name ?? "Unknown",
          sourceId: link._id,
        });
      }
    }
    return {
      dataset: w.dataset?.name ?? "Live",
      today: w.today,
      timezone: w.timezone,
      timezoneConfigured: w.timezoneConfigured,
      calendarBasis: w.timezoneConfigured
        ? "Configured local calendar"
        : "UTC fallback only; ask for a timezone when local dates or appointment times matter",
      defaultHousehold: w.household
        ? {
            id: w.household,
            name:
              w.entities.find((e) => e._id === w.household)?.display_name ??
              "Configured household",
            arrangementId: w.householdArrangement ?? null,
            members,
            membershipComplete: true,
            membershipBasis:
              "Complete recorded membership roles. Adult/Child roles do not establish specific marriage or parent-child relationships. Entity identity/history records do not contain relationship edges; use life.relationships with arrangementId if more relationship evidence is needed.",
          }
        : null,
      sampleActualsThrough: w.dataset?.seed_as_of ?? null,
      datasetCompleteness: "unknown",
      charts: charts
        .filter((c) => !c.archived)
        .map((c) => ({ id: c._id, name: c.name })),
      capabilities: [
        "timeline: events, due and overdue obligations, scheduled and expected cashflows",
        "financial summaries: income, expense, balances, net changes and project costs",
        "relationships and ownership as of a date",
        "record changes, measurements and source documents",
        "revision-checked create/edit operations; hypothetical questions never write",
      ],
    };
  },
});
export const search = query({
  agent: { operation: "life.search", scope: "data:read" },
  args: {
    query: v.string(),
    entityType: v.optional(v.string()),
    kind: v.optional(
      v.union(
        v.literal("entity"),
        v.literal("arrangement"),
        v.literal("account"),
        v.literal("tag"),
        v.literal("schedule"),
      ),
    ),
    ...paging,
  },
  handler: async (ctx, a) => {
    await requireUser(ctx);
    const items: {
      id: string;
      kind: string;
      name: string;
      type?: string;
      revision?: number;
    }[] = [];
    for (const r of await referenceRows(ctx, "entity"))
      if (!r.archived) {
        const e = await entityAt(ctx, r);
        items.push({
          id: e._id,
          kind: "entity",
          name: e.display_name,
          type: e.kind,
          revision: e.revision,
        });
      }
    for (const r of await referenceRows(ctx, "arrangement"))
      if (!r.archived) {
        const e = await arrangementAt(ctx, r);
        items.push({
          id: e._id,
          kind: "arrangement",
          name: e.name ?? e.kind,
          type: e.kind,
          revision: e.revision,
        });
      }
    for (const e of await referenceRows(ctx, "ledger_account"))
      if (!e.archived)
        items.push({
          id: e._id,
          kind: "ledger_account",
          name: e.name,
          type: e.type,
        });
    for (const e of await referenceRows(ctx, "tag"))
      if (!e.archived) items.push({ id: e._id, kind: "tag", name: e.name });
    for (const e of await referenceRows(ctx, "commitment_schedule"))
      if (!e.archived)
        items.push({
          id: e._id,
          kind: "commitment_schedule",
          name: e.name,
          revision: e.revision,
        });
    const allMatches = items
      .filter((e) => matchesText(`${e.name} ${e.type ?? ""}`, a.query))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const typed = {
      entity: "entity",
      arrangement: "arrangement",
      account: "ledger_account",
      tag: "tag",
      schedule: "commitment_schedule",
    };
    const matches = allMatches.filter(
      (e) => (!a.kind || e.kind === typed[a.kind]) && (!a.entityType || (e.kind === "entity" && matchesText(e.type ?? "", a.entityType))),
    );
    return {
      ...page(matches, a.limit, a.offset),
      ...(matches.length === 0 && allMatches.length
        ? {
            otherKinds: allMatches.slice(0, 5),
            hint: "Matching names exist in another record category. Projects may be tags; use the returned kind and ID.",
          }
        : {}),
      identityStatus:
        matches.length === 1
          ? "unique"
          : matches.length
            ? "ambiguous"
            : "not_found",
    };
  },
});
const readable = v.union(
  v.literal("entity"),
  v.literal("arrangement"),
  v.literal("ledger_account"),
  v.literal("tag"),
  v.literal("commitment_schedule"),
  v.literal("monetary_obligation"),
  v.literal("event"),
);
async function scheduleTerms(
  ctx: LifeContext,
  id: import("./_generated/dataModel").Id<"commitment_schedule">,
) {
  const revisions = await ctx.db
    .query("commitment_schedule_revision")
    .withIndex("by_schedule", (q) => q.eq("schedule_id", id))
    .take(201);
  if (revisions.length > 200)
    throw new Error(
      "QUERY_LIMIT: schedule exceeds 200 revisions; inspect a narrower history",
    );
  const latest = revisions.sort((a, b) => b.revision - a.revision)[0];
  if (!latest) return { periods: [], revisionReason: null };
  const periods = await Promise.all(
    latest.segments.map(async (segment) => {
      const v = await ctx.db.get(segment.facts.version_id);
      if (!v) throw new Error("Missing schedule version");
      const debtor = await ctx.db.get(v.debtor_id),
        creditor = await ctx.db.get(v.creditor_id);
      return {
        versionId: v._id,
        effectiveFrom: new Date(segment.valid_from).toISOString(),
        effectiveToExclusive:
          segment.valid_to === undefined
            ? null
            : new Date(segment.valid_to).toISOString(),
        localEffectiveDate: civilDate(segment.valid_from, v.timezone),
        localLastEffectiveDate:
          segment.valid_to === undefined
            ? null
            : civilDate(segment.valid_to - 1, v.timezone),
        effectivePeriod: `${civilDate(segment.valid_from, v.timezone)} through ${segment.valid_to === undefined ? "ongoing" : civilDate(segment.valid_to - 1, v.timezone)} (inclusive local dates)`,
        amount: v.amount ? money(v.amount.minor_units, v.currency) : null,
        currency: v.currency,
        recurrence: v.recurrence,
        startDate: v.start_date,
        endDate: v.end_date ?? null,
        timezone: v.timezone,
        debtor: { id: v.debtor_id, name: debtor?.display_name },
        creditor: { id: v.creditor_id, name: creditor?.display_name },
      };
    }),
  );
  return { periods, revisionReason: latest.reason ?? null };
}
export const read = query({
  agent: { operation: "life.read", scope: "data:read" },
  args: { kind: readable, id: v.string() },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx),
      id = ctx.db.normalizeId(a.kind, a.id);
    if (!id) throw new Error("Invalid record type/ID. Use life.search first.");
    const r = await owned(ctx, a.kind, id, user._id);
    const current =
      a.kind === "entity"
        ? await entityAt(
            ctx,
            r as import("./_generated/dataModel").Doc<"entity">,
          )
        : a.kind === "arrangement"
          ? await arrangementAt(
              ctx,
              r as import("./_generated/dataModel").Doc<"arrangement">,
            )
          : r;
    const { _creationTime, user_id, dataset_id, ...record } = current;
    return {
      kind: a.kind,
      record,
      ...(a.kind === "commitment_schedule"
        ? await scheduleTerms(
            ctx,
            id as import("./_generated/dataModel").Id<"commitment_schedule">,
          )
        : {}),
      queryComplete: true,
    };
  },
});
export const relationships = query({
  agent: { operation: "life.relationships", scope: "data:read" },
  args: {
    entityId: v.optional(v.id("entity")),
    arrangementId: v.optional(v.id("arrangement")),
    asOf: v.optional(v.string()),
    role: v.optional(v.string()),
    arrangementQuery: v.optional(v.string()),
    ...paging,
  },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx);
    if (a.entityId) await owned(ctx, "entity", a.entityId, user._id);
    if (a.arrangementId)
      await owned(ctx, "arrangement", a.arrangementId, user._id);
    if (a.asOf) date(a.asOf);
    const w = await workspace(ctx);
    const at = a.asOf ? localInstant(a.asOf, "23:59", w.timezone) + 59999 : Date.now();
    const [er, ar, rr, links, ownership] = await Promise.all([
      referenceRows(ctx, "entity"),
      referenceRows(ctx, "arrangement"),
      referenceRows(ctx, "arrangement_role_definition"),
      referenceRows(ctx, "arrangement_role_assignment"),
      referenceRows(ctx, "ownership_interest"),
    ]);
    const entities = await Promise.all(er.map((e) => entityAt(ctx, e, at))),
      arrangements = await Promise.all(
        ar.map((e) => arrangementAt(ctx, e, at)),
      ),
      roles = await Promise.all(rr.map((e) => roleAt(ctx, e, at)));
    const name = (id: string) =>
      entities.find((e) => e._id === id)?.display_name ??
      arrangements.find((e) => e._id === id)?.name ??
      id;
    const active = (r: {
      archived?: boolean;
      valid_from: number;
      valid_to?: number;
    }) =>
      !r.archived &&
      r.valid_from <= at &&
      (r.valid_to === undefined || at < r.valid_to);
    const allActive = (await Promise.all(links.map(e => assignmentAt(ctx, e, at)))).filter(active);
    const roleName = (id: string) => roles.find(r => r._id === id)?.name ?? "Unknown role";
    const selected = allActive.filter(
      (e) =>
        active(e) &&
        (!a.entityId || e.entity_id === a.entityId) &&
        (!a.arrangementId || e.arrangement_id === a.arrangementId) &&
        (!a.role || matchesText(roleName(e.role_definition_id), a.role)) &&
        (!a.arrangementQuery || matchesText(name(e.arrangement_id), a.arrangementQuery)),
    );
    const items = [
      ...selected.map((e) => ({
        kind: "role",
        id: e._id,
        entity: { id: e.entity_id, name: name(e.entity_id) },
        arrangement: { id: e.arrangement_id, name: name(e.arrangement_id) },
        role: roleName(e.role_definition_id),
        participants: allActive.filter(p => p.arrangement_id === e.arrangement_id && p._id !== e._id).slice(0, 50).map(p => ({
          sourceId: p._id, entity: { id: p.entity_id, name: name(p.entity_id) }, role: roleName(p.role_definition_id),
        })),
        participantsComplete: allActive.filter(p => p.arrangement_id === e.arrangement_id && p._id !== e._id).length <= 50,
      })),
      ...ownership
        .filter(
          (e) =>
            active(e) &&
            (!a.entityId ||
              e.owner_entity_id === a.entityId ||
              e.asset_entity_id === a.entityId) &&
            (!a.arrangementId || e.arrangement_id === a.arrangementId) &&
            (!a.role || matchesText("Owner ownership", a.role)) &&
            (!a.arrangementQuery || (e.arrangement_id && matchesText(name(e.arrangement_id), a.arrangementQuery))),
        )
        .map((e) => ({
          kind: "ownership",
          id: e._id,
          owner: { id: e.owner_entity_id, name: name(e.owner_entity_id) },
          asset: { id: e.asset_entity_id, name: name(e.asset_entity_id) },
          sharePercent: e.share_bps / 100,
          basis: e.basis,
        })),
    ];
    return {
      ...page(items, a.limit, a.offset),
      asOf: new Date(at).toISOString(),
      timezone: w.timezone,
      dateBasis: a.asOf ? "End of the requested local civil day" : "Current instant",
      filters: {
        entity: a.entityId ? name(a.entityId) : null,
        arrangement: a.arrangementId ? name(a.arrangementId) : null,
        roleWords: a.role ?? null,
        arrangementWords: a.arrangementQuery ?? null,
      },
      coverage: a.entityId || a.arrangementId || a.role || a.arrangementQuery
        ? "Query completeness applies only to the explicit filters above. Records outside those filters were excluded; a filtered result is not a complete ownership or family inventory. Do not describe its only match as the only relationship in the dataset. Follow pagination for remaining matches."
        : "All active recorded roles and ownership at the stated instant were queried. Follow pagination before claiming the complete matching list. This does not establish unrecorded real-life relationships.",
      basis:
        "Recorded direct roles and ownership. No inferred beneficial ownership or financial consolidation. Ownership and surnames do not assign company transactions to a person; use explicit ledger subject/beneficiary allocations, or ask for the intended reporting scope instead of inferring an allocation.",
    };
  },
});
export const history = query({
  agent: { operation: "life.history", scope: "data:read" },
  args: {
    kind: v.union(
      v.literal("entity"),
      v.literal("arrangement"),
      v.literal("commitment_schedule"),
    ),
    id: v.string(),
    ...paging,
  },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx),
      id = ctx.db.normalizeId(a.kind, a.id);
    if (!id) throw new Error("Invalid typed record ID");
    await owned(ctx, a.kind, id, user._id);
    const rows =
      a.kind === "entity"
        ? await ctx.db
            .query("entity_revision")
            .withIndex("by_root", (q) =>
              q.eq(
                "root_id",
                id as import("./_generated/dataModel").Id<"entity">,
              ),
            )
            .take(501)
        : a.kind === "arrangement"
          ? await ctx.db
              .query("arrangement_revision")
              .withIndex("by_root", (q) =>
                q.eq(
                  "root_id",
                  id as import("./_generated/dataModel").Id<"arrangement">,
                ),
              )
              .take(501)
          : await ctx.db
              .query("commitment_schedule_revision")
              .withIndex("by_schedule", (q) =>
                q.eq(
                  "schedule_id",
                  id as import("./_generated/dataModel").Id<"commitment_schedule">,
                ),
              )
              .take(501);
    if (rows.length > 500)
      throw new Error("QUERY_LIMIT: history exceeds 500 revisions");
    return {
      ...page(
        rows
          .sort((a, b) => b.revision - a.revision)
          .map((r) => ({
            id: r._id,
            revision: r.revision,
            recordedAt: new Date(r.recorded_at).toISOString(),
            reason: r.reason,
            segments: r.segments,
          })),
        a.limit,
        a.offset,
      ),
      basis:
        "Revision records preserve both effective intervals and when changes were recorded.",
    };
  },
});
export const measurements = query({
  agent: { operation: "life.measurements", scope: "data:read" },
  args: {
    from: v.optional(v.string()),
    through: v.string(),
    subjectId: v.optional(v.string()),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (a.from) dateRange(a.from, a.through, 36600);
    else date(a.through);
    const w = await workspace(ctx),
      limit = a.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("limit must be 1–50");
    const lo = a.from ? Date.parse(a.from) - 86400000 : -8640000000000000,
      hi = Date.parse(a.through) + 2 * 86400000;
    const state =
      a.subjectId && !ctx.scope.legacy
        ? a.cursor
          ? (JSON.parse(a.cursor) as {
              phase: "subject" | "owner";
              cursor: string | null;
            })
          : { phase: "subject" as const, cursor: null }
        : null;
    if (
      state &&
      (!["subject", "owner"].includes(state.phase) ||
        (state.cursor !== null && typeof state.cursor !== "string"))
    )
      throw new Error("Invalid measurement cursor");
    const source = ctx.scope.legacy
      ? ctx.db
          .query("measurement")
          .withIndex("by_as_of", (q) => q.gte("as_of", lo).lt("as_of", hi))
      : a.subjectId
        ? state?.phase === "owner"
          ? ctx.db
              .query("measurement")
              .withIndex("by_legacy_owner_as_of", (q) =>
                q
                  .eq("dataset_id", ctx.scope.datasetId)
                  .eq("owner_id", a.subjectId)
                  .gte("as_of", lo)
                  .lt("as_of", hi),
              )
          : ctx.db.query("measurement").withIndex("by_subject_as_of", (q) =>
              q
                .eq("dataset_id", ctx.scope.datasetId)
                .eq("subject.id", a.subjectId as never)
                .gte("as_of", lo)
                .lt("as_of", hi),
            )
        : ctx.db
            .query("measurement")
            .withIndex("by_dataset_as_of", (q) =>
              q
                .eq("dataset_id", ctx.scope.datasetId)
                .gte("as_of", lo)
                .lt("as_of", hi),
            );
    const slice = await source.order("desc").paginate({
        cursor: state ? state.cursor : (a.cursor ?? null),
        numItems: limit,
      }),
      items = [];
    const nextCursor = state
      ? slice.isDone
        ? state.phase === "subject"
          ? JSON.stringify({ phase: "owner", cursor: null })
          : null
        : JSON.stringify({ ...state, cursor: slice.continueCursor })
      : slice.isDone
        ? null
        : slice.continueCursor;
    for (const r of slice.page) {
      if (state?.phase === "owner" && r.subject) continue;
      const date = civilDate(r.as_of, w.timezone);
      if (
        r.archived ||
        (a.from && date < a.from) ||
        date > a.through ||
        (a.subjectId && (r.subject?.id ?? r.owner_id) !== a.subjectId) ||
        (a.query && !matchesText(r.name, a.query))
      )
        continue;
      if (
        await ctx.db
          .query("measurement")
          .withIndex("by_corrects", (q) => q.eq("corrects_id", r._id))
          .first()
      )
        continue;
      const subject = r.subject ?? { id: r.owner_id, kind: r.owner_type };
      const table = subject.kind === "entity" || subject.kind === "arrangement" ? subject.kind : null;
      const subjectId = table && subject.id ? ctx.db.normalizeId(table, subject.id) : null;
      const root = subjectId ? await ctx.db.get(subjectId) : null;
      const subjectName = root ? ("display_name" in root ? (await entityAt(ctx, root)).display_name : (await arrangementAt(ctx, root)).name) : undefined;
      items.push({
        id: r._id,
        name: r.name,
        date,
        subject: { ...subject, ...(subjectName ? { name: subjectName } : {}) },
        value: r.value ?? null,
        assertion: r.m_type ?? "unspecified",
        method: r.method ?? null,
        sourceIds: r.evidence_ids ?? [],
      });
    }
    return {
      items,
      filter: { from: a.from ?? "all recorded history", through: a.through, query: a.query ?? null, subjectId: a.subjectId ?? null },
      nextCursor,
      queryComplete: nextCursor === null,
      datasetCompleteness: "unknown",
      basis:
        "Recorded measurements, newest first; preserve units, assertion type and date. Follow the cursor even when a filtered page has no matches. Missing measurements are unknown.",
    };
  },
});
export const documents = query({
  agent: { operation: "life.documents", scope: "data:read" },
  args: { ...paging },
  handler: async (ctx, a) =>
    page(
      (await referenceRows(ctx, "details_document")).map((d) => ({
        id: d._id,
        target: d.target,
        availability: d.availability,
      })),
      a.limit,
      a.offset,
    ),
});

export const events = query({
  agent: { operation: "life.events", scope: "data:read" },
  args: {
    from: v.optional(v.string()),
    through: v.optional(v.string()),
    query: v.optional(v.string()),
    kind: v.optional(v.string()),
    entityId: v.optional(v.id("entity")),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (a.from !== undefined && a.through !== undefined) dateRange(a.from, a.through, 36600);
    else { if (a.from !== undefined) date(a.from); if (a.through !== undefined) date(a.through); }
    const nextEvent = a.from !== undefined && a.through === undefined;
    const w = await workspace(ctx),
      limit = a.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("limit must be 1–50");
    const subject = a.entityId ? await owned(ctx, "entity", a.entityId, w.user._id) : null;
    const lo = a.from ? Date.parse(a.from) - 86400000 : -8640000000000000,
      hi = a.through ? Date.parse(a.through) + 2 * 86400000 : 8640000000000000;
    const useSubjectIndex = !!(a.entityId && !nextEvent && (await ctx.db.query("event_affects").withIndex("by_target", q => q.eq("target_type", "entity").eq("target_id", a.entityId!)).take(51)).length <= 50);
    const state =
      !nextEvent && !useSubjectIndex && ctx.scope.legacy && ctx.scope.datasetId
        ? a.cursor
          ? (JSON.parse(a.cursor) as { legacy: boolean; cursor: string | null })
          : { legacy: false, cursor: null }
        : null;
    if (
      state &&
      (typeof state.legacy !== "boolean" ||
        (state.cursor !== null && typeof state.cursor !== "string"))
    )
      throw new Error("Invalid event cursor");
    const selectedDataset = state?.legacy ? undefined : ctx.scope.datasetId;
    const source = nextEvent && ctx.scope.legacy
      ? ctx.db.query("event").withIndex("by_occurred_at", q => q.gte("occurred_at", lo).lt("occurred_at", hi)).order("asc")
      : a.query && !nextEvent
      ? ctx.db.query("event").withSearchIndex("search_title", (q) => {
          const s = q
            .search("title", a.query!)
            .eq("dataset_id", selectedDataset);
          return a.kind ? s.eq("kind", a.kind) : s;
        })
      : a.kind
        ? ctx.db
            .query("event")
            .withIndex("by_dataset_kind_occurred", (q) =>
              q
                .eq("dataset_id", selectedDataset)
                .eq("kind", a.kind!)
                .gte("occurred_at", lo)
                .lt("occurred_at", hi),
            )
            .order(nextEvent ? "asc" : "desc")
        : ctx.db
            .query("event")
            .withIndex("by_dataset_occurred", (q) =>
              q
                .eq("dataset_id", selectedDataset)
                .gte("occurred_at", lo)
                .lt("occurred_at", hi),
            )
            .order(nextEvent ? "asc" : "desc");
    // A subject-only query must not page through unrelated household transactions.
    // All event links carry the canonical legacy-compatible target_type/target_id fields.
    const subjectLinks = useSubjectIndex
      ? await ctx.db.query("event_affects").withIndex("by_target", q => q.eq("target_type", "entity").eq("target_id", a.entityId!)).order(nextEvent ? "asc" : "desc").paginate({ cursor: a.cursor ?? null, numItems: limit })
      : null;
    const slice = subjectLinks
      ? { ...subjectLinks, page: (await Promise.all(subjectLinks.page.map(link => ctx.db.get(link.event_id)))).filter((e): e is NonNullable<typeof e> => e !== null) }
      : await source.paginate({ cursor: state ? state.cursor : (a.cursor ?? null), numItems: limit });
    const items = [];
    const seen = new Set<string>();
    for (const e of slice.page) {
      if (seen.has(e._id)) continue;
      seen.add(e._id);
      const day = civilDate(e.occurred_at, w.timezone);
      if (
        (a.kind && e.kind !== a.kind) ||
        e.archived ||
        e.voided_at !== undefined ||
        (a.from && day < a.from) ||
        (a.through && day > a.through) ||
        (a.query && !matchesText(`${e.title ?? ""} ${e.kind}`, a.query))
      )
        continue;
      if (
        await ctx.db
          .query("event")
          .withIndex("by_corrects", (q) => q.eq("corrects_id", e._id))
          .first()
      )
        continue;
      if (a.entityId) {
        const links = await ctx.db
          .query("event_affects")
          .withIndex("by_event", (q) => q.eq("event_id", e._id))
          .take(101);
        if (links.length > 100)
          throw new Error("Event has too many linked subjects");
        if (!links.some((l) => (l.target?.id ?? l.target_id) === a.entityId))
          continue;
      }
      let payload: { timezone?: string; datePrecision?: string } = {};
      try {
        payload = JSON.parse(e.payload_json ?? "{}");
      } catch {
        /* Legacy plain payload. */
      }
      let timezone = payload.timezone ?? w.timezone;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      } catch {
        timezone = w.timezone;
      }
      items.push({
        id: e._id,
        title: e.title ?? e.kind,
        kind: e.kind,
        date: civilDate(e.occurred_at, timezone),
        time:
          payload.datePrecision === "day"
            ? undefined
            : new Intl.DateTimeFormat("en-GB", {
                timeZone: timezone,
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              }).format(e.occurred_at),
        occurredAt: new Date(e.occurred_at).toISOString(),
        timezone,
        ...(payload.datePrecision === "day" ? {} : clockFacts(e.occurred_at, timezone)),
      });
    }
    const nextCursor = state
      ? slice.isDone
        ? !state.legacy
          ? JSON.stringify({ legacy: true, cursor: null })
          : null
        : JSON.stringify({ ...state, cursor: slice.continueCursor })
      : slice.isDone
        ? null
        : slice.continueCursor;
    return {
      items,
      nextCursor,
      queryComplete: nextCursor === null,
      datasetCompleteness: "unknown",
      order: nextEvent ? "earliest_first" : subjectLinks ? "subject_link_order" : a.query ? "text_relevance" : "most_recent_first",
      filter: { from: a.from ?? null, through: a.through ?? null, query: a.query ?? null, entityId: a.entityId ?? null, entity: subject?.display_name ?? null },
      basis:
        "Recorded events only. Omit unknown dates for title/subject lookup across recorded history. With from but no through, earliest-first search covers all recorded dates from that day: the first matching item is the next occurrence; an empty page with a cursor is not absence. Bounded title searches use the text index and bounded subject-only queries use the subject-link index. Follow nextCursor even on empty filtered pages before concluding absence. Projections and obligations use life.timeline.",
    };
  },
});
