"use client";

import { useEffect, useId, useState, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { useQuery } from "@/lib/dataset";
import { useDataset } from "@/lib/dataset";
import { useRecordDraft } from "./record-ui";
import { Button } from "./ui/button";
import { MarkdownDetails } from "./markdown-details";
import { parseDetails } from "../lib/details/frontmatter";
import type {
  DetailsTarget,
  DocumentRead,
  DocumentRevision,
} from "../lib/details/types";

export interface DetailsEditorProps {
  target: DetailsTarget;
  title?: string;
  className?: string;
  readOnly?: boolean;
  onSaved?: (result: { documentId: string; commit: string }) => void;
}
type Snapshot = DocumentRead & {
  documentId: string | null;
  warning?: string | null;
  cache?: string;
};
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Details could not be loaded.");
  return result as T;
}
export function DetailsEditor(props: DetailsEditorProps) {
  // Target changes cannot accidentally save the previous object's text to another object.
  return <Editor key={`${props.target.kind}:${props.target.id}`} {...props} />;
}
function Editor({
  target,
  title = "Details",
  className = "",
  readOnly = false,
  onSaved,
}: DetailsEditorProps) {
  const { id: datasetId } = useDataset();
  function datasetRequest<T>(url: string, init?: RequestInit) {
    return request<T>(url, {
      ...init,
      headers: { ...init?.headers, "x-lifeor-dataset": datasetId },
    });
  }
  const locator = useQuery(api.details.forTarget, { target: target as never });
  const seenCommit = useRef<string | null | undefined>(undefined);
  const labelId = useId();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"write" | "preview" | "history">(
    readOnly ? "preview" : "write",
  );
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [revisions, setRevisions] = useState<DocumentRevision[]>([]);
  const [pinned, setPinned] = useState<Snapshot | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const dirty = !!snapshot && draft !== (snapshot.source ?? "");
  useRecordDraft(dirty, busy);
  const diagnostic = parseDetails(draft).diagnostic;
  const documentId = snapshot?.documentId;

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ kind: target.kind, id: target.id });
    datasetRequest<Snapshot>(`/api/details?${params}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        setSnapshot(value);
        setDraft(value.source ?? "");
        setNotice(
          value.cache === "pending"
            ? "The document is committed in Git; its database cache will retry on the next read."
            : null,
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Details could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [target.kind, target.id, datasetId, reload]);
  useEffect(() => {
    const remote = locator?.observed_commit;
    if (!snapshot || !remote || remote === snapshot.commit || remote === seenCommit.current || busy) return;
    if (dirty) {
      setNotice("This document changed elsewhere. Your draft is preserved; copy it before reloading or resolve the conflict when saving.");
      return;
    }
    seenCommit.current = remote;
    setPinned(null);
    setDiff(null);
    setRevisions([]);
    setReload(value => value + 1);
  }, [locator?.observed_commit, snapshot, dirty, busy]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const value = await datasetRequest<Snapshot>(
        documentId
          ? `/api/details/${encodeURIComponent(documentId)}`
          : "/api/details",
        {
          method: documentId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            source: draft,
            expectedCommit: snapshot.commit,
          }),
        },
      );
      setSnapshot(value);
      setNotice(value.warning ?? "Saved to Git.");
      setRevisions([]);
      setPinned(null);
      setDiff(null);
      if (value.documentId && value.commit)
        onSaved?.({ documentId: value.documentId, commit: value.commit });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Save failed. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function history() {
    setTab("history");
    setPinned(null);
    setDiff(null);
    if (!documentId) return;
    setBusy(true);
    setError(null);
    try {
      const value = await datasetRequest<{ revisions: DocumentRevision[] }>(
        `/api/details/${encodeURIComponent(documentId)}/history`,
      );
      setRevisions(value.revisions);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "History could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function inspect(revision: DocumentRevision, index: number) {
    if (!documentId) return;
    setBusy(true);
    setError(null);
    setPinned(null);
    setDiff(null);
    try {
      const root = `/api/details/${encodeURIComponent(documentId)}`;
      const value = await datasetRequest<Snapshot>(
        `${root}/revisions/${revision.commit}`,
      );
      setPinned(value);
      const previous = revisions[index + 1];
      if (previous) {
        const result = await datasetRequest<{ diff: string }>(
          `${root}/diff?${new URLSearchParams({ from: previous.commit, to: revision.commit })}`,
        );
        setDiff(result.diff);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Revision could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-labelledby={labelId}
      className={`record-document ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b py-4">
        <div>
          <h3 id={labelId} className="font-semibold tracking-tight">
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Markdown notes · saved separately from record fields
          </p>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {dirty
            ? "Unsaved changes"
            : snapshot?.availability === "available"
              ? `Git ${snapshot.commit?.slice(0, 8)}`
              : "No committed document"}
        </span>
      </header>
      <div
        className="flex flex-wrap items-center gap-1 border-b py-2"
        aria-label="Details views"
      >
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            variant={tab === "write" ? "secondary" : "ghost"}
            aria-pressed={tab === "write"}
            onClick={() => setTab("write")}
          >
            Write
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant={tab === "preview" ? "secondary" : "ghost"}
          aria-pressed={tab === "preview"}
          onClick={() => setTab("preview")}
        >
          Preview
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === "history" ? "secondary" : "ghost"}
          aria-pressed={tab === "history"}
          disabled={busy}
          onClick={history}
        >
          History
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={busy || dirty}
          onClick={() => {
            setPinned(null);
            setDiff(null);
            setReload((value) => value + 1);
          }}
        >
          Reload current
        </Button>
      </div>
      <div className="space-y-3 py-5" aria-busy={busy}>
        {busy && (
          <p role="status" className="text-xs text-muted-foreground">
            Working…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
          >
            {error}
            {dirty &&
              " Your draft is preserved below. Copy it before discarding or leaving this record."}
          </p>
        )}
        {notice && (
          <p role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        {tab === "write" && (
          <>
            <label htmlFor={`${labelId}-source`} className="sr-only">
              Markdown source
            </label>
            <textarea
              id={`${labelId}-source`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!snapshot || busy}
              spellCheck
              className="min-h-64 w-full resize-y rounded-md border bg-background p-4 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              placeholder="# Notes\n\nWrite details for this record…"
            />
            {diagnostic && (
              <p
                role="status"
                className="text-xs text-amber-700 dark:text-amber-400"
              >
                {diagnostic} You can still save the exact source.
              </p>
            )}
          </>
        )}
        {tab === "preview" &&
          (snapshot?.availability === "missing" && !draft ? (
            <p className="text-sm text-muted-foreground">
              No document has been committed for this record.
            </p>
          ) : (
            <MarkdownDetails source={draft} />
          ))}
        {tab === "history" && (
          <>
            {!revisions.length && !busy && (
              <p className="text-sm text-muted-foreground">
                No committed revisions.
              </p>
            )}
            <ol className="space-y-1">
              {revisions.map((revision, index) => (
                <li key={revision.commit}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => inspect(revision, index)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <code>{revision.commit.slice(0, 8)}</code>
                    <time
                      dateTime={revision.date}
                      className="text-muted-foreground"
                    >
                      {new Date(revision.date).toLocaleString()}
                    </time>
                    <span>{revision.message}</span>
                  </button>
                </li>
              ))}
            </ol>
            {pinned && (
              <div className="space-y-4 border-t pt-4">
                <p className="break-all font-mono text-xs text-muted-foreground">
                  Pinned revision {pinned.commit}
                </p>
                {pinned.source === null ? (
                  <p>Document missing at this revision.</p>
                ) : (
                  <MarkdownDetails source={pinned.source} />
                )}
                {diff !== null && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">
                      Changes from previous revision
                    </summary>
                    <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
                      {diff || "No changes."}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {!readOnly && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
          <p className="text-xs text-muted-foreground">
            Front matter is descriptive. It does not change typed fields.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                setDraft(snapshot?.source ?? "");
                setNotice(null);
              }}
            >
              Discard draft
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                !snapshot ||
                busy ||
                (!dirty && snapshot.availability === "available")
              }
              onClick={save}
            >
              {busy ? "Working…" : "Save details"}
            </Button>
          </div>
        </footer>
      )}
    </section>
  );
}
