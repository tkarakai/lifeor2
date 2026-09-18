import { v, type Infer } from "convex/values";
import { mutation, query, type QueryCtx } from "./lib/scoped";
import type { Doc, Id } from "./_generated/dataModel";
import { owned, ownedTarget, requireUser } from "./lib/access";
import {
  add,
  date,
  instant,
  integer,
  money,
  nonempty,
  period,
  timezone,
} from "./lib/domain";
import { capturedInput, gitPin, moneyValue, target } from "./schema/shared";
import { assumptionValue, overrideValue, manifest } from "./schema/planning";
import { outstanding } from "./obligations";

type Input = Infer<typeof capturedInput>;
type GitPin = Infer<typeof gitPin>;

function dates(start: string, end: string) {
  date(start);
  date(end);
  if (end < start) throw new Error("End date precedes start date");
}

function validatePin(pin: GitPin) {
  nonempty(pin.repository_key);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pin.commit)) {
    throw new Error("Git input requires a full immutable commit ID");
  }
  if (!/^details\/[a-zA-Z0-9_-]{1,128}\.md$/.test(pin.path)) {
    throw new Error("Invalid pinned document path");
  }
}

type Target = Infer<typeof target>;
type KnownRecord = {
  _creationTime: number;
  user_id?: string;
  recorded_at?: number;
  created_at?: number;
  posted_at?: number;
  added_at?: number;
};
function recordedTime(record: KnownRecord) {
  return (
    record.recorded_at ??
    record.created_at ??
    record.added_at ??
    Math.floor(record._creationTime)
  );
}
function requireKnown(record: KnownRecord, boundary: number) {
  if (recordedTime(record) > boundary)
    throw new Error(
      "Input was recorded after the actual-data boundary; select an immutable historical revision",
    );
}

const captureFormat = "lifeor2-plan-input-v1";
function validateFrozenInputs(inputs: Input[]) {
  for (const input of inputs) {
    if (typeof input.captured !== "string")
      throw new Error(
        "Input has no frozen capture; publish a new complete plan version",
      );
    let bundle: { format?: string; records?: { target?: Target }[] };
    try {
      bundle = JSON.parse(input.captured);
    } catch {
      throw new Error("Invalid frozen input capture");
    }
    if (
      bundle.format !== captureFormat ||
      !Array.isArray(bundle.records) ||
      !bundle.records.some(
        (node) =>
          node.target?.kind === input.target.kind &&
          node.target?.id === input.target.id,
      )
    )
      throw new Error(
        "Legacy or incomplete input capture; publish a new complete plan version",
      );
  }
}

