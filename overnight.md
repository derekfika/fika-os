# Overnight Operating Notes — AFK Execution and Staging Browser Access

This note supplements the repository operating policy in [`AGENTS.md`](AGENTS.md). Repository and app guides, deployment controls, data-safety rules, and current owner instructions remain authoritative where applicable. Use this note for overnight coordination and UAT; it does not grant deployment, migration, or operational-write authority.

## Permanent AFK command protocol

The owner may start a run with one command, for example:

```text
AFK: 235,334,381 +5 S0 T3 L* W2 BP235
```

- Issue numbers are the first-priority queue, in the order given. `+N` selects up to N additional existing, ready, unclaimed issues after checking scope, ownership, dependencies, and available capacity. Do not create duplicate work or new issues just to fill the count. A genuinely critical safety incident may take precedence under the existing release policy.
- `S0` permits zero Sol assignments; `S<N>` caps total Sol assignments for this run. `T<N>` caps Terra assignments. `L*` sets no fixed Luna assignment count. These are ceilings, not required quotas, and never override existing model, reasoning, usage, or availability rules. In particular, S0 means no Sol dispatch, even for work normally recommended for Sol; record that task's precise blocker and continue other suitable work. If no budget suffix is supplied, use repository defaults.
- `W<N>` explicitly sets the maximum number of concurrent independent coding workers for this run, up to the repository's supported limit. Without it, keep the normal solo-worker default. Every writer needs a separate Git worktree. Check active workers and open PRs, coordinate shared-path changes and sequence dependencies before assignment.
- `BP<N>` requests a production deployment for the scoped issue. Resolve the app and exact merged source, and use the standard deployment command after exact-source CI. Ordinary language works the same way.
- `XT<N>` records that optional manual/browser UAT should be skipped for the issue. Use `SKIPPED`, never `PASSED`. Automated validation, data safeguards and post-rollout serving verification still apply. Staging and manual UAT are optional regardless of this suffix.

### Blockers stay local to the task

At each meaningful blocker, record the exact failure and classify it as transient, source defect, or mandatory authority/safety gate. Attempt bounded safe remediation when appropriate, preserving work, evidence, workspace, and release lineage. Mark only the affected task BLOCKED with its precise next action, then immediately move to another ready, authorised issue. Revisit it only when new evidence, a dependency change, or a viable remediation appears. Do not repeat the same failing command without changing conditions, and do not stop independent work because authentication or an external service blocks one task. Continue while the runtime is active and within configured budgets; do not claim asynchronous work after it ends.

### Run ledger and completion

Track each selected issue in #265 with its priority, assigned worker, status, branch/PR/source SHA, CI result, release/UAT evidence, and remaining blocker/next action. Use these statuses: READY, ACTIVE, BLOCKED, PR OPEN, MERGED, STAGED, DEPLOYED, ACCEPTED. Update status only when evidence supports the transition; close an issue only when its full acceptance criteria are met. Keep Luna responsible for coordination, implementation, automated checks, UAT, integration, release operations, issue tracking, and operational verification. Sol never performs UAT; all existing overnight Sol allocation and reasoning rules still apply.

## Coordinator and delegation

- The named Luna coordinator owns the run, the current coordination ledger (issue #265), and the scoped execution issue (issue #357). Do not create duplicate coordinators or claim work that has not actually started.
- Use Codex workers only. At most two Sol assignments may be consumed in one overnight run, including read-only audits. Assign Sol High or Extra High reasoning, never Fast; Sol does not perform UAT. Prefer a bounded read-only Sol audit followed by a Luna or standard Codex implementation worker when that safely separates diagnosis from implementation.
- Check current source, issues, PRs, worktrees and deployment evidence before dispatch. Preserve other tasks’ worktrees, branches, stashes, locks and recovery data.
- An issue or assignment is not an agent launch. Report only real workers, tests, deployments, permissions, and capacity evidence.

## Defect and UAT loop

- A failed UAT case creates a bounded investigation; it does not end the run. Record the scenario and evidence, classify defect versus fixture/environment/tester limitation, assess severity, and check current issues, PRs and worktrees.
- Dispatch a scoped worker where useful. Pause only the affected journey and continue independent safe journeys. Review the worker's exact PR/CI result, integrate through the governed merge process, deploy only the affected staging app when authorised, verify its serving SHA, then rerun the failed case.
- Use bounded retries and change approach when a failure repeats. Authentication, environment, fixture, or browser failures are evidence limits, not automatic application defects. Never turn missing evidence into a UAT pass.
- Keep fixture data synthetic, explicitly authorised, and isolated to staging. Verify app/project identity before writes. Do not use production customer data, fabricate governed destinations, or cause emails, Calendar events, Drive/PDF writes, signed packets, orders, or other side effects without their separate authority and verified isolation.

## Defect reporting and release evidence

- Report severity and observed effects per app. Keep missing authenticated UAT evidence marked UNKNOWN or BLOCKED. Record optional UX work and unrelated defects as follow-up.
- Follow the same PR, exact-source CI and merge workflow for every app and change category. Use the governed CLI for requested releases and recovery. Preserve original journals, active intents and rollback lineage.
- After a requested deployment, verify exact source, rollout, traffic and health. Record app-specific smoke and optional owner operational acceptance separately.

## Staging browser URLs

Use the operator-facing custom domains for browser navigation and authenticated staging UAT. Start from the authenticated Hub landing page:

- Hub: <https://staging-os.fikacatering.com/>
- Menu Planning: <https://menu-planning-staging.fikacatering.com/>
- CPU: <https://cpu-staging.fikacatering.com/>
- Delivered-In: <https://delivered-in-staging.fikacatering.com/>
- Logistics: <https://logistics-staging.fikacatering.com/>
- Hospitality: <https://hospitality-staging.fikacatering.com/>
- Ad-Hoc: <https://adhoc-staging.fikacatering.com/>

Do not use Firebase `*.hosted.app` addresses as browser or operator URLs. They are deployment/service origins, not substitutes for the custom domains configured for staging access.

Use the user's authenticated in-app browser session when available. Before relying on browser UAT, verify the custom-domain sign-in/return round-trip and confirm the served application build through governed release evidence and the app's build-info endpoint where available. Keep the user's session and custom-domain URL intact when moving between apps.

If the authenticated in-app browser cannot be accessed, report the exact access limitation and mark authenticated UI journeys BLOCKED. Continue safe, independent read-only, API, emulator, or code-backed checks. Do not infer browser access from a URL supplied in ambient context, and do not report an unobserved browser journey as passing.

## Staging and production boundary

Staging UAT uses isolated, authorised staging fixtures only. Use the governed command for requested production deployments. Staging access does not authorise production data changes, operational emails, live Calendar writes, signed packets, PDFs, or Drive writes. Verify required isolation controls before attempting any such side effect; if unverified, block the affected test and continue unaffected work.

For each UAT journey, record the custom URL, app/build/source SHA, scenario, observed result, evidence, and outstanding issue. Keep staging deployment verification separate from UI acceptance.
