# 2026-11-01 — Export outbound-environment from server-shared (issue #181, slice B)

Adds the `@fika/server-shared/outbound-environment` package export so the Hub booking-email worker can consume the merged
Slice A outbound gate. Export entry only; the gate module itself is unchanged and no other app imports it.

Validation: Hub typecheck and `next build` resolve the export; booking-email staging-sink tests pass (see PR). Other apps were not rebuilt locally.
Deployment: none.