/** A typed dependency closure captured in this mutation's consistent database snapshot. */
async function captureBundle(
  ctx: QueryCtx,
  initial: Target,
  userId: string,
  boundary: number,
) {
  const records = new Map<
    string,
    { target: Target; record: unknown; children: Record<string, unknown> }
  >();
  const keys = (ref: Target) => `${ref.kind}:${ref.id}`;
  function knownChildren<T extends KnownRecord>(rows: T[]) {
    for (const row of rows)
      if (row.user_id !== undefined && row.user_id !== userId)
        throw new Error("Child ownership mismatch");
    return rows.filter((row) => recordedTime(row) <= boundary);
  }
  async function visit(ref: Target): Promise<void> {
    if (records.has(keys(ref))) return;
    if (ref.kind === "plan" || ref.kind === "scenario")
      throw new Error(
        "Mutable planning roots cannot be inputs; select a published immutable version",
      );
    const row = await ownedTarget(ctx, ref, userId);
    const node = {
      target: ref,
      record: row as unknown,
      children: {} as Record<string, unknown>,
    };
    records.set(keys(ref), node);
    const planning = [
      "plan_version",
      "scenario_version",
      "budget_target",
      "forecast_assumption",
      "expected_flow",
      "forecast_run",
    ].includes(ref.kind);
    if (!planning) requireKnown(row, boundary);
    // A later void is not part of an earlier knowledge snapshot.
    if (
      "voided_at" in row &&
      row.voided_at !== undefined &&
      row.voided_at > boundary
    ) {
      node.record = { ...row, voided_at: undefined, void_reason: undefined };
    }
    switch (ref.kind) {
      case "entity": {
        const root = await owned(ctx, "entity", ref.id, userId);
        const revisions = await ctx.db
          .query("entity_revision")
          .withIndex("by_root", (q) => q.eq("root_id", ref.id))
          .collect();
        if (
          revisions.some(
            (r) => r.revision === root.revision && r.recorded_at > boundary,
          )
        )
          throw new Error(
            "Entity revision is newer than the actual-data boundary",
          );
        node.children.revisions = knownChildren(revisions);
        break;
      }
      case "arrangement": {
        const root = await owned(ctx, "arrangement", ref.id, userId);
        const revisions = await ctx.db
          .query("arrangement_revision")
          .withIndex("by_root", (q) => q.eq("root_id", ref.id))
          .collect();
        if (
          revisions.some(
            (r) => r.revision === root.revision && r.recorded_at > boundary,
          )
        )
          throw new Error(
            "Arrangement revision is newer than the actual-data boundary",
          );
        node.children.revisions = knownChildren(revisions);
        const roles = knownChildren(
          await ctx.db
            .query("arrangement_role_definition")
            .withIndex("by_arrangement", (q) => q.eq("arrangement_id", ref.id))
            .collect(),
        );
        const assignments = knownChildren(
          await ctx.db
            .query("arrangement_role_assignment")
            .withIndex("by_arrangement", (q) => q.eq("arrangement_id", ref.id))
            .collect(),
        );
        node.children.roles = roles.map((r) => r._id);
        node.children.assignments = assignments.map((r) => r._id);
        for (const r of roles)
          await visit({ kind: "arrangement_role_definition", id: r._id });
        for (const r of assignments)
          await visit({ kind: "arrangement_role_assignment", id: r._id });
        break;
      }
      case "arrangement_type": {
        const root = await owned(ctx, "arrangement_type", ref.id, userId);
        const revisions = await ctx.db
          .query("arrangement_type_revision")
          .withIndex("by_root", (q) => q.eq("root_id", ref.id))
          .collect();
        if (
          revisions.some(
            (r) => r.revision === root.revision && r.recorded_at > boundary,
          )
        )
          throw new Error(
            "Type revision is newer than the actual-data boundary",
          );
        node.children.revisions = knownChildren(revisions);
        break;
      }
      case "arrangement_role_definition": {
        const root = await owned(
          ctx,
          "arrangement_role_definition",
          ref.id,
          userId,
        );
        const revisions = await ctx.db
          .query("role_definition_revision")
          .withIndex("by_root", (q) => q.eq("root_id", ref.id))
          .collect();
        if (
          revisions.some(
            (r) => r.revision === root.revision && r.recorded_at > boundary,
          )
        )
          throw new Error(
            "Role revision is newer than the actual-data boundary",
          );
        node.children.revisions = knownChildren(revisions);
        break;
      }
      case "arrangement_role_assignment": {
        const root = await owned(
          ctx,
          "arrangement_role_assignment",
          ref.id,
          userId,
        );
        const revisions = await ctx.db
          .query("role_assignment_revision")
          .withIndex("by_root", (q) => q.eq("root_id", ref.id))
          .collect();
        if (
          revisions.some(
            (r) => r.revision === root.revision && r.recorded_at > boundary,
          )
        )
          throw new Error(
            "Assignment revision is newer than the actual-data boundary",
          );
        node.children.revisions = knownChildren(revisions);
        break;
      }
      case "event": {
        node.children.affects = await ctx.db
          .query("event_affects")
          .withIndex("by_event", (q) => q.eq("event_id", ref.id))
          .collect();
        const journals = (
          await ctx.db
            .query("journal_entry")
            .withIndex("by_event", (q) => q.eq("event_id", ref.id))
            .collect()
        ).filter(
          (j) =>
            j.status === "posted" &&
            (j.posted_at ?? recordedTime(j)) <= boundary,
        );
        node.children.journals = journals.map((j) => j._id);
        for (const j of journals)
          await visit({ kind: "journal_entry", id: j._id });
        break;
      }
      case "journal_entry": {
        const journal = await owned(ctx, "journal_entry", ref.id, userId);
        if (journal.status !== "posted")
          throw new Error("Draft journals cannot be actual inputs");
        if ((journal.posted_at ?? recordedTime(journal)) > boundary)
          throw new Error("Journal was posted after the actual-data boundary");
        const postings = await ctx.db
          .query("posting")
          .withIndex("by_je", (q) => q.eq("je_id", ref.id))
          .collect();
        node.children.postings = postings.map((p) => p._id);
        for (const p of postings) await visit({ kind: "posting", id: p._id });
        await visit({ kind: "event", id: journal.event_id });
        // Freeze the whole known correction chain; a zero-sum reversal is not omitted.
        const family = (
          await ctx.db
            .query("journal_entry")
            .withIndex("by_user", (q) => q.eq("user_id", userId))
            .collect()
        ).filter(
          (j) =>
            j.status === "posted" &&
            (j.posted_at ?? recordedTime(j)) <= boundary &&
            (j.reverses_id === journal._id ||
              j.corrects_id === journal._id ||
              j._id === journal.reverses_id ||
              j._id === journal.corrects_id),
        );
        node.children.corrections = family.map((j) => j._id);
        for (const j of family)
          await visit({ kind: "journal_entry", id: j._id });
        break;
      }
      case "posting": {
        const posting = await ctx.db.get(ref.id);
        if (!posting) throw new Error("Posting missing");
        await visit({ kind: "journal_entry", id: posting.je_id });
        const account = await owned(
          ctx,
          "ledger_account",
          posting.account_id,
          userId,
        );
        node.children.account = account;
        const sets = knownChildren(
          await ctx.db
            .query("posting_attribution_set")
            .withIndex("by_posting", (q) => q.eq("posting_id", ref.id))
            .collect(),
        ).sort((a, b) => b.revision - a.revision);
        node.record = { ...posting, attribution_revision: sets[0]?.revision };
        if (sets[0]) {
          node.children.attribution_set = sets[0]._id;
          await visit({ kind: "posting_attribution_set", id: sets[0]._id });
        }
        break;
      }
      case "posting_attribution_set": {
        const portions = await ctx.db
          .query("posting_attribution")
          .withIndex("by_set", (q) => q.eq("set_id", ref.id))
          .collect();
        node.children.portions = portions.map((p) => p._id);
        for (const p of portions)
          await visit({ kind: "posting_attribution", id: p._id });
        break;
      }
      case "posting_attribution": {
        node.children.beneficiaries = knownChildren(
          await ctx.db
            .query("attribution_beneficiary")
            .withIndex("by_attribution", (q) => q.eq("attribution_id", ref.id))
            .collect(),
        );
        break;
      }
      case "ledger_account": {
        const postings = await ctx.db
          .query("posting")
          .withIndex("by_account", (q) => q.eq("account_id", ref.id))
          .collect();
        const ids = [];
        for (const p of postings) {
          const je = await owned(ctx, "journal_entry", p.je_id, userId);
          if (
            je.status === "posted" &&
            (je.posted_at ?? recordedTime(je)) <= boundary
          ) {
            ids.push(p._id);
            await visit({ kind: "posting", id: p._id });
          }
        }
        node.children.postings = ids;
        break;
      }
      case "chart_of_accounts": {
        const accounts = knownChildren(
          await ctx.db
            .query("ledger_account")
            .withIndex("by_chart", (q) => q.eq("chart_id", ref.id))
            .collect(),
        );
        node.children.accounts = accounts.map((a) => a._id);
        for (const a of accounts)
          await visit({ kind: "ledger_account", id: a._id });
        break;
      }
      case "financial_account": {
        const account = await owned(ctx, "financial_account", ref.id, userId);
        await visit({ kind: "ledger_account", id: account.ledger_account_id });
        break;
      }
      case "monetary_obligation": {
        const root = await owned(ctx, "monetary_obligation", ref.id, userId);
        const adjustments = knownChildren(
          await ctx.db
            .query("obligation_adjustment")
            .withIndex("by_obligation", (q) => q.eq("obligation_id", ref.id))
            .collect(),
        );
        const settlements = knownChildren(
          await ctx.db
            .query("obligation_settlement")
            .withIndex("by_obligation", (q) => q.eq("obligation_id", ref.id))
            .collect(),
        );
        node.children.adjustments = adjustments;
        node.children.settlements = settlements;
        if (root.recognition_posting_id)
          await visit({ kind: "posting", id: root.recognition_posting_id });
        for (const adjustment of adjustments)
          if (adjustment.posting_id)
            await visit({ kind: "posting", id: adjustment.posting_id });
        for (const settlement of settlements)
          await visit({ kind: "posting", id: settlement.capacity_posting_id });
        break;
      }
      case "obligation_settlement": {
        const r = await owned(ctx, "obligation_settlement", ref.id, userId);
        await visit({ kind: "monetary_obligation", id: r.obligation_id });
        break;
      }
      case "obligation_adjustment": {
        const r = await owned(ctx, "obligation_adjustment", ref.id, userId);
        await visit({ kind: "monetary_obligation", id: r.obligation_id });
        break;
      }
      case "commitment_schedule": {
        const root = await owned(ctx, "commitment_schedule", ref.id, userId);
        const revisions = await ctx.db
          .query("commitment_schedule_revision")
          .withIndex("by_schedule", (q) => q.eq("schedule_id", ref.id))
          .collect();
        if (
          revisions.some(
            (r) => r.revision === root.revision && r.recorded_at > boundary,
          )
        )
          throw new Error(
            "Schedule revision is newer than the actual-data boundary",
          );
        node.children.revisions = knownChildren(revisions);
        const versions = knownChildren(
          await ctx.db
            .query("commitment_schedule_version")
            .withIndex("by_schedule", (q) => q.eq("schedule_id", ref.id))
            .collect(),
        );
        node.children.versions = versions;
        break;
      }
      case "commitment_schedule_revision": {
        const revision = await owned(
          ctx,
          "commitment_schedule_revision",
          ref.id,
          userId,
        );
        for (const s of revision.segments)
          await visit({
            kind: "commitment_schedule_version",
            id: s.facts.version_id,
          });
        break;
      }
      case "tag": {
        node.children.membership = knownChildren(
          await ctx.db
            .query("tag_assignment")
            .withIndex("by_tag", (q) => q.eq("tag_id", ref.id))
            .collect(),
        ).map((link) => ({
          ...link,
          removed_at:
            link.removed_at !== undefined && link.removed_at <= boundary
              ? link.removed_at
              : undefined,
        }));
        break;
      }
      case "statement": {
        node.children.lines = knownChildren(
          await ctx.db
            .query("statement_line")
            .withIndex("by_statement", (q) => q.eq("statement_id", ref.id))
            .collect(),
        );
        break;
      }
      case "reconciliation": {
        const reconciliation = await owned(
          ctx,
          "reconciliation",
          ref.id,
          userId,
        );
        await visit({
          kind: "financial_account",
          id: reconciliation.financial_account_id,
        });
        node.children.matches = knownChildren(
          await ctx.db
            .query("reconciliation_match")
            .withIndex("by_reconciliation", (q) =>
              q.eq("reconciliation_id", ref.id),
            )
            .collect(),
        );
        if (reconciliation.statement_id)
          await visit({ kind: "statement", id: reconciliation.statement_id });
        if (reconciliation.observation_id)
          await visit({
            kind: "balance_observation",
            id: reconciliation.observation_id,
          });
        break;
      }
      case "plan_version": {
        const plan = await owned(ctx, "plan_version", ref.id, userId);
        if (plan.status !== "published")
          throw new Error("Draft plan versions cannot be immutable inputs");
        if (plan.actual_boundary > boundary)
          throw new Error("Nested plan exceeds actual-data boundary");
        validateFrozenInputs(plan.inputs);
        node.children.budget_targets = await ctx.db
          .query("budget_target")
          .withIndex("by_version", (q) => q.eq("plan_version_id", ref.id))
          .collect();
        break;
      }
      case "budget_target": {
        const budget = await owned(ctx, "budget_target", ref.id, userId);
        const parent = await owned(
          ctx,
          "plan_version",
          budget.plan_version_id,
          userId,
        );
        if (parent.status !== "published")
          throw new Error("Budget target belongs to a draft plan");
        await visit({ kind: "plan_version", id: parent._id });
        break;
      }
      case "scenario_version": {
        const scenario = await owned(ctx, "scenario_version", ref.id, userId);
        await visit({
          kind: "plan_version",
          id: scenario.base_plan_version_id,
        });
        const base = await owned(
          ctx,
          "plan_version",
          scenario.base_plan_version_id,
          userId,
        );
        const frozenOverrides: unknown[] = [];
        for (const override of scenario.overrides) {
          // Reuse the published baseline, never reinterpret an old plan through today's root.
          const saved = base.inputs.find((input) => {
            if (typeof input.captured !== "string") return false;
            const bundle = JSON.parse(input.captured) as {
              records?: { target: Target }[];
            };
            return (
              (input.target.kind === override.target.kind &&
                input.target.id === override.target.id) ||
              bundle.records?.some(
                (node) =>
                  node.target.kind === override.target.kind &&
                  node.target.id === override.target.id,
              )
            );
          });
          if (saved)
            frozenOverrides.push({
              target: override.target,
              captured: saved.captured,
            });
          else await visit(override.target);
        }
        node.children.published_override_baselines = frozenOverrides;
        break;
      }
      case "forecast_run": {
        const run = await owned(ctx, "forecast_run", ref.id, userId);
        if (run.actual_boundary > boundary)
          throw new Error("Nested run exceeds actual-data boundary");
        break;
      }
      case "expected_flow": {
        const flow = await owned(ctx, "expected_flow", ref.id, userId);
        const fulfillment = knownChildren(
          await ctx.db
            .query("expected_flow_fulfillment")
            .withIndex("by_flow", (q) => q.eq("expected_flow_id", ref.id))
            .collect(),
        );
        node.children.fulfillments = fulfillment;
        for (const link of fulfillment)
          await visit({ kind: "posting", id: link.posting_id });
        const obligation = await incurredObligation(ctx, flow, userId);
        if (obligation && recordedTime(obligation) <= boundary)
          await visit({ kind: "monetary_obligation", id: obligation._id });
        if (flow.obligation_id)
          await visit({ kind: "monetary_obligation", id: flow.obligation_id });
        if (flow.schedule_version_id)
          await visit({
            kind: "commitment_schedule_version",
            id: flow.schedule_version_id,
          });
        if (flow.assumption_id)
          await visit({ kind: "forecast_assumption", id: flow.assumption_id });
        break;
      }
    }
    // Grouping and evidence references that affect interpretation are frozen alongside facts.
    node.children.tags = knownChildren(
      (await ctx.db.query("tag_assignment").collect()).filter(
        (link) => link.target.kind === ref.kind && link.target.id === ref.id,
      ),
    ).map((link) => ({
      ...link,
      removed_at:
        link.removed_at !== undefined && link.removed_at <= boundary
          ? link.removed_at
          : undefined,
    }));
    const links = knownChildren(
      (await ctx.db.query("evidence_link").collect()).filter(
        (link) => link.target.kind === ref.kind && link.target.id === ref.id,
      ),
    );
    node.children.evidence = links;
    for (const link of links)
      await visit({ kind: "evidence_item", id: link.evidence_id });
    if ("evidence_id" in row && row.evidence_id)
      await visit({ kind: "evidence_item", id: row.evidence_id });
    if ("evidence_ids" in row)
      for (const id of row.evidence_ids ?? [])
        await visit({ kind: "evidence_item", id });
  }
  await visit(initial);
  return {
    format: captureFormat,
    record: records.get(keys(initial))!.record,
    records: [...records.values()],
  };
}

