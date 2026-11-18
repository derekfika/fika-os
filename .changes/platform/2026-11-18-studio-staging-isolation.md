# 2026-11-18 — Observe Studio hosting history and shared artifact exposure

Add bounded read-only observations for App Hosting build and rollout history and the managed Artifact Registry repository. An empty package list leaves isolation unverified. Document the local-first preview, proposed Studio-only staging project and release evidence gates.

Validation: Studio staging workflow tests, Studio unit and isolated Firestore emulator tests, loopback authoring HTTP smoke, read-only cloud metadata, IAM condition lint and App Hosting validate-only request.
Deployment: none.
