"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Panel,
  Editor,
  Form,
  TextField,
  SelectField,
  Field,
  Loading,
  Empty,
  controlClass,
  textValue,
} from "@/components/record-ui";
import { MoneyFields, moneyFieldsValue } from "@/components/financial-fields";
import { TargetSelect, targetValue } from "@/components/target-select";
import { RecordDetails } from "@/components/record-details";
function Versions({ scenarioId }: { scenarioId: Id<"scenario"> }) {
  const plans = useQuery(api.planning.listPlans);
  const [planId, setPlanId] = useState<Id<"plan"> | "">("");
  const [kind, setKind] = useState<"amount" | "timing">("amount");
  const bases = useQuery(
    api.planning.listPlanVersions,
    planId ? { planId } : "skip",
  );
  const versions = useQuery(api.planning.listScenarioVersions, { scenarioId });
  const create = useMutation(api.planning.createScenarioVersion);
  return (
    <>
      <Editor title="Add version with an override">
        <Form
          label="Create scenario version"
          onSave={(data) =>
            create({
              scenarioId,
              base_plan_version_id: textValue(
                data,
                "base",
              ) as Id<"plan_version">,
              overrides: [
                {
                  target: targetValue(data),
                  value:
                    kind === "amount"
                      ? { kind, amount: moneyFieldsValue(data) }
                      : { kind, date: textValue(data, "date") },
                },
              ],
            })
          }
        >
          <Field label="Base plan">
            <select
              className={controlClass}
              value={planId}
              onChange={(e) => setPlanId(e.target.value as Id<"plan">)}
              required
            >
              <option value="">Select…</option>
              {(plans ?? []).map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <SelectField
            key={planId}
            label="Published base version"
            name="base"
            options={(bases ?? [])
              .filter((v) => v.status === "published")
              .map((v) => ({
                value: v._id,
                label: `Version ${v.revision} · ${v.period_start} → ${v.period_end}`,
              }))}
            required
          />
          <TargetSelect label="Record to override" />
          <Field label="Override kind">
            <select
              className={controlClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as "amount" | "timing")}
            >
              <option value="amount">Amount</option>
              <option value="timing">Timing</option>
            </select>
          </Field>
          {kind === "amount" ? (
            <MoneyFields />
          ) : (
            <TextField label="Override date" name="date" type="date" required />
          )}
        </Form>
      </Editor>
      {versions === undefined ? (
        <Loading />
      ) : versions.length === 0 ? (
        <Empty>
          No scenario versions yet. Publish a plan version to use as the base.
        </Empty>
      ) : (
        versions.map((v) => (
          <p key={v._id} className="text-sm">
            Version {v.revision} · {v.overrides.length} explicit overrides
          </p>
        ))
      )}
    </>
  );
}
export function PlanningScenarios() {
  const scenarios = useQuery(api.planning.listScenarios);
  const create = useMutation(api.planning.createScenario);
  return (
    <Panel
      title="Scenarios"
      description="Versioned overrides of a published plan. No projections are computed here."
    >
      <Editor title="New scenario">
        <Form
          label="Create scenario"
          onSave={(data) => create({ name: textValue(data, "name") })}
        >
          <TextField label="Scenario name" name="name" required />
        </Form>
      </Editor>
      {scenarios === undefined ? (
        <Loading />
      ) : scenarios.length === 0 ? (
        <Empty>No scenarios yet.</Empty>
      ) : (
        scenarios.map((s) => (
          <div key={s._id} className="space-y-4 border-t pt-4">
            <h3 className="font-medium">{s.name}</h3>
            <Editor title="Scenario versions">
              <Versions scenarioId={s._id} />
            </Editor>
            <RecordDetails target={{ kind: "scenario", id: s._id }} />
          </div>
        ))
      )}
    </Panel>
  );
}
