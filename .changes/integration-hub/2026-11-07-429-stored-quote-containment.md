# 2026-11-07 — Contain stored Hospitality quote links in staging

Hub booking and group responses now omit saved Drive quote pointers whenever the runtime cannot prove production Drive access. Staging also rejects quote-PDF status writes and group quote generation/replay before persistence or confirmation reconciliation. Stored historical booking and quote evidence is unchanged; production responses retain existing links.

Validation: 8 focused tests passed; Hub typecheck and production build passed; the governed workflow suite passed 157/157. The full Hub suite reported 996 passed, 120 skipped (emulator not enabled), and one environment failure because the workspace lacks `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md`; no test failure identified these changes. Exact-source PR CI pending. Deployment: none.
