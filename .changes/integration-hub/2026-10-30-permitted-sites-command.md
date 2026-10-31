# 2026-10-30 — One on/off switch per site, including site-restricted Items

Catalogue Items created for specific sites (for example the 11 One Angel Court wines) carry a site list that
availability edits refused to broaden, so RCoA could not be given the existing wines. Switching a site ON for any
Item now works: for a site-restricted Item it extends the site list in the same governed transaction (version-checked,
revisioned, audited with the extension recorded). OFF keeps the reversible exception; OFF at a never-permitted site is
a no-op. Applies to the Item panel, bulk editor and `set-site-availability`. Prices, routing, minimums, configuration
and Item identity are untouched. Adds a read-only planner that verifies the 11 canonical wine IDs against live records.
Booking-section mapping is not changed here.

Validation: see the PR. Deployment: none yet.
