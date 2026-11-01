# 2026-11-01 Ad-Hoc dual signing and PDF-only releases

Restore Ad-Hoc signing through CPU's existing revisioned review and durable release path. Signatures bind to the canonical request/amendment and exact matrix; lifecycle-only version changes preserve demand authority, while cancellation and amendments fail closed. Persist one exact-release PDF, reuse it on retry, and create no Delivered-In packet or publication. Recheck source authority after upload before marking the release ready. Preserve chef row attestation, revoked history, and existing Drive configuration.

Validation: 13 focused lineage/materialization/attestation tests and the isolated Ad-Hoc API/emulator signing/revocation regression passed. Final governed validation passed workflow tests, CPU suite (531 passed, 4 skipped), typecheck and production build. Exact-source CI is recorded in the replacement PR.
Deployment: none. No staging writes, real PDFs, customer communications or production changes. Style Guide compliance: PASS (existing signing UI, source-lineage logic only).
