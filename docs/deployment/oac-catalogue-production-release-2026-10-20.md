# OAC 2026 brochure catalogue: production release record (2026-10-20)

Operator authorisation: direct production release, staging skipped; VAT confirmed (catalogue prices ex VAT, 20% applied once to the final taxable quote subtotal; 8% management fee unchanged).

## Code
* Commit `85ca1cce311e70c5743b6a772f148c3d403e8466` (catalogue-only; booking-migration drafts excluded), fast-forwarded onto `main` from `755a7f87`.
* Integration Hub `fika-os-prod-hub` build `build-2026-10-20-001`, Hospitality `fika-os-prod-hospitality` build `build-2026-10-20-001`: both READY, 100% traffic, source commit verified from the build record.
* **CPU Production `fika-os-prod-cpu` was NOT redeployed** (the rollout command was refused by the session's permission classifier). It still serves `build-2026-10-19-003`. Impact: only the display of numeric variety allocations on CPU job-detail views; production conversion is computed by the Hub. Deploy before real OAC bookings with allocated items reach CPU: `firebase apphosting:rollouts:create fika-os-prod-cpu --project fika-os --git-commit 85ca1cce311e70c5743b6a772f148c3d403e8466`.

## Catalogue
* Plan hash `278b21d56a1b19909402b68e3c00e6b7c424354e9655fed631328d2f45405c9a` (34 creates, 12 updates, 7 correct, 1 excluded; 46 commands, 0 holds, VAT 20% approved for new priced items).
* Live source fingerprint at preflight and plan generation (identical): `9476e3fb34292f99bcad4a282b7198a21feb287bcbfb9327399781693e629efd`. Comparison with the earlier 06:18 UTC evidence: no catalogue content differences.
* Applied with `scripts/apply-oac-catalogue-plan.ts` (plan-hash and live-source-hash gated, per-key progress file, stop on first failure): 46/46 succeeded in plan order; one package publication afterwards.
* Package: private v5 schema 2 hash `435b4f6df2d25ca1332461da575bdee64bac63a1998b074bb15c206f1f7084fe`; public v5 schema 2 hash `a46b2a18a8afd4750dd0db61beada70baca96bb1afee6f72b6de57c5912cb67f`. Previous manifests (schema 1): private `1609c3ee0b08439a92ab1b6fd7b0e94d774c0e7225709c68a48d93c78bae5736`, public `58bba43c1fa5edb1b8c4c2e1fafa67392cf5282102a359c128006a10c85d5c28`.
* Audit evidence: governance audit events by actor `release:oac-catalogue-2026-10-20` (one per command, written in the mutation transaction); runner progress file in the release evidence folder.

## Verification (read-only, immediately after)
* 48 OPLOC/date effective-catalogue views compared with the pre-release snapshot: **0 changes at any other site**. OAC offerings 39 to 74.
* Published package resolves identically to Firestore for OAC (74/74). Prices, minimums, guest floors, notice, quote-only modes and routing read back as planned. Classic Working Lunch is not offered at OAC. 34 new Items are OAC-only; the 24 in-house Items carry the empty in-house route (as existing in-house items do).
* Gallagher via the shared validator on live data: Deli 10 to 5, Savoury Filled Croissant (each) 12 to 5, Breakfast Pots 12 to 5.
* Not verified: signed-in browser flows (no session available) and the Hospitality-to-Hub package fetch of v2 under an authenticated session.

## Rollback
Fresh-version compensating commands per item, never deletion: reset OAC overrides on the 12 shared Items (`set-site-override` with `price:null`, `minimumQuantity:null`, `configuration:null`, standard mode, `minimumGuests:null`, `noticeRequiredDays:null`) and archive the 34 OAC-only Items (`set-item-status`), then republish. Code rollback: App Hosting rollouts at the previous SHA `755a7f87` (Hub previous build `build-2026-10-19-020`, Hospitality `build-2026-10-19-008`). Historical bookings and audit records are untouched.
