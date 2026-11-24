# 2026-11-24 — Supplementary menu service metadata

Extended the shared external production schema to carry optional, validated supplementary menu identity, display name, service type, service time and kitchen notes. The metadata is accepted only from Menu Planning and is required as a complete identity/name/type set when present.

Validation: Menu Planning/CPU/Hub typechecks and builds; Delivered-In build; Hub contract test. Deployment: staging pending; production not deployed.
