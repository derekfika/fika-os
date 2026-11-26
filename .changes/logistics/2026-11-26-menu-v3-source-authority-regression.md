# 2026-11-26 — #322 Logistics Menu v3 authority regression

Added a synthetic Delivered-In authority regression that distinguishes Production Order/fulfilment version 3 from Menu day version 1. It also verifies rejection of independent order-version, Menu source-version, content-hash, destination-allocation, cancellation, supersession, publication/day withdrawal, and stale publication-day-pointer mismatches.

Validation: `npm exec -- tsx --test tests/menu-source-authority.test.ts` passed 10/10.
Deployment: none.
