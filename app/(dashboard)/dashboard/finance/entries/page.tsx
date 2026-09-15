"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, FileText } from "lucide-react";

interface Posting {
  accountId: string;
  amount: number;
  currency: string;
  description: string;
}

export default function JournalEntriesPage() {
  const arrangements = useQuery(api.arrangements.list) || [];
  const events = useQuery(api.events.list) || [];
  const accounts = useQuery(api.finance.listAccounts, {}) || [];
  const entries = useQuery(api.finance.listJournalEntries, {}) || [];
  const createJournalEntry = useMutation(api.finance.createJournalEntry);

  const [showForm, setShowForm] = useState(false);
  const [coaArrangementId, setCoaArrangementId] = useState("");
  const [eventId, setEventId] = useState("");
  const [memo, setMemo] = useState("");
  const [postings, setPostings] = useState<Posting[]>([
    { accountId: "", amount: 0, currency: "USD", description: "" },
    { accountId: "", amount: 0, currency: "USD", description: "" },
  ]);

  const coaArrangements = arrangements.filter((a) => a.kind === "ChartOfAccounts");

  useEffect(() => {
    if (coaArrangements.length > 0 && !coaArrangementId) {
      setCoaArrangementId(coaArrangements[0]._id);
    }
  }, [coaArrangements, coaArrangementId]);

  const addPosting = () => {
    setPostings([...postings, { accountId: "", amount: 0, currency: "USD", description: "" }]);
  };

  const removePosting = (index: number) => {
    if (postings.length > 2) {
      setPostings(postings.filter((_, i) => i !== index));
    }
  };

  const updatePosting = (index: number, field: keyof Posting, value: string | number) => {
    const newPostings = [...postings];
    newPostings[index] = { ...newPostings[index], [field]: value };
    setPostings(newPostings);
  };

  const calculateBalance = () => {
    const byCurrency: Record<string, number> = {};
    postings.forEach((p) => {
      if (!byCurrency[p.currency]) byCurrency[p.currency] = 0;
      byCurrency[p.currency] += p.amount;
    });
    return byCurrency;
  };

  const isBalanced = () => {
    const balances = calculateBalance();
    return Object.values(balances).every((b) => Math.abs(b) < 0.01);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !coaArrangementId) {
      alert("Please select an event and chart of accounts");
      return;
    }

    if (!isBalanced()) {
      alert("Journal entry is not balanced! Debits must equal credits.");
      return;
    }

    try {
      await createJournalEntry({
        eventId: eventId as any,
        coaArrangementId: coaArrangementId as any,
        memo,
        postings: postings.map((p) => ({
          accountId: p.accountId as any,
          amount: p.amount,
          currency: p.currency,
          description: p.description,
        })),
      });

      setMemo("");
      setPostings([
        { accountId: "", amount: 0, currency: "USD", description: "" },
        { accountId: "", amount: 0, currency: "USD", description: "" },
      ]);
      setShowForm(false);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const balances = calculateBalance();
  const balanced = isBalanced();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Journal Entries</h1>
          <p className="text-muted-foreground">
            Record financial transactions with double-entry validation
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} disabled={events.length === 0 || accounts.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          New Entry
        </Button>
      </div>

      {(events.length === 0 || accounts.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Prerequisites Missing</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {events.length === 0 && "Create events first. "}
              {accounts.length === 0 && "Create ledger accounts first."}
            </p>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create Journal Entry</CardTitle>
            <CardDescription>
              Enter postings - debits must equal credits
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Event</label>
                  <select
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2"
                    required
                  >
                    <option value="">Select event...</option>
                    {events.map((event) => (
                      <option key={event._id} value={event._id}>
                        {event.kind} - {new Date(event.occurred_at).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>
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
                        {arr.kind}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Memo</label>
                <Input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Description of transaction"
                  required
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Postings</h3>
                  <Button type="button" size="sm" variant="outline" onClick={addPosting}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Line
                  </Button>
                </div>

                {postings.map((posting, index) => (
                  <Card key={index}>
                    <CardContent className="pt-6">
                      <div className="grid grid-cols-5 gap-2 items-end">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium mb-1">Account</label>
                          <select
                            value={posting.accountId}
                            onChange={(e) => updatePosting(index, "accountId", e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                            required
                          >
                            <option value="">Select...</option>
                            {accounts.map((acc) => (
                              <option key={acc._id} value={acc._id}>
                                {acc.name} ({acc.type})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Amount</label>
                          <Input
                            type="number"
                            step="0.01"
                            value={posting.amount}
                            onChange={(e) => updatePosting(index, "amount", parseFloat(e.target.value))}
                            className="text-sm"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Currency</label>
                          <Input
                            value={posting.currency}
                            onChange={(e) => updatePosting(index, "currency", e.target.value)}
                            className="text-sm"
                            required
                          />
                        </div>
                        <div className="flex items-end">
                          {postings.length > 2 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => removePosting(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-2">
                        <Input
                          value={posting.description}
                          onChange={(e) => updatePosting(index, "description", e.target.value)}
                          placeholder="Description"
                          className="text-sm"
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <div className="p-4 rounded-lg border bg-muted">
                  <h4 className="text-sm font-medium mb-2">Balance Check</h4>
                  {Object.entries(balances).map(([currency, balance]) => (
                    <div key={currency} className="text-sm flex justify-between">
                      <span>{currency}:</span>
                      <span className={balanced ? "text-green-600" : "text-red-600"}>
                        {balance.toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="mt-2 text-sm font-medium">
                    {balanced ? (
                      <span className="text-green-600">✓ Balanced</span>
                    ) : (
                      <span className="text-red-600">✗ Not Balanced</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={!balanced}>
                  Create Entry
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {entries.map((entry) => (
          <Card key={entry._id}>
            <CardHeader>
              <CardTitle className="text-lg">{entry.memo}</CardTitle>
              <CardDescription>
                Status: {entry.status} | Posted: {entry.posted_at ? new Date(entry.posted_at).toLocaleString() : "N/A"}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {entries.length === 0 && !showForm && events.length > 0 && accounts.length > 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No journal entries yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first entry to record transactions
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Entry
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
