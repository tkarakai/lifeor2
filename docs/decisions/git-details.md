# Git-owned details: implementation and operating decisions

Implemented 2026-09-16 against redesign-spec sections 3 and 9. Git is the sole source of Markdown bytes and revision history. Convex stores only an owned stable locator and disposable availability/commit cache. This worker did not modify or initialize the live content repository, stage files, install dependencies, or create application commits.

## Component contract

```tsx
import { DetailsEditor } from "@/components/details-editor";

<DetailsEditor
  target={{ kind: "entity", id: entity._id }}
  title="Details"
  onSaved={({ documentId, commit }) => { /* optional */ }}
/>
```

`target` is `{kind: string, id: string}` at the component boundary; Next explicitly allowlists the backend's typed target kinds, and Convex validates the ID's table, existence, and ownership. Optional props are `title`, `className`, `readOnly`, and `onSaved`. No eager locator allocation occurs on opening a record: allocation occurs on the first save, including an intentional empty-document save. Object fields and details are separate saves.

The editor provides source, safe preview, the latest 100 path-scoped revisions, pinned revision reads, and diffs against the preceding listed document revision. It retains drafts on errors, reports commit/cache state separately, and warns on browser unload with unsaved changes. Target changes remount editor state so one object's text cannot be saved to another. Internal app navigation still belongs to the containing page; no application-wide draft persistence or navigation interception is claimed. A stale-document error asks the user to retain a copy of the draft before discarding/reloading; there is no merge interface.

`MarkdownDetails` takes `source` and optional `className`. Supported preview syntax is headings, paragraphs, unordered lists, blockquotes, fenced code, inline code, bold, and safe links. Raw HTML, scripts, MDX, images, executable YAML, arbitrary components, and Markdown extensions do not execute; React escapes source text. Link destinations allow HTTP(S), mailto, root-relative paths, and simple fragments only. This intentionally small renderer adds no dependencies and is not a full CommonMark implementation.

## Repository configuration

| Environment | Default | Meaning |
| --- | --- | --- |
| `DETAILS_REPOSITORY_PATH` | `.convex/details-content.git` | Separate local bare Git repository; default is already gitignored. |
| `DETAILS_REPOSITORY_KEY` | `local` | Stable key stored in locators; must match when reading/writing. |
| `DETAILS_GIT_BRANCH` | `main` | Fixed configured content branch; simple alphanumeric/underscore/hyphen name. |
| `DETAILS_GIT_AUTHOR_NAME` | `LifeOR Details` | Explicit local commit author and committer. |
| `DETAILS_GIT_AUTHOR_EMAIL` | `details@localhost` | Explicit local author/committer email. |

The host must have Git and a persistent writable filesystem. This is a local single-writer service, not an ephemeral/serverless or multi-host shared-storage design. No remote repository is required or contacted. The adapter never initializes repositories, modifies global Git config, or accepts client repository locations, branches, paths, authors, or commit messages.

Coordinator setup command (not run by this worker):

```sh
git init --bare --initial-branch=main .convex/details-content.git
```

A **bare repository** avoids a stale checked-out worktree while the application updates objects and the branch ref directly. A normal source checkout is rejected. Future manual editing can use a local clone of this bare repository while the app writer is stopped; changes become current only when pushed back to the configured branch. Coordinate those changes explicitly, do not force-push, and restart the app afterward. Manual clone/worktree workflows and remote synchronization are outside this phase's UI.

## Server and HTTP contracts

All handlers use Next's Node runtime and no-store responses. Better Auth's existing installed `convexBetterAuthNextJs` integration supplies authenticated query/mutation helpers locally in `lib/details/server.ts`; `lib/auth-server.ts` is unchanged. Before **any Git read/write**, the service queries the authenticated user and resolves a Convex-owned locator (or validates the typed target through `details.forTarget/ensure`). A second owner check, exact repository key check, and exact deterministic `details/<document-id>.md` path check occur in the service. The Git adapter is an internal server capability, never a public unauthenticated route.

| Route | Request | Result |
| --- | --- | --- |
| `GET /api/details?kind=entity&id=ID` | Owned typed target | Current document, or missing/unallocated. No allocation. |
| `POST /api/details` | `{target,source,expectedCommit}` | Allocate owned locator if needed, commit, then observe cache. |
| `GET /api/details/:id` | Owned document ID | Current committed document. |
| `PUT /api/details/:id` | `{source,expectedCommit}` | Commit an existing owned document. |
| `GET /api/details/:id/history` | Owned document ID | `{revisions:[{commit,date,message}]}` newest first, up to 100. |
| `GET /api/details/:id/diff?from=SHA&to=SHA` | Two full immutable commits | `{from,to,diff}` restricted to the locator path. |
| `GET /api/details/:id/revisions/:commit` | Full immutable commit | Pinned read; does not overwrite current cache. |

Reads distinguish `{availability:"missing",source:null}` from `{availability:"available",source:""}`. An unborn branch has `commit:null`; a missing file on an existing branch retains that branch's commit. Unreadable repositories return an error, never an empty document. Unallocated target reads return no document ID and do not need Git access. Returned parsed metadata is presentation-only and never writes typed backend fields.