async function captureInputs(
  ctx: QueryCtx,
  inputs: Input[],
  userId: string,
  boundary: number,
) {
  const seen = new Set<string>();
  return Promise.all(
    inputs.map(async (input) => {
      const record = await ownedTarget(ctx, input.target, userId);
      nonempty(input.label);
      const key = `${input.target.kind}:${input.target.id}`;
      if (seen.has(key)) throw new Error("Duplicate manifest input");
      seen.add(key);
      if (input.revision !== undefined) {
        integer(input.revision);
        if (!("revision" in record) || record.revision !== input.revision)
          throw new Error("Input revision changed; reload before capturing");
      }
      const bundle = await captureBundle(ctx, input.target, userId, boundary);
      return {
        ...input,
        captured: JSON.stringify({
          ...bundle,
          ...(input.captured !== undefined
            ? { suppliedContext: input.captured }
            : {}),
        }),
      };
    }),
  );
}

async function validatePins(ctx: QueryCtx, pins: GitPin[], userId: string) {
  const locators = await ctx.db
    .query("details_document")
    .withIndex("by_user", (q) => q.eq("user_id", userId))
    .collect();
  for (const pin of pins) {
    validatePin(pin);
    if (
      !locators.some(
        (locator) =>
          locator.path === pin.path &&
          locator.repository_key === pin.repository_key,
      )
    ) {
      throw new Error("Pinned document is not owned by this user");
    }
  }
  // Git existence is checked by the document adapter when resolving a manifest.
  // This database operation validates identity and captures references, not content availability.
}

