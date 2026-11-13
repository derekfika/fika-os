# 2026-11-13 — Isolate Menu Planning test data and accelerate CI

The duplicate-planning command test now uses one temporary working directory for its SQLite store and canonical item fixture. This prevents the test from appending generated dishes to tracked local data. The generated data from the baseline run was restored and is not committed. Menu Planning tests retain the complete file-isolated suite and gain a routing guard for the required CI lanes.

Validation: app-only npm ci; focused duplicate command test 10/10; CI routing test 2/2; full suite 562 cases (558 passed, four existing opt-in skips); typecheck and production build passed. The full suite left tracked fixtures unchanged. The three guarded Firestore and one guarded IndexedDB tests remain opt-in. Playwright is outside validate.yml; local listing was blocked by Node type stripping in the shared package import.

Deployment: none.
