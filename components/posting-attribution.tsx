"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { FunctionReturnType } from "convex/server";
import {
  Form,
  Field,
  TextField,
  Loading,
  controlClass,
  optionalText,
} from "@/components/record-ui";
import { Button } from "@/components/ui/button";
import { formatMoney, moneyInput, parseMoney } from "@/components/money";
type Beneficiary = { entity_id: string; share_bps: string };
type Portion = {
  amount: string;
  subject: string;
  arrangement: string;
  counterparty: string;
  unclassified: boolean;
  beneficiaries: Beneficiary[];
};
type Attribution = FunctionReturnType<typeof api.finance.getAttribution>;
export function PostingAttribution({ posting }: { posting: Doc<"posting"> }) {
  const current = useQuery(api.finance.getAttribution, {
    postingId: posting._id,
  });
  if (current === undefined) return <Loading />;
  if (posting.minor_units === undefined)
    return (
      <p className="text-sm text-muted-foreground">
        Migrate this legacy posting before editing attribution.
      </p>
    );
  return (
    <AttributionForm
      key={current?.set.revision ?? 0}
      posting={posting}
      current={current}
    />
  );
}
function AttributionForm({
  posting,
  current,
}: {
  posting: Doc<"posting">;
  current: Attribution;
}) {
  const entities = useQuery(api.entities.list);
  const arrangements = useQuery(api.arrangements.list);
  const save = useMutation(api.finance.replaceAttribution);
  const [portions, setPortions] = useState<Portion[]>(
    () =>
      current?.portions.map((p) => ({
        amount: moneyInput(p.minor_units, p.currency),
        subject: p.subject_entity_id ?? "",
        arrangement: p.arrangement_id ?? "",
        counterparty: p.counterparty_entity_id ?? "",
        unclassified: p.unclassified,
        beneficiaries: p.beneficiaries.map((b) => ({
          entity_id: b.entity_id ?? "",
          share_bps: String(b.share_bps),
        })),
      })) ?? [
        {
          amount: moneyInput(posting.minor_units!, posting.currency),
          subject: "",
          arrangement: "",
          counterparty: "",
          unclassified: true,
          beneficiaries: [{ entity_id: "", share_bps: "10000" }],
        },
      ],
  );
  const change = (index: number, changes: Partial<Portion>) =>
    setPortions(
      portions.map((p, i) => (i === index ? { ...p, ...changes } : p)),
    );
  if (!entities || !arrangements) return <Loading />;
  const entityChoices = entities.map((e) => (
    <option key={e._id} value={e._id}>
      {e.display_name}
    </option>
  ));
  return (
    <Form
      label="Save attribution revision"
      onSave={(data) =>
        save({
          postingId: posting._id,
          expectedRevision:
            current?.set.revision ?? posting.attribution_revision ?? 0,
          reason: optionalText(data, "reason"),
          portions: portions.map((p) => ({
            minor_units: parseMoney(p.amount, posting.currency),
            subject_entity_id: (p.subject as Id<"entity">) || undefined,
            arrangement_id: (p.arrangement as Id<"arrangement">) || undefined,
            counterparty_entity_id:
              (p.counterparty as Id<"entity">) || undefined,
            unclassified: p.unclassified,
            beneficiaries: p.beneficiaries.map((b) => ({
              entity_id: (b.entity_id as Id<"entity">) || undefined,
              unassigned: !b.entity_id,
              share_bps: Number(b.share_bps),
            })),
          })),
        })
      }
    >
      <p className="text-sm text-muted-foreground">
        Explain the existing{" "}
        {formatMoney(posting.minor_units!, posting.currency)} posting. Portions
        must sum to its signed amount; each portion’s beneficiary shares must
        total 10,000 basis points (100%).
      </p>
      {portions.map((p, index) => (
        <div key={index} className="space-y-4 rounded-md border p-4">
          <h4 className="font-medium">Portion {index + 1}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Signed amount (${posting.currency})`}>
              <input
                className={controlClass}
                value={p.amount}
                onChange={(e) => change(index, { amount: e.target.value })}
                required
              />
            </Field>
            <Field label="Subject (what it was for)">
              <select
                className={controlClass}
                value={p.subject}
                onChange={(e) =>
                  change(index, {
                    subject: e.target.value,
                    unclassified: !e.target.value && !p.arrangement,
                  })
                }
              >
                <option value="">No subject</option>
                {entityChoices}
              </select>
            </Field>
            <Field label="Arrangement">
              <select
                className={controlClass}
                value={p.arrangement}
                onChange={(e) =>
                  change(index, {
                    arrangement: e.target.value,
                    unclassified: !e.target.value && !p.subject,
                  })
                }
              >
                <option value="">No arrangement</option>
                {arrangements.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name || a.kind}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Counterparty">
              <select
                className={controlClass}
                value={p.counterparty}
                onChange={(e) =>
                  change(index, { counterparty: e.target.value })
                }
              >
                <option value="">Not recorded</option>
                {entityChoices}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.unclassified}
              onChange={(e) =>
                change(index, { unclassified: e.target.checked })
              }
            />
            Explicitly unclassified
          </label>
          {p.beneficiaries.map((b, bi) => (
            <div key={bi} className="grid gap-3 sm:grid-cols-3">
              <Field label="Beneficiary (who benefited)">
                <select
                  className={controlClass}
                  value={b.entity_id}
                  onChange={(e) =>
                    change(index, {
                      beneficiaries: p.beneficiaries.map((v, i) =>
                        i === bi ? { ...v, entity_id: e.target.value } : v,
                      ),
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {entityChoices}
                </select>
              </Field>
              <Field label="Share (basis points)">
                <input
                  className={controlClass}
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  required
                  value={b.share_bps}
                  onChange={(e) =>
                    change(index, {
                      beneficiaries: p.beneficiaries.map((v, i) =>
                        i === bi ? { ...v, share_bps: e.target.value } : v,
                      ),
                    })
                  }
                />
              </Field>
              {p.beneficiaries.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    change(index, {
                      beneficiaries: p.beneficiaries.filter((_, i) => i !== bi),
                    })
                  }
                >
                  Remove beneficiary
                </Button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                change(index, {
                  beneficiaries: [
                    ...p.beneficiaries,
                    { entity_id: "", share_bps: "0" },
                  ],
                })
              }
            >
              Add beneficiary
            </Button>
            {portions.length > 1 && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setPortions(portions.filter((_, i) => i !== index))
                }
              >
                Remove portion
              </Button>
            )}
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          setPortions([
            ...portions,
            {
              amount: "",
              subject: "",
              arrangement: "",
              counterparty: "",
              unclassified: true,
              beneficiaries: [{ entity_id: "", share_bps: "10000" }],
            },
          ])
        }
      >
        Add portion
      </Button>
      <TextField label="Reason for change (optional)" name="reason" />
    </Form>
  );
}
