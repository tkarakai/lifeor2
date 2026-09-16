"use client";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Panel,
  Editor,
  Form,
  TextField,
  SelectField,
  Loading,
  Empty,
  textValue,
  optionalText,
} from "@/components/record-ui";
import { ArrangementField } from "@/components/financial-fields";
import { RecordDetails } from "@/components/record-details";
export function FinancialAccounts() {
  const mappings = useQuery(api.finance.listFinancialAccounts);
  const accounts = useQuery(api.finance.listAccounts, {});
  const entities = useQuery(api.entities.list);
  const arrangements = useQuery(api.arrangements.list);
  const create = useMutation(api.finance.createFinancialAccount);
  return (
    <Panel
      title="Financial account mappings"
      description="Connect a banking or loan arrangement to its balance-sheet ledger account."
    >
      <Editor title="New financial account mapping">
        <Form
          label="Create mapping"
          onSave={(data) => {
            const account = accounts?.find(
              (a) => a._id === textValue(data, "account"),
            );
            if (!account) throw new Error("Select a ledger account.");
            return create({
              arrangement_id: textValue(
                data,
                "arrangement",
              ) as Id<"arrangement">,
              ledger_account_id: account._id,
              kind: textValue(data, "kind"),
              currency: account.currency,
              institution_entity_id: optionalText(data, "institution") as
                | Id<"entity">
                | undefined,
              identifier: optionalText(data, "identifier"),
            });
          }}
        >
          <ArrangementField required />
          <SelectField
            label="Asset or liability ledger account"
            name="account"
            options={(accounts ?? [])
              .filter((a) => a.type === "Asset" || a.type === "Liability")
              .map((a) => ({
                value: a._id,
                label: `${a.name} · ${a.currency}`,
              }))}
            required
          />
          <TextField
            label="Account kind"
            name="kind"
            required
            hint="For example: Checking, Savings, or Mortgage."
          />
          <SelectField
            label="Institution (optional)"
            name="institution"
            options={(entities ?? []).map((e) => ({
              value: e._id,
              label: e.display_name,
            }))}
          />
          <TextField
            label="Identifier (optional)"
            name="identifier"
            hint="A recognizable label or account suffix."
          />
        </Form>
      </Editor>
      {mappings === undefined ? (
        <Loading />
      ) : mappings.length === 0 ? (
        <Empty>No financial account mappings.</Empty>
      ) : (
        mappings.map((m) => (
          <div key={m._id} className="space-y-3 border-t pt-4">
            <h3 className="font-medium">
              {arrangements?.find((a) => a._id === m.arrangement_id)?.name ??
                m.kind}{" "}
              →{" "}
              {accounts?.find((a) => a._id === m.ledger_account_id)?.name ??
                "Archived ledger account"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {m.kind} · {m.currency}
              {m.identifier && ` · ${m.identifier}`}
            </p>
            <RecordDetails target={{ kind: "financial_account", id: m._id }} />
          </div>
        ))
      )}
    </Panel>
  );
}
