# 2026-10-30 — Logistics tablet header overflow

Reduce header flex spacing at tablet widths so the identity/action row fits its viewport. Preserve the user identity, date navigation, inspector, van lanes and the timeline's own horizontal scrolling; no page-level clipping or operational behavior change.

Validation: PR #168 targeted van-lane Playwright suite 8/8, including 820px, 1024px, 1280px and 1536px; Logistics tests 686/686; workflow validation 96/96; typecheck, build, workspace check, affected and changelog checks passed. Before/after 820px screenshots captured under `C:/Fika/agent-test-results/`.
Deployment: none.