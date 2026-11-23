# 2026-11-23 — Resolve assigned dishes outside the loaded page

Studio can look up known assigned dish IDs in bounded, authenticated batches without scanning the library or changing menu data. The section client can distinguish missing dishes from a failed lookup and offer a retry; existing draft, publication and catalogue authorities are unchanged.

Validation: Studio tests (57 passed), typecheck and production build; integrated browser verification pending.
Deployment: none.

