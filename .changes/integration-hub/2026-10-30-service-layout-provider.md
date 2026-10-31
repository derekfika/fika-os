# 2026-10-30 — Governed booking-service category layout (provider, slice 1 of #175)

Add the Hub-side model for which Item categories each booking service offers: a company default with sparse per-site
overrides, stored in a governed collection with optimistic versions, revisions and audit, changed only by the
`set-service-categories` / `clear-service-override` catalogue commands. The seed reproduces today's hard-coded portal lists
exactly, and the catalogue package carries an additive optional `serviceLayout` that older clients ignore. A single shared
resolver is provided for browsers and servers. Nothing consumes it yet: portals, server enforcement and the editor UI are
later slices, so no behaviour changes. No site permission, price, minimum or booking data is touched.

Validation: see the PR. Deployment: none.
