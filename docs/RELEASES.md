# Releases

The record of every release, kept here because release tags cannot be pushed from the agent environment (see "Gaps" in `GITFLOW.md`). A release agent adds one row in the same merge that cuts the release. When an agent with the access creates the tags, it creates them from this table: an annotated tag `vX.Y.Z` on the commit listed.

| Version | versionCode | Release commit | Date | On `main` | Tag |
|---|---|---|---|---|---|
| 0.8.0 | 12 | `7122c74` Release 0.8.0: version bump | 2026-11-07 | yes, `main` points here | `v0.8.0` made locally, not pushed |
| 0.7.0 | 11 | `24938e1` Release 0.7.0: version 0.7.0, versionCode 11 | 2026-10-31 | no (before gitflow) | none |
| 0.6.0 | 10 | `145a7d2` Release 0.6.0 (versionCode 10): version files, gate record, screenshots | 2026-10-30 | no (before gitflow) | none |

Versions before 0.6.0 have no release commit in the history. Each release commit above carries the version in its `package.json`.
