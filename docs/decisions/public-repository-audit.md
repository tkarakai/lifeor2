# Pre-publication repository audit

Audit date: 2026-09-17 (America/Chicago).

## Scope and evidence

A fresh mirror of `tkarakai/lifeor2` was fetched with every advertised branch/tag plus pull-request head and merge refs. The snapshot contained `main` at `7308fa5`, `feat/financial-agent-queries` at `0248e1f`, PR #1's head and synthetic merge ref, 12 reachable commits, and 352 unique file blobs (about 4.17 MB). No tags were present.

- Gitleaks 8.30.1 scanned all Git history with full redaction and inline allow comments disabled: zero findings. Gitleaks reports 10 scanned commits; independent Git enumeration includes 12 commits, including the synthetic merge. A separate scan of every reachable blob, including unchanged files, also found zero secrets.
- Historical filenames and blobs were inventoried for environment files, private keys, runtime configuration, databases, exports, archives, logs, documents, and user records. Only sanitized environment examples were tracked; the only binary blobs were Bun lockfiles.
- Text review covered email addresses, external URLs, local paths, authentication material, seed data, migration reports, and fixture provenance. The Morgan family names, addresses, balances, loans, and transactions are explicitly fictional fixtures.
- The existing PR body, issue/review/commit comments, reviews, and commit messages were checked. No credentials or private record payloads were found. There were no Actions runs, artifacts, caches, releases, or deployments. Wiki, Pages, and Discussions were disabled.
- `.env.local`, `.convex/standalone/`, and `.convex/details-content.git` are ignored. No runtime database, backup, export, or separate content repository was found in any historical source tree.

## Personal metadata

Older Git author/committer metadata includes the owner's personal email address. Historical setup documentation includes owner-derived local deployment names and aggregate counts from migration verification. These are personal/operational metadata, not credentials or raw business records. Publication requires the owner's decision on retaining them. Removing them only in a new commit would leave the old versions accessible; complete removal would require history rewriting and handling existing PR refs.

## Limits and prevention

No committed credentials or real business-data payloads were found by these checks; this is not a guarantee against every possible secret format or private fact. The audit covers the fetched refs and accessible GitHub surfaces at this snapshot, not unadvertised server objects or future commits. It does not audit the ignored local databases, which are outside the source repository and must remain private.

The required CI job scans Git history for secrets and validates changes using an empty disposable Convex deployment. Do not pass production credentials or copy saved databases into PR jobs. Re-audit newly added refs and public-facing content before changing visibility.
