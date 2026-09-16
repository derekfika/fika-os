# FIKA OS UAT debugging toolkit

The Phase 1 toolkit is read-only and collects one bounded evidence pass for
staging diagnostics. It does not publish, sign, withdraw, amend, mutate
staging data, deploy, or run a background poller.

## Setup

Install Node.js and the Google Cloud CLI. Authenticate gcloud against the
`fika-os-dev` project before using the log scanner:

```text
gcloud auth login
gcloud config set project fika-os-dev
```

The toolkit does not change gcloud configuration. If state endpoints require a
browser session, set the session cookie for the current process only:

```powershell
$env:FIKA_UAT_COOKIE = "<session-cookie-value>"
```

The cookie is forwarded to the existing read endpoints, never printed or
persisted, and is not read from browser credential stores. Without it, build
checks and log queries can still run, while protected state is reported as
unavailable/UNKNOWN.

CPU state capture uses the side-effect-free projection-head endpoint by
default. The existing CPU review GET can rebuild a missing review package on
its fallback path, so it is not called automatically by this read-only tool.
If the staging environment provides an explicitly approved read-only review
endpoint, set `FIKA_UAT_CPU_REVIEW_URL` for that process; otherwise review and
signature fields remain UNKNOWN while package-head evidence is collected.

## Commands

After deploying a staging app, verify live provenance:

```text
npm run uat -- builds --expected <validated-commit-sha>
```

Reproduce once, then collect the primary evidence bundle:

```text
npm run uat -- bundle --app delivered-in --service-date 2026-09-14 --oploc oploc:<stable-id> --minutes 15
```

The bundle writes an attachable Markdown file and machine-readable JSON under
`artifacts/uat/`. The output directory is ignored by Git.

For a focused state snapshot:

```text
npm run uat -- state --service-date 2026-09-14 --oploc oploc:<stable-id> --json
```

For an all-app incident scan:

```text
npm run uat -- logs --app all --tail-errors --minutes 15
```

Useful filters include `--service-date`, `--oploc`, `--build-sha`,
`--request-id`, `--event`, `--severity`, `--since`, `--project`, and bounded
`--limit` (maximum 500). Log scans default to WARNING and above; use
`--severity INFO` when routine informational records are specifically needed.
`--json` emits sanitized structured output.

The same workflow supports Delivered-In recovery, CPU signing and Menu
publication/handoff investigations. The toolkit only reads the existing
Menu publication range, CPU Delivered-In review, and Delivered-In day
projection endpoints; it does not add a privileged diagnostic API.

Invariant results are `PASS`, `FAIL`, or `UNKNOWN`. UNKNOWN means the evidence
was unavailable; it is never treated as PASS. Potential causal chains are
visual correlations based on stable IDs and target proximity, not automatic
root-cause claims.

Phase 2 seams are intentionally left for semantic before/after diffs,
guided scenarios, browser correlation IDs, cross-app session IDs and
deterministic fixtures.
