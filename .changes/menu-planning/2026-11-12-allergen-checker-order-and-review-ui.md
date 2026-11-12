# 2026-11-12 — Allergen Checker order and review UI

Allergen Checker uses the shared 29-slot menu ordering, places additional rows deterministically without changing slot or entry identities, groups dishes by menu section, and shows compact per-day and per-row review progress with accessible allergen states. Conflicting No Key declarations are blocked without clearing named Contains/May Contain values. Saving remains an explicit planned-allergen update; CPU approval and sign-off are separate.

Validation: final serial Menu Planning suite 558 passed / 4 skipped; Menu Planning typecheck and production build passed; order/layout/read-path and allergen-row tests 51/51; CPU allergen contract/review tests 26/26 and CPU typecheck passed; browser checks for keyboard editing, conflicting No Key retention, draft navigation/save 3/3. Live WC 16 November production data comparison is blocked because local GCP authentication requires reauthentication and the authenticated browser session has no Menu Planning tab.
Deployment: none yet; staging preview planned for review, production not authorized.
