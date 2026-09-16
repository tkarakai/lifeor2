"use client";
import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import {
  useQuery as convexQuery,
  useMutation as convexMutation,
} from "convex/react";
import type {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";

type State = { id: Id<"dataset">; datasets: Doc<"dataset">[] };
const Context = createContext<State | null>(null);
export function DatasetProvider({ children }: { children: ReactNode }) {
  const result = convexQuery(api.datasets.list, {});
  const initialize = convexMutation(api.datasets.initialize);
  const [error, setError] = useState("");
  useEffect(() => {
    if (result && !result.activeId)
      void initialize().catch((e) =>
        setError(e instanceof Error ? e.message : "Could not open datasets"),
      );
  }, [result, initialize]);
  if (error)
    return (
      <p role="alert" className="p-8 text-destructive">
        {error}
      </p>
    );
  if (!result?.activeId)
    return (
      <p role="status" className="p-8">
        Opening your datasets…
      </p>
    );
  return (
    <Context.Provider
      value={{ id: result.activeId, datasets: result.datasets }}
    >
      <div key={result.activeId}>{children}</div>
    </Context.Provider>
  );
}
export function useDataset() {
  const state = useContext(Context);
  if (!state) throw new Error("Dataset context is required");
  return state;
}
type Args<F extends FunctionReference<"query" | "mutation">> = Omit<
  FunctionArgs<F>,
  "datasetId"
>;
type CallArgs<F extends FunctionReference<"query" | "mutation">> =
  {} extends Args<F> ? [args?: Args<F>] : [args: Args<F>];
export function useQuery<Q extends FunctionReference<"query">>(
  query: Q,
  ...args: {} extends Args<Q>
    ? [args?: Args<Q> | "skip"]
    : [args: Args<Q> | "skip"]
): FunctionReturnType<Q> | undefined {
  const { id } = useDataset();
  const input = args[0] === "skip" ? "skip" : { ...args[0], datasetId: id };
  return convexQuery(query, input as never);
}
export function useMutation<M extends FunctionReference<"mutation">>(
  mutation: M,
) {
  const { id } = useDataset();
  const invoke = convexMutation(mutation);
  // The closure captures the dataset at render time: a late request from an old
  // form never silently writes to the newly selected dataset.
  return useCallback(
    (...args: CallArgs<M>): Promise<FunctionReturnType<M>> =>
      invoke({ ...args[0], datasetId: id } as FunctionArgs<M>),
    [invoke, id],
  );
}
