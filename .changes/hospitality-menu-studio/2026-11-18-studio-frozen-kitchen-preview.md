# 2026-11-18 — Preview frozen Studio kitchen specifications

The isolated Studio API reads the exact publication and selected dish, verifies that its signed CPU release is still current, and calculates fixed assortment counts per box and across the requested boxes. The response is a content preview. A changed draft cannot rewrite the frozen kitchen description, and a revoked or replaced release blocks preview.

Validation: Studio typecheck, unit tests, build and isolated Firestore route coverage. Deployment: none.
