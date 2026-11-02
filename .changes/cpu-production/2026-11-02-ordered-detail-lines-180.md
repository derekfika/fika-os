# 2026-11-02 — CPU: preserve ordered quantities in order details (#180)

Generic Production Order and Grab & Go detail views now display each line's recorded customer quantity and unit through the existing ordered-evidence formatter. Missing or blank legacy quantity evidence displays “Needs verification”. Headers show the number of ordered lines instead of summing unlike units. Canonical order values, production quantities, guest counts, allergens, signatures, and downstream records are unchanged.

Validation: focused ordered-quantity detail, kitchen-print, and run-sheet print suites (13 passed); CPU typecheck passed. Deployment: none. Staging mixed-unit evidence and physical print UAT remain unverified.
