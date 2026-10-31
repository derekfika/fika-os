# 2026-10-31 — Logistics desktop capability contract

The shared Logistics authority type now defines the View/Manage capability pair carried from Hub AUTHMOD admission to the Logistics server. This keeps desktop application capability separate from explicit vehicle resource grants and mobile PIN identity.

Validation: Hub and Logistics focused authorization tests, both typechecks and production builds passed; hosted exact-source CI remains required.
Deployment: none.
