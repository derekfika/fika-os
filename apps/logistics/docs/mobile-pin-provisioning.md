# Logistics mobile PIN staging provisioning

The helper provisions only these Secret Manager entries in project `fika-os-dev`:

- `LOGISTICS_MOBILE_SESSION_SECRET`
- `LOGISTICS_MOBILE_VAN1_PIN_VERIFIER`
- `LOGISTICS_MOBILE_VAN2_PIN_VERIFIER`

It never prints the entered PIN, verifier, or session secret. PINs are typed into a raw interactive terminal with echo disabled; the secret values are sent to `gcloud` over stdin. The helper does not deploy. Do not run it in a transcript-enabled, redirected, or shared terminal.

## Initial provisioning in Windows PowerShell

Use a private, interactive PowerShell terminal on the authorised staging operator workstation. Authenticate through the normal Google browser flow (no PIN or session secret is involved), and confirm the expected account and project:

```powershell
gcloud auth login
gcloud auth list
gcloud projects describe fika-os-dev --format="value(projectId)"
```

The account needs permission to create the three secret resources if absent and add secret versions in `fika-os-dev`. Then run:

```powershell
cd C:\Fika\agent-workspaces\fika-os\logistics-mobile-pin
node .\apps\logistics\scripts\provision-mobile-pin-secrets.mjs
```

Enter a separate 6–12 digit test PIN for each vehicle when prompted, then re-enter it to confirm. No PIN is passed as a command argument or written into a file. The utility generates each salt with Node's cryptographic random generator and uses the mobile verifier's `scrypt` parameters (`N=16384`, `r=8`, `p=1`, 32-byte key) and `scrypt$<base64url salt>$<base64url derived key>` format. It generates a 256-bit session secret.

The script creates a missing Secret Manager resource with automatic replication, or adds a new version to an existing resource. It prints only the resource names and returned version numbers. It then updates the three pinned secret references in `apps/logistics/apphosting.staging.yaml`. Review and commit any changed pins through the existing PR/CI workflow before an explicitly authorised staging deployment. Firebase App Hosting also needs Secret Manager access to each referenced secret; use the supported `firebase apphosting:secrets:grantaccess <SECRET_NAME>` command for each of the three names, or the approved least-privilege service-agent/runtime binding procedure. Review the project/account before each IAM operation. The helper does not change IAM grants.

## Rotation

Run `node .\apps\logistics\scripts\provision-mobile-pin-secrets.mjs --rotate van1`, `--rotate van2`, or `--rotate all` to add new vehicle verifier version(s). Run `--rotate-session` to create a new session-signing secret version; that invalidates currently issued mobile sessions when the new version is deployed. Each run updates the corresponding pinned staging reference only. Commit and validate the updated staging config and use the governed staging release workflow after the owner authorises deployment. Keep prior secret versions and release history available for recovery; do not destroy old versions as part of rotation.

## Lockout behaviour

Each vehicle has its own shared, vehicle-wide rate limit: the fifth failed attempt within a 15-minute window starts a 15-minute lockout for every operator using that vehicle PIN. The lockout expires automatically; a successful login clears that vehicle's attempt window. There is no manual unlock path. This is simple to explain and prevents rapid guessing, but one operator can temporarily deny the shared vehicle login to other operators. Operators should use the intended PIN carefully and contact the staging owner after a lockout; do not add a broad reset control or lower the lockout without a separate security review.

These credentials are staging-only test credentials. Never use a real staff PIN or represent mobile test access as an individual driver's identity.
