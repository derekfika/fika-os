# Logistics driver notifications: recovery scheduler

Driver change events are processed immediately after each planner save. A bounded Cloud Scheduler call is the safety net for
events whose post-save processing was interrupted (for example the instance stopped between the commit and the processing).

**What it can and cannot do.** Recovery retries events that were committed. It cannot reconstruct a change that failed to capture in
the first place; those are surfaced as capture gaps (see below and `driver-notifications-coverage.md`).

The route is `POST /api/logistics/driver-notifications/process`. It processes at most 50 pending events, is idempotent and safe to
overlap, and returns counts only:

```json
{ "processed": 0, "created": 0, "expired": 0, "openCaptureGaps": 0 }
```

`openCaptureGaps` above zero means a committed planner change could not be captured as an event. `-1` means the gap count itself
could not be read.

## Authentication: no secret in the job

The scheduler job authenticates with a Google-signed **OIDC identity token** for a dedicated, role-less service account
(`fika-logistics-notif-scheduler@<project>.iam.gserviceaccount.com`). The route verifies the signature against Google's published
certificates, the fixed audience `fika-logistics-driver-notifications-process`, expiry, and that the token's verified email is
exactly that project's scheduler account. No shared secret is stored in the job's metadata, command history or logs. A vehicle PIN
session is never accepted. (The older internal-token header is still accepted by the route for tooling, but the scheduler does not
use it: a header token appears in `gcloud scheduler jobs describe` output.)

## Configuration (staging)

| Setting | Value |
|---|---|
| Project / region | `fika-os-dev` / `europe-west4` |
| Job | `fika-logistics-driver-notifications-recovery` |
| Schedule | `*/5 * * * *`, time zone `Europe/London` |
| Target | `POST https://logistics-staging.fikacatering.com/api/logistics/driver-notifications/process` |
| Auth | OIDC, service account `fika-logistics-notif-scheduler@fika-os-dev.iam.gserviceaccount.com`, audience `fika-logistics-driver-notifications-process` |
| Retry | 3 attempts, 10 s to 60 s backoff, 30 s deadline |

Create once per environment, after the application code and indexes are deployed (staging first; production is a separate
approved release):

```powershell
gcloud iam service-accounts create fika-logistics-notif-scheduler --project=fika-os-dev --display-name="Logistics driver notifications scheduler"
gcloud scheduler jobs create http fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4 --schedule="*/5 * * * *" --time-zone="Europe/London" --uri="https://logistics-staging.fikacatering.com/api/logistics/driver-notifications/process" --http-method=POST --oidc-service-account-email="fika-logistics-notif-scheduler@fika-os-dev.iam.gserviceaccount.com" --oidc-token-audience="fika-logistics-driver-notifications-process" --attempt-deadline=30s --max-retry-attempts=3 --min-backoff=10s --max-backoff=60s
```

The service account holds no IAM roles: it only mints an identity token, which the route checks.

## Verify

```powershell
gcloud scheduler jobs describe fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4
gcloud scheduler jobs run fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4
```

Then check Cloud Logging for the request (HTTP 200) and the next scheduled run.

## Pause and rollback

Pause (stops all scheduled calls; nothing else depends on the job, events are still processed after each save):

```powershell
gcloud scheduler jobs pause fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4
gcloud scheduler jobs resume fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4
```

Remove completely:

```powershell
gcloud scheduler jobs delete fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4
gcloud iam service-accounts delete fika-logistics-notif-scheduler@fika-os-dev.iam.gserviceaccount.com --project=fika-os-dev
```

Cost: one bounded pending-event query plus one gap-count aggregate every five minutes (288 runs a day).

## Capture-gap alert

A log-based metric `logistics_driver_notification_capture_gaps` counts log lines containing
`[driver-notifications] CAPTURE GAP` from the Logistics service, and an alert policy "Logistics driver notification capture gap"
opens an incident when the count is above zero in a 5 minute window. Each occurrence is a committed planner change that may not
have notified a driver. The staging project has no notification channel configured, so incidents appear in Cloud Monitoring only
until a channel (for example email) is attached to the policy; adding one is an owner decision.
