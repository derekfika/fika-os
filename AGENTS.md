# FIKA OS — Agent operating guide

Applies repository-wide. Read the nearest app guide before working there; nested guides add context without weakening global safety rules. Inspect current code and tests: old reports/READMEs are evidence, not proof of current architecture. Report disagreements rather than silently choosing a convenient source.

## Solo-owner workflow

- Canonical integration checkout: `C:\Fika\fika-os`; source authority: `origin/main`. Fetch and record its SHA before every task. Never create another clone, rewrite main, force-push or discard another task's work.
- Use a governed isolated workspace: `npm run fika -- workspace create <task> --owner <agent-task> --scope <paths>`. Work only in your leased scope. Keep dependencies, build output, environment files and test state separate; use allocated ports with `fika dev`.
- Default to one implementation thread; parallel work needs disjoint ownership (normally at most two writers). Stabilise shared providers before dependent consumers. Do not edit another workspace or clean up ambiguous worktrees, stashes, recovery archives or preservation/rollback refs. Retire only your own workspace through the governed command; never delete unique ignored files.
- Commit/push validated task branches, not main. Integrate through merge-commit PRs with exact-source `Workflow / merge-gate` CI. Zero independent human approvals are required; owner integration authority and explicit stop-before-merge instructions still apply. No protection bypasses, unfinished feature absorption or automatic branch deletion.
- Deploy only when requested, using `fika deploy <app> --staging|--prod` (dry-run by default). Staging execution requires authenticated repository-write authority, exact-source CI and PR provenance. Production additionally needs an explicit owner release instruction recorded with `--owner-approved --reason`; a coding request never implies deployment approval.
- Deployment Dashboard status and migration criteria are in [the dashboard deployment note](docs/deployment/deployment-dashboard.md). Until its actual runner, exact-source safeguards and serving-version verification are present and verified, the governed `fika deploy` CLI remains the supported deployment interface. Do not substitute ad hoc Firebase CLI rollout commands or treat a dashboard prototype/local history record as a verified deployment.
- Dashboard agent assignments, when available, are informational only and do not grant deployment permission or block deployments. Do not add dashboard-specific locks, deployment leases or mutexes; the existing governed workspace workflow for source changes remains in force.
- Pin the validated source and selected backend. Production must preserve deployed lineage and be integrated into main. The complete serving-to-candidate delta sets the lane: cosmetic Fast Track after owner approval; operational/data-sensitive/shared changes require verified staging of the same app/dependency tree. No flag bypasses these safeguards.
- Keep automatic Firebase rollouts disabled. The twelve release branches are append-only ledgers, never deployable source. Use verified rollback records and matching recovery journals; active/unknown attempts stay pending and must not be blindly resubmitted or abandoned. Local authorised deployment does not depend on optional hosted WIF.
- Read the [operator guide](docs/deployment/workflow.md) before workspace lifecycle, integration or release operations. Report submitted versus verified live releases accurately; release approval does not authorise migrations, emails or operational test writes.

## Read only what the task needs

Codex uses root and scoped AGENTS.md. Claude's CLAUDE.md files import those same files; keep wrappers import-only, never duplicate policy. When starting at the root, explicitly read each affected app guide before editing. Preserve generated Next.js blocks in any existing AGENTS.md.

| Task | Required context beyond this root |
| --- | --- |
| UI, including a one-button change | Affected app guide + [Style Guide](docs/STYLE-GUIDE.md); relevant UI/API/test path |
| Domain, persistence, quantities, auth, dates or shared contracts | App/provider and consumer guides + [detailed rules §§3–6, 8–9](docs/ai/agent-reference.md); follow applicable safety/testing requirements |
| Packages, projections or caches | [Detailed rules §§5.1–5.4, 6.1, 8.1](docs/ai/agent-reference.md) before changing a store/consumer |
| Meaningful business mutations | [Logging/audit strategy](docs/ai/LOGGING-AUDIT-STRATEGY.md) and applicable detailed persistence rules |
| Performance/read-path changes | [Cost guardrails](COST-EFFICIENCY.md) + detailed §6; measure action → authoritative write → projection → UI |
| Staging diagnosis / deployment | Operator guide + [provenance and deployment rules §10](docs/ai/agent-reference.md); verify the served SHA before diagnosing source |
| Formal codebase audit | [Audit protocol](docs/ai/CODEBASE-AUDIT-PROTOCOL.md) + logging/audit strategy; read-only unless scope explicitly changes |

App guides: [Hub](apps/integration-hub/AGENTS.md), [Hospitality](apps/hospitality-booking/AGENTS.md), [Menu Planning](apps/menu-planning/AGENTS.md), [CPU](apps/cpu-production/AGENTS.md), [Delivered-In](apps/delivered-in/AGENTS.md), [Logistics](apps/logistics/AGENTS.md). Load every affected provider/consumer for a cross-app change.

## Coding and UI quality

