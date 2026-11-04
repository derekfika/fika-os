# 2026-11-04 — Recognize the Logistics production authentication gate

The governed release health probe now accepts Logistics production's exact FIKA session redirect as healthy, with strict production Hub origin, app, error, and return URL checks. Other probe statuses and redirects remain fail-closed.

Validation: `node --test tools/workflow/releases.test.mjs` — 21 passed; workspace scope and changelog checks passed.
Deployment: none.
