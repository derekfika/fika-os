# 2026-11-18 — Observe Studio hosting history and shared artifact exposure

Add bounded read-only observations for App Hosting build and rollout history and the managed Artifact Registry repository. An empty package list leaves isolation unverified. Document the approved-project architecture options, named database permission scope and first-release evidence gates.

Validation: Studio staging workflow tests, real read-only metadata, IAM condition lint and App Hosting validate-only request.
Deployment: none.
