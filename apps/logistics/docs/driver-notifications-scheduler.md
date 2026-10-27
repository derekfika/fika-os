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

## Configuration (staging): three jobs, one endpoint

Recovery runs more often while the planners and drivers are working and rarely overnight. All three jobs are in `fika-os-dev`,
`europe-west4`, use the **IANA time zone `Europe/London`** (never a fixed UTC offset), call the same endpoint, and authenticate with
the same OIDC service account. Normal notification processing is still immediate after each planner save; these jobs are only the
recovery safety net.

| Job | UK local window | Cron (Europe/London) |
|---|---|---|
| `fika-logistics-driver-notifications-recovery-day` | 06:00 to 15:59, every minute | `* 6-15 * * *` |
| `fika-logistics-driver-notifications-recovery-evening` | 16:00 to 17:55, every five minutes | `*/5 16-17 * * *` |
| `fika-logistics-driver-notifications-recovery-overnight` | 18:00 to 05:00, hourly | `0 18-23,0-5 * * *` |

Common settings: target `POST https://logistics-staging.fikacatering.com/api/logistics/driver-notifications/process`; OIDC service
account `fika-logistics-notif-scheduler@fika-os-dev.iam.gserviceaccount.com`, audience `fika-logistics-driver-notifications-process`;
3 attempts, 10 s to 60 s backoff, 30 s deadline. The earlier flat five-minute job
(`fika-logistics-driver-notifications-recovery`) was deleted so nothing overlaps; every UK minute is covered by exactly one job.

Create once per environment, after the application code and indexes are deployed (staging first; production is a separate
approved release):

```powershell
gcloud iam service-accounts create fika-logistics-notif-scheduler --project=fika-os-dev --display-name="Logistics driver notifications scheduler"
$common = @("--project=fika-os-dev","--location=europe-west4","--time-zone=Europe/London","--uri=https://logistics-staging.fikacatering.com/api/logistics/driver-notifications/process","--http-method=POST","--oidc-service-account-email=fika-logistics-notif-scheduler@fika-os-dev.iam.gserviceaccount.com","--oidc-token-audience=fika-logistics-driver-notifications-process","--attempt-deadline=30s","--max-retry-attempts=3","--min-backoff=10s","--max-backoff=60s")
gcloud scheduler jobs create http fika-logistics-driver-notifications-recovery-day --schedule="* 6-15 * * *" @common
gcloud scheduler jobs create http fika-logistics-driver-notifications-recovery-evening --schedule="*/5 16-17 * * *" @common
gcloud scheduler jobs create http fika-logistics-driver-notifications-recovery-overnight --schedule="0 18-23,0-5 * * *" @common
```

The service account holds no IAM roles: it only mints an identity token, which the route checks.

## UK clock changes

Cloud Scheduler evaluates each cron in the job's IANA zone, so it follows BST/GMT by itself. `tests/recovery-schedule.test.ts` models the
three crons across both 2027 transitions and asserts: exactly one job fires at any minute, 06:00 / 16:00 / 18:00 each begin the right
schedule, and real-time gaps never exceed one hour. Expected UTC times (UK local to UTC):

| Day | 05:00 | 06:00 (day starts) | 15:59 | 16:00 (evening starts) | 17:55 | 18:00 (overnight starts) |
|---|---|---|---|---|---|---|
| Fri 26 Mar 2027 (GMT) | 05:00Z | 06:00Z | 15:59Z | 16:00Z | 17:55Z | 18:00Z |
| Sun 28 Mar 2027 (GMT to BST at 01:00) | 04:00Z | 05:00Z | 14:59Z | 15:00Z | 16:55Z | 17:00Z |
| Mon 29 Mar 2027 (BST) | 04:00Z | 05:00Z | 14:59Z | 15:00Z | 16:55Z | 17:00Z |
| Sun 31 Oct 2027 (BST to GMT at 02:00) | 05:00Z | 06:00Z | 15:59Z | 16:00Z | 17:55Z | 18:00Z |
| Mon 1 Nov 2027 (GMT) | 05:00Z | 06:00Z | 15:59Z | 16:00Z | 17:55Z | 18:00Z |

The hourly overnight job at 01:00 local needs care on the two change nights:

- **28 March 2027** (clocks go from 01:00 GMT to 02:00 BST): local 01:00 does not exist. The overnight run is 00:00Z (00:00 GMT) then
  01:00Z (02:00 BST): still hourly in real time, no gap.
- **31 October 2027** (clocks go from 02:00 BST back to 01:00 GMT): local 01:00 happens twice (00:00Z and 01:00Z). The model fires
  both; if Cloud Scheduler fires only once the worst case is a two-hour gap in the overnight recovery net only. Both outcomes are
  safe because the processor is idempotent: an event is committed once, notices are created only if absent, and overlapping or
  duplicate invocations (verified by concurrent-processor emulator tests) change nothing. Eligibility uses the authoritative
  server-side Europe/London service date (`londonServiceDate`), checked in the same test across both changes.

Scheduler behaviour in the skipped and repeated hour is Google's; it cannot be simulated ahead of time, so confirm the logged
execution times on 28 March and 31 October 2027 (or before the first production release) by reading the scheduler logs.

## Verify

```powershell
gcloud scheduler jobs list --project=fika-os-dev --location=europe-west4 --filter="name~driver-notifications"
gcloud scheduler jobs run fika-logistics-driver-notifications-recovery-day --project=fika-os-dev --location=europe-west4
```

Check each job shows `timeZone: Europe/London`, an OIDC token and no secret headers, then look in Cloud Logging for the HTTP 200.

## Pause and rollback

Pause or resume all three (nothing else depends on them; events are still processed after each save):

```powershell
foreach ($tier in "day","evening","overnight") { gcloud scheduler jobs pause "fika-logistics-driver-notifications-recovery-$tier" --project=fika-os-dev --location=europe-west4 }
foreach ($tier in "day","evening","overnight") { gcloud scheduler jobs resume "fika-logistics-driver-notifications-recovery-$tier" --project=fika-os-dev --location=europe-west4 }
```

Remove completely:

```powershell
foreach ($tier in "day","evening","overnight") { gcloud scheduler jobs delete "fika-logistics-driver-notifications-recovery-$tier" --project=fika-os-dev --location=europe-west4 --quiet }
gcloud iam service-accounts delete fika-logistics-notif-scheduler@fika-os-dev.iam.gserviceaccount.com --project=fika-os-dev
```

Cost: 600 calls in the daytime window, 24 in the evening and 12 overnight: 636 a day,
each one bounded pending-event query plus one gap-count aggregate.

## Capture-gap alert

A log-based metric `logistics_driver_notification_capture_gaps` counts log lines containing
`[driver-notifications] CAPTURE GAP` from the Logistics service, and an alert policy "Logistics driver notification capture gap"
opens an incident when the count is above zero in a 5 minute window. Each occurrence is a committed planner change that may not
have notified a driver. The staging project has no notification channel configured, so incidents appear in Cloud Monitoring only
until a channel (for example email) is attached to the policy; adding one is an owner decision.
