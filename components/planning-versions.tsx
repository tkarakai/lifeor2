"use client";
import { useState } from "react";
import { useQuery, useMutation } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Form,
  TextField,
  SelectField,
  Field,
  Editor,
  Action,
  Loading,
  Empty,
  controlClass,
  textValue,
  optionalText,
  dateValue,
  localDateTime,
} from "@/components/record-ui";
import { MoneyFields, moneyFieldsValue } from "@/components/financial-fields";
import { formatMoney } from "@/components/money";
import { useRecordOptions } from "@/components/target-select";
function Budgets({ version }: { version: Doc<"plan_version"> }) {
  const budgets = useQuery(api.planning.listBudgetTargets, {
    planVersionId: version._id,
  });
  const charts = useQuery(api.finance.listCharts);
  const accounts = useQuery(api.finance.listAccounts, {});
  const tags = useQuery(api.tags.list);
  const entities = useQuery(api.entities.list);
  const create = useMutation(api.planning.createBudgetTarget);
  const [chart, setChart] = useState("");
  const [measure, setMeasure] = useState<"income" | "expense">("expense");
  return (
    <>
      {version.status === "draft" && (
        <Editor title="Add budget target">
          <Form
            label="Create target"
            onSave={(data) =>
              create({
                plan_version_id: version._id,
                period_start: textValue(data, "start"),
                period_end: textValue(data, "end"),
                measure,
                chart_id: chart as Id<"chart_of_accounts">,
                account_id: optionalText(data, "account") as
                  | Id<"ledger_account">
                  | undefined,
                subject_id: optionalText(data, "subject") as
                  | Id<"entity">
                  | undefined,
                tag_id: optionalText(data, "tag") as Id<"tag"> | undefined,
                amount: moneyFieldsValue(data),
              })
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Target period start"
                name="start"
                type="date"
                value={version.period_start}
                required
              />
              <TextField
                label="Target period end"
                name="end"
                type="date"
                value={version.period_end}
                required
              />
              <Field label="Measure">
                <select
                  className={controlClass}
                  value={measure}
                  onChange={(e) =>
                    setMeasure(e.target.value as "income" | "expense")
                  }
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </Field>
              <Field label="Chart">
                <select
                  className={controlClass}
                  value={chart}
                  onChange={(e) => setChart(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {(charts ?? []).map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <SelectField
                key={`${chart}:${measure}`}
                label="Account (optional)"
                name="account"
                options={(accounts ?? [])
                  .filter(
                    (a) =>
                      a.chart_id === chart &&
                      a.type === (measure === "expense" ? "Expense" : "Income"),
                  )
                  .map((a) => ({
                    value: a._id,
                    label: `${a.name} · ${a.currency}`,
                  }))}
              />
              <SelectField
                label="Subject (optional)"
                name="subject"
                options={(entities ?? []).map((e) => ({
                  value: e._id,
                  label: e.display_name,
                }))}
              />
              <SelectField
                label="Tag scope (optional)"
                name="tag"
                options={(tags ?? []).map((t) => ({
                  value: t._id,
                  label: t.name,
                }))}
              />
            </div>
            <MoneyFields />
          </Form>
        </Editor>
      )}
      {budgets === undefined ? (
        <Loading />
      ) : budgets.length === 0 ? (
        <Empty>No budget targets in this version.</Empty>
      ) : (
        budgets.map((b) => (
          <p key={b._id} className="text-sm">
            {b.measure} · {b.period_start} → {b.period_end} ·{" "}
            <strong>
              {formatMoney(b.amount.minor_units, b.amount.currency)}
            </strong>
            {b.account_id &&
              ` · ${accounts?.find((a) => a._id === b.account_id)?.name ?? "Archived account"}`}
          </p>
        ))
      )}
    </>
  );
}
export function PlanningVersions({ planId }: { planId: Id<"plan"> }) {
  const versions = useQuery(api.planning.listPlanVersions, { planId });
  const records = useRecordOptions({ snapshotInputs: true });
  const create = useMutation(api.planning.createPlanVersion);
  const publish = useMutation(api.planning.publishPlanVersion);
  return (
    <div className="space-y-4">
      <Editor title="New version">
        <Form
          label="Create draft version"
          onSave={(data) => {
            const selected = new Set(data.getAll("inputs").map(String));
            const inputs = (records ?? [])
              .filter((r) => selected.has(`${r.target.kind}:${r.target.id}`))
              .map((r) => ({ target: r.target, label: r.label }));
            return create({
              planId,
              period_start: textValue(data, "start"),
              period_end: textValue(data, "end"),
              inputs,
              git_revisions: [],
              resolved_tag_targets: [],
              actual_boundary: dateValue(data, "boundary")!,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Period start" name="start" type="date" required />
            <TextField label="Period end" name="end" type="date" required />
          </div>
          <TextField
            label="Actuals known through"
            name="boundary"
            type="datetime-local"
            value={localDateTime()}
            required
          />
          <Field
            label="Records to capture (optional)"
            hint="Selected structured records are captured when this draft is created. Markdown documents are not included."
          >
            <select
              className={controlClass}
              name="inputs"
              multiple
              size={Math.min(8, Math.max(3, records?.length ?? 3))}
            >
              {(records ?? []).map((r) => (
                <option
                  key={`${r.target.kind}:${r.target.id}`}
                  value={`${r.target.kind}:${r.target.id}`}
                >
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </Form>
      </Editor>
      {versions === undefined ? (
        <Loading />
      ) : versions.length === 0 ? (
        <Empty>No versions yet. Create a draft to add budget targets.</Empty>
      ) : (
        versions.map((v) => (
          <div key={v._id} className="space-y-4 rounded-md border p-4">
            <h4 className="font-medium">
              Version {v.revision} · {v.status}
            </h4>
            <p className="text-sm text-muted-foreground">
              {v.period_start} → {v.period_end} · {v.inputs.length} captured
              records
            </p>
            <Budgets version={v} />
            {v.status === "draft" && (
              <Action
                confirm="Publish this version and freeze its budget targets and captured inputs?"
                onClick={() => publish({ id: v._id })}
              >
                Publish version
              </Action>
            )}
          </div>
        ))
      )}
    </div>
  );
}