async function validateScope(
  ctx: QueryCtx,
  refs: Infer<typeof target>[],
  userId: string,
) {
  const seen = new Set<string>();
  for (const ref of refs) {
    await ownedTarget(ctx, ref, userId);
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) throw new Error("Duplicate scope target");
    seen.add(key);
  }
}

function validateAssumption(value: Infer<typeof overrideValue>) {
  if (value.kind === "amount")
    money(value.amount.minor_units, value.amount.currency);
  else if (value.kind === "timing") date(value.date);
  else if (value.kind === "effective_interval")
    period(value.valid_from, value.valid_to);
}

export const listPlans = query({
  agent: { operation: "planning.listPlans", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return (
      await ctx.db
        .query("plan")
        .withIndex("by_user", (q) => q.eq("user_id", user._id))
        .collect()
    ).filter((x) => !x.archived);
  },
});

export const createPlan = mutation({
  agent: { operation: "planning.createPlan", scope: "data:write" },
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return ctx.db.insert("plan", {
      name: nonempty(args.name),
      user_id: user._id,
      created_at: Date.now(),
    });
  },
});

export const listPlanVersions = query({
  agent: { operation: "planning.listPlanVersions", scope: "data:read" },
  args: { planId: v.id("plan") },
  handler: async (ctx, args) => {
    await owned(ctx, "plan", args.planId, (await requireUser(ctx))._id);
    return ctx.db
      .query("plan_version")
      .withIndex("by_plan", (q) => q.eq("plan_id", args.planId))
      .collect();
  },
});

