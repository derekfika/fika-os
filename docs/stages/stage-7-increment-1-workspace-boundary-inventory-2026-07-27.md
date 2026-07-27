# Stage 7 Increment 1 Workspace and Repository Boundary Inventory — 2026-07-27

## Safety and evidence boundary

This is a redacted, read-only inventory of `C:\FIKA`. It records paths and categories without copying credentials, private content or live operational records. No repository, application, file or history was moved, imported, cleaned or rewritten.

## Verified Git boundaries

| Git root | Remote identity | Branch/HEAD at review start | State | Role |
|---|---|---|---|---|
| `C:\FIKA` | GitHub `derekfika/fika-os` | `design/fika-impact-visual-refactor` at `7ffb7bf` | Dirty with unrelated application/tool changes and untracked assets/backups | Existing FIKA OS implementation/operational-workspace repository |
| `C:\FIKA\fika-platform-specs` | GitHub `derekfika/fika-platform-specs` | `main` at `4c94e78`; ahead 19, behind 1 relative to configured upstream | Clean | Governed FIKA OS specification repository |

The outer repository records `fika-platform-specs` as gitlink mode `160000` at historical commit `ad58261`; no `.gitmodules` file exists. The nested repository retains independent history. This review does not repair, flatten or reinterpret that relationship.

No other `.git` directory or Git-file worktree boundary was found beneath `C:\FIKA`. `.git-backup` is untracked backup material, not an active Git root.

## Workspace classification

| Current location | Classification | Git/history | Increment 1 recommendation | Risk and authority |
|---|---|---|---|---|
| `C:\FIKA\fika-platform-specs` | Governed specification/governance content; nested independent repository | Independent history | Keep independent; commit readiness records here | Never absorb or flatten without explicit structural authority |
| `C:\FIKA\shared\cpu-dashboard` | Stable legacy operational application | Tracked by outer FIKA OS repository; clean at review | Preserve in place; read-only reference only | No import, modification, Apps Script execution or deployment |
| `C:\FIKA\sites` | Stable operational applications plus separately developed FIKA Impact material | Tracked; several unrelated working changes | Exclude from Increment 1 | Live/independent lifecycle and dirty-worktree risk |
| `C:\FIKA\shared` excluding CPU Dashboard | Stable shared operational applications | Tracked | Exclude | Relevance does not imply migration |
| `C:\FIKA\tools\release-manager` | Existing shared/local tooling | Tracked with unrelated changes | Preserve; do not reuse automatically | Different responsibility and current user changes |
| proposed `C:\FIKA\tools\cpu-shadow-reconciliation` | Candidate Increment 1 implementation content | Does not exist | Add later in a clean worktree after readiness | Exact target path; no legacy source copied |
| `C:\FIKA\assets` | Shared brand/reference assets | Mixed tracked/untracked | Exclude | Not required by offline CLI; some unrelated/out-of-scope content |
| `C:\FIKA\archives`, `C:\FIKA\Backups`, `.git-backup` | Archive/backup/duplicate material | Mixed tracked/untracked | Exclude and preserve | Never bulk-import or delete; retention requires separate authority |
| `.codex-staging` | Historical/generated governance staging | Already tracked by outer repository | No new Increment 1 content | Generated/history characteristics; do not treat as source |
| `.artifact-work`, `.npm-cache`, `node_modules`, `tmp` | Generated/dependency/cache/runtime content | Ignored/untracked | Exclude | Reproducible or machine-local |
| `.agents`, `.codex` | Local tooling state; empty at review | Untracked | Exclude | No repository instruction content found |
| root `.bat` files | Stable deployment/release shortcuts | Tracked | Preserve unchanged | Can affect live Apps Script workflows; outside Increment 1 |
| outer `.gitignore` | Protective repository metadata | Tracked | Retain; consider narrow later additions | Current dirty worktree prevents unrelated metadata commit here |
| `.clasp.json` files | Machine/project linkage configuration | Present but ignored by outer rules | Exclude | May expose project linkage; never needed by offline task |
| `appsscript.json`, `.claspignore` | Legacy source/deployment manifests | Tracked with applications | Preserve with legacy apps | Not Increment 1 configuration |
| synthetic fixtures under proposed tool | Sanitised test data | Future tracked content | Include only after contract validation | Must contain no real records or provider IDs |
| raw Calendar/Sheet/Drive exports or attachments | Live/derived operational data | None authorised for inclusion | Forbidden | Requires separate extraction, sanitisation and access authority |

## Git inclusion recommendation

Later include only:

- `tools/cpu-shadow-reconciliation/` source, technical snapshot contract, synthetic fixtures and tests;
- package-local manifest and lockfile;
- placeholder-only example configuration; and
- generated evidence only when explicitly designated, sanitised and reproducible or intentionally retained as review evidence.

Do not include legacy CPU source copies, `.clasp.json`, raw exports, attachments, credentials, live configuration, caches, dependency directories, build/coverage output, operational logs, database/emulator state, backups or unrelated assets.

## History preservation

- Outer FIKA OS history remains authoritative for operational applications and future Increment 1 code.
- Specification history remains independent.
- The CPU Dashboard stays at `shared/cpu-dashboard`; later code may cite a source commit but may not copy or refactor it in the first task.
- Use a new `codex/` branch and clean worktree for repository preparation; never clean or overwrite the current dirty outer worktree.
- Resolving the historical gitlink-without-`.gitmodules` relationship is separate structural governance, not an Increment 1 prerequisite.

## Sensitive-content review

Filename/category inspection found no `.env`, OAuth client-secret, service-account, private-key, certificate or Calendar-export file in the audited source set. One ignored local database/cache artefact exists under FIKA Impact tooling and is unrelated. Operational-export-like filenames, archives, attachments, logs and generated build content exist and remain excluded by category.

A tracked secret-pattern scan produced one candidate in the Workforce application. Structural inspection found a reference rather than a literal credential assignment; no secret value was printed. No active tracked-secret exposure was established by this review.

The outer `.gitignore` already excludes dependencies, builds, coverage, caches, `.env*` except examples, logs, temporary folders, editor state, Python environments, Firebase state, `.clasp.json`, common credential files, archives and local artefacts. It does not ignore `.git-backup/` or `Backups/`; add those only in a separate outer-repository protective metadata commit after confirming retention expectations. Already tracked `.codex-staging` content is unaffected by ignore rules.

No `.gitattributes` exists in the outer repository. None is required before the offline first task; line-ending or generated-file policy can be added later with evidence.

## Remote and worktree safety

Remote URLs were inspected without embedded credentials. The outer worktree's unrelated changes include Hospitality applications, FIKA Impact assets and release-manager files. They remain untouched. The specifications worktree was clean at the start of this review.

## References

- [Primary readiness review](stage-7-increment-1-before-first-code-review-2026-07-27.md)
- [Increment 1 charter](stage-7-increment-1-shadow-cpu-production-charter.md)
- [Application inventory](../../inventory/applications.md)
- [CPU audit](../../inventory/reports/cpu-production-dashboard.md)
