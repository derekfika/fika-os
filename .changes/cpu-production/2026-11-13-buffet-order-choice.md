# 2026-11-13 — Show buffet selection in CPU orders

The existing CPU Production Order detail now renders the versioned Hot Fork Buffet choice stored on its Hospitality line. It shows selected mains with guest portions, salads awaiting manual portion confirmation, and desserts with exact or pending quantities. Historical menu versions show stable IDs for review. This is read-only booking evidence; CPU production quantities and signoff are unchanged.

Validation: four focused choice/ordered-quantity tests, 15 presentation/responsive tests, CPU typecheck and production build passed. The full CPU suite stalled on unchanged consumer-invalidation tests; a bounded serial retry timed out on four such tests and was stopped.

Deployment: none.
