"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Page,
  Panel,
  Collection,
  Editor,
  Form,
  FormSection,
  TextField,
  Field,
  Loading,
  Empty,
  controlClass,
  textValue,
  optionalText,
  localDateTime,
} from "@/components/record-ui";
import {
  MoneyFields,
  moneyFieldsValue,
  PartyFields,
  ArrangementField,
  PostingField,
} from "@/components/financial-fields";
import { formatMoney, parseMoney } from "@/components/money";
import { RecordDetails } from "@/components/record-details";
function Settle({
  id,
  currency,
  recognized,
}: {
  id: Id<"monetary_obligation">;
  currency: string;
  recognized: boolean;
}) {
  const entries = useQuery(api.finance.listJournalEntries, {});
  const [entryId, setEntryId] = useState<Id<"journal_entry"> | "">("");
  const settle = useMutation(api.obligations.settle);
  return (
    <Form
      label="Link settlement"
      onSave={(data) =>
        settle({
          obligationId: id,
          capacityPostingId: textValue(data, "posting") as Id<"posting">,
          minor_units: parseMoney(textValue(data, "amount"), currency),
          settlement_date: textValue(data, "date"),
          recognitionPostingId: optionalText(data, "recognition") as
            | Id<"posting">
            | undefined,
        })
      }
    >
      <p className="text-sm text-muted-foreground">
        Link an existing payment posting from a mapped financial account. This
        does not create or change ledger amounts.
      </p>
      <Field label="Payment journal entry">
        <select
          className={controlClass}
          value={entryId}
          onChange={(e) => setEntryId(e.target.value as Id<"journal_entry">)}
          required
        >
          <option value="">Select…</option>
          {(entries ?? []).map((e) => (
            <option key={e._id} value={e._id}>
              {e.memo} · {e.accounting_date}
            </option>
          ))}
        </select>
      </Field>
      <PostingField
        key={entryId}
        name="posting"
        label="Settlement capacity posting"
        entryId={entryId}
      />
      {recognized && (
        <PostingField
          key={`recognition:${entryId}`}
          name="recognition"
          label="Recognition counterpart posting"
          entryId={entryId}
        />
      )}
      <TextField
        label={`Settlement amount (${currency})`}
        name="amount"
        required
      />
      <TextField
        label="Settlement date"
        name="date"
        type="date"
        value={localDateTime().slice(0, 10)}
        required
      />
    </Form>
  );
}
export default function ObligationsPage() {
  const obligations = useQuery(api.obligations.list);
  const entities = useQuery(api.entities.list);
  const create = useMutation(api.obligations.create);
  const adjust = useMutation(api.obligations.adjust);
  const voidObligation = useMutation(api.obligations.voidObligation);
  const entityName = (id: Id<"entity">) =>
    entities?.find((e) => e._id === id)?.display_name ?? "Archived entity";
  return (
    <Page
      title="Obligations"
      description="Keep track of who owes whom, what is due, and the payments that settle it."
      actions={
        <>
          <Editor title="New obligation">
            <Form
              label="Record obligation"
              onSave={(data) =>
                create({
                  creditor_id: textValue(data, "creditor") as Id<"entity">,
                  debtor_id: textValue(data, "debtor") as Id<"entity">,
                  arrangement_id: optionalText(data, "arrangement") as
                    | Id<"arrangement">
                    | undefined,
                  due_date: textValue(data, "date"),
                  ...moneyFieldsValue(data),
                })
              }
            >
              <FormSection
                title="Parties & agreement"
                description="Identify who owes the money and who receives it."
              >
                <PartyFields />
                <ArrangementField />
              </FormSection>
              <FormSection
                title="Amount & due date"
                description="Record the original amount owed in its currency."
              >
                <MoneyFields />
                <TextField label="Due date" name="date" type="date" required />
              </FormSection>
            </Form>
          </Editor>
        </>
      }
    >
      {obligations === undefined || entities === undefined ? (
        <Loading />
      ) : obligations.length === 0 ? (
        <Empty>No monetary obligations recorded.</Empty>
      ) : (
        <Collection label="obligations">
          {obligations.map((o) => (
            <Panel
              key={o._id}
              category={
                o.voided_at !== undefined
                  ? "Voided"
                  : o.outstanding_minor_units === 0
                    ? "Settled"
                    : "Outstanding"
              }
              summary={formatMoney(o.outstanding_minor_units, o.currency)}
              summaryLabel={
                o.voided_at !== undefined
                  ? "Balance before void"
                  : "Outstanding"
              }
              context={`Original amount: ${formatMoney(o.original_minor_units, o.currency)}`}
              title={`${entityName(o.debtor_id)} owes ${entityName(o.creditor_id)}`}
              description={`${o.voided_at !== undefined ? "Voided · " : ""}Due ${o.due_date}`}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="text-sm">
                  Original:{" "}
                  <strong className="tabular-nums">
                    {formatMoney(o.original_minor_units, o.currency)}
                  </strong>
                </p>
                <p className="text-sm">
                  {o.voided_at !== undefined
                    ? "Balance before void:"
                    : "Outstanding:"}{" "}
                  <strong className="tabular-nums">
                    {formatMoney(o.outstanding_minor_units, o.currency)}
                  </strong>
                </p>
              </div>
              {o.voided_at === undefined && (
                <>
                  <Editor title="Link payment settlement">
                    <Settle
                      id={o._id}
                      currency={o.currency}
                      recognized={!!o.recognition_posting_id}
                    />
                  </Editor>
                  {!o.recognition_posting_id && (
                    <Editor title="Adjust obligation">
                      <Form
                        label="Record adjustment"
                        onSave={(data) =>
                          adjust({
                            obligationId: o._id,
                            minor_units: parseMoney(
                              textValue(data, "amount"),
                              o.currency,
                            ),
                            effective_date: textValue(data, "date"),
                            reason: textValue(data, "reason"),
                          })
                        }
                      >
                        <TextField
                          label={`Signed adjustment (${o.currency})`}
                          name="amount"
                          required
                          hint="Positive increases the amount owed; negative reduces it."
                        />
                        <TextField
                          label="Effective date"
                          name="date"
                          type="date"
                          required
                        />
                        <TextField label="Reason" name="reason" required />
                      </Form>
                    </Editor>
                  )}
                  {o.recognition_posting_id && (
                    <p className="text-sm text-muted-foreground">
                      Ledger-recognized obligation: amount corrections require a
                      matching journal adjustment.
                    </p>
                  )}
                  {!o.recognition_posting_id && o.settled_minor_units === 0 && (
                    <Editor title="Void obligation">
                      <Form
                        label="Void obligation"
                        onSave={(data) =>
                          voidObligation({
                            id: o._id,
                            reason: textValue(data, "reason"),
                          })
                        }
                      >
                        <TextField label="Reason" name="reason" required />
                      </Form>
                    </Editor>
                  )}
                </>
              )}
              {o.voided_at !== undefined && (
                <p className="text-sm text-muted-foreground">
                  Void reason: {o.void_reason}
                </p>
              )}
              <Editor title="Adjustments & settlements">
                {o.adjustments.length === 0 && o.settlements.length === 0 ? (
                  <Empty>No adjustments or settlements.</Empty>
                ) : (
                  <>
                    {o.adjustments.map((a) => (
                      <p key={a._id} className="text-sm">
                        Adjustment · {a.effective_date} ·{" "}
                        {formatMoney(a.minor_units, a.currency)} · {a.reason}
                      </p>
                    ))}
                    {o.settlements.map((s) => (
                      <p key={s._id} className="text-sm">
                        {s.reverses_id ? "Settlement reversal" : "Settlement"} ·{" "}
                        {s.settlement_date} ·{" "}
                        {formatMoney(s.minor_units, s.currency)}
                      </p>
                    ))}
                  </>
                )}
              </Editor>
              <RecordDetails
                target={{ kind: "monetary_obligation", id: o._id }}
              />
            </Panel>
          ))}
        </Collection>
      )}
    </Page>
  );
}
