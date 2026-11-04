# Overnight Operating Notes — AFK Execution and Staging Browser Access

This note supplements the repository operating policy in [`AGENTS.md`](AGENTS.md). Repository and app guides, deployment controls, data-safety rules, and current owner instructions remain authoritative where applicable. Use this note for overnight coordination and UAT; it does not grant deployment, migration, or operational-write authority.

## Coordinator and delegation

- The named Luna coordinator owns the run, the current coordination ledger (issue #265), and the scoped execution issue (issue #357). Do not create duplicate coordinators or claim work that has not actually started.
- Use Codex workers only. At most two Sol assignments may be consumed in one overnight run, including read-only audits. Assign Sol High or Extra High reasoning, never Fast; Sol does not perform UAT. Prefer a bounded read-only Sol audit followed by a Luna or standard Codex implementation worker when that safely separates diagnosis from implementation.
- Check current source, issues, PRs, workspace leases, and deployment evidence before dispatch. Use governed, non-overlapping workspaces. Respect existing leases and do not clean up another task's worktree, branch, stash, lock, or recovery data.
- An issue or assignment is not an agent launch. Report only real workers, tests, deployments, permissions, and capacity evidence.

## Defect and UAT loop

- A failed UAT case creates a bounded investigation; it does not end the run. Record the scenario and evidence, classify defect versus fixture/environment/tester limitation, assess severity, and check current issues, PRs, and leases.
- Dispatch a scoped worker where useful. Pause only the affected journey and continue independent safe journeys. Review the worker's exact PR/CI result, integrate through the governed merge process, deploy only the affected staging app when authorised, verify its serving SHA, then rerun the failed case.
- Use bounded retries and change approach when a failure repeats. Authentication, environment, fixture, or browser failures are evidence limits, not automatic application defects. Never turn missing evidence into a UAT pass.
- Keep fixture data synthetic, explicitly authorised, and isolated to staging. Verify app/project identity before writes. Do not use production customer data, fabricate governed destinations, or cause emails, Calendar events, Drive/PDF writes, signed packets, orders, or other side effects without their separate authority and verified isolation.

## Severity and release decisions

- Block only the affected app/release for a demonstrated release-critical P0: a critical workflow unusable; unsafe food/allergen evidence; material data loss, corruption, duplication or misrouting; unauthorised exposure; or unsafe deployment/rollback.
- Record cosmetic issues, optional UX work, noncritical P1/P2/P3 defects, and unrelated backlog as follow-up work. Missing authenticated evidence is UNKNOWN/BLOCKED, not a defect and not a pass.
- Decide GO, CONDITIONAL, or NO-GO per app and release slice. Mandatory safeguards remain separate from defect severity: exact-source CI and provenance, required same-tree staging, environment isolation, rollback evidence, authorised access, and explicit current owner production approval are never waived by urgency or a deadline.
- Do not patch release ledgers manually or blindly retry pending/unknown attempts. Use the governed deployment/reconciliation CLI and preserve original journals and lineage. Report submitted versus verified serving status accurately.
- After an authorised deployment, independently verify exact source/build, successful rollout and traffic, health, and app-specific smoke. Owner operational acceptance remains a separate gate.

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

Staging UAT uses isolated, authorised staging fixtures only. Production remains untouched unless a separate explicit owner release instruction authorises a governed production deployment. Staging access does not authorise production data changes, operational emails, live Calendar writes, signed packets, PDFs, or Drive writes. Verify required isolation controls before attempting any such side effect; if unverified, block the affected test and continue unaffected work.

For each UAT journey, record the custom URL, app/build/source SHA, scenario, observed result, evidence, and outstanding issue. Keep staging deployment verification separate from UI acceptance; Brian's operational acceptance remains a separate gate.
