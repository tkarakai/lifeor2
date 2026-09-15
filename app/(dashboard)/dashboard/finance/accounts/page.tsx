"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, DollarSign } from "lucide-react";

const accountTypes = [
  { value: "Asset", label: "Asset", normalBalance: "Debit" },
  { value: "Liability", label: "Liability", normalBalance: "Credit" },
  { value: "Equity", label: "Equity", normalBalance: "Credit" },
  { value: "Income", label: "Income", normalBalance: "Credit" },
  { value: "Expense", label: "Expense", normalBalance: "Debit" },
] as const;

export default function AccountsPage() {
  const arrangements = useQuery(api.arrangements.list) || [];
  const accounts = useQuery(api.finance.listAccounts, {}) || [];
  const createAccount = useMutation(api.finance.createAccount);

  const [showForm, setShowForm] = useState(false);
  const [coaArrangementId, setCoaArrangementId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"Asset" | "Liability" | "Equity" | "Income" | "Expense">("Asset");
  const [currency, setCurrency] = useState("USD");

  // Find ChartOfAccounts arrangements
  const coaArrangements = arrangements.filter((a) => a.kind === "ChartOfAccounts");

  useEffect(() => {
    if (coaArrangements.length > 0 && !coaArrangementId) {
      setCoaArrangementId(coaArrangements[0]._id);
    }
  }, [coaArrangements, coaArrangementId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coaArrangementId) {
      alert("Please create a Chart of Accounts arrangement first");
      return;
    }

    const selectedType = accountTypes.find((t) => t.value === type);
    if (!selectedType) return;

    await createAccount({
      coaArrangementId: coaArrangementId as any,
      name,
      type,
      normal_balance: selectedType.normalBalance as "Debit" | "Credit",
      currency,
    });

    setName("");
    setShowForm(false);
  };

  // Group accounts by type
  const accountsByType = accounts.reduce((acc, account) => {
    if (!acc[account.type]) {
      acc[account.type] = [];
    }
    acc[account.type].push(account);
    return acc;
  }, {} as Record<string, typeof accounts>);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chart of Accounts</h1>
          <p className="text-muted-foreground">
            Manage your ledger accounts for double-entry bookkeeping
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} disabled={coaArrangements.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          New Account
        </Button>
      </div>

      {coaArrangements.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Chart of Accounts</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a ChartOfAccounts arrangement first
            </p>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Account</CardTitle>
            <CardDescription>Add a ledger account to your chart of accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Chart of Accounts</label>
                <select
                  value={coaArrangementId}
                  onChange={(e) => setCoaArrangementId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  required
                >
                  {coaArrangements.map((arr) => (
                    <option key={arr._id} value={arr._id}>
                      {arr.kind} (ID: {arr._id.slice(-8)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Account Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Cash, Accounts Receivable"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  {accountTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} (Normal: {t.normalBalance})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Currency</label>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  placeholder="USD"
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit">Create</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {coaArrangements.length > 0 && accounts.length > 0 && (
        <div className="space-y-6">
          {accountTypes.map((accountType) => {
            const typeAccounts = accountsByType[accountType.value] || [];
            if (typeAccounts.length === 0) return null;

            return (
              <Card key={accountType.value}>
                <CardHeader>
                  <CardTitle>{accountType.label} Accounts</CardTitle>
                  <CardDescription>
                    Normal Balance: {accountType.normalBalance}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {typeAccounts.map((account) => (
                      <div
                        key={account._id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      >
                        <div>
                          <div className="font-medium">{account.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {account.currency}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          ID: {account._id.slice(-8)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {coaArrangements.length > 0 && accounts.length === 0 && !showForm && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No accounts yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first ledger account to get started
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Account
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
