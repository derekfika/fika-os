# CFC / Munich RE Hospitality P0 delivery — 29 October 2026

Deadline: operationally ready before Monday 2 November 2026. Engineering owner: Sol, `codex-cfc-mre-p0`. Baseline `origin/main` `44469a6f865f9c21752206906f698ea654155464`. Track #108 with #119. No production mutation or production deployment authority.

## Verified starting state

Read-only bounded administrative queries retrieved canonical Hospitality Items, Prices, Offerings and OPLOCs from staging and production. Staging: 90 Items, 46 active; production: 124 Items, 80 active. Neither environment has any active CFC or Munich RE provider mappings. Snapshots and decoded evidence are preserved outside source in `C:/Fika/_scratch/cfc-mre-2026-10-29/`; no mutable operational snapshots are committed.

Canonical active OPLOCs: CFC `oploc:0d8626f9-99bd-4dde-9471-191dd0abfb2e`; Munich RE `oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701`. Historical Munich fifth-floor identity remains merged, not a new destination. No room data is invented.

PR #81 merged only regression tests and a changelog entry. Its description claimed a link command, but current `CatalogueCommand`, admin dispatcher and API schema have no `link-provider-item` operation. This task implements that missing additive operation through existing versioned transactions, audit and revisions. The operation does not create Items, Dish Library recipes, prices, routing or bookings. Its bounded catalogue-wide read is deliberate administration (maximum 500 Items), not a new normal booking read path or recurring job.

Additional current-code gaps: CFC and Munich RE reference-data always use local snapshots; booking ingestion does not load their effective site Offering/Price relations. Linking real canonical Items alone would expose the old raw `Item.unitPrice` assumption and fail valid orders. Shared effective-offering resolution and governed provider-filtered portal reads must be connected before applying staging aliases.

## Sources and unresolved evidence

CFC authority: [CFC Hospitality Brochure 2026](https://docs.google.com/presentation/d/1jzZ0s_RnG8yJQZvbGuplYKEreeDTH-TADB5-0Czf-74/edit), modified 8 October, fetched read-only. It states the standard eight-person minimum unless otherwise stated, prices excluding VAT, explicit product/pack limits and notice. The old snapshot omits juice/shot/weekly-salad/Gold-buffet variants and flattens other option information. Traybake must not be silently associated with either the canonical Contains Nuts or Nut Free product. Renamed Glow Bowl/Propper Salads and generic bespoke-event/Christmas-example semantics need explicit reconciliation.

Munich authority work already exists in #125/#128. Preserve its form inventory and minimum-5 implementation. Active `munich-re-portal` lease owned by `claude-munich-re-onboarding` covers BookingPortal, locations and portal tests; coordination request posted to #128, no overlapping edits. Its claimed live Microsoft form has no URL in the checked-in handoff; current URL requested from owner. Owner will supply it after the requested usage-limit checkpoint and agent handoff. Available [Munich RE brochure](https://docs.google.com/presentation/d/1RCnwY1vlXGOPSFAy0f8f4_2rG2bBO4oN/edit) says prices include VAT, unlike CFC and unlike the unverified net-price assumption in #128. It also has different pack contents (e.g. ten rice-paper rolls versus CFC twelve). Do not silently reuse CFC products/quantities or apply a global cap to explicit pack/product minimums.

The confirmed Munich minimum 5 applies only to inherited standard minimums. Explicit pack sizes, per-variety minima and product rules must remain authoritative. Source/VAT/pack ambiguities remain blockers for the affected Munich rows, not for independent CFC progress.

## Recipe dependency — separate from catalogue delivery

Sam will create fresh canonical Dish Library recipes and confirm intended Item/group associations. Existing Menu Planning dishes are not approved Hospitality recipes. No auto-reuse, fixture recipe creation, inferred allergens or fabricated associations is permitted. Per-item reporting must separately record catalogue mapping/bookability/routing and `pending Sam recipe`, including canonical dish ID/revision only after Sam supplies it. Catalogue or CPU order acceptance does not prove recipe or signed production-release readiness.

## Validation and next stages

Current explicit-link foundation: three focused tests pass, actual isolated emulator permission/stale/no-op/uniqueness race test passes, Hub typecheck/build pass. Full Hub suite passed (837 passed, 104 skipped); exact-source CI pending. No mapping writes or deployment yet.

Next: connect provider-filtered effective catalogue reads and server ingestion using existing resolver and bounded relation loader; prepare explicit row-by-row mapping/price/rule plan, stage the confirmed CFC subset, verify synthetic booking through Hub canonical Production Orders to CPU without email/dispatch/signing side effects, then complete Munich rows supported by confirmed source evidence. Keep #108/#119 open through operational verification and required production approval.
