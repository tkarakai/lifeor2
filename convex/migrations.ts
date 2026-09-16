/** Additive operator-only migration. Never schedules itself and never deletes legacy rows. */
import { legacySchedule } from "./lib/legacy";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  parseMoney,
  add,
  period,
  nonempty,
  decimal,
  scale,
} from "./lib/domain";
import { owned, ownedTarget } from "./lib/access";
const stages = v.union(
  v.literal("entity"),
  v.literal("arrangement"),
  v.literal("arrangement_role"),
  v.literal("ledger_account"),
  v.literal("journal_entry"),
  v.literal("posting"),
  v.literal("event"),
  v.literal("event_affects"),
  v.literal("measurement"),
  v.literal("property"),
);
const migration = "redesign-v1";
async function map(ctx: QueryCtx, table: string, id: string) {
  return ctx.db
    .query("migration_map")
    .withIndex("by_source", (q) =>
      q.eq("source_table", table).eq("source_id", id),
    )
    .first();
}
async function mapped(
  ctx: MutationCtx,
  table: string,
  id: string,
  targetTable: string,
  targetId: string,
) {
  if (!(await map(ctx, table, id)))
    await ctx.db.insert("migration_map", {
      source_table: table,
      source_id: id,
      target_table: targetTable,
      target_id: targetId,
      migration,
      recorded_at: Date.now(),
    });
}
async function issue(
  ctx: MutationCtx,
  table: string,
  id: string,
  reason: string,
) {
  const old = await ctx.db
    .query("migration_issue")
    .withIndex("by_source", (q) =>
      q.eq("source_table", table).eq("source_id", id),
    )
    .collect();
  if (!old.some((x) => x.reason === reason))
    await ctx.db.insert("migration_issue", {
      source_table: table,
      source_id: id,
      reason,
      recorded_at: Date.now(),
    });
}
async function chart(
  ctx: QueryCtx,
  legacy: Id<"arrangement"> | undefined,
  user: string,
) {
  if (!legacy) throw new Error("Missing legacy chart");
  const row = await ctx.db
    .query("chart_of_accounts")
    .withIndex("by_legacy", (q) => q.eq("legacy_arrangement_id", legacy))
    .first();
  if (!row || row.user_id !== user)
    throw new Error("Migrate owned chart arrangement first");
  return row._id;
}
async function validateLegacyOwner(
  ctx: QueryCtx,
  kind: "entity" | "arrangement" | "event" | undefined,
  id: string | undefined,
  user: string,
) {
  if (!kind || !id) throw new Error("Missing legacy owner reference");
  const typed = ctx.db.normalizeId(kind, id);
  if (!typed) throw new Error("Malformed legacy owner reference");
  const row = await ctx.db.get(typed);
  if (!row || row.user_id !== user)
    throw new Error("Orphaned or cross-owner legacy reference");
  return row;
}
export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const entities = await ctx.db.query("entity").collect(),
      arrangements = await ctx.db.query("arrangement").collect(),
      roles = await ctx.db.query("arrangement_role").collect(),
      accounts = await ctx.db.query("ledger_account").collect(),
      journals = await ctx.db.query("journal_entry").collect(),
      postings = await ctx.db.query("posting").collect(),
      properties = await ctx.db.query("property").collect(),
      measurements = await ctx.db.query("measurement").collect(),
      events = await ctx.db.query("event").collect(),
      affects = await ctx.db.query("event_affects").collect();
    const rejects: { table: string; id: string; reason: string }[] = [];
    const warnings: { table: string; id: string; reason: string }[] = [];
    const totals = new Map<string, number>();
    for (const p of postings) {
      try {
        const je = journals.find((x) => x._id === p.je_id),
          account = accounts.find((x) => x._id === p.account_id);
        if (
          !je ||
          !account ||
          je.user_id !== account.user_id ||
          je.coa_arrangement_id !== account.coa_arrangement_id ||
          p.currency !== account.currency
        )
          throw new Error(
            "Posting journal/account/owner/chart/currency mismatch",
          );
        const amount =
          p.minor_units ?? parseMoney(String(p.amount), p.currency);
        if (!amount) throw new Error("Zero legacy posting");
        const key = `${p.account_id}:${p.currency}`;
        totals.set(key, add(totals.get(key) ?? 0, amount));
      } catch (e) {
        rejects.push({ table: "posting", id: p._id, reason: String(e) });
      }
    }
    for (const je of journals) {
      try {
        const event = events.find((e) => e._id === je.event_id),
          coa = arrangements.find((a) => a._id === je.coa_arrangement_id);
        if (
          !event ||
          event.user_id !== je.user_id ||
          (!je.chart_id &&
            (!coa ||
              coa.user_id !== je.user_id ||
              coa.kind !== "ChartOfAccounts"))
        )
          throw new Error("Journal reference mismatch");
        const ps = postings.filter((p) => p.je_id === je._id);
        if (ps.length < 2) throw new Error("Journal requires two postings");
        const sums = new Map<string, number>();
        for (const p of ps)
          sums.set(
            p.currency,
            add(
              sums.get(p.currency) ?? 0,
              p.minor_units ?? parseMoney(String(p.amount), p.currency),
            ),
          );
        if ([...sums.values()].some((x) => x !== 0))
          throw new Error("Legacy journal is not exactly balanced");
      } catch (e) {
        rejects.push({ table: "journal_entry", id: je._id, reason: String(e) });
      }
    }
    for (const role of roles) {
      const arr = arrangements.find((a) => a._id === role.arrangement_id),
        entity = entities.find((e) => e._id === role.entity_id);
      if (!arr || !entity || arr.user_id !== entity.user_id)
        rejects.push({
          table: "arrangement_role",
          id: role._id,
          reason: "Orphaned or cross-owner role",
        });
      if (role.share_json)
        warnings.push({
          table: "arrangement_role",
          id: role._id,
          reason:
            "Unknown share JSON preserved; ownership interest not inferred",
        });
    }
    for (const a of arrangements) {
      if (a.valid_to !== undefined)
        warnings.push({
          table: "arrangement",
          id: a._id,
          reason:
            "Legacy end boundary retained without reinterpretation; inclusive/calendar intent needs explicit review",
        });
      for (const ref of [a.parent_arrangement_id, a.supersedes_arrangement_id])
        if (
          ref &&
          !arrangements.some((p) => p._id === ref && p.user_id === a.user_id)
        )
          rejects.push({
            table: "arrangement",
            id: a._id,
            reason: "Orphaned/cross-owner arrangement lineage",
          });
    }
    for (const row of [...properties, ...measurements])
      try {
        if ("subject" in row && row.subject)
          await ownedTarget(ctx, row.subject, row.user_id);
        else
          await validateLegacyOwner(
            ctx,
            row.owner_type,
            row.owner_id,
            row.user_id,
          );
      } catch (e) {
        rejects.push({
          table:
            "value_json" in row && "valid_from" in row
              ? "property"
              : "measurement",
          id: row._id,
          reason: String(e),
        });
      }
    for (const a of accounts) {
      const coa = arrangements.find((c) => c._id === a.coa_arrangement_id);
      if (
        !a.chart_id &&
        (!coa || coa.kind !== "ChartOfAccounts" || coa.user_id !== a.user_id)
      )
        rejects.push({
          table: "ledger_account",
          id: a._id,
          reason: "Invalid chart reference",
        });
      if (a.parent_account_id) {
        const p = accounts.find((p) => p._id === a.parent_account_id);
        if (
          !p ||
          p.user_id !== a.user_id ||
          p.currency !== a.currency ||
          p.coa_arrangement_id !== a.coa_arrangement_id
        )
          rejects.push({
            table: "ledger_account",
            id: a._id,
            reason: "Invalid parent account",
          });
      }
    }
    return {
      migration,
      counts: {
        entity: entities.length,
        arrangement: arrangements.length,
        arrangement_role: roles.length,
        ledger_account: accounts.length,
        journal_entry: journals.length,
        posting: postings.length,
        event: events.length,
        event_affects: affects.length,
        property: properties.length,
        measurement: measurements.length,
      },
      rejects,
      warnings,
      totals: [...totals].map(([key, minor_units]) => ({ key, minor_units })),
      existingMappings: (await ctx.db.query("migration_map").collect()).length,
      issues: await ctx.db.query("migration_issue").collect(),
      applyOrder: [
        "entity",
        "arrangement",
        "arrangement_role",
        "ledger_account",
        "journal_entry",
        "posting",
        "event",
        "event_affects",
        "measurement",
        "property",
      ],
    };
  },
});
export const applyBatch = internalMutation({
  args: {
    stage: stages,
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const limit = a.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Limit must be 1..100");
    const page = await ctx.db
      .query(a.stage)
      .paginate({ cursor: a.cursor ?? null, numItems: limit });
    let migrated = 0,
      skipped = 0;
    const rejects: { id: string; reason: string }[] = [];
    for (const source of page.page) {
      if (await map(ctx, a.stage, source._id)) {
        skipped++;
        continue;
      }
      try {
        if (a.stage === "entity") {
          const row = await ctx.db.get(source._id as Id<"entity">);
          if (!row) continue;
          nonempty(row.kind);
          nonempty(row.display_name);
          if (!row.revision) {
            await ctx.db.insert("entity_revision", {
              user_id: row.user_id,
              root_id: row._id,
              revision: 1,
              recorded_at: Date.now(),
              actor: "migration:redesign-v1",
              reason: "Legacy snapshot; earlier knowledge history unavailable",
              segments: [
                {
                  valid_from: row._creationTime,
                  facts: { kind: row.kind, display_name: row.display_name },
                },
              ],
            });
            await ctx.db.patch(row._id, {
              revision: 1,
              created_at: row._creationTime,
            });
          }
          await mapped(ctx, a.stage, row._id, "entity", row._id);
        } else if (a.stage === "arrangement") {
          const row = await ctx.db.get(source._id as Id<"arrangement">);
          if (!row) continue;
          period(row.valid_from, row.valid_to);
          for (const ref of [
            row.parent_arrangement_id,
            row.supersedes_arrangement_id,
          ])
            if (ref) await owned(ctx, "arrangement", ref, row.user_id);
          if (row.valid_to !== undefined)
            await issue(
              ctx,
              a.stage,
              row._id,
              "Legacy end boundary requires review; value preserved, not blindly shifted",
            );
          if (row.kind === "ChartOfAccounts") {
            let id = (
              await ctx.db
                .query("chart_of_accounts")
                .withIndex("by_legacy", (q) =>
                  q.eq("legacy_arrangement_id", row._id),
                )
                .first()
            )?._id;
            if (!id)
              id = await ctx.db.insert("chart_of_accounts", {
                user_id: row.user_id,
                name: row.name ?? "Chart of accounts",
                legacy_arrangement_id: row._id,
                created_at: row._creationTime,
              });
            await ctx.db.patch(row._id, {
              migrated_to: { kind: "chart_of_accounts", id },
            });
            await mapped(ctx, a.stage, row._id, "chart_of_accounts", id);
            const links = await ctx.db
              .query("arrangement_role")
              .withIndex("by_arrangement", (q) =>
                q.eq("arrangement_id", row._id),
              )
              .first();
            if (
              links ||
              row.parent_arrangement_id ||
              row.supersedes_arrangement_id
            )
              await issue(
                ctx,
                a.stage,
                row._id,
                "Chart has legacy relationship links; retained for review",
              );
          } else if (row.kind === "Project") {
            const id = await ctx.db.insert("tag", {
              user_id: row.user_id,
              name: row.name ?? `Legacy project ${row._id}`,
              created_at: row._creationTime,
            });
            await ctx.db.patch(row._id, { migrated_to: { kind: "tag", id } });
            await mapped(ctx, a.stage, row._id, "tag", id);
            await issue(
              ctx,
              a.stage,
              row._id,
              "Project converted to tag; original arrangement and ambiguous relationship links preserved for review",
            );
          } else if (
            [
              "Budget",
              "Plan",
              "Scenario",
              "Valuation",
              "FXObservation",
              "PipelineOpportunity",
              "InformationArrangement",
            ].includes(row.kind)
          ) {
            throw new Error(
              "Legacy non-arrangement kind requires explicit meaning review",
            );
          } else {
            let typeId = row.type_id;
            let type = typeId ? await ctx.db.get(typeId) : null;
            if (!type) {
              type =
                (
                  await ctx.db
                    .query("arrangement_type")
                    .withIndex("by_user", (q) => q.eq("user_id", row.user_id))
                    .collect()
                ).find((t) => t.name === row.kind) ?? null;
              typeId = type?._id;
              if (!typeId) {
                typeId = await ctx.db.insert("arrangement_type", {
                  user_id: row.user_id,
                  name: row.kind,
                  revision: 1,
                  templates: [],
                  created_at: Date.now(),
                });
                await ctx.db.insert("arrangement_type_revision", {
                  user_id: row.user_id,
                  root_id: typeId,
                  name: row.kind,
                  templates: [],
                  revision: 1,
                  recorded_at: Date.now(),
                  actor: "migration:redesign-v1",
                });
              }
            }
            const facts = {
              name: row.name ?? row.kind,
              lifecycle: row.lifecycle ?? ("active" as const),
              valid_from: row.valid_from,
              valid_to: row.valid_to,
              parent_arrangement_id: row.parent_arrangement_id,
              supersedes_arrangement_id: row.supersedes_arrangement_id,
            };
            if (!row.revision)
              await ctx.db.insert("arrangement_revision", {
                user_id: row.user_id,
                root_id: row._id,
                revision: 1,
                recorded_at: Date.now(),
                actor: "migration:redesign-v1",
                reason:
                  "Legacy snapshot; earlier knowledge history unavailable",
                segments: [{ valid_from: row.valid_from, facts }],
              });
            await ctx.db.patch(row._id, {
              ...facts,
              type_id: typeId,
              revision: row.revision ?? 1,
              created_at: row._creationTime,
            });
            await mapped(ctx, a.stage, row._id, "arrangement", row._id);
          }
        } else if (a.stage === "arrangement_role") {
          const row = await ctx.db.get(source._id as Id<"arrangement_role">);
          if (!row) continue;
          const arr = await ctx.db.get(row.arrangement_id);
          if (!arr) throw new Error("Missing arrangement");
          await owned(ctx, "entity", row.entity_id, arr.user_id);
          if (arr.migrated_to)
            throw new Error(
              "Role on converted chart/project preserved for manual meaning review",
            );
          let role = (
            await ctx.db
              .query("arrangement_role_definition")
              .withIndex("by_arrangement", (q) =>
                q.eq("arrangement_id", arr._id),
              )
              .collect()
          ).find((r) => r.name === row.role_name);
          if (!role) {
            const facts = {
              name: nonempty(row.role_name),
              participation: "participant" as const,
            };
            const id = await ctx.db.insert("arrangement_role_definition", {
              ...facts,
              user_id: arr.user_id,
              arrangement_id: arr._id,
              revision: 1,
              created_at: Date.now(),
            });
            await ctx.db.insert("role_definition_revision", {
              user_id: arr.user_id,
              root_id: id,
              revision: 1,
              recorded_at: Date.now(),
              actor: "migration:redesign-v1",
              segments: [{ valid_from: Date.now(), facts }],
            });
            role = (await ctx.db.get(id))!;
          }
          const facts = { entity_id: row.entity_id, valid_from: Date.now() };
          const id = await ctx.db.insert("arrangement_role_assignment", {
            ...facts,
            user_id: arr.user_id,
            arrangement_id: arr._id,
            role_definition_id: role._id,
            revision: 1,
            created_at: Date.now(),
            legacy_role_id: row._id,
            history_unknown: true,
            legacy_share_json: row.share_json,
          });
          await ctx.db.insert("role_assignment_revision", {
            user_id: arr.user_id,
            root_id: id,
            revision: 1,
            recorded_at: Date.now(),
            actor: "migration:redesign-v1",
            reason: "Original role had no effective dates; history unknown",
            segments: [{ valid_from: facts.valid_from, facts }],
          });
          await mapped(
            ctx,
            a.stage,
            row._id,
            "arrangement_role_assignment",
            id,
          );
          if (row.share_json)
            await issue(
              ctx,
              a.stage,
              row._id,
              "Unknown share JSON preserved verbatim; ownership semantics not inferred",
            );
        } else if (a.stage === "ledger_account") {
          const row = await ctx.db.get(source._id as Id<"ledger_account">);
          if (!row) continue;
          const chartId =
            row.chart_id ??
            (await chart(ctx, row.coa_arrangement_id, row.user_id));
          parseMoney("0", row.currency);
          if (row.parent_account_id) {
            const parent = await owned(
              ctx,
              "ledger_account",
              row.parent_account_id,
              row.user_id,
            );
            if (
              parent.currency !== row.currency ||
              parent.coa_arrangement_id !== row.coa_arrangement_id
            )
              throw new Error("Parent chart/currency mismatch");
          }
          await ctx.db.patch(row._id, {
            chart_id: chartId,
            created_at: row._creationTime,
          });
          await mapped(ctx, a.stage, row._id, "ledger_account", row._id);
        } else if (a.stage === "journal_entry") {
          const row = await ctx.db.get(source._id as Id<"journal_entry">);
          if (!row) continue;
          const chartId =
            row.chart_id ??
            (await chart(ctx, row.coa_arrangement_id, row.user_id));
          const event = await owned(ctx, "event", row.event_id, row.user_id);
          const ps = await ctx.db
            .query("posting")
            .withIndex("by_je", (q) => q.eq("je_id", row._id))
            .collect();
          if (ps.length < 2)
            throw new Error("Journal requires at least two postings");
          const sums = new Map<string, number>();
          for (const p of ps) {
            const account = await owned(
              ctx,
              "ledger_account",
              p.account_id,
              row.user_id,
            );
            if (account.chart_id !== chartId || account.currency !== p.currency)
              throw new Error("Posting account chart/currency mismatch");
            const n = p.minor_units ?? parseMoney(String(p.amount), p.currency);
            if (!n) throw new Error("Zero posting");
            sums.set(p.currency, add(sums.get(p.currency) ?? 0, n));
          }
          if ([...sums.values()].some((n) => n !== 0))
            throw new Error("Legacy journal not exactly balanced");
          await ctx.db.patch(row._id, {
            chart_id: chartId,
            accounting_date:
              row.accounting_date ??
              new Date(event.occurred_at).toISOString().slice(0, 10),
            recorded_at: row.recorded_at ?? row._creationTime,
            created_at: row._creationTime,
          });
          await mapped(ctx, a.stage, row._id, "journal_entry", row._id);
        } else if (a.stage === "posting") {
          const row = await ctx.db.get(source._id as Id<"posting">);
          if (!row) continue;
          const je = await ctx.db.get(row.je_id);
          if (!je || !(await map(ctx, "journal_entry", je._id)))
            throw new Error("Migrate valid journal first");
          const account = await owned(
            ctx,
            "ledger_account",
            row.account_id,
            je.user_id,
          );
          if (
            account.chart_id !== je.chart_id ||
            account.currency !== row.currency
          )
            throw new Error("Posting chart/currency mismatch");
          const n =
            row.minor_units ?? parseMoney(String(row.amount), row.currency);
          await ctx.db.patch(row._id, { minor_units: n, user_id: je.user_id });
          const { attribution } = await import("./lib/ledger");
          if (!row.attribution_revision)
            await attribution(
              ctx,
              je.user_id,
              (await ctx.db.get(row._id))!,
              [
                {
                  minor_units: n,
                  unclassified: true,
                  beneficiaries: [{ unassigned: true, share_bps: 10000 }],
                },
              ],
              "Legacy posting migration",
            );
          await mapped(ctx, a.stage, row._id, "posting", row._id);
        } else if (a.stage === "event") {
          const row = await ctx.db.get(source._id as Id<"event">);
          if (!row) continue;
          await ctx.db.patch(row._id, {
            title: row.title ?? row.kind,
            created_at: row._creationTime,
          });
          await mapped(ctx, a.stage, row._id, "event", row._id);
        } else if (a.stage === "event_affects") {
          const row = await ctx.db.get(source._id as Id<"event_affects">);
          if (!row) continue;
          const event = await ctx.db.get(row.event_id);
          if (!event) throw new Error("Missing event");
          if (row.target) {
            const { ownedTarget } = await import("./lib/access");
            await ownedTarget(ctx, row.target, event.user_id);
          } else {
            if (
              row.target_type !== "entity" &&
              row.target_type !== "arrangement"
            )
              throw new Error("Unknown target kind");
            const targetRow = await validateLegacyOwner(
              ctx,
              row.target_type,
              row.target_id,
              event.user_id,
            );
            let target: import("./lib/access").Target =
              row.target_type === "entity"
                ? { kind: "entity", id: targetRow._id as Id<"entity"> }
                : {
                    kind: "arrangement",
                    id: targetRow._id as Id<"arrangement">,
                  };
            if ("migrated_to" in targetRow && targetRow.migrated_to)
              target = targetRow.migrated_to;
            await ctx.db.patch(row._id, { target });
          }
          await mapped(ctx, a.stage, row._id, "event_affects", row._id);
        } else if (a.stage === "measurement") {
          const row = await ctx.db.get(source._id as Id<"measurement">);
          if (!row) continue;
          if (row.subject) {
            await ownedTarget(ctx, row.subject, row.user_id);
          } else {
            const subjectRoot = await validateLegacyOwner(
              ctx,
              row.owner_type,
              row.owner_id,
              row.user_id,
            );
            let subject: import("./lib/access").Target =
              row.owner_type === "entity"
                ? { kind: "entity", id: subjectRoot._id as Id<"entity"> }
                : row.owner_type === "event"
                  ? { kind: "event", id: subjectRoot._id as Id<"event"> }
                  : {
                      kind: "arrangement",
                      id: subjectRoot._id as Id<"arrangement">,
                    };
            if ("migrated_to" in subjectRoot && subjectRoot.migrated_to)
              subject = subjectRoot.migrated_to;
            const schedule = await legacySchedule(
              ctx,
              row.user_id,
              row.value_json ?? "null",
            );
            if (schedule) {
              if (subject.kind !== "arrangement")
                throw new Error(
                  "Legacy schedule needs an actual arrangement subject",
                );
              const evidenceId = await ctx.db.insert("evidence_item", {
                user_id: row.user_id,
                kind: "legacy_record",
                namespace: "migration:measurement",
                external_key: row._id,
                captured_at: Date.now(),
                content_ref: `legacy:measurement:${row._id}`,
                created_at: Date.now(),
              });
              const id = await ctx.db.insert("commitment_schedule", {
                user_id: row.user_id,
                arrangement_id: subject.id,
                name: row.name,
                revision: 1,
                created_at: Date.now(),
              });
              const version = await ctx.db.insert(
                "commitment_schedule_version",
                {
                  ...schedule,
                  user_id: row.user_id,
                  schedule_id: id,
                  revision: 1,
                  recorded_at: Date.now(),
                  actor: "migration:redesign-v1",
                  evidence_ids: [evidenceId],
                },
              );
              await ctx.db.insert("commitment_schedule_revision", {
                user_id: row.user_id,
                schedule_id: id,
                revision: 1,
                recorded_at: Date.now(),
                actor: "migration:redesign-v1",
                segments: [
                  {
                    valid_from: schedule.valid_from,
                    valid_to: schedule.valid_to,
                    facts: { version_id: version },
                  },
                ],
              });
              await mapped(ctx, a.stage, row._id, "commitment_schedule", id);
              migrated++;
              continue;
            }
            let converted:
              | { decimal: string; unit: string; currency?: string }
              | undefined;
            try {
              const payload: unknown = JSON.parse(row.value_json ?? "null");
              if (
                payload &&
                typeof payload === "object" &&
                !Array.isArray(payload)
              ) {
                const p = payload as Record<string, unknown>;
                const value = p.decimal ?? p.value ?? p.amount;
                const unit =
                  p.unit ?? (p.amount !== undefined ? p.currency : undefined);
                if (
                  (typeof value === "string" || typeof value === "number") &&
                  typeof unit === "string" &&
                  (!("currency" in p) || typeof p.currency === "string")
                ) {
                  decimal(String(value));
                  nonempty(unit);
                  if (p.currency) scale(String(p.currency));
                  if (p.amount !== undefined && typeof p.currency === "string")
                    parseMoney(String(value), p.currency);
                  converted = {
                    decimal: String(value),
                    unit,
                    currency:
                      typeof p.currency === "string" ? p.currency : undefined,
                  };
                }
              }
            } catch {
              /* Preserve the original payload and surface an issue below. */
            }
            if (
              converted &&
              (row.m_type === "observed" || row.m_type === "contractual")
            ) {
              const evidenceId = await ctx.db.insert("evidence_item", {
                user_id: row.user_id,
                kind: "legacy_record",
                namespace: "migration:measurement",
                external_key: row._id,
                captured_at: Date.now(),
                content_ref: `legacy:measurement:${row._id}`,
                created_at: Date.now(),
              });
              await ctx.db.patch(row._id, {
                subject,
                value: converted,
                evidence_ids: [...(row.evidence_ids ?? []), evidenceId],
                created_at: row._creationTime,
              });
            } else
              await issue(
                ctx,
                a.stage,
                row._id,
                "Legacy measurement payload preserved; missing units, assumption/input provenance, or recurrence semantics require explicit conversion",
              );
          }
          await mapped(ctx, a.stage, row._id, "measurement", row._id);
        } else if (a.stage === "property") {
          const row = await ctx.db.get(source._id as Id<"property">);
          if (!row) continue;
          await validateLegacyOwner(
            ctx,
            row.owner_type,
            row.owner_id,
            row.user_id,
          );
          await issue(
            ctx,
            a.stage,
            row._id,
            "Read-only legacy property pending verified Git export; original row retained",
          );
          await mapped(ctx, a.stage, row._id, "property", row._id);
        }
        migrated++;
      } catch (e) {
        const reason = String(e);
        rejects.push({ id: source._id, reason });
        await issue(ctx, a.stage, source._id, reason);
      }
    }
    return {
      stage: a.stage,
      migrated,
      skipped,
      rejects,
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };
  },
});
export const exportLegacyProperties = internalQuery({
  args: {},
  handler: async (ctx) => ({
    format: "lifeor2-legacy-properties-v1",
    exported_at: Date.now(),
    rows: await ctx.db.query("property").collect(),
  }),
});
