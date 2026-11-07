# 2026-11-07 — Beverage local document review

Add DOCX, PPTX and PDF file selection to the local recipe review alongside pasted text. Show the file and extraction provenance, retain the original file in page memory for fingerprint-bound confirmation and same-key retries, invalidate review on a source change, and surface format, size, signature and extraction errors. Google sources require manual export or paste; no file bytes, full extracted text, external API calls or staging persistence are added.

Style Guide compliance: PASS — the review uses shared FIKA semantic tokens and labelled native controls, visible keyboard focus, state text and responsive layouts.

Validation: document and pasted review component tests, local emulator integration, app tests, typecheck, build, audit, desktop/tablet browser journeys and affected exact-source CI. See the PR for actual results.

Deployment: none.
