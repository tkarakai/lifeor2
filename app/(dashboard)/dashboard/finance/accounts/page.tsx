"use client";
import { useState } from "react";
import { useQuery, useMutation } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Page,
  Action,
  Panel,
  Collection,
  WorkspaceTabs,
  Form,
  TextField,
  SelectField,
  Field,
  Editor,
  Loading,
  Empty,
  controlClass,
  textValue,
  optionalText,
  options,
} from "@/components/record-ui";
import { FinancialAccounts } from "@/components/financial-accounts";
import { currencyScales } from "@/components/money";
import { RecordDetails } from "@/components/record-details";
const accountTypes = [
  "Asset",
  "Liability",
  "Equity",
  "Income",
  "Expense",
] as const;
export default function AccountsPage() {
  const charts = useQuery(api.finance.listCharts);
  const entities = useQuery(api.entities.list);
  const [selection, setSelection] = useState("");
  const chartId = charts?.some((c) => c._id === selection)
    ? selection
    : charts?.[0]?._id;
  const accounts = useQuery(
    api.finance.listAccounts,
    chartId ? { chartId: chartId as Id<"chart_of_accounts"> } : "skip",
  );
  const createChart = useMutation(api.finance.createChart);
  const createAccount = useMutation(api.finance.createAccount);
  const updateAccount = useMutation(api.finance.updateAccount);
  const updateChart = useMutation(api.finance.updateChart);
  return (
    <Page
      title="Charts & accounts"
      description="A chart holds ledger accounts for one reporting scope. Each account has its own currency."
      actions={
        <>
          {chartId ? (
            <Editor title="New ledger account">
              <Form
                label="Create account"
                onSave={(data) => {
                  const type = textValue(
                    data,
                    "type",
                  ) as (typeof accountTypes)[number];
                  return createAccount({
                    chartId: chartId as Id<"chart_of_accounts">,
                    name: textValue(data, "name"),
                    type,
                    normal_balance:
                      type === "Asset" || type === "Expense"
                        ? "Debit"
                        : "Credit",
                    currency: textValue(data, "currency"),
                    parent_account_id: optionalText(data, "parent") as
                      | Id<"ledger_account">
                      | undefined,
                  });
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Account name" name="name" required />
                  <SelectField
                    label="Type"
                    name="type"
                    value="Asset"
                    options={options(accountTypes)}
                    required
                  />
                  <SelectField
                    label="Currency"
                    name="currency"
                    value="USD"
                    options={options(Object.keys(currencyScales))}
                    required
                  />
                  <SelectField
                    label="Parent account (optional)"
                    name="parent"
                    options={(accounts ?? []).map((a) => ({
                      value: a._id,
                      label: a.name,
                    }))}
                  />
                </div>
              </Form>
            </Editor>
          ) : (
            <Editor title="New chart of accounts">
              <Form
                label="Create chart"
                onSave={(data) =>
                  createChart({
                    name: textValue(data, "name"),
                    reportingEntityId: optionalText(data, "entity") as
                      | Id<"entity">
                      | undefined,
                  })
                }
              >
                <TextField label="Chart name" name="name" required />
                <SelectField
                  label="Reporting entity (optional)"
                  name="entity"
                  options={(entities ?? []).map((e) => ({
                    value: e._id,
                    label: e.display_name,
                  }))}
                />
              </Form>
            </Editor>
          )}
        </>
      }
    >
      <WorkspaceTabs
        tabs={[
          {
            label: "Ledger accounts",
            content: (
              <>
                {charts === undefined ? (
                  <Loading />
                ) : charts.length === 0 ? (
                  <Empty>
                    Create your first chart above, then add ledger accounts.
                  </Empty>
                ) : (
                  <>
                    <div className="record-context-bar">
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
                      <Editor title="Edit chart">
                        <Form
                          key={chartId}
                          onSave={(data) =>
                            updateChart({
                              id: chartId as Id<"chart_of_accounts">,
                              name: textValue(data, "name"),
                            })
                          }
                        >
                          <TextField
                            label="Chart name"
                            name="name"
                            value={charts.find((c) => c._id === chartId)?.name}
                            required
                          />
                        </Form>
                        <Action
                          confirm="Archive this chart? Its ledger records will be retained."
                          onClick={async () => {
                            await updateChart({
                              id: chartId as Id<"chart_of_accounts">,
                              archived: true,
                            });
                            setSelection("");
                          }}
                        >
                          Archive chart
                        </Action>
                      </Editor>
                      <RecordDetails
                        key={chartId}
                        target={{ kind: "chart_of_accounts", id: chartId! }}
                      />
                      <Editor title="New chart of accounts">
                        <Form
                          label="Create chart"
                          onSave={(data) =>
                            createChart({
                              name: textValue(data, "name"),
                              reportingEntityId: optionalText(
                                data,
                                "entity",
                              ) as Id<"entity"> | undefined,
                            })
                          }
                        >
                          <TextField label="Chart name" name="name" required />
                          <SelectField
                            label="Reporting entity (optional)"
                            name="entity"
                            options={(entities ?? []).map((e) => ({
                              value: e._id,
                              label: e.display_name,
                            }))}
                          />
                        </Form>
                      </Editor>
                    </div>

                    {accounts === undefined ? (
                      <Loading />
                    ) : accounts.length === 0 ? (
                      <Empty>This chart has no ledger accounts.</Empty>
                    ) : (
                      <Collection label="accounts">
                        {accounts.map((a) => (
                          <Panel
                            key={a._id}
                            category={a.type}
                            title={a.name}
                            description={`${a.type} · ${a.currency} · Normal balance: ${a.normal_balance}`}
                          >
                            <Editor title="Edit account" inline>
                              <Form
                                onSave={(data) =>
                                  updateAccount({
                                    id: a._id,
                                    name: textValue(data, "name"),
                                  })
                                }
                              >
                                <TextField
                                  label="Account name"
                                  name="name"
                                  value={a.name}
                                  required
                                />
                              </Form>
                              <Action
                                confirm="Archive this account? Its historical postings remain in reports."
                                onClick={() =>
                                  updateAccount({ id: a._id, archived: true })
                                }
                              >
                                Archive account
                              </Action>
                            </Editor>
                            <RecordDetails
                              target={{ kind: "ledger_account", id: a._id }}
                            />
                          </Panel>
                        ))}
                      </Collection>
                    )}
                  </>
                )}
              </>
            ),
          },
          { label: "Bank & loan mappings", content: <FinancialAccounts /> },
        ]}
      />
    </Page>
  );
}