- Inspect the relevant UI, API, service, persistence, contracts and tests before editing. Use the smallest coherent change; avoid unrelated refactoring or accepted-workflow redesigns. Classify dirty files before staging.
- Read actual package scripts; run narrow relevant tests first, then affected tests/typechecks/builds and integration/E2E checks for changed boundaries. Use isolated stores/emulators. Documentation-only changes need consistency/CI checks, not application builds. Never report tests not successfully run; distinguish verified baseline failures from new regressions.
- For UI creation, changes or review, read the Style Guide first. Reuse semantic tokens/components, light operational surfaces, accessible text/status labels, contrast, keyboard focus and controls. No dark islands or alert/prompt shortcuts. Document justified domain/brand deviations; UI returns must state `Style Guide compliance: PASS` or `DEVIATION` with reason/surface. Backend/data/docs-only tasks are exempt unless a UI surface changes.
- Prefer shared packages or app-local HTTP adapters over sibling-app production imports. Do not hide domain failures with UI fallback data or swallow downstream errors. Preserve friendly runtime URLs. No surprising GET writes.

## Non-negotiable domain and data safety

- **One downstream truth:** entry workflow → owned request → explicit handoff → canonical Production Order → Fulfilment Requirement → Logistics/projections. Never create a parallel production/fulfilment authority or silently edit another domain's state from a UI.
- **Identity/contracts:** stable IDs, never names, are identity. Resolve historical OPLOC aliases through Hub authority before authorisation/service filtering. One-off destinations use order/request-scoped snapshots, not fake OPLOCs. Before changing any shared schema/DTO/package/helper, identify its owner, trace all producers/consumers, preserve live/historical compatibility and validate every affected consumer.
- **Quantities/history:** preserve production portions, selling/production units, service dates and destination allocations through handoffs; do not invent work for blank/no-service days. Historical quotes, publications, reviews and signed artifacts are immutable evidence. Changed evidence needs explicit revisions, actor/source/lineage and supersession/withdrawal, not retrospective rewriting.
- **Allergens:** UNRECORDED/unknown is never CLEAR. Preserve CONTAINS and MAY_CONTAIN explicitly; do not infer dietary/allergen truth from names. CPU signed releases bind to the frozen matrix hash. Post-signing changes revoke current release/signatures/packet/artifacts, withdraw downstream current pointers and require re-review plus dual signature; historical revoked evidence remains. Delivered-In consumes only the current verified compressed CPU packet.
- **Auth:** use existing actors/sessions and server-side authorisation. AUTHMOD is fail-closed; missing scopes/redirects must never broaden access. Login alone is not permission. No hardcoded real staff identities in write paths, production synthetic actors, credential logging or weakened Admin SDK/API boundaries.
- **Persistence:** classify authoritative, historical, derived, fixture and recovery data before changing it. No mutable runtime data or blanket `local-data/` commits. Preserve atomicity, optimistic concurrency, audit/outbox and idempotent retry semantics; a double click/replay must not duplicate orders, publications, fulfilment or artifacts. Amendments/cancellations must explicitly propagate downstream; disappearance from a query is not withdrawal.
- **Packages/caches:** distinguish CURRENT, MISSING BUT REBUILDABLE, STALE and INTEGRITY FAILED. Recover missing derived state only from valid authority, coalescing concurrent work; integrity failures stay closed. Never silently serve stale safety/operational data as current. Support historical records explicitly. For compressed-byte hashes use `download({ decompress: false })`, verify raw gzip bytes before decompression, and regression-test the storage roundtrip.
- **Reads/audit:** bounded IDs/indexed queries/date scopes/manifests/packages first; no ordinary-path collection scans, broad listeners, rapid polling or per-read Firestore audit writes. Whole-catalogue scans are deliberate administrative work only. Keep Firestore server-side unless explicitly approved. Durable business changes need authoritative actor/entity/version/source evidence, preferably in existing atomic events/outboxes; technical diagnostics and optional batched Drive archives are separate. Do not reduce reads by removing correctness safeguards.
- **Dates/operations:** UK business dates use Europe/London deliberately; never blindly slice UTC ISO timestamps. Test midnight/DST boundaries. Do not remove legacy paths before establishing whether they remain operational. Deployments, migrations, Firestore/secret mutations and operational side effects need explicit authorisation.

## Completion

Every non-read-only task updates root [CHANGELOG.md](CHANGELOG.md): date, task title, summary, affected domain, actual validation and deployment status. Never fabricate a deployment.

Report what changed and why, affected boundaries, data/migration and upstream/downstream implications, validation actually run/not run, limitations, and new recurring cost/audit behaviour where relevant. Formal audits use the audit protocol instead.

End every task return with: **task name; branch; starting origin/main SHA; final SHA; push status; CHANGELOG yes/no + entry title; tests/typechecks/builds performed; deployment status; TL;DR**. State explicitly if no implementation was needed.

Further references: [detailed platform rules](docs/ai/agent-reference.md), [development history](FIKA-OS-DEVELOPMENT-HISTORY.md), [local workspace/runtime](LOCAL-WORKSPACE.md), [cost guardrails](COST-EFFICIENCY.md). Detailed rules remain mandatory for the applicable task; they are not waived by this shorter index.
