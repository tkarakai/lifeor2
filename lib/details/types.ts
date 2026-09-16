export interface DetailsTarget { kind: string; id: string }
export interface DetailsLocator {
  _id: string;
  user_id: string;
  target: DetailsTarget;
  repository_key: string;
  path: string;
}
export interface DocumentRead {
  availability: "available" | "missing";
  commit: string | null;
  source: string | null;
}
export interface DocumentRevision { commit: string; date: string; message: string }
export class DetailsError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export function documentPath(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new DetailsError("invalid_id", "Invalid document ID.");
  return `details/${id}.md`;
}
export function validateCommit(commit: string): string {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new DetailsError("invalid_revision", "Use a full Git commit ID.");
  return commit;
}
