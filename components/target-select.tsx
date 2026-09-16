"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SelectField } from "@/components/record-ui";
import type { Infer } from "convex/values";
import type { target } from "@/convex/schema/shared";
export type RecordTarget = Infer<typeof target>;
export function useRecordOptions({ snapshotInputs = false } = {}) {
  const entities = useQuery(api.entities.list);
  const arrangements = useQuery(api.arrangements.list);
  const events = useQuery(api.events.list);
  const charts = useQuery(api.finance.listCharts);
  const accounts = useQuery(api.finance.listAccounts, {});
  const measurements = useQuery(api.measurements.list);
  const types = useQuery(api.arrangements.listTypes);
  const journals = useQuery(api.finance.listJournalEntries, {});
  const tags = useQuery(api.tags.list);
  const plans = useQuery(api.planning.listPlans);
  const scenarios = useQuery(api.planning.listScenarios);
  const assumptions = useQuery(api.planning.listAssumptions);
  const flows = useQuery(api.planning.listExpectedFlows);
  const obligations = useQuery(api.obligations.list);
  const financial = useQuery(api.finance.listFinancialAccounts);
  const schedules = useQuery(api.obligations.listSchedules);
  if (
    !entities ||
    !arrangements ||
    !events ||
    !charts ||
    !accounts ||
    !measurements ||
    !types ||
    !journals ||
    !tags ||
    !plans ||
    !scenarios ||
    !assumptions ||
    !flows ||
    !obligations ||
    !financial ||
    !schedules
  )
    return undefined;
  const records = [
    ...plans.map((r) => ({
      target: { kind: "plan", id: r._id } as RecordTarget,
      label: `Plan · ${r.name}`,
    })),
    ...scenarios.map((r) => ({
      target: { kind: "scenario", id: r._id } as RecordTarget,
      label: `Scenario · ${r.name}`,
    })),
    ...assumptions.map((r) => ({
      target: { kind: "forecast_assumption", id: r._id } as RecordTarget,
      label: `Assumption · ${r.name}`,
    })),
    ...flows.map((r) => ({
      target: { kind: "expected_flow", id: r._id } as RecordTarget,
      label: `Expected flow · ${r.occurrence_key}`,
    })),
    ...obligations.map((r) => ({
      target: { kind: "monetary_obligation", id: r._id } as RecordTarget,
      label: `Obligation · ${r.due_date} · ${r.currency}`,
    })),
    ...financial.map((r) => ({
      target: { kind: "financial_account", id: r._id } as RecordTarget,
      label: `Financial account · ${r.kind} ${r.identifier ?? ""}`,
    })),
    ...schedules.map((r) => ({
      target: { kind: "commitment_schedule", id: r._id } as RecordTarget,
      label: `Schedule · ${r.name}`,
    })),
    ...measurements.map((r) => ({
      target: { kind: "measurement", id: r._id } as RecordTarget,
      label: `Measurement · ${r.name}`,
    })),
    ...types.map((r) => ({
      target: { kind: "arrangement_type", id: r._id } as RecordTarget,
      label: `Type · ${r.name}`,
    })),
    ...journals.map((r) => ({
      target: { kind: "journal_entry", id: r._id } as RecordTarget,
      label: `Journal · ${r.memo}`,
    })),
    ...tags.map((r) => ({
      target: { kind: "tag", id: r._id } as RecordTarget,
      label: `Tag · ${r.name}`,
    })),
    ...entities.map((r) => ({
      target: { kind: "entity", id: r._id } as RecordTarget,
      label: `Entity · ${r.display_name}`,
    })),
    ...arrangements.map((r) => ({
      target: { kind: "arrangement", id: r._id } as RecordTarget,
      label: `Arrangement · ${r.name || r.kind}`,
    })),
    ...events.map((r) => ({
      target: { kind: "event", id: r._id } as RecordTarget,
      label: `Event · ${r.title || r.kind}`,
    })),
    ...charts.map((r) => ({
      target: { kind: "chart_of_accounts", id: r._id } as RecordTarget,
      label: `Chart · ${r.name}`,
    })),
    ...accounts.map((r) => ({
      target: { kind: "ledger_account", id: r._id } as RecordTarget,
      label: `Account · ${r.name}`,
    })),
  ];
  return snapshotInputs
    ? records.filter((r) => r.target.kind !== "plan" && r.target.kind !== "scenario" &&
        (r.target.kind !== "journal_entry" || journals.some(j => j._id === r.target.id && j.status === "posted")))
    : records;
}
export function TargetSelect({
  name = "target",
  label = "Related record",
  required = true,
  value,
}: {
  name?: string;
  label?: string;
  required?: boolean;
  value?: RecordTarget;
}) {
  const records = useRecordOptions();
  return (
    <SelectField
      label={records ? label : `${label} (loading…)`}
      name={name}
      required={required}
      value={value ? JSON.stringify(value) : undefined}
      options={(records ?? []).map((r) => ({
        value: JSON.stringify(r.target),
        label: r.label,
      }))}
    />
  );
}
export function targetValue(data: FormData, name = "target"): RecordTarget {
  const value = String(data.get(name) ?? "");
  if (!value) throw new Error("Select a related record.");
  return JSON.parse(value) as RecordTarget;
}
