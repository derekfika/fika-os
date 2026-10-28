# 2026-10-28 — Reconcile CPU custom-range backlog against current Totals

PR #8 targeted an older Totals preset layout and added explicit input handlers. Current main uses the newer week/day controls from #15 and already processes input-only native date events through its controlled inputs. Preserve those production controls and add the useful custom-range edge-case coverage plus an opt-in browser regression against the real page with synthetic API responses. No production source, quantities, persistence or API contract changes.

Validation: baseline Chromium browser test passed before any source edit; focused/full CPU tests, typecheck/build, desktop/touch browser test and exact-source CI results are recorded in the reconciliation PR. Run the browser test against an isolated local CPU URL using FIKA_CPU_INPUT_TEST_URL; ordinary tests skip browser coverage when no URL is supplied. WebKit/iOS physical-device behaviour is not claimed.
Deployment: none. No data, infrastructure, emails or downstream operational writes.
