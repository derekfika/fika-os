# 2026-11-04 — Add production serving-baseline validation

Extend the existing guarded baseline validator to accept exact Hub/Menu production serving evidence while requiring integrated source and exact-source CI. Route `fika reconcile <app> --prod --resolution serving-baseline` through the supported CLI. The path remains append-only and records that historical production authorization is not inferred.

Validation: pending exact-source CI. Focused local run `node --test tools/workflow/releases.test.mjs` — 23 passed; `git diff --check` passed. Tests cover exact target, stable traffic, READY/SUCCEEDED state, health, prior ledger, owner-bound authorization, and governed reconcile dispatch.
Deployment: none.
