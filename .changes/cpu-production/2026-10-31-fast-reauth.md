# 2026-10-31 — CPU session recovery

The dashboard recognises explicit missing/invalid session responses and offers the existing Hub sign-in in a new tab, preserving the original dashboard view and open forms for the same account. A changed verified actor scope reloads the tab to clear the previous account's in-memory state. A user-triggered login check reads the existing bounded CPU cache-scope endpoint, then refreshes reads without replaying a failed command. Permission denials and network failures stay distinct. Session lifetime, authentication and authorisation policy are unchanged; no polling, business writes or additional audit writes are introduced. CPU local development explicitly selects webpack to match the existing build configuration under Next.js 16.

Validation: CPU-only governed validation passed (106 workflow tests, 506 CPU tests passed / 4 skipped, typecheck and production build). The final callback correction then passed 52 focused security/production/recovery tests, synthetic Chromium checks 2/2 at 820px and 1280px, typecheck and production build. Browser cases include offline/denied/repeated expiry, actor-switch reset and changing views during a delayed login check. Style Guide compliance: PASS.

Deployment: none. Real sign-in, staging/tablet UAT and the cause of daily sign-outs remain unverified.
