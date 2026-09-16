"use client";

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import "@/components/records.css";

export const controlClass =
  "record-control w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const NoticeContext = createContext<(message: string) => void>(() => {});
const SheetContext = createContext<{
  close: () => void;
  saved: () => void;
  busy: (value: boolean) => void;
  dirty: (value: boolean) => void;
} | null>(null);
const CollectionContext = createContext(false);

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <NoticeContext.Provider value={setNotice}>
      <div className="records-workspace">
        <header className="records-header">
          <div className="records-eyebrow">
            <span /> LIFEOR / RECORDS{" "}
            <Link href="/dashboard/insights">
              Open Observatory <ArrowRight size={13} />
            </Link>
          </div>
          <div className="records-heading">
            <div>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            {actions && (
              <div className="records-primary-actions">{actions}</div>
            )}
          </div>
        </header>
        <div className="records-content">{children}</div>
        <div className="records-toast" role="status" aria-live="polite">
          {notice && (
            <>
              <Check size={16} />
              {notice}
            </>
          )}
        </div>
      </div>
    </NoticeContext.Provider>
  );
}

type PanelProps = {
  title: string;
  description?: string;
  category?: string;
  summary?: ReactNode;
  summaryLabel?: string;
  context?: string;
  searchText?: string;
  children: ReactNode;
};
export function Panel({
  title,
  description,
  category,
  summary,
  summaryLabel,
  context,
  children,
}: PanelProps) {
  const collection = useContext(CollectionContext);
  const [open, setOpen] = useState(false);
  if (collection)
    return (
      <>
        <button
          type="button"
          className="record-row"
          onClick={() => setOpen(true)}
          aria-label={`Open ${title}`}
        >
          <span className="record-avatar" aria-hidden="true">
            {title.slice(0, 1).toUpperCase()}
          </span>
          <span className="record-row-name">
            <strong>{title}</strong>
            {description && <span>{description}</span>}
            {context && <span className="record-row-context">{context}</span>}
          </span>
          <span className="record-row-category">
            {category && <span className="record-badge">{category}</span>}
          </span>
          <span className="record-row-summary">
            {summaryLabel && <small>{summaryLabel}</small>}
            {summary}
          </span>
          <ChevronRight size={17} className="record-row-arrow" />
        </button>
        {open && (
          <Sheet
            title={title}
            description={description}
            onClose={() => setOpen(false)}
          >
            <CollectionContext.Provider value={false}>
              <div className="record-inspector">
                {(summary || context) && (
                  <div className="record-overview">
                    <div>
                      {category && (
                        <span className="record-badge">{category}</span>
                      )}
                      {context && <p>{context}</p>}
                    </div>
                    {summary && (
                      <div className="record-overview-value">
                        <small>{summaryLabel ?? "At a glance"}</small>
                        {summary}
                      </div>
                    )}
                  </div>
                )}
                {children}
              </div>
            </CollectionContext.Provider>
          </Sheet>
        )}
      </>
    );
  return (
    <section className="record-section">
      <header>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      <div className="record-section-body">{children}</div>
    </section>
  );
}

