# Contributing

Use a feature branch and a pull request targeting `main` for every change, including documentation and dependency updates. Do not push directly to `main`.

```sh
git fetch origin
git switch -c feat/my-change origin/main
# Make and commit changes.
git push -u origin HEAD
gh pr create --base main
```

Describe the problem, behavior changes, validation, and deployment steps in the PR. Draft PRs are welcome; CI runs on drafts too. Review outstanding conversations, update the branch if `main` changes, and wait for **LifeOR2 validation** to pass before squash- or rebase-merging. Merge commits are disabled. Auto-merge is available but must be enabled for each PR deliberately. Delete merged feature branches manually when no longer needed.

Like `lifeor2-client`, PRs require zero general approvals, with code-owner review enabled in the ruleset. There is currently no `CODEOWNERS` file, so no ownership-based review requests are generated. Existing approvals are not dismissed on new pushes, and unresolved conversations do not block merges. The ruleset requests Copilot review for new non-draft PRs without re-review on every push; actual execution depends on Copilot availability.

## Checks

`.github/workflows/ci-lifeor.yml` runs on every PR to `main`, pushes to `main`, and manual dispatches. Its stable required check name is **LifeOR2 validation**. It scans Git history with Gitleaks, installs locked dependencies, generates Convex bindings using a new anonymous local deployment, runs Python lifecycle/export tests, TypeScript checks, Vitest tests, the MCP catalog check when present, a production build, and the record-workspace Chromium checks.

The job receives no production credentials or real user data. Live authentication, MCP integration, and migration acceptance against a saved deployment remain operator-run checks. Do not upload local backend state or environment files as CI artifacts.

With a configured development environment, run the relevant checks locally:

```sh
bun run test:local
bun run typecheck
bun run test -- --maxWorkers=1 --testTimeout=30000
bun run build
# With the development frontend running and Chromium installed:
bun run test:ui
```

## Main protection

The checked-in settings mirror the live `lifeor2-client` configuration captured on 2026-09-17. Both classic branch protection and the active `rule01` ruleset apply. The ruleset binds **LifeOR2 validation** to the GitHub Actions app.

- `.github/repository-settings.json`: squash/rebase merges, auto-merge availability, manual branch deletion, and squash commit defaults.
- `.github/main-protection.json`: classic `main` protection.
- `.github/main-ruleset.json`: linear history, PR/code-owner review, Copilot review, required checks, and administrator bypass for the default branch.

Normal contributions require an up-to-date branch, a PR, passing validation, and linear history. Force pushes and default-branch deletion are blocked. Administrators can bypass protection, matching the client; use the normal PR process unless the user explicitly requests a bypass.

To reapply the settings:

```sh
gh api --method PATCH repos/tkarakai/lifeor2 --input .github/repository-settings.json
gh api --method PUT repos/tkarakai/lifeor2/branches/main/protection --input .github/main-protection.json
ruleset_id=$(gh api repos/tkarakai/lifeor2/rulesets --jq '.[] | select(.name == "rule01" and .source == "tkarakai/lifeor2") | .id')
if [ -n "$ruleset_id" ]; then
  gh api --method PUT "repos/tkarakai/lifeor2/rulesets/$ruleset_id" --input .github/main-ruleset.json
else
  gh api --method POST repos/tkarakai/lifeor2/rulesets --input .github/main-ruleset.json
fi
```

## Private runtime data

Keep `.env.local`, `.convex/`, database exports, backups, and the separate details-content Git repository out of application Git. Only fictional fixtures and sanitized environment examples belong in source control. Before changing repository visibility, audit all branches, tags, PR refs, historical blobs, and public-facing discussion/Actions artifacts; deleting a sensitive file in a new commit does not remove its history.
