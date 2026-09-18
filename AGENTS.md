# Repository workflow

Read `CONTRIBUTING.md` before committing, pushing, or opening a PR.

- Work on a feature branch and submit changes through a PR targeting `main`; never push directly to `main`.
- Run checks appropriate to the change, report remaining validation honestly, and wait for **LifeOR2 validation** before merging.
- Do not merge a PR unless the user authorizes merging. Squash and rebase merges are allowed; review outstanding conversations before merging.
- Administrators can bypass protection, matching `lifeor2-client`. Do not use that bypass unless the user explicitly requests it.
- Never commit credentials, database snapshots, exports, or the separate Git content repository. Keep tests and CI independent of real user data.
