# 2026-11-13 — Keep Hospitality tests in a focused CI lane

Retain the complete Hospitality test command and its existing file-level process isolation. A routing regression check protects the affected-app selection, cached app installation, exact-source build and required merge gate. No booking, quote, menu or customer behavior changed.

Validation: the original app-only dependency installation passed in 42.7s with no root `node_modules`; all 474 existing tests passed in 21.1s, typecheck in 12.7s and production build in 52.2s. After the routing check, 476 tests passed in 17.6s, typecheck in 13.4s and a warm build in 39.2s. The 67 original test files have no fixed listening ports; one filesystem fixture uses a unique temporary directory. The audit found no duplicate literal test titles or permanent skips; no case was removed. Exact-source GitHub Actions validation remains required. Deployment: none.
