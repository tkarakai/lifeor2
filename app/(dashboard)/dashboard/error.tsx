"use client";
import { Button } from "@/components/ui/button";
export default function DashboardError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto max-w-xl space-y-4 rounded-lg border p-6"
    >
      <h1 className="text-xl font-semibold">Unable to load these records</h1>
      <p className="text-muted-foreground">
        Check your connection and try again. Your saved records are unchanged.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
