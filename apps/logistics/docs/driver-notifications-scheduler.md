# Logistics driver notifications: recovery scheduler

Driver change events are processed immediately after each planner save. A bounded Cloud Scheduler call is the safety net for
events whose post-save processing was interrupted (for example the instance stopped between the commit and the processing).

The route is `POST /api/logistics/driver-notifications/process`. It is authenticated by the internal service token
(`x-fika-internal-token`), exactly like `/api/logistics/invalidate`; a driver vehicle session cannot call it. It processes at most
50 pending events, is idempotent and safe to overlap, and returns counts only:

```json
{ "processed": 0, "created": 0, "expired": 0, "openCaptureGaps": 0 }
```

`openCaptureGaps` above zero means a committed planner change could not be captured as an event (see the delivery guarantee in
`apps/logistics/docs/driver-notifications-coverage.md`). A value of `-1` means the gap count itself could not be read.

## Provision once per environment (staging first)

Do this only after the application code and the three Firestore indexes are deployed. It is **not** performed by a repository
change. Use the same internal token already configured for Hub-to-Logistics delivery:

```powershell
$token = (gcloud secrets versions access latest --secret=FIKA_INTERNAL_API_TOKEN --project=fika-os-dev).Trim()
gcloud scheduler jobs create http fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4 --schedule="*/5 * * * *" --uri="https://logistics-staging.fikacatering.com/api/logistics/driver-notifications/process" --http-method=POST --headers="Content-Type=application/json,x-fika-internal-token=$token" --message-body="{}" --time-zone="Europe/London"
```

Verify the job and run it once by hand:

```powershell
gcloud scheduler jobs describe fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4
gcloud scheduler jobs run fika-logistics-driver-notifications-recovery --project=fika-os-dev --location=europe-west4
```

Cost: one bounded pending-event query (plus one gap-count aggregate) every five minutes, 288 runs a day. Pause it with
`gcloud scheduler jobs pause fika-logistics-driver-notifications-recovery` if it ever needs to be stopped; nothing else depends on it.

## Alerting

Create a Cloud Logging log-based alert on the text `[driver-notifications] CAPTURE GAP` in the Logistics service. Each occurrence
is a committed planner change that may not have notified a driver.