`expectedCommit` is required on writes and is either a full SHA or `null` for an unallocated/missing initial state. Changed same-document content rejects with 409; unrelated documents changing repository HEAD do not prevent a save. Exact source retries are idempotent. Pins must be full 40- or 64-character lowercase hashes naming commits reachable from the configured branch. Arbitrary Git revisions such as `HEAD`, paths, and options are rejected. Save bodies require JSON, have bounded encoded/decoded sizes, and reject browser cross-origin requests. Document size is limited to 1 MiB UTF-8; invalid Unicode/UTF-8 is rejected rather than silently normalized. UTF-8 BOM, Unicode, CRLF, missing terminal newline, and malformed front matter are preserved.

The API exposes coarse 401/403/404/409/413/415/503 failures without raw Git stderr or filesystem paths. A committed save with failed `details.observe` returns success plus `cache:"pending"` and an explicit warning. Normal current reads retry observation, rebuilding the disposable cache. A pinned read never changes current observed commit. Backend `observe` needs optional `commit` for missing/unreadable states with no known revision; this was requested from the coordinator after detecting the initial mandatory-string implementation.

## Commit and failure recovery

Writes use safe argv through `spawn`, never shell interpolation. Git-related inherited environment overrides are stripped; author/committer are supplied explicitly; global/system configuration, hooks, filesystem monitors, replacement objects, signing, external diffs, and text conversion are disabled for these operations.

1. Validate repository and acquire `lifeor-details-writer.lock` exclusively in its root. Lock records PID/start time. Other writers fail with 409 and retain their draft.
2. Read committed state and check the caller's base. Create a private temporary index outside the repository.
3. Hash exact source, update only the fixed document path in that index, write the tree, and create a commit with the actual current commit time.
4. Atomically update only the configured branch ref with its expected prior SHA.
5. Remove temporary index and writer lock, then observe the commit in Convex.

A failed index/tree/commit/ref operation leaves the original branch and ordinary repository index untouched; temporary files and lock are removed on ordinary errors. Unreachable Git objects from a failed operation are harmless and can be collected by normal Git maintenance. If the ref-update response is lost, re-read the branch: only an exact match to the newly created commit confirms success. An unconfirmed outcome is an error; the UI retains the draft. Retrying exact content discovers an already committed save without making duplicate history.

After a process crash, an existing writer lock intentionally blocks automatic writes. Stop/verify the prior writer is no longer running, inspect the configured branch's committed document/history, then remove only `lifeor-details-writer.lock` and retry the retained draft. Do not delete Git locks or reset the repository automatically. Temporary `lifeor-details-*` directories under the OS temp directory from a crashed process may be removed after the process has exited. No timeout-based automatic stale-lock theft or merge recovery is attempted.

## Front matter and migration

`parseDetails` recognizes an optional leading `---` delimited top-level scalar mapping. Keys use a simple ASCII identifier grammar; values support finite/safe numbers, booleans, null, quoted strings, or restricted plain strings. Nested maps/lists, duplicate or prototype keys, tags, anchors, block scalars, unsupported syntax, and malformed quotes produce diagnostics. Malformed input retains the entire original source as its body; render/save never silently strips or repairs it. Metadata is descriptive and cannot override identity, ownership, money, dates, or relationships. Editing raw source is always available.

Legacy Property export/conversion and UI-page migration are owned by the coordinator/backend/UI workers. This subsystem supplies the authenticated commit path and reusable editor, and does not reclassify or collapse historical Property rows. A migration must allocate locators through the owner-validated backend, commit complete historical source at the real migration time, preserve old IDs/owners/effective and recorded dates/conflicts, and retain read-only legacy records until verified. No live data migration was performed by this worker.

## Files and verification

Added:

- `lib/details/types.ts`, `frontmatter.ts`, `git.ts`, `service.ts`, `server.ts`.
- `app/api/details/route.ts`, `[id]/route.ts`, `[id]/history/route.ts`, `[id]/diff/route.ts`, `[id]/revisions/[commit]/route.ts`.
- `components/details-editor.tsx`, `components/markdown-details.tsx`.
- `tests/details.test.ts`, `tests/details-frontmatter.test.ts`, `tests/details-http.test.ts`.
- This decision/report file.

Commands and results:

- `bunx vitest run tests/details.test.ts tests/details-frontmatter.test.ts tests/details-http.test.ts`: **28 tests passed in 3 files**. Uses newly created temporary bare repositories, removed after each test. Covers unborn repository, missing versus empty, exact malformed/CRLF source, pinned history/diff, two-document isolation, unrelated HEAD changes, stale-save rejection, idempotence, explicit author, injected index/commit/ref failures, lost-ref-response reconciliation, unchanged ordinary index, writer locks, safe paths, repository configuration, authorization-before-Git for all service operations, cross-owner/forged-locator rejection, Git/DB cache recovery, lazy locator allocation, front-matter safety, escaped rendering, HTTP target/body/CSRF/size/error handling.
- `bun run typecheck`: details files pass; full project still had in-flight finance/UI/generated-API errors in the shared checkout at the check time. This is not reported as a globally passing typecheck.
- `bunx eslint lib/details app/api/details components/details-editor.tsx components/markdown-details.tsx tests/details.test.ts tests/details-frontmatter.test.ts tests/details-http.test.ts`: could not run because the repository has no ESLint 9 `eslint.config.*`. No package/config edits were made to hide this.

No authenticated browser end-to-end run is claimed by this worker. Coordinator should verify deployed Convex functions, authenticated editor integration, and the live environment after the other workers settle.
