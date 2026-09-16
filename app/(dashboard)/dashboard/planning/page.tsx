"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Page,
  Panel,
  Editor,
  Form,
  TextField,
  SelectField,
  Field,
  Loading,
  Empty,
  textValue,
  optionalText,
  localDateTime,
  dateValue,
  options,
  controlClass,
} from "@/components/record-ui";
import {
  MoneyFields,
  moneyFieldsValue,
  PartyFields,
  ArrangementField,
  PostingField,
} from "@/components/financial-fields";
import { formatMoney, parseMoney } from "@/components/money";
import { PlanningScenarios } from "@/components/planning-scenarios";
import { PlanningAssumptions } from "@/components/planning-assumptions";
import { PlanningVersions } from "@/components/planning-versions";
import { RecordDetails } from "@/components/record-details";
function Fulfill({
  id,
  currency,
}: {
  id: Id<"expected_flow">;
  currency: string;
}) {
  const entries = useQuery(api.finance.listJournalEntries, {});
  const [entryId, setEntryId] = useState<Id<"journal_entry"> | "">("");
  const fulfill = useMutation(api.planning.fulfillExpectedFlow);
  return (
    <Form
      label="Link actual posting"
      onSave={(data) =>
        fulfill({
          id,
          postingId: textValue(data, "posting") as Id<"posting">,
          minor_units: parseMoney(textValue(data, "amount"), currency),
        })
      }
    >
      <Field label="Actual journal entry">
        <select
          className={controlClass}
          value={entryId}
          onChange={(e) => setEntryId(e.target.value as Id<"journal_entry">)}
          required
        >
          <option value="">Select…</option>
          {(entries ?? []).map((e) => (
            <option key={e._id} value={e._id}>
              {e.memo}
            </option>
          ))}
        </select>
      </Field>
      <PostingField
        key={entryId}
        entryId={entryId}
        name="posting"
        label="Actual posting"
      />
      <TextField
        label={`Fulfilled amount (${currency})`}
        name="amount"
        required
      />
    </Form>
  );
}
function Schedules() {
  const schedules = useQuery(api.obligations.listSchedules);
  const create = useMutation(api.obligations.createSchedule);
  return (
    <Panel
      title="Commitment schedules"
      description="Typed recurrence rules associated with an arrangement. Saving a rule does not generate events or forecasts."
    >
      <Editor title="New fixed-amount schedule">
        <Form
          label="Create schedule"
          onSave={(data) => {
            const amount = moneyFieldsValue(data);
            return create({
              arrangement_id: textValue(
                data,
                "arrangement",
              ) as Id<"arrangement">,
              name: textValue(data, "name"),
              creditor_id: textValue(data, "creditor") as Id<"entity">,
              debtor_id: textValue(data, "debtor") as Id<"entity">,
              amount,
              currency: amount.currency,
              recurrence: {
                frequency: textValue(data, "frequency") as
                  | "once"
                  | "daily"
                  | "weekly"
                  | "monthly"
                  | "yearly",
                interval: Number(textValue(data, "interval")),
              },
              start_date: textValue(data, "start"),
              end_date: optionalText(data, "end"),
              timezone: textValue(data, "timezone"),
              valid_from: dateValue(data, "effective")!,
            });
          }}
        >
          <TextField label="Schedule name" name="name" required />
          <ArrangementField required />
          <PartyFields />
          <MoneyFields />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Frequency"
              name="frequency"
              value="monthly"
              options={options([
                "once",
                "daily",
                "weekly",
                "monthly",
                "yearly",
              ])}
              required
            />
            <TextField
              label="Every (number of periods)"
              name="interval"
              value="1"
              type="number"
              required
            />
            <TextField label="Start date" name="start" type="date" required />
            <TextField label="End date (optional)" name="end" type="date" />
            <TextField
              label="Schedule timezone"
              name="timezone"
              value={Intl.DateTimeFormat().resolvedOptions().timeZone}
              required
            />
            <TextField
              label="Terms effective from"
              name="effective"
              type="datetime-local"
              value={localDateTime()}
              required
            />
          </div>
        </Form>
      </Editor>
      {schedules === undefined ? (
        <Loading />
      ) : schedules.length === 0 ? (
        <Empty>No commitment schedules.</Empty>
      ) : (
        schedules.map((s) => (
          <div key={s._id} className="space-y-3 border-t pt-3">
            <h3 className="font-medium">{s.name}</h3>
            <p className="text-sm text-muted-foreground">
              Revision {s.revision}
            </p>
            {s.versions
              .filter((v) => v.revision === s.revision)
              .map((v) => (
                <p key={v._id} className="text-sm">
                  {v.amount
                    ? formatMoney(v.amount.minor_units, v.amount.currency)
                    : v.variable_rule}{" "}
                  · every {v.recurrence.interval} {v.recurrence.frequency} ·{" "}
                  {v.start_date} → {v.end_date ?? "Open-ended"} · {v.timezone}
                </p>
              ))}
            <RecordDetails
              target={{ kind: "commitment_schedule", id: s._id }}
            />
          </div>
        ))
      )}
    </Panel>
  );
}
export default function PlanningPage() {
  const plans = useQuery(api.planning.listPlans);
  const flows = useQuery(api.planning.listExpectedFlows);
  const assumptions = useQuery(api.planning.listAssumptions);
  const accounts = useQuery(api.finance.listAccounts, {});
  const obligations = useQuery(api.obligations.list);
  const createPlan = useMutation(api.planning.createPlan);
  const createFlow = useMutation(api.planning.createExpectedFlow);
  return (
    <Page
      title="Planning records"
      description="Keep plans, schedules, and expected flows separate from actual occurrences and the ledger. These records do not calculate forecasts."
    >
      <Panel title="Plans">
        <Editor title="New plan">
          <Form
            label="Create plan"
            onSave={(data) => createPlan({ name: textValue(data, "name") })}
          >
            <TextField label="Plan name" name="name" required />
          </Form>
        </Editor>
        {plans === undefined ? (
          <Loading />
        ) : plans.length === 0 ? (
          <Empty>No plans yet.</Empty>
        ) : (
          plans.map((plan) => (
            <div key={plan._id} className="space-y-3 border-t pt-4">
              <h3 className="font-semibold">{plan.name}</h3>
              <Editor title="Versions & budget targets">
                <PlanningVersions planId={plan._id} />
              </Editor>
              <RecordDetails target={{ kind: "plan", id: plan._id }} />
            </div>
          ))
        )}
      </Panel>
      <PlanningScenarios />
      <Schedules />
      <PlanningAssumptions />
      <Panel
        title="Expected flows"
        description="Manually recorded expectations; fulfillment references an actual posting."
      >
        <Editor title="New expected flow">
          <Form
            label="Record expected flow"
            onSave={(data) =>
              createFlow({
                expected_date: textValue(data, "date"),
                ...moneyFieldsValue(data),
                account_id: optionalText(data, "account") as
                  | Id<"ledger_account">
                  | undefined,
                obligation_id: textValue(data, "source").startsWith(
                  "obligation:",
                )
                  ? (textValue(data, "source").slice(
                      11,
                    ) as Id<"monetary_obligation">)
                  : undefined,
                assumption_id: textValue(data, "source").startsWith(
                  "assumption:",
                )
                  ? (textValue(data, "source").slice(
                      11,
                    ) as Id<"forecast_assumption">)
                  : undefined,
                occurrence_key: textValue(data, "occurrence"),
                input_revision: Number(textValue(data, "revision")),
              })
            }
          >
            <MoneyFields />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Expected date"
                name="date"
                type="date"
                required
              />
              <TextField
                label="Occurrence key"
                name="occurrence"
                required
                hint="A stable identifier for this particular expected occurrence."
              />
              <TextField
                label="Input revision"
                name="revision"
                type="number"
                value="1"
                required
              />
              <SelectField
                label="Ledger account (optional)"
                name="account"
                options={(accounts ?? [])
                  .filter((a) => a.type === "Asset" || a.type === "Liability")
                  .map((a) => ({
                    value: a._id,
                    label: `${a.name} · ${a.currency}`,
                  }))}
              />
              <SelectField
                label="Source obligation or assumption"
                name="source"
                required
                options={[
                  ...(obligations ?? []).map((o) => ({
                    value: `obligation:${o._id}`,
                    label: `Obligation · ${o.due_date} · ${formatMoney(o.outstanding_minor_units, o.currency)}`,
                  })),
                  ...(assumptions ?? []).map((a) => ({
                    value: `assumption:${a._id}`,
                    label: `Assumption · ${a.name}`,
                  })),
                ]}
              />
            </div>
          </Form>
        </Editor>
        {flows === undefined ? (
          <Loading />
        ) : flows.length === 0 ? (
          <Empty>No expected flows recorded.</Empty>
        ) : (
          flows.map((flow) => (
            <div key={flow._id} className="space-y-3 border-t pt-4">
              <h3 className="font-medium">
                {flow.expected_date} ·{" "}
                {formatMoney(flow.minor_units, flow.currency)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {flow.occurrence_key} · Remaining{" "}
                {formatMoney(flow.remaining_minor_units, flow.currency)}
              </p>
              {flow.cancelled_at !== undefined ? (
                <p className="text-sm text-muted-foreground">
                  Cancelled: {flow.cancel_reason}
                </p>
              ) : flow.obligation_id ? (
                <p className="text-sm text-muted-foreground">
                  Settle the linked obligation in Finance → Obligations; the
                  remaining expectation updates automatically.
                </p>
              ) : (
                <Editor title="Link actual fulfillment">
                  <Fulfill id={flow._id} currency={flow.currency} />
                </Editor>
              )}
              <RecordDetails target={{ kind: "expected_flow", id: flow._id }} />
            </div>
          ))
        )}
      </Panel>
    </Page>
  );
}
