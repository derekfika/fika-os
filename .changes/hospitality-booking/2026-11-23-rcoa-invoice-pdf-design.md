# 2026-11-23 — Match the Hospitality quote design in RCoA invoice PDFs

The RCoA invoice PDF now reuses the canonical Hospitality quote masthead, branding, embedded logos, typography and palette. Its invoice table, summary total, financial exception warning, eligibility note and multipage footer follow the same visual system. Canonical booking `notes` use an `Event:` line for meeting titles; the existing “Meeting title not recorded” label remains for bookings without one. No booking, quote, financial, eligibility or access-control data changed.

Validation: Hospitality tests (498/498), typecheck and production build passed. Local rendered PDF samples covered one, five and twenty bookings, multiple pages, long titles and references, a missing title, financial exceptions and an empty period. PNG inspection confirmed embedded FIKA and RCoA logos, Gilroy fonts, repeated table headers and page numbering. The app lint command could not run because the app has no ESLint flat or legacy config.

Deployment: staging release to follow the protected PR merge; production not deployed.
