# 2026-11-10 — Hot Fork Buffet handoff notices and demand

Added exact-ID Hot Fork Buffet classification, bounded OPLOC-scoped demand projection, and versioned transactional outbox notices for first CPU handoff, approved changes and cancellations. The worker resolves Brian only through a unique active matched AUTHMOD identity; recipient identity is captured in send evidence and failures remain retryable.

Validation: Hub typecheck/build passed; full Hub suite passed (1,156 tests: 1,034 passed, 122 skipped), including focused booking/demand notification tests. The platform-specs submodule was initialized at the repository-pinned revision for validation. Staging email delivery remains gated and was not attempted.
Deployment: none.
