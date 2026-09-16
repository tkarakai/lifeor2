"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, FileText, Calendar } from "lucide-react";
import { formatTimestamp } from "@/lib/temporal-queries";

const arrangementKinds = [
  { value: "Employment", label: "Employment" },
  { value: "Tenancy", label: "Tenancy" },
  { value: "Ownership", label: "Ownership" },
  { value: "ChartOfAccounts", label: "Chart of Accounts" },
  { value: "BankAccount", label: "Bank Account" },
];

export default function ArrangementsPage() {
  const arrangements = useQuery(api.arrangements.list) || [];
  const createArrangement = useMutation(api.arrangements.create);
  const deleteArrangement = useMutation(api.arrangements.remove);

  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState("Employment");
  const [validFrom, setValidFrom] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [validTo, setValidTo] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createArrangement({
        kind,
        valid_from: new Date(validFrom).getTime(),
        valid_to: validTo ? new Date(validTo).getTime() : undefined,
      });
      setValidFrom(new Date().toISOString().split("T")[0]);
      setValidTo("");
      setShowForm(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not save record");
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this arrangement?")) {
      try {
        await deleteArrangement({ id: id as any });
      } catch (error) {
        alert(error instanceof Error ? error.message : "Could not delete record");
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Arrangements</h1>
          <p className="text-muted-foreground">
            Manage relationships and agreements with temporal validity
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Arrangement
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Arrangement</CardTitle>
            <CardDescription>
              Define a relationship or agreement with validity period
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Kind</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  {arrangementKinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Valid From
                </label>
                <Input
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Valid To (Optional)
                </label>
                <Input
                  type="date"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                  placeholder="Leave empty for open-ended"
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {arrangements.map((arrangement) => {
          const isActive = !arrangement.valid_to || arrangement.valid_to >= Date.now();
          return (
            <Card key={arrangement._id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">{arrangement.kind}</CardTitle>
                  </div>
                  {isActive && (
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      Active
                    </span>
                  )}
                </div>
                <CardDescription className="flex items-center gap-1 mt-2">
                  <Calendar className="h-3 w-3" />
                  {formatTimestamp(arrangement.valid_from)}
                  {arrangement.valid_to && (
                    <> → {formatTimestamp(arrangement.valid_to)}</>
                  )}
                  {!arrangement.valid_to && <> → Ongoing</>}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(arrangement._id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {arrangements.length === 0 && !showForm && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No arrangements yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first arrangement to get started
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Arrangement
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
