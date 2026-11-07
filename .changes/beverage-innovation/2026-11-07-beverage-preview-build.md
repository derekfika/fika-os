# 2026-11-07 — Fix Beverage App Hosting preview build

Configure Beverage's App Hosting build to emit the app-root standalone Webpack bundle and exact FIKA build identity. Restrict the repository-root tracing setup to local Turbopack development. Remove the staging Firestore emulator variable so the preview's no-write runtime does not trip the shared fail-closed emulator guard or configure a persistence endpoint.

Validation: local production build, typecheck, and 15 app tests passed; `npm audit` and `npm audit --omit=dev` reported zero vulnerabilities. Standalone manifest, route manifest, build SHA, placeholder assets, unauthenticated Hub redirect, and API GET/POST 404 responses verified locally. Cloud App Hosting build validation is pending a governed PR and retry.
Deployment: no successful application revision yet. The failed first build was reconciled as an abandoned staging attempt; backend traffic remains empty.
