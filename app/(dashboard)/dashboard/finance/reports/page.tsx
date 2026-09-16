"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Page,
  Panel,
  Field,
  Loading,
  Empty,
  controlClass,
} from "@/components/record-ui";
import { formatMoney } from "@/components/money";
export default function ReportsPage() {
  const charts = useQuery(api.finance.listCharts);
  const [selection, setSelection] = useState("");
  const chartId = selection || charts?.[0]?._id;
  const report = useQuery(
    api.finance.getTrialBalance,
    chartId ? { chartId: chartId as Id<"chart_of_accounts"> } : "skip",
  );
  return (
    <Page
      title="Trial balance"
      description="Posted ledger balances, grouped by currency. No exchange-rate conversion is applied."
    >
      {charts === undefined ? (
        <Loading />
      ) : charts.length === 0 ? (
        <Empty>
          Create a chart of accounts before viewing a trial balance.
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
          {report === undefined ? (
            <Loading />
          ) : report.byCurrency.length === 0 ? (
            <Empty>No account balances in this chart.</Empty>
          ) : (
            report.byCurrency.map((group) => (
              <Panel
                key={group.currency}
                title={`${group.currency} trial balance`}
                description={
                  group.isBalanced
                    ? "Debits and credits balance exactly."
                    : "Debits and credits do not balance."
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Trial balance in {group.currency}
                    </caption>
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="p-2 text-left">
                          Account
                        </th>
                        <th scope="col" className="p-2 text-left">
                          Type
                        </th>
                        <th scope="col" className="p-2 text-right">
                          Debit
                        </th>
                        <th scope="col" className="p-2 text-right">
                          Credit
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.balances
                        .filter((b) => b.currency === group.currency)
                        .map((b) => (
                          <tr key={b.accountId} className="border-b">
                            <th
                              scope="row"
                              className="p-2 text-left font-normal"
                            >
                              {b.accountName}
                            </th>
                            <td className="p-2">{b.accountType}</td>
                            <td className="p-2 text-right tabular-nums">
                              {formatMoney(b.debit, b.currency)}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {formatMoney(b.credit, b.currency)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-semibold">
                        <th scope="row" colSpan={2} className="p-2 text-left">
                          Total
                        </th>
                        <td className="p-2 text-right tabular-nums">
                          {formatMoney(group.totalDebit, group.currency)}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {formatMoney(group.totalCredit, group.currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Panel>
            ))
          )}
        </>
      )}
    </Page>
  );
}
