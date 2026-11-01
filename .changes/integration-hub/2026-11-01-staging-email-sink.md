# 2026-11-01 — Staging booking email sink (issue #181, slice B)

The shared booking-email worker now consults the outbound-environment gate. In staging every notification path
(submitted, confirmed, amended, cancelled, including consolidated group cancellations) is sent only to the sink inbox
supplied as the gate's `ownerInbox` (`FIKA_STAGING_OWNER_INBOX`); customer To/Cc/Bcc are cleared, the Reply-To header and
reply-to contact line are omitted, and the subject is prefixed `[STAGING]`. Missing or malformed sink/gate config, an
unrecognised non-empty `FIKA_RUNTIME_MODE`, or any `OutboundGateError` fails closed before the send barrier: nothing is sent,
the record stays retryable and there is no customer-facing fallback. Production, local and unset modes are unchanged.
Known gap: the gate also requires staging Drive destinations and an ancestry proof, read here only from the server config
`FIKA_OUTBOUND_STAGING_DRIVE_JSON`, so staging mail stays blocked until that verifier output is supplied. Also exports
`@fika/server-shared/outbound-environment`.

Validation: new `booking-email-staging-sink` tests (injected transport, no network), affected booking-email tests, Hub
typecheck; see the PR for results.
Deployment: none.
