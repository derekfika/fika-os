# 2026-11-01 — Week Planner historical dish references

Adds a bounded, optional `dishReferences` v1 consumer for saved Week Planner entries. Reclassified, archived, verified merged and unresolved references receive semantic cell tints and keyboard/touch accessible explanatory tooltips; saved IDs, labels, slots and quantities remain unchanged. Explicitly archived/merged IDs are excluded from new picker and copy choices. The provider is a separate #151 change and is not yet integrated.

Validation: final focused tests 8/8 and typecheck passed; optimized build passed after the final consumer guard changes. The Menu Planning suite passed 436 tests with 1 skipped before the final provenance-boundary adjustment. Governed `fika validate` was interrupted after its workflow tests stalled during a fixture workspace creation; exact-source CI remains pending. Deployment: none; staging isolation remains unverified.
