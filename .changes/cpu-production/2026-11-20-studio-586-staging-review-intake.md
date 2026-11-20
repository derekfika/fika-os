# 2026-11-20 — Accept exact Studio dish revisions in staging CPU

Add a staging-only CPU intake that accepts Google identity tokens for the dedicated Studio runtime. CPU registers an exact saved dish revision once and keeps the existing company-wide person-only checker, two distinct signers, immutable release history and revocation. Status checks validate the release and signing events and return only the subject and readiness proof.

Validation: focused intake and isolated CPU checker tests, TypeScript and production build.
Deployment: none. Staging review remains disabled until an approved release enables FIKA_CPU_STUDIO_REVIEW_ENABLED.
