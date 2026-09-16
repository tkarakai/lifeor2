"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Panel,
  Editor,
  Form,
  TextField,
  Field,
  Loading,
  Empty,
  controlClass,
  textValue,
} from "@/components/record-ui";
import { MoneyFields, moneyFieldsValue } from "@/components/financial-fields";
import { formatMoney } from "@/components/money";
import { RecordDetails } from "@/components/record-details";
export function PlanningAssumptions() {
  const assumptions = useQuery(api.planning.listAssumptions);
  const create = useMutation(api.planning.createAssumption);
  const [kind, setKind] = useState<"amount" | "timing">("amount");
  return (
    <Panel
      title="Assumptions"
      description="Explicit manual inputs for expectations. An assumption is not an actual event or ledger amount."
    >
      <Editor title="New assumption">
        <Form
          label="Record assumption"
          onSave={(data) =>
            create({
              name: textValue(data, "name"),
              source: textValue(data, "source"),
              value:
                kind === "amount"
                  ? { kind, amount: moneyFieldsValue(data) }
                  : { kind, date: textValue(data, "date") },
            })
          }
        >
          <TextField label="Name" name="name" required />
          <TextField label="Source / basis" name="source" required />
          <Field label="Assumption kind">
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
            <TextField label="Expected date" name="date" type="date" required />
          )}
        </Form>
      </Editor>
      {assumptions === undefined ? (
        <Loading />
      ) : assumptions.length === 0 ? (
        <Empty>No assumptions recorded.</Empty>
      ) : (
        assumptions.map((a) => (
          <div key={a._id} className="space-y-3 border-t pt-4">
            <h3 className="font-medium">{a.name}</h3>
            <p className="text-sm">
              {a.value.kind === "amount"
                ? formatMoney(
                    a.value.amount.minor_units,
                    a.value.amount.currency,
                  )
                : a.value.kind === "timing"
                  ? a.value.date
                  : "Effective interval"}{" "}
              · {a.source}
            </p>
            <RecordDetails
              target={{ kind: "forecast_assumption", id: a._id }}
            />
          </div>
        ))
      )}
    </Panel>
  );
}
