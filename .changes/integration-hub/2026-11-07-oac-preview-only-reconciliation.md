# 2026-11-07 — OAC preview-only reconciliation

Added a pure, hash-bound OAC reconciliation preview using the current Hospitality canonical booking ID and schema types. It checks stable IDs, exact existing documents, status/date/quantity consistency, and explicitly approved item aliases. It records source Quote Docs and Calendar IDs as evidence, but never builds/persists a booking, turns a Draft Doc into a FIKA quote revision, or triggers Calendar, email, CPU, or Logistics effects. The file-only CLI requires redacted input/output outside the Git checkout.

The current redacted source projection contained 169 rows: 13 held (12 future confirmed and 1 past confirmed), 156 excluded, 0 exact target matches, and 0 preview creates. All 12 future confirmed rows remain held: linked source Docs are Draft, source Calendar state is unverified, and migration lifecycle/quote policy is unresolved; five rows also contain non-approved or unmapped item IDs. This evidence does not authorize import or CPU/Logistics handoff.

Validation: seven focused preview tests, Hub typecheck, ESLint on the changed files, Hub production build, and two identical runs of the 169-row redacted current-source preview (matching plan/source/context hashes; zero writes and downstream effects). The full Hub suite had 1123 tests: 1002 passed, 120 skipped, and 1 unrelated ENOENT because `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md` is absent from this checkout and has no submodule mapping. No emulator persistence or production mutation was run.
Deployment: none.
