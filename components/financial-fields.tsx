"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  TextField,
  SelectField,
  textValue,
  options,
} from "@/components/record-ui";
import { parseMoney, currencyScales } from "@/components/money";
export function MoneyFields({
  currency = "USD",
  prefix = "",
  label = "Amount",
}: {
  currency?: string;
  prefix?: string;
  label?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label={label}
        name={`${prefix}amount`}
        required
        hint="Decimal amount in the selected currency; no rounding."
      />
      <SelectField
        label="Currency"
        name={`${prefix}currency`}
        value={currency}
        options={options(Object.keys(currencyScales))}
        required
      />
    </div>
  );
}
export function moneyFieldsValue(data: FormData, prefix = "") {
  const currency = textValue(data, `${prefix}currency`);
  return {
    minor_units: parseMoney(textValue(data, `${prefix}amount`), currency),
    currency,
  };
}
export function PartyFields() {
  const entities = useQuery(api.entities.list);
  const choices = (entities ?? []).map((e) => ({
    value: e._id,
    label: e.display_name,
  }));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label="Creditor (owed money)"
        name="creditor"
        options={choices}
        required
      />
      <SelectField
        label="Debtor (owes money)"
        name="debtor"
        options={choices}
        required
      />
    </div>
  );
}
export function ArrangementField({ required = false }: { required?: boolean }) {
  const arrangements = useQuery(api.arrangements.list);
  return (
    <SelectField
      label={`Arrangement${required ? "" : " (optional)"}`}
      name="arrangement"
      options={(arrangements ?? []).map((a) => ({
        value: a._id,
        label: a.name || a.kind,
      }))}
      required={required}
    />
  );
}
export function PostingField({
  name,
  label,
  entryId,
}: {
  name: string;
  label: string;
  entryId: Id<"journal_entry"> | "";
}) {
  const postings = useQuery(
    api.finance.getPostings,
    entryId ? { jeId: entryId } : "skip",
  );
  const accounts = useQuery(api.finance.listAccounts, {});
  return (
    <SelectField
      name={name}
      label={label}
      required
      options={(postings ?? []).map((p) => ({
        value: p._id,
        label: `${accounts?.find((a) => a._id === p.account_id)?.name ?? "Account"} · ${p.description} · ${p.currency}`,
      }))}
    />
  );
}
