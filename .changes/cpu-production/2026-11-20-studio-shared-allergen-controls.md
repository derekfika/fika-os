# 2026-11-20 — Reuse CPU allergen controls for Studio dishes

Share the existing Hospitality allergen box between production reviews and the exact-revision Studio dish review. Studio dish rows use the same explicit No Key declaration, named-allergen cycle and CPU signature dialog.

Validation: 634 CPU unit tests passed, six skipped, plus the shared-cell regression, typecheck and production build against the local review API dependency. A browser with an isolated Firestore fixture and synthetic reviewer checked keyboard operation, blank-row rejection, Contains/May Contain and No Key transitions at desktop, tablet and narrow widths. The inherited signature pad requires pointer input.
Deployment: not deployed.
