"use client";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useDataset } from "@/lib/dataset";
import { useState, useId } from "react";
import type { Id } from "@/convex/_generated/dataModel";
export function DatasetSwitcher() {
  const selectorId = useId();
  const { id, datasets } = useDataset();
  const select = useMutation(api.datasets.select);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="space-y-2 px-3">
      <label
        className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        htmlFor={selectorId}
      >
        Dataset
      </label>
      <select
        id={selectorId}
        className="w-full rounded border bg-background p-2 text-sm"
        value={id}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.value as Id<"dataset">;
          if (
            !window.confirm(
              "Switch datasets? Unsaved form changes will be discarded.",
            )
          )
            return;
          setBusy(true);
          setError("");
          try {
            await select({ id: next });
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not switch dataset",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {datasets.map((d) => (
          <option
            key={d._id}
            value={d._id}
            disabled={d.seed_status === "building"}
          >
            {d.name}
            {d.kind === "test" ? " · Test" : ""}
          </option>
        ))}
      </select>
      {datasets.find((d) => d._id === id)?.kind === "test" && (
        <p className="text-xs font-medium text-amber-800">
          Test dataset — separate from Live
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
