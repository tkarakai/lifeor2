"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  const arrangements = useQuery(api.arrangements.list) || [];
  const [coaArrangementId, setCoaArrangementId] = useState("");

  const coaArrangements = arrangements.filter((a) => a.kind === "ChartOfAccounts");

  useEffect(() => {
    if (coaArrangements.length > 0 && !coaArrangementId) {
      setCoaArrangementId(coaArrangements[0]._id);
    }
  }, [coaArrangements, coaArrangementId]);

  const trialBalance = useQuery(
    api.finance.getTrialBalance,
    coaArrangementId ? { coaArrangementId: coaArrangementId as any } : "skip"
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financial Reports</h1>
          <p className="text-muted-foreground">
            Trial balance and financial statements
          </p>
        </div>
      </div>

      {coaArrangements.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Chart of Accounts</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a ChartOfAccounts arrangement first
            </p>
          </CardContent>
        </Card>
      )}

      {coaArrangements.length > 0 && (
        <>
          <div>
            <label className="block text-sm font-medium mb-2">Chart of Accounts</label>
            <select
              value={coaArrangementId}
              onChange={(e) => setCoaArrangementId(e.target.value)}
              className="w-64 rounded-md border border-input bg-background px-3 py-2"
            >
              {coaArrangements.map((arr) => (
                <option key={arr._id} value={arr._id}>
                  {arr.kind} (ID: {arr._id.slice(-8)})
                </option>
              ))}
            </select>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Trial Balance</CardTitle>
              <CardDescription>
                Verify that debits equal credits across all accounts
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trialBalance ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Account</th>
                          <th className="text-left p-2">Type</th>
                          <th className="text-right p-2">Debit</th>
                          <th className="text-right p-2">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trialBalance.balances.map((balance) => (
                          <tr key={balance.accountId} className="border-b">
                            <td className="p-2">{balance.accountName}</td>
                            <td className="p-2">{balance.accountType}</td>
                            <td className="text-right p-2">
                              {balance.debit > 0 ? balance.debit.toFixed(2) : "-"}
                            </td>
                            <td className="text-right p-2">
                              {balance.credit > 0 ? balance.credit.toFixed(2) : "-"}
                            </td>
                          </tr>
                        ))}
                        <tr className="font-bold border-t-2">
                          <td className="p-2" colSpan={2}>
                            Total
                          </td>
                          <td className="text-right p-2">
                            {trialBalance.totalDebit.toFixed(2)}
                          </td>
                          <td className="text-right p-2">
                            {trialBalance.totalCredit.toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div
                    className={`p-4 rounded-lg ${
                      trialBalance.isBalanced
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                    }`}
                  >
                    {trialBalance.isBalanced ? (
                      <span className="font-medium">✓ Trial Balance is Balanced</span>
                    ) : (
                      <span className="font-medium">
                        ✗ Trial Balance is NOT Balanced (Difference:{" "}
                        {Math.abs(trialBalance.totalDebit - trialBalance.totalCredit).toFixed(2)})
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
