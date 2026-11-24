# 2026-11-24 — Enforce the five-worktree lifecycle

Governed workspace creation now reserves one of five machine-wide task slots or queues the owner. Post-merge retirement checks the exact main PR and local source, protects active or interrupted operations, preserves Git evidence, and removes verified generated files with the checkout. Windows health checks report NTFS allocation with hardlink deduplication. Local installs share locked npm downloads while maintaining checkout-local dependency trees.

Validation: Windows workspace concurrency, merge retirement and recovery fixtures. Representative Ad-Hoc npm install, 42 unit/contract tests, typecheck, production build and 11 isolated Firestore emulator tests passed.
Deployment: none. App Hosting and CI package managers are unchanged.
