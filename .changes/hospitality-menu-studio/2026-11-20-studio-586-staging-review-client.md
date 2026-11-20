# 2026-11-20 — Request staged CPU review from a saved Studio revision

Studio authors can send the exact archived revision via the staging CPU interface when explicitly enabled. The existing Food safety panel shows only current CPU evidence for the saved revision. Studio keeps drafts in its dedicated database and does not send browser credentials to CPU.

Validation: Studio unit and isolated Firestore tests, TypeScript and production build.
Deployment: none. Staging review remains disabled until an approved release enables FIKA_STUDIO_CPU_REVIEW_ENABLED. Publication, activation and production handoff remain closed.
