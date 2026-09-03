# Staging App Hosting build provenance

The staging App Hosting backends are connected to the repository `derekfika/fika-os` in project `fika-os-dev`:

| App | Backend |
| --- | --- |
| Menu Planning | `fika-menu-planning-staging` |
| CPU Production | `fika-cpu-production-staging` |
| Delivered-In | `fika-delivered-in-staging` |

For an explicit staging rollout of the current clean checkout, run from the repository root:

```powershell
.\scripts\deploy-staging-apphosting.ps1 -App menu-planning
```

The wrapper derives `git rev-parse HEAD`, refuses a dirty worktree or non-full SHA, and passes that exact SHA to `firebase apphosting:rollouts:create`. The Next.js build configuration independently resolves the same checkout SHA (or a full commit SHA supplied by the build environment), injects it as the non-secret `FIKA_BUILD_SHA`, and fails closed if the sources disagree or no SHA is available. This keeps the protected build-info endpoints tied to the deployed source commit without requiring a manually maintained value.

The human-approved Grab & Go source is migration input only. Validate it without publishing:

```powershell
Set-Location C:\FIKA-UAT\apps\cpu-production
npx tsx scripts/publish-grab-and-go-catalogue.ts C:\FIKA-UAT\apps\delivered-in\app\grab-and-go\grab-and-go-catalogue.json --validate-only
```

Publishing the validated products remains an explicit CPU-side operation and is not part of an application deployment.
