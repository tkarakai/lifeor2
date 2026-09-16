"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Calendar, Clock } from "lucide-react";
import { formatTimestamp } from "@/lib/temporal-queries";

const eventKinds = [
  { value: "PayrollDeposit", label: "Payroll Deposit" },
  { value: "RentPayment", label: "Rent Payment" },
  { value: "Purchase", label: "Purchase" },
  { value: "Sale", label: "Sale" },
  { value: "Transfer", label: "Transfer" },
  { value: "Other", label: "Other" },
];

export default function EventsPage() {
  const events = useQuery(api.events.list) || [];
  const createEvent = useMutation(api.events.create);
  const deleteEvent = useMutation(api.events.remove);

  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState("PayrollDeposit");
  const [occurredAt, setOccurredAt] = useState(
    new Date().toISOString().slice(0, 16)
  );
  const [payloadJson, setPayloadJson] = useState("{}");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      JSON.parse(payloadJson); // Validate JSON
      await createEvent({
        kind,
        occurred_at: new Date(occurredAt).getTime(),
        payload_json: payloadJson,
      });
      setPayloadJson("{}");
      setOccurredAt(new Date().toISOString().slice(0, 16));
      setShowForm(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not save event");
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this event?")) {
      try {
        await deleteEvent({ id: id as any });
      } catch (error) {
        alert(error instanceof Error ? error.message : "Could not delete record");
      }
    }
  };

  const formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            Timeline of recorded occurrences
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Event
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Record New Event</CardTitle>
            <CardDescription>
              Create a new event occurrence with timestamp and data
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
                  {eventKinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Occurred At
                </label>
                <Input
                  type="datetime-local"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Payload (JSON)
                </label>
                <textarea
                  value={payloadJson}
                  onChange={(e) => setPayloadJson(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                  rows={4}
                  placeholder='{"amount": 1000, "currency": "USD"}'
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

      <div className="space-y-4">
        {events.map((event, index) => {
          let payload;
          try {
            payload = JSON.parse(event.payload_json);
          } catch {
            payload = { error: "Invalid JSON" };
          }

          return (
            <Card key={event._id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{event.kind}</CardTitle>
                    <CardDescription className="flex items-center gap-4 mt-2">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatTimestamp(event.occurred_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(event.occurred_at)}
                      </span>
                    </CardDescription>
                  </div>
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    #{events.length - index}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Payload</h4>
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                      {JSON.stringify(payload, null, 2)}
                    </pre>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Recorded: {formatDateTime(event.recorded_at)}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(event._id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {events.length === 0 && !showForm && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No events yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Record your first event to get started
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Record Event
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
