"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const controlClass =
  "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
export function Page({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">{description}</p>
      </header>
      {children}
    </div>
  );
}
export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
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
  return (
    <label className="block min-w-0 space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
      {hint && (
        <span className="block text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}
export function TextField({
  label,
  name,
  value,
  type = "text",
  required = false,
  hint,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const messageId = useId();
  return (
    <form
      className="space-y-4"
      aria-describedby={messageId}
      onChange={() => setSaved(false)}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setPending(true);
        setError("");
        setSaved(false);
        try {
          await onSave(new FormData(form));
          setSaved(true);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not save. Please try again.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        {children}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : label}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </fieldset>
      <div id={messageId} aria-live="polite">
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
    <div>
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
    <p role="status" className="py-8 text-muted-foreground">
      Loading records…
    </p>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      {children}
    </p>
  );
}
export function Editor({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="rounded-lg border p-4"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">
        {title}
      </summary>
      {opened && <div className="mt-4 space-y-4">{children}</div>}
    </details>
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
