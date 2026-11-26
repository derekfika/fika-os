# 2026-11-26 — Use the selected site owner for generic menus

Generic menu generation uses the governed OPLOC's configured Drive owner and output root. A site with neither setting uses the Delivered-In app owner and root. An incomplete site configuration stops generation before credentials are read.

Retries look in the selected week's folder for the same site's delivery. New copies record their route and destination so retirement can verify the file and its parent before moving it to trash. Existing app-owned delivery copies can be reused when ownership, parent and delivery match. Files with unverifiable retirement provenance remain intact.

## Validation:

All 230 Delivered-In tests and typecheck passed. The generation, retry and retirement tests used offline Google responses. Hosted Drive UAT remains pending.

## Deployment:

No deployment was performed.
