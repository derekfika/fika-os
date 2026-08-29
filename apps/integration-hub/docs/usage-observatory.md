# Usage Observatory

The administrator-only `/usage` screen reads Firestore document operation metrics from Google Cloud Monitoring. It never scans operational Firestore collections and does not write telemetry documents.

Each request makes three Monitoring `timeSeries.list` calls on a cold cache: reads, writes and deletes. A warm request is served from the server process cache for `FIKA_USAGE_CACHE_TTL_SECONDS` (180 seconds by default). Custom ranges choose one-minute, five-minute, hourly or daily alignment according to their duration. The dashboard does not poll; Refresh explicitly invalidates the cache. AuthMOD repository reads used to authorize the route are control-plane access checks, not workload measurement.

The metric totals are authoritative platform totals. Current Firestore operation metrics do not expose a trustworthy FIKA app identity, so the dashboard intentionally omits app shares and labels attribution unavailable. Do not infer app ownership by timing. A future attribution implementation should use one aggregated custom metric or log-based metric at a shared server-side repository boundary, with dimensions limited to app, operation and bounded time bucket; it must reconcile to these global totals and must not write one telemetry record per operation.

The selected date-time inputs are interpreted as Europe/London wall-clock values and converted to UTC before calling Monitoring. The server rejects reversed, future and over-large windows. Query Insights and deploy markers are links/statuses only because no supported authoritative server API is configured for them.

Hosted runtimes need the runtime identity to have `roles/monitoring.viewer` (or an equivalent permission containing `monitoring.timeSeries.list`) on the configured project. The server uses the `https://www.googleapis.com/auth/monitoring.read` scope through Application Default Credentials. No browser credential or access token is returned.
