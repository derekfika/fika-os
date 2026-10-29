# Rotations staging delivery investigation — 29 October 2026

Starting integration authority: `e8bfbdbdc0be0e437cf3b1aeeb46aa99f132a0ac`.

## Access check before deployment

Read-only, bounded Firestore queries matched `derek@fikacatering.com` to the existing active person identity in both `fika-os-dev` and `fika-os`. Its Hospitality normal app assignment is active. The staging identity has fullAccess; production does not. Neither environment contains any `hospitality.rotations` authority grant for this identity (25 staging and 22 production subject grants checked, below the query limit of 100).

The provider explicitly requires separate organisation-wide View, Manage and Publish grants for `hospitality.rotations` under `hospitality-booking`. Full access and normal Hospitality management do not imply these special authorities. Derek therefore cannot use the planner with the current assignments. No permission writes were made. Owner approval for any staging grant remains separate from deployment.

## Source versus deployed features

PR #105 is merged and defines the v1 Hub provider and shared strict schema. PR #106 is merged but deliberately supplies only a fixture dashboard and cookie-forwarding proxy. Its `/rotations-preview` route is disabled whenever NODE_ENV is production; App Hosting staging also uses production builds. The 404 cannot be diagnosed solely as an old deployment. No real protected planner route, configuration persistence adapter, canonical dish/item pickers or connected publishing UI exists in that PR.

Do not expose fixture data as live or relax the preview guard to claim workflow UAT. A connected manager needs server capability gating, provider-owned canonical pickers, the shared schema, version-aware whole-configuration saves, actor-bound stable request IDs, explicit publication of the current draft, conflict review/reload and unavailable-authority handling. Booking consumption and production handoff remain separate future work.

## Release evidence

Hub staging is still serving `652f3014088aad4b23eccf8349e7ff485d8a9998`, build `build-2026-10-28-002`. Later builds failed because the app-only App Hosting install cannot resolve zod types for the shared Rotations contract. Its narrow store/tsconfig lease remains owned by `codex-hospitality-rotations-buildfix`; the workspace is clean, idle and based on `45c60817`. Do not edit or displace it without coordination. The latest Hub ledger already records the failed October 29 attempt as abandoned, retaining its healthy previous-good source.

Hospitality staging serves `c8f81e72550ff346a4f73eb79a2d0dd931174324`, build and rollout `build-2026-10-26-001`, READY/SUCCEEDED, single 100% traffic, no active operations, auto rollouts disabled. Original intent `e107a933-aa0b-4020-8a45-9e55c7b1b8ae` remains pending. Governed reconciliation refused completion because its generic health probe rejects the intentional HTTP 307 `/workspace` redirect. The same backend's `/workspace` returns 200. Reconciliation failed before ledger/journal modification; no duplicate rollout was submitted.

An isolated release-tooling fix verifies the literal same-backend redirect and HTTP 200 workspace with no additional redirects. Production probe behaviour and independent Firebase exact-source checks remain unchanged.

## Operational limits

No production deployment, AUTHMOD assignment, menu/booking/dish data change, email, scheduler activation or operational UAT write occurred. The working Menu publication delivery integration is untouched. Current staging is not declared ready for Rotations workflow UAT.
