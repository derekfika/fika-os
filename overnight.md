# Overnight Operating Notes — Staging Browser Access

This note supplements the repository operating policy in [`AGENTS.md`](AGENTS.md). Repository and app guides, deployment controls, data-safety rules, and issue-specific instructions remain authoritative where applicable.

## Staging browser URLs

Use the operator-facing custom domains for browser navigation and authenticated staging UAT. Start from the authenticated Hub landing page:

- Hub: <https://staging-os.fikacatering.com/>
- Menu Planning: <https://menu-planning-staging.fikacatering.com/>
- CPU: <https://cpu-staging.fikacatering.com/>
- Delivered-In: <https://delivered-in-staging.fikacatering.com/>
- Logistics: <https://logistics-staging.fikacatering.com/>
- Hospitality: <https://hospitality-staging.fikacatering.com/>
- Ad-Hoc: <https://adhoc-staging.fikacatering.com/>

Do not use Firebase `*.hosted.app` addresses as browser or operator URLs. They are deployment/service origins, not substitutes for the custom domains configured for staging access.

Use the user's authenticated in-app browser session when available. Before relying on browser UAT, verify the custom-domain sign-in/return round-trip and confirm the served application build through governed release evidence and the app's build-info endpoint where available. Keep the user's session and custom-domain URL intact when moving between apps.

If the authenticated in-app browser cannot be accessed, report the exact access limitation and mark authenticated UI journeys BLOCKED. Continue safe, independent read-only, API, emulator, or code-backed checks. Do not infer browser access from a URL supplied in ambient context, and do not report an unobserved browser journey as passing.

## Staging and production boundary

Staging UAT uses isolated, authorised staging fixtures only. Production remains untouched unless a separate explicit owner release instruction authorises a governed production deployment. Staging access does not authorise production data changes, operational emails, live Calendar writes, signed packets, PDFs, or Drive writes. Verify required isolation controls before attempting any such side effect; if unverified, block the affected test and continue unaffected work.

For each UAT journey, record the custom URL, app/build/source SHA, scenario, observed result, evidence, and outstanding issue. Keep staging deployment verification separate from UI acceptance; Brian's operational acceptance remains a separate gate.
