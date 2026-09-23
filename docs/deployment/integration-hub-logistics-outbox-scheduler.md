# Integration Hub → Logistics outbox recovery

Firebase App Hosting runs the Integration Hub Next application, but it does
not run a long-lived worker. Hosted recovery therefore needs one bounded Cloud
Scheduler call to the Integration Hub internal outbox route.

Provision once per environment, using the same internal token already
configured for Hub-to-Logistics delivery:

```powershell
$token = (gcloud secrets versions access 3 --secret=FIKA_INTERNAL_API_TOKEN --project=fika-os-dev).Trim()
gcloud scheduler jobs create http fika-logistics-projection-outbox-recovery --project=fika-os-dev --location=europe-west4 --schedule="* * * * *" --uri="https://staging-os.fikacatering.com/api/internal/logistics-outbox" --http-method=POST --headers="Content-Type=application/json,x-fika-internal-token=$token" --message-body='{"limit":25}' --time-zone="Europe/London"
```

Verify the job and its bounded payload:

```powershell
gcloud scheduler jobs describe fika-logistics-projection-outbox-recovery --project=fika-os-dev --location=europe-west4
```

The route claims at most 25 due outbox events and delivers them in one bounded
batch. Logistics invalidation coalesces changes by service date and performs one
canonical reconciliation per affected date, with idempotent event updates and
safe retry diagnostics. Provisioning is intentionally not performed by a
repository change; until the command is run, hosted automatic recovery is not
complete.
