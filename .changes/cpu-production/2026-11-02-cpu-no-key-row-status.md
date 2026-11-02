# 2026-11-02 — CPU No Key row-level status and conflict state (#251)

Restored a visible row-level No Key status in the CPU review column (not verified / legacy not verified / conflict / No Key Allergens declared) while the allergen cell stays text-free. A No Key conflict (ticked with named allergens) is now announced as a conflict (aria-pressed mixed), shown with a danger outline and still blocks Mark checked/signing. The legend swatch is text-free, a visible :focus-visible ring was added for allergen squares, and dead .cpu-no-key-* CSS was removed. Click semantics, persistence, signing and hashing are unchanged.

Validation: targeted CPU allergen tests (46) and tsc --noEmit passed; full npm test: only durable-outbox tests timed out locally (CI covers).
Deployment: none.
