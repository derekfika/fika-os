# 2026-11-01 — Hosted staging never sends real Web Push (#181)

Hosted staging holds a real VAPID key and a minute-by-minute scheduler calling the driver-notification process route, so it could send real external Web Push to stored subscriptions. With `FIKA_RUNTIME_MODE=staging` the default real-network sender is now blocked (no override exists; no approved staging push sink). Verification returns `disabled_in_staging` and the push route answers 503 `LOGISTICS_PUSH_DISABLED_IN_STAGING` without storing or verifying a device; the GET reports push disabled. Saved-notice delivery and `retryPendingPushes` short-circuit before any claim/query, leaving notices pending with no attempt counted and subscriptions untouched (`pushRetried` is 0). A caller-injected `send`, production and local behaviour are unchanged. Logistics only; one low-noise warning per process.

Validation: driver-push-staging-guard, driver-push, driver-push-android and driver-notifications-api tests; Logistics typecheck and build.
Deployment: none.
