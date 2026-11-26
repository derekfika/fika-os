# 2026-11-26 — CPU operational improvements 01 and 02

- Date: 2026-11-26
- Task: Brian's operational improvements 01 & 02
- Summary: Show the canonical Core Salad marker in the CPU Gastro Labels modal without changing printed label content. Add a filtered, service-level PAX summary to CPU Totals and its A4 output, preserving unrecorded values and disclosing incomplete totals. Totals printing now reloads with the selected production scope.
Validation: Governed `fika validate` passed (719 CPU tests: 713 passed, 6 skipped; typecheck; production build; workflow and emulator checks). Focused Core Salad/PAX tests passed; Chromium A4 Totals/PAX layout tests passed (13/13); CPU print-dialog browser test passed; `git diff --check` passed.

Deployment: Pending protected merge and authorized production release.
