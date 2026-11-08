# 2026-11-06 — Confirm one-off delivery addresses through the Hub

Accept explicit pending routing evidence for Menu orders. Authorised Logistics managers can confirm an address against the existing order version. The transaction updates fulfilment and stages the normal outbox with the manager’s audit identity.

Validation: Hub typecheck and the isolated Firestore handoff passed, including stale-version rejection and idempotent confirmation.
Deployment: pending governed release.