export const createPlanVersion = mutation({
  agent: { operation: "planning.createPlanVersion", scope: "data:write" },
  args: {
    planId: v.id("plan"),
    period_start: v.string(),
    period_end: v.string(),
    ...manifest,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const plan = await owned(ctx, "plan", args.planId, user._id);
    if (plan.archived) throw new Error("Plan is archived");
    dates(args.period_start, args.period_end);
    instant(args.actual_boundary);
    if (args.actual_boundary > Date.now())
      throw new Error("Actual-data cutoff cannot be in the future");
    const inputs = await captureInputs(
      ctx,
      args.inputs,
      user._id,
      args.actual_boundary,
    );
    await validatePins(ctx, args.git_revisions, user._id);
    await validateScope(ctx, args.resolved_tag_targets, user._id);
    const previous = await ctx.db
      .query("plan_version")
      .withIndex("by_plan", (q) => q.eq("plan_id", args.planId))
      .collect();
    const { planId, ...fields } = args;
    return ctx.db.insert("plan_version", {
      ...fields,
      inputs,
      plan_id: planId,
      revision: Math.max(0, ...previous.map((x) => x.revision)) + 1,
      status: "draft",
      user_id: user._id,
      created_at: Date.now(),
    });
  },
});

export const publishPlanVersion = mutation({
  agent: { operation: "planning.publishPlanVersion", scope: "data:write" },
  args: { id: v.id("plan_version") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const version = await owned(ctx, "plan_version", args.id, user._id);
    if (version.status === "published") return args.id;
    validateFrozenInputs(version.inputs);
    await ctx.db.patch(args.id, {
      status: "published",
      published_at: Date.now(),
    });
    await ctx.db.patch(version.plan_id, { current_version_id: args.id });
    return args.id;
  },
});

export const createBudgetTarget = mutation({
  agent: { operation: "planning.createBudgetTarget", scope: "data:write" },
  args: {
    plan_version_id: v.id("plan_version"),
    period_start: v.string(),
    period_end: v.string(),
    measure: v.union(v.literal("income"), v.literal("expense")),
    chart_id: v.id("chart_of_accounts"),
    account_id: v.optional(v.id("ledger_account")),
    subject_id: v.optional(v.id("entity")),
    tag_id: v.optional(v.id("tag")),
    amount: moneyValue,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const version = await owned(
      ctx,
      "plan_version",
      args.plan_version_id,
      user._id,
    );
    if (version.status !== "draft")
      throw new Error("Published plan versions are immutable");
    dates(args.period_start, args.period_end);
    if (
      args.period_start < version.period_start ||
      args.period_end > version.period_end
    )
      throw new Error("Target is outside plan period");
    money(args.amount.minor_units, args.amount.currency);
    if (args.amount.minor_units < 0)
      throw new Error("Budget target must be nonnegative");
    await owned(ctx, "chart_of_accounts", args.chart_id, user._id);
    if (args.account_id) {
      const account = await owned(
        ctx,
        "ledger_account",
        args.account_id,
        user._id,
      );
      if (
        account.chart_id !== args.chart_id ||
        account.currency !== args.amount.currency ||
        account.type !== (args.measure === "expense" ? "Expense" : "Income")
      )
        throw new Error("Budget account scope mismatch");
    }
    if (args.subject_id) await owned(ctx, "entity", args.subject_id, user._id);
    const resolved_targets: Infer<typeof target>[] = [];
    if (args.tag_id) {
      await owned(ctx, "tag", args.tag_id, user._id);
      const links = await ctx.db
        .query("tag_assignment")
        .withIndex("by_tag", (q) => q.eq("tag_id", args.tag_id!))
        .collect();
      for (const link of links.filter((x) => x.removed_at === undefined)) {
        await ownedTarget(ctx, link.target, user._id);
        resolved_targets.push(link.target);
      }
    }
    return ctx.db.insert("budget_target", {
      ...args,
      resolved_targets,
      user_id: user._id,
      created_at: Date.now(),
    });
  },
});

export const listBudgetTargets = query({
  agent: { operation: "planning.listBudgetTargets", scope: "data:read" },
  args: { planVersionId: v.id("plan_version") },
  handler: async (ctx, args) => {
    await owned(
      ctx,
      "plan_version",
      args.planVersionId,
      (await requireUser(ctx))._id,
    );
    return ctx.db
      .query("budget_target")
      .withIndex("by_version", (q) =>
        q.eq("plan_version_id", args.planVersionId),
      )
      .collect();
  },
});

export const listScenarios = query({
  agent: { operation: "planning.listScenarios", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return (
      await ctx.db
        .query("scenario")
        .withIndex("by_user", (q) => q.eq("user_id", user._id))
        .collect()
    ).filter((x) => !x.archived);
  },
});

export const createScenario = mutation({
  agent: { operation: "planning.createScenario", scope: "data:write" },
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return ctx.db.insert("scenario", {
      name: nonempty(args.name),
      user_id: user._id,
      created_at: Date.now(),
    });
  },
});

export const createScenarioVersion = mutation({
  agent: { operation: "planning.createScenarioVersion", scope: "data:write" },
  args: {
    scenarioId: v.id("scenario"),
    base_plan_version_id: v.id("plan_version"),
    overrides: v.array(v.object({ target, value: overrideValue })),
    git_revision: v.optional(gitPin),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await owned(ctx, "scenario", args.scenarioId, user._id);
    const base = await owned(
      ctx,
      "plan_version",
      args.base_plan_version_id,
      user._id,
    );
    if (base.status !== "published")
      throw new Error("Scenario requires an immutable published base");
    const keys = new Set<string>();
    for (const override of args.overrides) {
      await ownedTarget(ctx, override.target, user._id);
      validateAssumption(override.value);
      const key = `${override.target.kind}:${override.target.id}:${override.value.kind}`;
      if (keys.has(key)) throw new Error("Contradictory duplicate override");
      keys.add(key);
    }
    await validatePins(
      ctx,
      args.git_revision ? [args.git_revision] : [],
      user._id,
    );
    const versions = await ctx.db
      .query("scenario_version")
      .withIndex("by_scenario", (q) => q.eq("scenario_id", args.scenarioId))
      .collect();
    const { scenarioId, ...fields } = args;
    const id = await ctx.db.insert("scenario_version", {
      ...fields,
      scenario_id: scenarioId,
      revision: Math.max(0, ...versions.map((x) => x.revision)) + 1,
      user_id: user._id,
      created_at: Date.now(),
    });
    await ctx.db.patch(scenarioId, { current_version_id: id });
    return id;
  },
});

