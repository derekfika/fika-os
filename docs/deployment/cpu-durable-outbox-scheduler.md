# CPU durable outbox recovery

Firebase App Hosting runs the CPU Next application only; it does not start the
repository's long-lived `worker:durable-outbox` process. Normal hosted recovery
therefore requires one Cloud Scheduler job calling the bounded recovery route.

Provision once per environment, using the same internal token already configured
for CPU-to-CPU and CPU-to-consumer delivery:

```powershell
$token = (gcloud secrets versions access latest --secret=FIKA_INTERNAL_API_TOKEN --project=fika-os-dev).Trim()
gcloud scheduler jobs create http fika-cpu-durable-outbox-recovery --project=fika-os-dev --location=europe-west4 --schedule="* * * * *" --uri="https://cpu-staging.fikacatering.com/api/internal/durable-outbox" --http-method=POST --headers="Content-Type=application/json,x-fika-internal-token=$token" --message-body='{"limit":25}' --time-zone="Europe/London"
```

Verify the job and its bounded payload:

```powershell
gcloud scheduler jobs describe fika-cpu-durable-outbox-recovery --project=fika-os-dev --location=europe-west4
```

The job drains at most 25 due events per minute, including materialisation,
release delivery and approximately T+60 reconciliation obligations. The
`/api/internal/durable-outbox` route remains diagnostic/replay-capable, but is
not the normal operator workflow. Provisioning is intentionally not performed
by repository changes or this task; until the command is run, hosted automatic
recovery is not complete.
