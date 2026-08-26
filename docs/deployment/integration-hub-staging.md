# Integration Hub staging deployment

## Deployment shape

Firebase App Hosting is suitable for the first hosted Integration Hub alpha. In the App Hosting backend setup, use the repository `derekfika/fika-os`, set the root directory to `apps/integration-hub`, and use the `feature/authmod-access-control` branch only for an explicit staging rollout. App Hosting has monorepo root-directory support; the app's own `package.json` and lockfile are therefore the build boundary, while `next.config.ts` retains the repository root for the existing `shared/` imports.

The app uses Next.js `16.2.12`, requires Node `>=22.13.0`, builds with `npm run build` (`next build`), and runs with `npm run start` (`next start -p 3200`). App Hosting can infer these Next.js commands; do not override them unless a rollout build demonstrates a framework-adapter issue.

`apps/integration-hub/apphosting.staging.yaml` supplies only safe staging defaults. Name the App Hosting environment `staging` so the environment-specific file is selected. No deployment is performed by this change.

## Required staging environment

Set these in App Hosting environment configuration. The four `NEXT_PUBLIC_FIREBASE_*` values come from the `fika-os-dev` web app and are public client configuration, not server credentials:

```text
FIKA_RUNTIME_MODE=staging
FIREBASE_PROJECT_ID=fika-os-dev
FIKA_ALLOWED_EMAIL_DOMAINS=fikacatering.com
NEXT_PUBLIC_FIREBASE_API_KEY=<fika-os-dev web app API key>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<fika-os-dev auth domain>
NEXT_PUBLIC_FIREBASE_PROJECT_ID=fika-os-dev
NEXT_PUBLIC_FIREBASE_APP_ID=<fika-os-dev web app ID>
```

Firebase App Hosting provides Application Default Credentials through the attached service identity. The current Admin SDK initialization uses that identity for Auth and Firestore; `GOOGLE_APPLICATION_CREDENTIALS` is not required and must not reference a local file.

## Secrets and connector posture

Keep these out of Git and store them as App Hosting/Secret Manager secrets only if the corresponding connector is deliberately enabled:

- `BRIGHTHR_CLIENT_SECRET`, `BRIGHTHR_CLIENT_ID`, `BRIGHTHR_TOKEN_URL`, `BRIGHTHR_API_BASE_URL`
- `SQUARE_ACCESS_TOKEN`, `SQUARE_API_VERSION`, `SQUARE_API_BASE_URL`
- `FIKA_INTERNAL_API_TOKEN`, `MNK_CANON_BRIDGE_TOKEN`
- `FIKA_EMAIL_WEBHOOK_URL`
- Gmail/Calendar OAuth client and token material; hosted workers must use a managed secret or a hosted Google identity, never a Windows path

The staging file keeps BrightHR and Square in `fixture` mode. Do not copy `BRIGHTHR_MODE=live-local`, `SQUARE_MODE=live-local`, emulator hosts, `FIKA_LOCAL_GOOGLE_AUTH`, `INTEGRATION_HUB_DATA_ROOT`, `GOOGLE_APPLICATION_CREDENTIALS`, or any `C:\FIKA\...` path into staging.

## Launcher URLs

The launcher now uses localhost defaults only when runtime mode is local. In staging, configure the real HTTPS application URLs before expecting those tiles to appear:

```text
FIKA_APP_CPU_URL=https://<staging-cpu-host>
FIKA_APP_LOGISTICS_URL=https://<staging-logistics-host>
FIKA_APP_MENU_PLANNING_URL=https://<staging-menu-host>
FIKA_APP_HOSPITALITY_URL=https://<staging-hospitality-host>/workspace
FIKA_APP_DELIVERED_IN_URL=https://<staging-delivered-in-host>
FIKA_APP_AD_HOC_URL=https://<staging-ad-hoc-host>
FIKA_ALLOWED_APP_ORIGINS=<comma-separated HTTPS origins used for returnTo>
```

Do not replace these placeholders with guessed URLs. Until an app has a real HTTPS staging URL, its tile is omitted rather than linking a staging user to localhost.

## Firestore/Auth bootstrap

Before the first alpha sign-in:

1. Enable Google sign-in in Firebase Authentication for `fika-os-dev` and add the hosted App Hosting domain to Firebase Auth authorized domains.
2. Configure the Google provider's Workspace/domain restriction as required by the existing `fikacatering.com` server-side allow-list.
3. Deploy or verify `firestore.rules` and `firestore.indexes.json` against `fika-os-dev` through an approved release action; this change does not deploy them.
4. Run the reviewed AUTHMOD application-registry bootstrap against staging Firestore, then create/link the initial person administrator through the reviewed AUTHMOD path. Do not copy local emulator exports or local fixture identities into staging.
5. Use `GET /api/auth/runtime` as the lightweight runtime smoke check. It should return `200`, `local: false`, and `googleWorkspaceAvailable: true` once the public web config is present.

The existing server-side Firestore repository uses the real `fika-os-dev` project outside local mode. Its local filesystem snapshot/upload helpers are not a durable hosted data store; avoid enabling workflows that depend on those local artifacts until a hosted storage boundary is provided.

## Firebase Console/App Hosting checklist

- Create the App Hosting backend in project `fika-os-dev` from the GitHub repository and set root directory `apps/integration-hub`.
- Use the `staging` environment configuration and keep automatic production rollouts disabled.
- Grant the App Hosting backend service identity the least-privilege Firebase Auth verification and Firestore access it needs.
- Add the generated App Hosting hostname to Firebase Authentication authorized domains.
- Add the generated HTTPS application origins to `FIKA_ALLOWED_APP_ORIGINS` and to any relevant Google/Firebase authorized-origin configuration.
- Confirm the deployed `/api/auth/runtime` response before testing Google sign-in; no local emulator variables should be visible in the rollout environment.
