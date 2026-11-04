# 2026-11-04 — Correct synthetic Drive identity test fixtures (#365)

CPU test fixtures now establish the production project identity using mocked metadata, while staging remains blocked and Hospitality's local test path stays explicit. Updated the Delivered-In route source assertion to preserve the fresh stored revision check.

Validation: focused matrix Drive config tests 6/6, Ad-Hoc signing tests 4/4, and Delivered-In review tests 8/8 passed. The full CPU suite was interrupted after local isolated workers did not exit; exact-source CI 41930424641 had completed but failed two source assertions under active #251 ownership plus other now-corrected fixtures. No build rerun.
Deployment: none.