export function Collection({
  children,
  label = "records",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("original");
  const [page, setPage] = useState(0);
  const rows = Children.toArray(children).filter(isValidElement<PanelProps>);
  const categories = [
    ...new Set(
      rows.map((row) => row.props.category).filter((v): v is string => !!v),
    ),
  ].sort();
  const filtered = rows.filter(
    ({ props }) =>
      (!category || props.category === category) &&
      [
        props.title,
        props.description,
        props.category,
        props.context,
        props.searchText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  if (sort !== "original")
    filtered.sort(
      (a, b) =>
        a.props.title.localeCompare(b.props.title) * (sort === "az" ? 1 : -1),
    );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pageCount - 1);
  return (
    <section className="record-collection" aria-label={label}>
      <div className="record-toolbar">
        <label className="record-search">
          <Search size={17} />
          <span className="sr-only">Search {label}</span>
          <input
            type="search"
            placeholder={`Search ${label}…`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="record-filters">
          {categories.length > 1 && (
            <label>
              <span>Type</span>
              <select
                aria-label={`Filter ${label} by type`}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All types</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>Sort by</span>
            <select
              aria-label={`Sort ${label}`}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(0);
              }}
            >
              <option value="original">Default order</option>
              <option value="az">Name: A–Z</option>
              <option value="za">Name: Z–A</option>
            </select>
          </label>
        </div>
      </div>
      <div className="record-list-caption">
        <span aria-live="polite">
          {filtered.length}{" "}
          {filtered.length === 1
            ? label.endsWith("ies")
              ? `${label.slice(0, -3)}y`
              : label.replace(/s$/, "")
            : label}
          {filtered.length !== rows.length && ` of ${rows.length}`}
        </span>
        <span>Select a record to view & edit</span>
      </div>
      <CollectionContext.Provider value={true}>
        <div className="record-list">
          {filtered.slice(currentPage * 20, (currentPage + 1) * 20)}
        </div>
      </CollectionContext.Provider>
      {!filtered.length && (
        <div className="record-no-results">
          <Search size={24} />
          <h3>No matching {label}</h3>
          <p>Try another name or clear your filters.</p>
          <Button
            variant="outline"
            onClick={() => {
              setQuery("");
              setCategory("");
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
      {pageCount > 1 && (
        <div className="record-pagination">
          <span>
            {currentPage * 20 + 1}–
            {Math.min((currentPage + 1) * 20, filtered.length)} of{" "}
            {filtered.length}
          </span>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} /> Previous
            </Button>
            <span>
              {currentPage + 1} / {pageCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage + 1 === pageCount}
              onClick={() => setPage(currentPage + 1)}
              aria-label="Next page"
            >
              Next <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function WorkspaceTabs({
  tabs,
}: {
  tabs: { label: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  const id = useId();
  return (
    <div className="record-tabs-workspace">
      <div className="record-tabs" role="tablist" aria-label="Sections">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            id={`${id}-tab-${index}`}
            role="tab"
            aria-selected={active === index}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(e) => {
              const next =
                e.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : e.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? tabs.length - 1
                        : null;
              if (next !== null) {
                e.preventDefault();
                setActive(next);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        key={active}
        role="tabpanel"
        id={`${id}-panel-${active}`}
        aria-labelledby={`${id}-tab-${active}`}
      >
        {tabs[active].content}
      </div>
    </div>
  );
}

function Sheet({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const parent = useContext(SheetContext);
  const notify = useContext(NoticeContext);
  const dirty = useRef(false);
  const pending = useRef(false);
  const close = () => {
    if (pending.current) return;
    if (dirty.current && !window.confirm("Discard your unsaved changes?"))
      return;
    onClose();
  };
  useEffect(() => {
    const dialog = ref.current!;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previous = Array.from(
      document.querySelectorAll<HTMLDialogElement>(".record-sheet[open]"),
    ).at(-1);
    if (previous) {
      previous.inert = true;
      previous.setAttribute("aria-hidden", "true");
    }
    dialog.showModal();
    const preventLeave = (event: BeforeUnloadEvent) => {
      if (dirty.current || pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => {
      dialog.close();
      if (previous) {
        previous.inert = false;
        previous.removeAttribute("aria-hidden");
      }
      if (opener?.isConnected) opener.focus();
      else
        document
          .querySelector<HTMLInputElement>(
            ".records-content .record-search input",
          )
          ?.focus();
      window.removeEventListener("beforeunload", preventLeave);
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="record-sheet records-workspace"
      aria-labelledby={headingId}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
    >
      <SheetContext.Provider
        value={{
          close,
          saved: () => {
            dirty.current = false;
            notify("Changes saved successfully");
            onClose();
          },
          busy: (value) => {
            pending.current = value;
          },
          dirty: (value) => {
            dirty.current = value;
          },
        }}
      >
        <CollectionContext.Provider value={false}>
          <header className="record-sheet-header">
            <button type="button" className="record-back" onClick={close}>
              {parent ? (
                <>
                  <ArrowLeft size={15} /> Back to record
                </>
              ) : (
                <>Records / {title}</>
              )}
            </button>
            <button
              type="button"
              className="record-close"
              onClick={close}
              aria-label={`Close ${title}`}
            >
              <X size={20} />
            </button>
          </header>
          <div className="record-sheet-heading">
            <span className="records-eyebrow">
              {parent ? "RECORD ACTION" : "RECORD WORKSPACE"}
            </span>
            <h2 id={headingId} tabIndex={-1} autoFocus>
              {title}
            </h2>
            {description && <p>{description}</p>}
          </div>
          <div
            className="record-sheet-body"
            onChange={(event) => {
              event.stopPropagation();
              dirty.current = true;
            }}
          >
            {children}
          </div>
        </CollectionContext.Provider>
      </SheetContext.Provider>
    </dialog>,
    document.body,
  );
}
export function useRecordDraft(dirty: boolean, busy: boolean) {
  const sheet = useContext(SheetContext);
  useEffect(() => {
    sheet?.dirty(dirty);
    sheet?.busy(busy);
  }, [dirty, busy, sheet]);
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const control = Children.toArray(children).find(isValidElement) as
    | ReactElement<{
        id?: string;
        required?: boolean;
        "aria-describedby"?: string;
      }>
    | undefined;
  const controlId = control?.props.id ?? id;
  return (
    <div className="record-field">
      <label htmlFor={controlId}>
        {label}
        {control?.props.required && (
          <span className="record-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {control
        ? cloneElement(control, {
            id: controlId,
            "aria-describedby":
              [
                control.props["aria-describedby"],
                hint ? `${id}-hint` : undefined,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
          })
        : children}
      <span id={`${id}-hint`} className="record-field-hint">
        {hint}
      </span>
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="record-form-section" aria-labelledby={id}>
      <header>
        <h3 id={id}>{title}</h3>
        {description && <p>{description}</p>}
      </header>
      <div className="record-form-section-fields">{children}</div>
    </section>
  );
}

export function TextField({
  label,
  name,
  value,
  type = "text",
  required = false,
  hint,
  inputMode,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  required?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className={controlClass}
        name={name}
        defaultValue={value}
        type={type}
        inputMode={inputMode}
        required={required}
      />
    </Field>
  );
}
export function SelectField({
  label,
  name,
  value,
  options,
  required = false,
}: {
  label: string;
  name: string;
  value?: string;
  options: readonly { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        className={controlClass}
        name={name}
        defaultValue={value ?? ""}
        required={required}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function Form({
  children,
  onSave,
  label = "Save",
  onCancel,
}: {
  children: ReactNode;
  onSave: (data: FormData) => Promise<unknown>;
  label?: string;
  onCancel?: () => void;
}) {
  const sheet = useContext(SheetContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const messageId = useId();
  return (
    <form
      className="record-form"
      aria-describedby={messageId}
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest('button[type="button"]') &&
          !target.closest(".record-form-actions")
        )
          sheet?.dirty(true);
      }}
      onChange={() => setSaved(false)}
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const form = event.currentTarget;
        setPending(true);
        sheet?.busy(true);
        setError("");
        setSaved(false);
        try {
          await onSave(new FormData(form));
          setSaved(true);
          sheet?.saved();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not save. Please try again.",
          );
        } finally {
          setPending(false);
          sheet?.busy(false);
        }
      }}
    >
      <fieldset disabled={pending} className="record-form-fields">
        {children}
        <div className="record-form-actions">
          {(onCancel || sheet) && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel ?? sheet?.close}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            <Check size={15} aria-hidden="true" />
            {pending ? "Saving…" : label}
          </Button>
        </div>
      </fieldset>
      <div id={messageId} className="record-form-feedback" aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      </div>
    </form>
  );
}
export function Action({
  children,
  onClick,
  confirm: confirmation,
}: {
  children: ReactNode;
  onClick: () => Promise<unknown>;
  confirm?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="record-action">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          if (confirmation && !window.confirm(confirmation)) return;
          setPending(true);
          setError("");
          try {
            await onClick();
          } catch (error) {
            setError(error instanceof Error ? error.message : "Action failed.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Working…" : children}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="record-loading" role="status">
      <span className="record-loading-dot" /> Loading records…
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="record-empty">
      <FolderOpen size={30} strokeWidth={1.3} />
      <p>{children}</p>
    </div>
  );
}
export function Editor({
  title,
  children,
  inline = false,
  description,
}: {
  title: string;
  children: ReactNode;
  inline?: boolean;
  description?: string;
}) {
  const [opened, setOpened] = useState(false);
  if (inline)
    return (
      <div className="record-inline-editor">
        <header className="record-inline-heading">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </header>
        {children}
      </div>
    );
  const create = /^(New |Add |Record an)/.test(title);
  return (
    <>
      <button
        type="button"
        className={`record-editor-trigger${create ? " record-create" : ""}`}
        onClick={() => setOpened(true)}
      >
        {create ? <Plus size={16} /> : null}
        <span>{title}</span>
        {!create && <ArrowRight size={15} />}
      </button>
      {opened && (
        <Sheet
          title={title}
          description={description}
          onClose={() => setOpened(false)}
        >
          {children}
        </Sheet>
      )}
    </>
  );
}
export function textValue(data: FormData, key: string) {
  return String(data.get(key) ?? "").trim();
}
export function optionalText(data: FormData, key: string) {
  return textValue(data, key) || undefined;
}
export function dateValue(data: FormData, key: string) {
  const value = textValue(data, key);
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Enter a valid date.");
  return timestamp;
}
export function localDateTime(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function dateLabel(timestamp?: number) {
  return timestamp === undefined
    ? "Open-ended"
    : new Date(timestamp).toLocaleDateString();
}
export function options(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }));
}
