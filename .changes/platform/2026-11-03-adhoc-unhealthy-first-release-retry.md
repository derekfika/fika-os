# 2026-11-03 — Retry an unhealthy Ad-Hoc first release safely

The release workflow can now recognize only the exact abandoned Ad-Hoc first production rollout recorded as unhealthy, with stable 100% traffic, exact source/build/rollout lineage, production environment selection, disabled automatic rollouts and no active operations. It remains fail-closed for unknown or changed attempts and does not invent a rollback baseline.

Validation: focused policy/release tests passed (36/36; including stable-snapshot retry checks). Exact-source CI pending.
Deployment: none.
