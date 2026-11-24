# 2026-11-24 — Menu scoped CPU run sheets

Carried supplementary menu identity and label through canonical Production Orders. CPU run sheet grouping now separates two services routed to the same OPLOC and prints the menu name with the destination. Primary menu order identities and legacy payload defaults are preserved.

Validation: PR and post-merge GitHub checks passed; focused CPU tests (62 passed), typecheck and build; regression tests cover separate same-site service identities, allergen print context, Gastro Labels and totals allocation. Staging: deployed and verified at main SHA `5e436da8d5666ad2f9794b1655be6352cec3d62d`; authenticated custom-domain access and served build verified. Feature data UAT remains pending a designated fictional staging OPLOC; no order was created. Production: not deployed.
