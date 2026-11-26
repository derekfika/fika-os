# 2026-11-26 — Verify frozen signatures before allergen release materialization

CPU checks both sign-off roles on the committed release before replaying a per-order delivery or starting materialization. Master and site PDFs print the signers recorded on that release. Missing, invalid or out-of-scope signatures return a conflict before the outbox, plan or artifacts change.

Complexity: High

Recommended model: Sol

Reason: The release and its PDFs must preserve the signers who approved the exact allergen evidence.

Validation: The full CPU suite ran 712 tests. It passed 706, failed zero and skipped six. All 21 focused release materialization checks passed, including verification of the signers sent to the PDF renderer. The combined worker, release and retry checks passed 28 of 28. The CPU typecheck passed. The production build passed and generated all 18 static pages.

Deployment: none.
