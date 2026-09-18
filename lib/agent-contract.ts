import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const AGENT_SCOPES = ["data:read", "data:write", "finance:write", "data:delete", "datasets:manage"] as const;
export const AGENT_SCOPE_LABELS: Record<string, string> = { "data:read": "Read records", "data:write": "Edit records", "finance:write": "Change financial records", "data:delete": "Permanently delete", "datasets:manage": "Manage datasets" };
export type AgentScope = typeof AGENT_SCOPES[number];
export type AgentPolicy = { operation: string; scope: AgentScope; revision?: boolean };
export function digest(value: string) { return bytesToHex(sha256(new TextEncoder().encode(value))); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
