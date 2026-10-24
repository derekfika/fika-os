<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Ad-Hoc Production — app guide

Lightweight requester workspace for bespoke, one-off food orders. It is **not** a production, scheduling, quoting or allergen system.

- **Ownership:** this app owns only the requester's request (`fikaAdHocProductionOrdersV2`: draft/edit/archive/duplicate, send state, history). The canonical Production Order, CPU allergen review/signing/release and the Logistics Fulfilment Requirement stay Hub/CPU/Logistics-owned. Never add a parallel order, schedule or fulfilment store.
- **Handoff:** `lib/ad-hoc-service.ts` → Hub `createCpuProductionOrder` (first send) / `amendAdHocProductionOrder` (later sends, same canonical order) / `transitionProductionOrder(..."cancelled")`. Idempotency key `adhoc-send:<requestId>:v<version>`. Do not create a second order per revision.
- **Destinations:** existing OPLOCs are validated server-side against the caller's Hub-authorised list (aliases resolved via Hub redirects; label/address snapshots are server-built). One-off addresses use the request-scoped identity `adhoc-destination:<requestId>` plus an order-scoped snapshot — never a fake OPLOC.
- **Ready time** is a ready-by request (`requiredBy`, `serviceWindow.startTime`). Logistics owns dispatch; never present it as a dispatch or arrival time.
- **Allergens:** no allergen evidence is sent. Lines reach CPU unreviewed and go through CPU's normal review.
- **Lifecycle:** DRAFT → SENT_TO_CPU → NEEDS_UPDATE (edited after send; CPU keeps the last sent version until the requester sends the update) → CANCELLED. Never-sent drafts are archived; sent requests are cancelled so CPU/Logistics withdraw the work. CPU refuses amendments once it has started the order.
- **Dates:** service dates are Europe/London business dates (`londonBusinessDate`); never slice UTC timestamps.
- **Legacy:** quote-era documents in `fikaAdHocProductionRequestsV1` are historical evidence; this app neither reads nor rewrites them. Quotes, pricing and the Allergen Review/checker surfaces are intentionally absent.
- **UI:** follow `docs/STYLE-GUIDE.md`; approved mockups are in `apps/ad-hoc-production/docs/ui-evidence/`. No native browser dialogs.
- **Tests:** `npm test` (unit + source-contract; emulator tests skip without it); `npm run test:emulator` with `FIREBASE_PROJECT_ID=demo-fika-os FIRESTORE_EMULATOR_HOST=127.0.0.1:8292 FIKA_RUNTIME_MODE=local`.
