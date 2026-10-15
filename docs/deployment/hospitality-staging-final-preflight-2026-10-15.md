# Final Hub + Hospitality staging runtime configuration and merge gate

Task: Configure final Hospitality staging Drive bindings and deploy the reviewed pair.
Project: `fika-os-dev` only. Date: 2026-10-15.
Reviewed candidate: `e1fc30890f91f011ba25eb7d66c21ea40c67b07f`.
Starting `origin/main`: `3a3c51d91cba03f9ad95c0985ea1853568234651`.

## Configuration saved and read back

The existing App Hosting `overrideEnv` mechanism supplies both governed owner
bindings to **both** `fika-os-staging` and `fika-hospitality-staging`. Hub needs
these identities for its grouped quote artifact path; Hospitality needs them
for quote/menu and matrix persistence. Other overrides were preserved.

| Site | Owner binding | Value |
|---|---|---|
| RCoA | `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_BE0BECBE_B6CF_4D7F_9C1E_F36E689FEAB2` | `rcoa@fikacatering.com` |
| Angel Court | `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_24A93500_D75D_4FE0_8BEB_672D36F9DA10` | `seven@fikacatering.com` |

Existing `fikaDashboardQuoteSettings` document IDs are SHA-256 of the dashboard
ID, as used by the application. The two dashboard settings documents were
written atomically with document preconditions, preserving existing settings
(or using the existing code defaults for absent documents), incrementing the
version to **2**, and recording the authenticated operator and update time.
These were authorized configuration writes, not an application-data migration.

| Dashboard | `googleQuoteFolderId` | `googleMatrixFolderId` | `googleMenuFolderId` |
|---|---|---|---|
| `rcoa-hospitality` | `1SMd9V_3wTwLAKpXJxj0VacDosRsJBFKR` | `1-RuVcoHccoKDuk3kBym-5n3RuF9ncn3X` | `1dEY_-fr_MD1iZmIZ0hfzaDcBhpFPz1Ij` |
| `angel-court-hospitality` | `18dLsE5Xatj5v6BnxOZFVYspJRWPRx5bO` | `1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X` | `1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc` |

Angel Court `googleMenuTemplateId` is the supplied tablet template
`1bkaXTTCStSDqo_YZOCnTZbHzaAzzzIAWIL6ooS1EEGw`. The older tablet ID was not used.
Flat (`1Uh1WSJvZk3fPaIFh-36Jwl9GYC5omuwiHCeJkbWC2T8`) and tent
(`13ceJl5oqKmn-138GMOg5bPCVhqQV4r3Y4kyq28bkjx0`) are accessible, but this
reviewed candidate has no selector/binding for those formats. Derek explicitly
approved tablet active, flat/tent deferred; no unused configuration fields or
parallel mechanism were created. RCoA has no template setting and no substituted
template; its menu generation remains explicitly unavailable.

## Non-mutating preflight: zero BLOCKING findings

The verification phase used the candidate's staging YAML plus saved backend
overrides and persisted dashboard settings. Secret values were resolved and
compared in memory only. Neither secrets nor customer payloads were logged.

| Requirement | Status | Evidence |
|---|---|---|
| Hub/Hospitality runtime mode, project, placeholders | READY | `staging`, `fika-os-dev`; no placeholder values in effective runtime configuration |
| Hub/Hospitality PDF renderer URL/token | READY | Correct staging endpoint; authenticated empty-HTML request returned validation HTTP 422 before rendering; no PDF generated |
| Hub/Hospitality Drive DWD | READY | Existing secret bindings resolve; governed owner authentication succeeds |
| Hospitality Hub/CPU bindings | READY | Correct staging service URLs |
| Hub/Hospitality submission bridge | READY | Bridge tokens match in memory |
| Hub/CPU internal token and CPU callback | READY | Tokens match; callback points to Hospitality staging; existing CPU deployment is compatible |
| RCoA canonical OPLOC mapping | READY | One confirmed `provider-location` mapping for `rcoa`; exact configured canonical OPLOC is active |
| RCoA quote, matrix, menu folders | READY | All metadata GETs HTTP 200; active folders; `canAddChildren=true` under `rcoa@fikacatering.com` |
| Angel Court quote, matrix, menu folders | READY | All metadata GETs HTTP 200; active folders; `canAddChildren=true` under `seven@fikacatering.com` |
| Site matrix adapter selection | READY | Exact candidate resolver selects each persisted site folder and governed owner; no save/upload call |
| Angel Court tablet binding | READY | Existing resolver consumes the exact approved tablet ID |
| Angel Court three template access checks | READY | Drive metadata and Slides GET HTTP 200; `canCopy=true`; no copy |
| RCoA missing menu templates | DEFERRED-NONBLOCKING | Resolver fails closed; booking, quote, CPU/allergen and run-sheet paths have no menu-template dependency |
| Angel Court flat/tent runtime selection | DEFERRED-NONBLOCKING | Explicitly approved deferral; access verified |
| Run-sheet path | READY | Shared quote branding/HTML path and focused presentation tests; no menu-template dependency |
| Customer email delivery disabled | READY | Active Hub runtime and candidate configuration both `FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED=false`; no email sent |

CPU staging was inspected read-only to verify compatibility. Its source and
runtime were not changed and no CPU deployment is required.

Before the coordinated rollouts, active revisions were Hub
`fika-os-staging-build-2026-10-15-009`, Hospitality
`fika-hospitality-staging-build-2026-10-15-010`, and CPU
`fika-cpu-production-staging-build-2026-10-14-006`. New backend overrides are
saved configuration for the next build; this preflight does not claim that
the old running revisions already consume the new bindings.

## Merge and validation evidence

Main initially matched the approved baseline and was an ancestor of the exact
candidate. A conflict-free local merge was prepared without committing.
Before commit/push, the final remote check found main had moved to
`03a8e4ab2865dbe3ec25a8ec28d84730f59dd7b8` ("Add staging Hospitality catalogue
canonicalisation runbook"). The user explicitly required stopping if main moved,
so the pending local merge was aborted. No merge commit or main push occurred.
The checkout was returned to `codex/hospitality-uat-integration` at the exact
reviewed candidate. This report and the required CHANGELOG entry remain local,
uncommitted documentation. Application/shared-package source is unchanged.

The candidate's 189 Hospitality tests, 64 focused Hub tests, both typechecks and
production builds were already validated. This task reran focused Hospitality runtime,
matrix, PDF and presentation tests (28/28), focused Hub integration contracts
(64/64), and diff checks (clean). Full typechecks/builds were not repeated because
application source remained byte-for-byte equivalent to the validated candidate. No
additional code implementation or test changes were needed.

**Final verdict: BLOCKED by moved main, as instructed.** Runtime preflight has
zero blocking configuration findings, with the explicitly accepted template
deferrals above. No rollout was submitted. There is no merged main SHA or newly
deployed SHA/build/rollout ID for this task. Existing staging URLs are:

- Hub: https://staging-os.fikacatering.com
- Hospitality: https://hospitality-staging.fikacatering.com

The saved configuration remains in place for a future coordinated rollout.
The current active revisions were not changed by the backend configuration
updates. No automatic deployment success is inferred.

No customer artifacts were created during preflight. No catalogue
canonicalisation, Item merge/archive, routing decision, review-group mutation,
customer-email enablement or production access was performed.
