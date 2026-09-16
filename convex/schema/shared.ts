import { v } from "convex/values";
export const root = {
  user_id: v.string(),
  created_at: v.optional(v.number()),
  archived: v.optional(v.boolean()),
  details_document_id: v.optional(v.id("details_document")),
};
export const target = v.union(
  v.object({
    kind: v.literal("commitment_schedule_revision"),
    id: v.id("commitment_schedule_revision"),
  }),
  v.object({ kind: v.literal("entity_revision"), id: v.id("entity_revision") }),
  v.object({
    kind: v.literal("arrangement_revision"),
    id: v.id("arrangement_revision"),
  }),
  v.object({
    kind: v.literal("arrangement_type_revision"),
    id: v.id("arrangement_type_revision"),
  }),
  v.object({
    kind: v.literal("role_definition_revision"),
    id: v.id("role_definition_revision"),
  }),
  v.object({
    kind: v.literal("role_assignment_revision"),
    id: v.id("role_assignment_revision"),
  }),
  v.object({
    kind: v.literal("commitment_schedule_version"),
    id: v.id("commitment_schedule_version"),
  }),
  v.object({
    kind: v.literal("posting_attribution_set"),
    id: v.id("posting_attribution_set"),
  }),

  v.object({ kind: v.literal("entity"), id: v.id("entity") }),
  v.object({ kind: v.literal("arrangement"), id: v.id("arrangement") }),
  v.object({
    kind: v.literal("arrangement_type"),
    id: v.id("arrangement_type"),
  }),
  v.object({
    kind: v.literal("arrangement_role_definition"),
    id: v.id("arrangement_role_definition"),
  }),
  v.object({
    kind: v.literal("arrangement_role_assignment"),
    id: v.id("arrangement_role_assignment"),
  }),
  v.object({ kind: v.literal("event"), id: v.id("event") }),
  v.object({ kind: v.literal("measurement"), id: v.id("measurement") }),
  v.object({ kind: v.literal("tag"), id: v.id("tag") }),
  v.object({
    kind: v.literal("chart_of_accounts"),
    id: v.id("chart_of_accounts"),
  }),
  v.object({ kind: v.literal("ledger_account"), id: v.id("ledger_account") }),
  v.object({ kind: v.literal("journal_entry"), id: v.id("journal_entry") }),
  v.object({ kind: v.literal("posting"), id: v.id("posting") }),
  v.object({
    kind: v.literal("financial_account"),
    id: v.id("financial_account"),
  }),
  v.object({
    kind: v.literal("posting_attribution"),
    id: v.id("posting_attribution"),
  }),
  v.object({ kind: v.literal("evidence_item"), id: v.id("evidence_item") }),
  v.object({ kind: v.literal("statement"), id: v.id("statement") }),
  v.object({ kind: v.literal("statement_line"), id: v.id("statement_line") }),
  v.object({
    kind: v.literal("balance_observation"),
    id: v.id("balance_observation"),
  }),
  v.object({ kind: v.literal("reconciliation"), id: v.id("reconciliation") }),
  v.object({
    kind: v.literal("commitment_schedule"),
    id: v.id("commitment_schedule"),
  }),
  v.object({
    kind: v.literal("monetary_obligation"),
    id: v.id("monetary_obligation"),
  }),
  v.object({ kind: v.literal("plan"), id: v.id("plan") }),
  v.object({ kind: v.literal("plan_version"), id: v.id("plan_version") }),
  v.object({ kind: v.literal("scenario"), id: v.id("scenario") }),
  v.object({
    kind: v.literal("scenario_version"),
    id: v.id("scenario_version"),
  }),
  v.object({
    kind: v.literal("forecast_assumption"),
    id: v.id("forecast_assumption"),
  }),
  v.object({ kind: v.literal("expected_flow"), id: v.id("expected_flow") }),
  v.object({ kind: v.literal("forecast_run"), id: v.id("forecast_run") }),
  v.object({ kind: v.literal("budget_target"), id: v.id("budget_target") }),
  v.object({
    kind: v.literal("ownership_interest"),
    id: v.id("ownership_interest"),
  }),
  v.object({
    kind: v.literal("obligation_adjustment"),
    id: v.id("obligation_adjustment"),
  }),
  v.object({
    kind: v.literal("obligation_settlement"),
    id: v.id("obligation_settlement"),
  }),
);
export const moneyValue = v.object({
  minor_units: v.number(),
  currency: v.string(),
});
export const participation = v.union(
  v.literal("participant"),
  v.literal("subject"),
);
export const roleFacts = {
  name: v.string(),
  participation,
  eligibleKinds: v.optional(v.array(v.string())),
  archived: v.optional(v.boolean()),
};
export const template = v.object(roleFacts);
export const entityFacts = { kind: v.string(), display_name: v.string() };
export const arrangementFacts = {
  name: v.string(),
  lifecycle: v.union(
    v.literal("draft"),
    v.literal("active"),
    v.literal("ended"),
  ),
  valid_from: v.number(),
  valid_to: v.optional(v.number()),
  parent_arrangement_id: v.optional(v.id("arrangement")),
  supersedes_arrangement_id: v.optional(v.id("arrangement")),
};
export const assignmentFacts = {
  entity_id: v.id("entity"),
  valid_from: v.number(),
  valid_to: v.optional(v.number()),
};
export const provenance = {
  details_document_id: v.optional(v.id("details_document")),
  recorded_at: v.number(),
  actor: v.string(),
  reason: v.optional(v.string()),
  evidence_ids: v.optional(v.array(v.id("evidence_item"))),
};
export const gitPin = v.object({
  repository_key: v.string(),
  path: v.string(),
  commit: v.string(),
});
export const capturedInput = v.object({
  target,
  revision: v.optional(v.number()),
  captured: v.optional(v.union(v.string(), v.number(), v.boolean())),
  label: v.string(),
});