export const listScenarioVersions = query({
  agent: { operation: "planning.listScenarioVersions", scope: "data:read" },
  args: { scenarioId: v.id("scenario") },
  handler: async (ctx, args) => {
    await owned(ctx, "scenario", args.scenarioId, (await requireUser(ctx))._id);
    return ctx.db
      .query("scenario_version")
      .withIndex("by_scenario", (q) => q.eq("scenario_id", args.scenarioId))
      .collect();
  },
});

export const createAssumption = mutation({
  agent: { operation: "planning.createAssumption", scope: "data:write" },
  args: {
    name: v.string(),
    value: assumptionValue,
    source: v.string(),
    context: v.optional(target),
    supersedes_id: v.optional(v.id("forecast_assumption")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateAssumption(args.value);
    if (args.context) await ownedTarget(ctx, args.context, user._id);
    if (args.supersedes_id)
      await owned(ctx, "forecast_assumption", args.supersedes_id, user._id);
    return ctx.db.insert("forecast_assumption", {
      ...args,
      name: nonempty(args.name),
      source: nonempty(args.source),
      user_id: user._id,
      created_at: Date.now(),
    });
  },
});

export const listAssumptions = query({
  agent: { operation: "planning.listAssumptions", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return ctx.db
      .query("forecast_assumption")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
  },
});

async function activePayment(
  ctx: QueryCtx,
  postingId: Id<"posting">,
  userId: string,
) {
  const posting = await ctx.db.get(postingId);
  if (!posting) throw new Error("Payment posting missing");
  const entry = await owned(ctx, "journal_entry", posting.je_id, userId);
  const account = await owned(
    ctx,
    "ledger_account",
    posting.account_id,
    userId,
  );
  if (
    entry.status !== "posted" ||
    entry.reverses_id ||
    (await ctx.db
      .query("journal_entry")
      .withIndex("by_reverses", (q) => q.eq("reverses_id", entry._id))
      .first())
  ) {
    throw new Error("Payment must be posted and unreversed");
  }
  if (account.type !== "Asset" && account.type !== "Liability")
    throw new Error("Payment must reference an actual balance-account posting");
  if (posting.minor_units === undefined)
    throw new Error("Posting requires money migration");
  return posting as typeof posting & { minor_units: number };
}

type OccurrenceSource = {
  schedule_version_id?: Id<"commitment_schedule_version">;
  obligation_id?: Id<"monetary_obligation">;
  assumption_id?: Id<"forecast_assumption">;
  occurrence_key: string;
};
export async function canonicalOccurrence(
  ctx: QueryCtx,
  source: OccurrenceSource,
  user: string,
): Promise<string> {
  if (source.obligation_id) {
    const obligation = await owned(
      ctx,
      "monetary_obligation",
      source.obligation_id,
      user,
    );
    if (obligation.schedule_version_id && obligation.occurrence_key)
      return canonicalOccurrence(
        ctx,
        {
          schedule_version_id: obligation.schedule_version_id,
          occurrence_key: obligation.occurrence_key,
        },
        user,
      );
    return `obligation:${obligation._id}`;
  }
  if (source.schedule_version_id) {
    const version = await owned(
      ctx,
      "commitment_schedule_version",
      source.schedule_version_id,
      user,
    );
    const prefix = `${version._id}:`;
    if (!source.occurrence_key.startsWith(prefix))
      throw new Error(
        "Schedule occurrence key requires version ID and calendar period",
      );
    const calendar = source.occurrence_key.slice(prefix.length);
    if (!/^(?:\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(calendar))
      throw new Error("Invalid schedule occurrence calendar period");
    const dateValue =
      calendar.length === 4
        ? `${calendar}-01-01`
        : calendar.length === 7
          ? `${calendar}-01`
          : calendar;
    date(dateValue);
    const frequency = version.recurrence.frequency;
    let normalized: string;
    if (frequency === "once") normalized = "once";
    else if (frequency === "yearly") normalized = calendar.slice(0, 4);
    else if (frequency === "monthly") {
      if (calendar.length < 7)
        throw new Error("Monthly occurrence requires year and month");
      normalized = calendar.slice(0, 7);
    } else {
      if (calendar.length !== 10)
        throw new Error("Daily/weekly occurrence requires a calendar date");
      normalized = calendar;
      if (frequency === "weekly") {
        const days = Math.floor(
          (Date.parse(calendar + "T00:00:00Z") -
            Date.parse(version.start_date + "T00:00:00Z")) /
            86400000,
        );
        if (days < 0) throw new Error("Occurrence predates schedule");
        const span = 7 * version.recurrence.interval;
        normalized = new Date(
          Date.parse(version.start_date + "T00:00:00Z") +
            Math.floor(days / span) * span * 86400000,
        )
          .toISOString()
          .slice(0, 10);
      }
    }
    return `schedule:${version.schedule_id}:${frequency}:${normalized}`;
  }
  return `assumption:${source.assumption_id}:${source.occurrence_key}`;
}
export async function incurredObligation(
  ctx: QueryCtx,
  source: OccurrenceSource,
  user: string,
) {
  if (source.obligation_id)
    return owned(ctx, "monetary_obligation", source.obligation_id, user);
  if (!source.schedule_version_id) return null;
  const key = await canonicalOccurrence(ctx, source, user);
  const obligations = await ctx.db
    .query("monetary_obligation")
    .withIndex("by_user", (q) => q.eq("user_id", user))
    .collect();
  const matches = [];
  for (const obligation of obligations) {
    if (
      obligation.schedule_version_id &&
      obligation.occurrence_key &&
      (await canonicalOccurrence(
        ctx,
        {
          obligation_id: obligation._id,
          occurrence_key: obligation.occurrence_key,
        },
        user,
      )) === key
    )
      matches.push(obligation);
  }
  if (matches.length > 1)
    throw new Error(
      "Multiple incurred claims for one schedule period require explicit correction",
    );
  return matches[0] ?? null;
}
export async function remaining(ctx: QueryCtx, flow: Doc<"expected_flow">) {
  if (flow.cancelled_at !== undefined) return 0;
  const obligation = await incurredObligation(ctx, flow, flow.user_id);
  if (obligation) {
    if (obligation.voided_at !== undefined) return 0;
    const balance = (await outstanding(ctx, obligation))
      .outstanding_minor_units;
    if (balance < 0) throw new Error("Obligation over-settled");
    return (
      Math.sign(flow.minor_units) *
      Math.min(Math.abs(flow.minor_units), balance)
    );
  }
  const links = await ctx.db
    .query("expected_flow_fulfillment")
    .withIndex("by_flow", (q) => q.eq("expected_flow_id", flow._id))
    .collect();
  let fulfilled = 0;
  for (const link of links) {
    const posting = await ctx.db.get(link.posting_id);
    if (!posting) throw new Error("Fulfillment posting missing");
    const reversed = await ctx.db
      .query("journal_entry")
      .withIndex("by_reverses", (q) => q.eq("reverses_id", posting.je_id))
      .first();
    if (!reversed) fulfilled = add(fulfilled, link.minor_units);
  }
  return (
    Math.sign(flow.minor_units) * add(Math.abs(flow.minor_units), -fulfilled)
  );
}

export const createExpectedFlow = mutation({
  agent: { operation: "planning.createExpectedFlow", scope: "data:write" },
  args: {
    expected_date: v.string(),
    minor_units: v.number(),
    currency: v.string(),
    account_id: v.optional(v.id("ledger_account")),
    schedule_version_id: v.optional(v.id("commitment_schedule_version")),
    obligation_id: v.optional(v.id("monetary_obligation")),
    assumption_id: v.optional(v.id("forecast_assumption")),
    occurrence_key: v.string(),
    input_revision: v.number(),
    supersedes_id: v.optional(v.id("expected_flow")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    date(args.expected_date);
    money(args.minor_units, args.currency);
    if (!args.minor_units) throw new Error("Expected flow must be nonzero");
    integer(args.input_revision);
    if (args.input_revision < 1)
      throw new Error("Input revision must be positive");
    if (
      [args.schedule_version_id, args.obligation_id, args.assumption_id].filter(
        Boolean,
      ).length !== 1
    )
      throw new Error("Expected flow requires exactly one source");
    if (args.account_id) {
      const account = await owned(
        ctx,
        "ledger_account",
        args.account_id,
        user._id,
      );
      if (
        account.currency !== args.currency ||
        !["Asset", "Liability"].includes(account.type)
      )
        throw new Error(
          "Expected account must be a balance account in the same currency",
        );
    }
    if (args.schedule_version_id) {
      const schedule = await owned(
        ctx,
        "commitment_schedule_version",
        args.schedule_version_id,
        user._id,
      );
      if (
        schedule.currency !== args.currency ||
        schedule.revision !== args.input_revision
      )
        throw new Error("Schedule input mismatch");
      // Settlement timing may differ from the source due period; identity uses
      // the schedule occurrence, while expected_date remains a separate forecast.
    }
    if (args.obligation_id) {
      const obligation = await owned(
        ctx,
        "monetary_obligation",
        args.obligation_id,
        user._id,
      );
      if (
        obligation.currency !== args.currency ||
        obligation.voided_at !== undefined
      )
        throw new Error("Obligation input mismatch");
    }
    if (args.assumption_id)
      await owned(ctx, "forecast_assumption", args.assumption_id, user._id);
    const flows = await ctx.db
      .query("expected_flow")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
    const key = nonempty(args.occurrence_key);
    const canonical = await canonicalOccurrence(ctx, args, user._id);
    for (const flow of flows) {
      if (
        flow.cancelled_at === undefined &&
        flow._id !== args.supersedes_id &&
        (flow.occurrence_key === key ||
          (await canonicalOccurrence(ctx, flow, user._id)) === canonical)
      )
        throw new Error("Duplicate active expected occurrence");
    }
    if (args.supersedes_id) {
      const prior = await owned(
        ctx,
        "expected_flow",
        args.supersedes_id,
        user._id,
      );
      if (
        (await canonicalOccurrence(ctx, prior, user._id)) !== canonical ||
        prior.currency !== args.currency ||
        prior.cancelled_at !== undefined
      )
        throw new Error("Invalid superseded occurrence");
      const obligation = await incurredObligation(ctx, prior, user._id);
      if (
        obligation &&
        (await outstanding(ctx, obligation)).settled_minor_units !== 0
      )
        throw new Error("Do not supersede settled occurrence history");
      const fulfilled = await ctx.db
        .query("expected_flow_fulfillment")
        .withIndex("by_flow", (q) => q.eq("expected_flow_id", prior._id))
        .first();
      if (fulfilled) throw new Error("Do not supersede fulfilled history");
      await ctx.db.patch(prior._id, {
        cancelled_at: Date.now(),
        cancel_reason: "Superseded by a new expected-flow revision",
      });
    }
    return ctx.db.insert("expected_flow", {
      ...args,
      occurrence_key: key,
      user_id: user._id,
      created_at: Date.now(),
    });
  },
});

export const listExpectedFlows = query({
  agent: { operation: "planning.listExpectedFlows", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const flows = await ctx.db
      .query("expected_flow")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
    return Promise.all(
      flows.map(async (flow) => ({
        ...flow,
        remaining_minor_units: await remaining(ctx, flow),
      })),
    );
  },
});

export const fulfillExpectedFlow = mutation({
  agent: { operation: "planning.fulfillExpectedFlow", scope: "data:write" },
  args: {
    id: v.id("expected_flow"),
    postingId: v.id("posting"),
    minor_units: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const flow = await owned(ctx, "expected_flow", args.id, user._id);
    if (await incurredObligation(ctx, flow, user._id))
      throw new Error(
        "Settle the linked obligation; its forecast remainder is derived automatically",
      );
    const posting = await activePayment(ctx, args.postingId, user._id);
    money(args.minor_units, flow.currency);
    if (args.minor_units <= 0 || flow.cancelled_at !== undefined)
      throw new Error("Invalid fulfillment");
    if (
      posting.currency !== flow.currency ||
      Math.sign(posting.minor_units) !== Math.sign(flow.minor_units) ||
      (flow.account_id && flow.account_id !== posting.account_id)
    )
      throw new Error("Fulfillment account/currency/direction mismatch");
    const consumed = await ctx.db
      .query("expected_flow_fulfillment")
      .withIndex("by_posting", (q) => q.eq("posting_id", args.postingId))
      .collect();
    const settlements = await ctx.db.query("obligation_settlement").collect();
    const applied = settlements.filter(
      (s) =>
        s.capacity_posting_id === posting._id &&
        !s.reverses_id &&
        !settlements.some((r) => r.reverses_id === s._id),
    );
    if (
      settlements.some(
        (s) =>
          s.journal_entry_id === posting.je_id &&
          !s.reverses_id &&
          s.capacity_posting_id !== posting._id,
      )
    )
      throw new Error(
        "Journal uses a different canonical settlement capacity posting",
      );
    if (
      add(
        args.minor_units,
        ...consumed.map((x) => x.minor_units),
        ...applied.map((x) => x.minor_units),
      ) > Math.abs(posting.minor_units) ||
      args.minor_units > Math.abs(await remaining(ctx, flow))
    )
      throw new Error("Fulfillment exceeds available amount");
    return ctx.db.insert("expected_flow_fulfillment", {
      user_id: user._id,
      expected_flow_id: args.id,
      posting_id: args.postingId,
      minor_units: args.minor_units,
      recorded_at: Date.now(),
    });
  },
});

export const createForecastRun = mutation({
  agent: { operation: "planning.createForecastRun", scope: "data:write" },
  args: {
    plan_version_id: v.id("plan_version"),
    scenario_version_id: v.optional(v.id("scenario_version")),
    engine_version: v.string(),
    horizon_start: v.string(),
    horizon_end: v.string(),
    timezone: v.string(),
    anchor_ids: v.array(v.id("reconciliation")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const plan = await owned(
      ctx,
      "plan_version",
      args.plan_version_id,
      user._id,
    );
    if (plan.status !== "published")
      throw new Error("Run requires a published plan");
    validateFrozenInputs(plan.inputs);
    dates(args.horizon_start, args.horizon_end);
    timezone(args.timezone);
    if (args.scenario_version_id) {
      const scenario = await owned(
        ctx,
        "scenario_version",
        args.scenario_version_id,
        user._id,
      );
      if (scenario.base_plan_version_id !== plan._id)
        throw new Error("Scenario has a different base plan");
    }
    const accountIds = new Set<string>();
    const anchors = [];
    for (const id of args.anchor_ids) {
      const anchor = await owned(ctx, "reconciliation", id, user._id);
      if (
        anchor.state !== "accepted" ||
        anchor.cutoff === undefined ||
        anchor.discrepancy_minor_units !== 0
      )
        throw new Error("Run needs accepted reconciled anchors");
      requireKnown(anchor, plan.actual_boundary);
      if (anchor.cutoff > plan.actual_boundary)
        throw new Error("Anchor cutoff exceeds actual-data boundary");
      if (accountIds.has(anchor.financial_account_id))
        throw new Error("Duplicate account anchor");
      accountIds.add(anchor.financial_account_id);
      anchors.push({
        reconciliation_id: id,
        cutoff: anchor.cutoff,
        minor_units: anchor.ledger_minor_units,
        currency: anchor.currency,
      });
    }
    const runInputs: Input[] = [...plan.inputs];
    const pinKeys = new Set(
      plan.git_revisions.map(
        (pin) => `${pin.repository_key}:${pin.path}:${pin.commit}`,
      ),
    );
    const git_revisions = [...plan.git_revisions];
    const freeze: Input[] = [
      {
        target: { kind: "plan_version", id: plan._id },
        revision: plan.revision,
        label: "Published plan and budget targets",
      },
    ];
    if (args.scenario_version_id) {
      const scenario = await owned(
        ctx,
        "scenario_version",
        args.scenario_version_id,
        user._id,
      );
      freeze.push({
        target: { kind: "scenario_version", id: scenario._id },
        revision: scenario.revision,
        label: "Scenario and override inputs",
      });
      if (scenario.git_revision) {
        const key = `${scenario.git_revision.repository_key}:${scenario.git_revision.path}:${scenario.git_revision.commit}`;
        if (!pinKeys.has(key)) git_revisions.push(scenario.git_revision);
      }
    }
    for (const id of args.anchor_ids)
      freeze.push({
        target: { kind: "reconciliation", id },
        label: "Accepted balance anchor and source coverage",
      });
    const additions = freeze.filter(
      (input) =>
        !runInputs.some(
          (saved) =>
            saved.target.kind === input.target.kind &&
            saved.target.id === input.target.id,
        ),
    );
    runInputs.push(
      ...(await captureInputs(ctx, additions, user._id, plan.actual_boundary)),
    );
    const { anchor_ids: _, ...fields } = args;
    return ctx.db.insert("forecast_run", {
      ...fields,
      engine_version: nonempty(args.engine_version),
      anchors,
      inputs: runInputs,
      git_revisions,
      resolved_tag_targets: plan.resolved_tag_targets,
      actual_boundary: plan.actual_boundary,
      status: "inputs_frozen",
      user_id: user._id,
      created_at: Date.now(),
    });
  },
});

export const listForecastRuns = query({
  agent: { operation: "planning.listForecastRuns", scope: "data:read" },
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return ctx.db
      .query("forecast_run")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
  },
});
