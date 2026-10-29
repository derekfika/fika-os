# Rotations foundation staging release — 29 October 2026

Owner requested deployment of the available merged foundation immediately, while the connected planner remains under its separate active owner. Pinned application source: `6fe91d6ca0f199bd6e4898d6231efc559f843275` (PR #137, preserving #136's `fc37d7c6` source). No unfinished resource/UI work is included.

## Hub — verified live

Governed release `455604f6-3168-45b8-a575-94eb7104ea2c` completed at 17:31:58 UTC. Build/rollout `build-2026-10-29-003`, exact pinned source, READY/SUCCEEDED, single 100% traffic, automatic rollouts disabled. Release ledger `458353ae9412580a1b191c8f3f28fe7c24061604` retains previous-good `652f3014` / `build-2026-10-28-002` and its record.

Live non-mutating smoke: root HTTP 200; `/api/hospitality-rotations?mode=access` HTTP 401 with `ROTATIONS_401` and authentication-required message, replacing the earlier 404. This proves the deployed provider route and anonymous gate, not authenticated workflow UAT.

## Hospitality — verified live after governed recovery

Original release `8173c4c7-e1c0-4769-a9a1-527fe78cce67` persisted intent ledger `b3141504a54f5452c52463c129b885b8fdddaa3c` at 17:33:49 UTC. GitHub connectivity failed during post-push readback, before any Firebase submission markers were written. No ad hoc submission or journal edit was made. Previous-good `c8f81e72` / `build-2026-10-26-001` retained.

Two independently validated tooling corrections were necessary: #141 recovers the narrow intent-saved/no-submission-marker phase only after the existing quiet period, exact original binding, exhaustive identical Firebase snapshots, zero create calls in readable Cloud Audit Logs and durable single-use claim; #143 reads Windows audit evidence using Cloud Logging JSON API without weakening the shell guard. Local validation: #141 11 focused / 85 workflow tests; #143 12 focused / 86 workflow tests; combined focused suite 14 passed. Governed validation and exact-source CI passed. Neither changes application source or authorises production. Merged tooling source `7959d336564b7abff9fcff7af6f3935ba1bf5330`.

The first same-intent resume returned without submission after a Firebase inspection timeout; the original pending intent and release lock lifecycle were preserved. A fresh independent check passed. A second governed resume, with a shorter serving-verification timeout, independently rechecked all safeguards and durably claimed the single allowed submission at 18:21:24 UTC. The original phase was recorded as unstarted, without invented timestamps. No duplicate rollout was submitted.

The original intent completed at 18:25:40 UTC, exact source `6fe91d6ca0f199bd6e4898d6231efc559f843275`, build/rollout `build-2026-10-29-001`, READY/SUCCEEDED, 100% traffic. Ledger `22ae881f4d3b3a359125e60d19a8dd07a90f8eb2` retains the original previous-good record. Smoke: literal root HTTP 307 to `/workspace`, workspace HTTP 200, and API proxy `GET /api/hospitality-rotations?mode=access` HTTP 401 with Hub's `ROTATIONS_401` response. `/rotations` and `/rotations-preview` both return 404 as expected for this foundation source. No authenticated planner UAT is claimed.

## Validation, access and limits

Exact pinned source merge-gate, Hub application checks and Hub emulator CI passed. Hub's app-only build/typecheck and 831-test suite were validated in the source PR. Hospitality's complete app/dependency scope hash at this source is `e076e9b8ef8e7b4179eb8b7df0c428c0b53bba438813be7e6a3543eea2ef2859`, identical to its successfully tested source `f4af81dd`; no application rebuild was repeated locally for this release-only task. Firebase builds each submitted exact source.

Derek's explicitly approved staging View, Manage and Publish grants were already applied through normal audited AUTHMOD commands and verified by provider authorisation before deployment. Production permissions unchanged. No menu, booking, dish, production, fulfilment, scheduler or email operational writes were performed for these smoke checks.

The merged Hospitality UI is still the fixture-only #106 foundation. `/rotations-preview` deliberately remains unavailable in production-mode builds, including staging. A connected `/rotations` manager and canonical resource endpoint are being developed under `codex-hospitality-rotations-integration` in separate leases. These deployments do not assert save/publish planner UAT or booking integration complete. Issue #119 remains open.
