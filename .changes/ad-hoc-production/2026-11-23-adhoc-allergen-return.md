# 2026-11-23 — Show the current signed Ad-Hoc checker

Ad-Hoc order details show CPU's live checker state and signer names, with PDF access routed through the authenticated Ad-Hoc session and Hub. No allergen entry or signing authority moved into Ad-Hoc. Style Guide compliance: PASS; the read-only status uses the existing operational card, semantic status text, and a keyboard-accessible link.

Validation: `npm run typecheck`, `npm test` (38 passed, 0 failed, 11 emulator-only skips), and the Firestore-emulator Ad-Hoc suite (11/11 passed); `npm run build` passed. Authenticated browser UAT not performed because no authenticated in-app browser session was available.
Deployment: none.
