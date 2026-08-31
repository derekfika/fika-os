# FIKA OS Delivered-In

Phase 1 is a read-only site projection of immutable Menu Planning publications. It uses the Integration Hub session cookie and Hub-side synthetic site assignments; it does not own menu truth or editable rolling-menu state.

Run locally with `npm run dev` on port 3800 (`http://localhost:3800`). Sign in through the Integration Hub first so the shared `fika_hub_token` cookie is present.

Synthetic assignments:

- `admin@local.fika`: all known/local active OPLOCs
- `reviewer@local.fika`: Haleon and FIKA Xchange
- `viewer@local.fika`: Haleon

The assignments are isolated in `apps/integration-hub/lib/delivered-in-access.ts` and can be replaced by real identity/site assignment resolution later.

## Phase 2 site menus

Set `GOOGLE_DELIVERED_IN_TEMPLATE_ID` to the generic FIKA Slides template and `GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID` to the shared Delivered-In Drive folder. The template can use `{{SITE_NAME}}`, `{{SERVICE_DATE}}`, `{{WEEK_COMMENCING}}`, `{{SALADS}}`, `{{HOT_MAINS}}` and `{{SIDES_EXTRAS}}` tokens. Slides containing an empty section token are omitted from the generated deck.

Google OAuth uses the existing `GOOGLE_OAUTH_CLIENT_FILE` and `GOOGLE_OAUTH_TOKEN_FILE` refresh-token flow. Generated decks are derived from the current immutable site projection and recorded locally in `local-data/delivered-in/site-menus.json`; publication records are never changed. A later publication amendment automatically marks the prior generated deck as stale until regenerated.

Generated menus and Delivered-In allergen PDFs are placed beneath a deterministic `WC_YYYY-MM-DD` folder under their configured Drive root. Regenerating a site menu creates the replacement from the template first, then trashes the previous active deck only after successful generation.

## Grab & Go ordering

The `Grab & Go` navigation loads the CPU-owned catalogue seeded from `Master Grab n Go.xlsx`. Orders are scoped to the authenticated OPLOC and are available for upcoming Monday and Wednesday deliveries only. The next-day production cutoff is 12:00 local time; after that cutoff an order is read-only. Set `GRAB_N_GO_ROTATION_WEEK_1_DATE` to the governed date for rotation week 1 (default `2026-08-24`).

Catalogue records and auditable order history are stored locally under `local-data/delivered-in/` for this local Phase 1 workflow. Orders retain stable OPLOC/product IDs and snapshot the product name, category, sort order and price at each submission or amendment.

CPU Production reads submitted Grab & Go fulfilment truth through `GET /api/delivered-in/grab-and-go/production`; it does not read this app's files. Set `DELIVERED_IN_GRAB_AND_GO_API_URL` in CPU Production when the apps are deployed separately, and use `FIKA_INTERNAL_API_TOKEN` in both apps for the service-to-service request.
