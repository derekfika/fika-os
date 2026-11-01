# 2026-11-01 — Staging booking email sink (issue #181, slice B)

The shared booking-email worker now consults the outbound-environment gate. In staging every notification path
(submitted, confirmed, amended, cancelled, including consolidated group cancellations) is sent only to the sink inbox
supplied as the gate's `ownerInbox` (`FIKA_STAGING_OWNER_INBOX`); customer To/Cc/Bcc are cleared, the Reply-To header and
reply-to contact line are omitted, and the subject is prefixed `[STAGING]`. Unset, unknown or inconsistent `FIKA_RUNTIME_MODE`, missing or malformed sink/gate config, local mode (the gate's local
block) and any `OutboundGateError` fail closed before the send barrier: nothing is sent, the record stays retryable and
there is no customer-facing fallback. Production is unchanged (passthrough) but now requires project `fika-os`, which the Hub
production apphosting already sets together with `FIKA_RUNTIME_MODE=production`. The gate's staging Drive proof comes only
from a trusted, code-injected verifier (`bookingEmailDeps(driveVerifier)`); it is never read from env/config JSON, so staging
mail stays blocked until a real verifier is wired. Callers injecting their own deps without `outbound` (tests) bypass the gate.
Also exports `@fika/server-shared/outbound-environment`.

Validation: `booking-email-staging-sink` tests (injected transport, no network), affected booking-email tests, Hub
typecheck and build; see the PR for results.
Deployment: none.
