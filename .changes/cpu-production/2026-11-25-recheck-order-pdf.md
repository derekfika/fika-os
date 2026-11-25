# 2026-11-25 — Recheck signed order PDFs before opening

CPU checks the current Production Order, destination access, release and file again after downloading and verifying a signed order PDF. A concurrent cancellation, revocation or replacement closes the download. Each download adds one bounded order and plan read. No changes to signatures, packets or Drive files.

Validation: 23 focused signed-document, route, master, retry and materialisation tests passed. CPU typecheck and production build passed.

Deployment: none.
