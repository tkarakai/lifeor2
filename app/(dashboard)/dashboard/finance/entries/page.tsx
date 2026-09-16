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
  controlClass,
  textValue,
  localDateTime,
} from "@/components/record-ui";
import { Button } from "@/components/ui/button";
import { formatMoney, parseMoney } from "@/components/money";
import { RecordDetails } from "@/components/record-details";
import { PostingAttribution } from "@/components/posting-attribution";
import { add } from "@/convex/lib/domain";
type Line = { accountId: string; amount: string; description: string };
const blankLine = (): Line => ({ accountId: "", amount: "", description: "" });
export function PostingList({ jeId }: { jeId: Id<"journal_entry"> }) {
  const postings = useQuery(api.finance.getPostings, { jeId });
  const accounts = useQuery(api.finance.listAccounts, {});
  if (!postings || !accounts) return <Loading />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="p-2">Account</th>
            <th className="p-2">Description</th>
            <th className="p-2 text-right">Debit / (credit)</th>
          </tr>
        </thead>
        <tbody>
          {postings.map((p) => (
            <tr key={p._id} className="border-b">
              <td className="p-2">
                {accounts.find((a) => a._id === p.account_id)?.name ??
                  "Archived account"}
              </td>
              <td className="p-2">
                <p>{p.description}</p>
                <Editor title="Attribution">
                  <PostingAttribution posting={p} />
                </Editor>
              </td>
              <td className="p-2 text-right tabular-nums">
                {p.minor_units === undefined
                  ? "Legacy amount awaiting migration"
                  : formatMoney(p.minor_units, p.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function EntryForm({ chartId }: { chartId: Id<"chart_of_accounts"> }) {
  const accounts = useQuery(api.finance.listAccounts, { chartId });
  const events = useQuery(api.events.list);
  const create = useMutation(api.finance.createJournalEntry);
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  if (!accounts || !events) return <Loading />;
  if (accounts.length < 2 || events.length === 0)
    return (
      <Empty>
        Create an actual event and at least two ledger accounts in this chart
        before recording a journal entry.
      </Empty>
    );
  const updateLine = (index: number, changes: Partial<Line>) =>
    setLines(
      lines.map((line, i) => (i === index ? { ...line, ...changes } : line)),
    );
  const balances: Record<string, number> = {};
  let validation = "";
  try {
    for (const line of lines) {
      const account = accounts.find((a) => a._id === line.accountId);
      if (!account) throw new Error("Select an account for every posting.");
      const amount = parseMoney(line.amount, account.currency);
      if (!amount) throw new Error("Posting amounts must be nonzero.");
      balances[account.currency] = add(balances[account.currency] ?? 0, amount);
    }
  } catch (error) {
    validation =
      error instanceof Error ? error.message : "Check posting amounts.";
  }
  const balanced =
    !validation && Object.values(balances).every((value) => value === 0);
  return (
    <Form
      label="Post journal entry"
      onSave={async (data) => {
        if (!balanced)
          throw new Error(
            validation ||
              "Debits and credits must balance exactly in every currency.",
          );
        await create({
          chartId,
          eventId: textValue(data, "event") as Id<"event">,
          accounting_date: textValue(data, "date"),
          memo: textValue(data, "memo"),
          postings: lines.map((line) => {
            const account = accounts.find((a) => a._id === line.accountId)!;
            return {
              accountId: account._id,
              minor_units: parseMoney(line.amount, account.currency),
              currency: account.currency,
              description: line.description,
            };
          }),
        });
        setLines([blankLine(), blankLine()]);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Actual event"
          name="event"
          options={events
            .filter((e) => e.voided_at === undefined)
            .map((e) => ({
              value: e._id,
              label: `${e.title || e.kind} · ${new Date(e.occurred_at).toLocaleDateString()}`,
            }))}
          required
        />
        <TextField
          label="Accounting date"
          name="date"
          type="date"
          value={localDateTime().slice(0, 10)}
          required
        />
      </div>
      <TextField label="Memo" name="memo" required />
      <p className="text-sm text-muted-foreground">
        Enter positive debits and negative credits in the account currency.
        Amounts must balance exactly per currency; no rounding is applied.
      </p>
      {lines.map((line, index) => (
        <div key={index} className="space-y-3 rounded-md border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Posting ${index + 1} account`}>
              <select
                className={controlClass}
                value={line.accountId}
                required
                onChange={(e) =>
                  updateLine(index, { accountId: e.target.value })
                }
              >
                <option value="">Select…</option>
                {accounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Signed amount">
              <input
                className={controlClass}
                inputMode="decimal"
                value={line.amount}
                required
                onChange={(e) => updateLine(index, { amount: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Posting description">
            <input
              className={controlClass}
              value={line.description}
              onChange={(e) =>
                updateLine(index, { description: e.target.value })
              }
            />
          </Field>
          {lines.length > 2 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines(lines.filter((_, i) => i !== index))}
            >
              Remove posting {index + 1}
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => setLines([...lines, blankLine()])}
      >
        Add posting
      </Button>
      <div aria-live="polite" className="rounded-md bg-muted p-4 text-sm">
        {validation ? (
          validation
        ) : (
          <>
            {Object.entries(balances).map(([currency, value]) => (
              <p key={currency}>
                {currency} difference: {formatMoney(value, currency)}
              </p>
            ))}
            <p className="mt-2 font-medium">
              {balanced
                ? "Balanced in every currency."
                : "Debits and credits do not yet balance."}
            </p>
          </>
        )}
      </div>
    </Form>
  );
}
export default function EntriesPage() {
  const reverse = useMutation(api.finance.reverseJournalEntry);
  const charts = useQuery(api.finance.listCharts);
  const [selection, setSelection] = useState("");
  const chartId = selection || charts?.[0]?._id;
  const entries = useQuery(
    api.finance.listJournalEntries,
    chartId ? { chartId: chartId as Id<"chart_of_accounts"> } : "skip",
  );
  return (
    <Page
      title="Journal entries"
      description="Post balanced financial effects linked to actual events. Posted amounts are preserved as exact minor units."
    >
      {charts === undefined ? (
        <Loading />
      ) : charts.length === 0 ? (
        <Empty>
          Create a chart and ledger accounts in Charts & accounts first.
        </Empty>
      ) : (
        <>
          <Field label="Chart of accounts">
            <select
              className={controlClass}
              value={chartId}
              onChange={(e) => setSelection(e.target.value)}
            >
              {charts.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Editor title="New journal entry">
            <EntryForm
              key={chartId}
              chartId={chartId as Id<"chart_of_accounts">}
            />
          </Editor>
          {entries === undefined ? (
            <Loading />
          ) : entries.length === 0 ? (
            <Empty>No journal entries in this chart.</Empty>
          ) : (
            entries.map((entry) => (
              <Panel
                key={entry._id}
                title={entry.memo}
                description={`${entry.status} · ${entry.accounting_date ?? "No accounting date recorded"}`}
              >
                <PostingList jeId={entry._id} />
                {entry.status === "posted" && !entry.reverses_id && (
                  <Editor title="Reverse entry">
                    <Form
                      label="Post reversal"
                      onSave={(data) =>
                        reverse({
                          jeId: entry._id,
                          accounting_date: textValue(data, "date"),
                          reason: textValue(data, "reason"),
                        })
                      }
                    >
                      <p className="text-sm text-muted-foreground">
                        Posts an equal and opposite entry and preserves the
                        original journal.
                      </p>
                      <TextField
                        label="Reversal accounting date"
                        name="date"
                        type="date"
                        value={localDateTime().slice(0, 10)}
                        required
                      />
                      <TextField label="Reason" name="reason" required />
                    </Form>
                  </Editor>
                )}
                <RecordDetails
                  target={{ kind: "journal_entry", id: entry._id }}
                />
              </Panel>
            ))
          )}
        </>
      )}
    </Page>
  );
}
