# 2026-11-27 — Task 04A hosted staging acceptance

Recorded the hosted staging release and isolated acceptance for the Menu Library and Menu Planner UI housekeeping in PRs #738 and #739. The Week Planner retained Main Lunch while creating and reloading an independent Breakfast structure; template edits, duplication, rename and archive left the saved menu instance unchanged. Hospitality Rotations and the obsolete Hospitality availability control were absent from Menu Planning navigation and toolbar; their backend routes and metadata were preserved.

Published one staging Breakfast service for Munich RE on 30 November 2026 with one canonical dish, 8 portions and recorded PAX 10. Menu Planning confirmed the downstream handoff delivered. CPU staging showed one corresponding Published menu order for Munich RE, 8 portions and 10 guests, with no duplicate order.

Validation: hosted custom-domain UI verified save, reload, per-menu structure independence, template edit/duplicate/rename/archive isolation, Main Lunch preservation, one explicit supplementary publication and delivered handoff; read-only CPU staging confirmed exactly one corresponding order. PR #739 exact-source CI passed and `/api/build-info` returned the selected source SHA.
Deployment: Menu Planning staging (`fika-menu-planning-staging`, `europe-west4`), PR #739 source `cdc365be24392e79f7d1d03fca9bc9dd14755e55`, merge `efa46b58837c7118d068df3c66def2d63756545f`, rollout `build-2026-11-27-002`, release `f5c8ceda-6faa-447e-9736-9fe3571e08d7`, SUCCEEDED at 100%. No production deployment.
