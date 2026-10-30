# 2026-10-30 — Shared booking-service category layout resolver (#175 slice 1)

New `@fika/server-shared/hospitality-service-layout` export (seed, normalisation, pure resolver) and an additive optional
`serviceLayout` on the catalogue package type. Older packages and clients are unaffected; no consumer uses it yet.

Validation: see the Hub change entry. Deployment: none.
