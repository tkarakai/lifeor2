"use client";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import {
  Page,
  Panel,
  Collection,
  Editor,
  Form,
  TextField,
  SelectField,
  Loading,
  Empty,
  textValue,
  optionalText,
  dateValue,
  localDateTime,
  options,
} from "@/components/record-ui";
import {
  TargetSelect,
  targetValue,
  useRecordOptions,
} from "@/components/target-select";
import { RecordDetails } from "@/components/record-details";
import { currencyScales } from "@/components/money";
function MeasurementForm({ corrects }: { corrects?: Doc<"measurement"> }) {
  const create = useMutation(api.measurements.create);
  return (
    <Form
      label={corrects ? "Record correction" : "Record measurement"}
      onSave={(data) =>
        create({
          subject: targetValue(data),
          name: textValue(data, "name"),
          assertion: textValue(data, "assertion") as "observed" | "contractual",
          value: {
            decimal: textValue(data, "value"),
            unit: textValue(data, "unit"),
            currency: optionalText(data, "currency"),
          },
          as_of: dateValue(data, "asOf")!,
          method: optionalText(data, "method"),
          corrects_id: corrects?._id,
        })
      }
    >
      <TargetSelect label="Subject" value={corrects?.subject} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Measurement name"
          name="name"
          value={corrects?.name}
          required
        />
        <SelectField
          label="Meaning"
          name="assertion"
          value={
            corrects?.m_type === "contractual" ? "contractual" : "observed"
          }
          options={options(["observed", "contractual"])}
          required
        />
        <TextField
          label="Exact decimal value"
          name="value"
          value={corrects?.value?.decimal}
          required
          hint="A quantity or rate, not a ledger posting."
        />
        <TextField
          label="Unit"
          name="unit"
          value={corrects?.value?.unit}
          required
          hint="For example: km, kg, percent, or currency."
        />
        <SelectField
          label="Currency (only for monetary quantities)"
          name="currency"
          value={corrects?.value?.currency}
          options={options(Object.keys(currencyScales))}
        />
        <TextField
          label="As of"
          name="asOf"
          type="datetime-local"
          value={localDateTime(corrects?.as_of)}
          required
        />
      </div>
      <TextField
        label="Method / source (optional)"
        name="method"
        value={corrects?.method}
      />
    </Form>
  );
}
export default function MeasurementsPage() {
  const measurements = useQuery(api.measurements.list);
  const records = useRecordOptions();
  return (
    <Page
      title="Measurements"
      description="Track quantities, rates, and observations over time, with their source and history."
      actions={
        <>
          <Editor title="New measurement">
            <MeasurementForm />
          </Editor>
        </>
      }
    >
      {measurements === undefined ? (
        <Loading />
      ) : measurements.length === 0 ? (
        <Empty>No measurements recorded yet.</Empty>
      ) : (
        <Collection label="measurements">
          {measurements.map((m) => (
            <Panel
              key={m._id}
              category={m.m_type}
              summary={
                m.value
                  ? `${m.value.decimal} ${m.value.currency ?? m.value.unit}`
                  : "Legacy value"
              }
              summaryLabel="Recorded value"
              context={[
                records?.find(
                  (r) => r.target.id === (m.subject?.id ?? m.owner_id),
                )?.label,
                m.method ? `Source: ${m.method}` : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
              searchText={
                records?.find(
                  (r) => r.target.id === (m.subject?.id ?? m.owner_id),
                )?.label
              }
              title={m.name}
              description={`${m.m_type} · ${new Date(m.as_of).toLocaleString()}${m.corrects_id ? " · Correction" : ""}`}
            >
              <p className="text-sm text-muted-foreground">
                {records?.find(
                  (r) => r.target.id === (m.subject?.id ?? m.owner_id),
                )?.label ??
                  `${m.subject?.kind ?? m.owner_type} · ${m.subject?.id ?? m.owner_id}`}
              </p>
              {m.value ? (
                <p className="text-xl font-medium tabular-nums">
                  {m.value.decimal} {m.value.currency ?? m.value.unit}
                </p>
              ) : (
                <div>
                  <p className="mb-2 text-sm text-muted-foreground">
                    Preserved legacy value; no quantity has been inferred.
                  </p>
                  <pre className="overflow-x-auto text-xs">{m.value_json}</pre>
                </div>
              )}
              {m.method && <p className="text-sm">Method: {m.method}</p>}
              <RecordDetails target={{ kind: "measurement", id: m._id }} />
              {(m.m_type === "observed" || m.m_type === "contractual") && (
                <Editor title="Correct measurement">
                  <MeasurementForm corrects={m} />
                </Editor>
              )}
            </Panel>
          ))}
        </Collection>
      )}
    </Page>
  );
}
