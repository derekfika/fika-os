# 2026-11-18 — Keep Studio App Hosting closed pending staging isolation

Remove the active environment overlays and preserve a closed default for App Hosting. The staging runbook records the proposed isolated Firestore database, dedicated identity and required Studio AUTHMOD admission.

Validation: Studio unit tests, typecheck, build and isolated Firestore emulator tests.
Deployment: none. Cloud staging and production remain unavailable.
