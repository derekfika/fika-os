# 2026-11-20 — Restore the Menu Studio storyboard layout

Rework the Studio dashboard, menu wizard, section and rotation editors, dish and assortment screens, previews, publication review and history to follow the original #586 board. Separate editor components and retain the existing authoring and authority boundaries. Refresh the in-memory draft list after restore so an immediate reopen starts from the acknowledged version.

Validation: 20 Studio tests, 2 isolated Firestore emulator tests, TypeScript and a production build. Browser comparisons at desktop and tablet sizes, narrow layout checks, keyboard focus, and fictional authoring, conflict, restore and rotation checks.

Deployment: pending visual approval and a separate governed staging rollout.
