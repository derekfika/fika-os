# Xchange Brother print-agent foundation

This is a disabled-by-default, local agent foundation for the Xchange Brother A4 queue. It is not installed on the Pi, has no service unit or background loop, and does not include a real CUPS adapter. Tests use a fake queue and fake printer only.

## Safety boundary

- `AgentConfig.from_env({})` returns disabled. The runner refuses to claim work until `FIKA_XCHANGE_PRINT_AGENT_ENABLED=1` and a dedicated machine credential are present.
- Queue API requests use HTTPS, a bearer machine credential and a stable agent identity. The HTTP client never follows redirects, so the credential cannot be forwarded to another origin.
- Claim requests retain a durable idempotency key when a request must be retried. The key rotates only after an empty claim or an acknowledged receipt, so a lost claim response cannot lease a second job and a completed job does not pin the agent to an old claim forever.
- The versioned claim/document/receipt endpoints in `agent.py` are a proposed client contract. A matching CPU server endpoint, dedicated revocable credential provisioning and exact origin allowlist are not implemented here. Do not configure or activate the agent until those pieces are separately reviewed and deployed.
- The only accepted job is one A4 PDF copy with stable job/site IDs, a service date, source revision, lease identity/expiry, source-manifest SHA-256 and PDF SHA-256. The lease is sent with document and receipt requests, and the downloaded bytes are hashed before any printer boundary is called.
- SQLite durably reserves a job before submission. The agent records `submitting` before calling a printer. After restart, an interrupted submission becomes `uncertain` and is never automatically printed again. A completed scheduler receipt can be retried without reprinting.
- The local SQLite record contains job identity and source lineage, not credentials or customer/menu payloads. It is technical local state, not CPU business history or proof of physical delivery.

`submitted` means a future local print scheduler accepted the job; it does not mean paper was physically printed. This repository change does not connect to a printer, alter production orders, or dispatch paper. The staging and production queue server contracts, key management, server-side authority/freshness check, canonical PDF rendering and supervised UAT remain separate prerequisites.

Run the regression suite through CPU's normal test command. It invokes Python's standard-library `unittest` runner and uses synthetic PDFs, in-memory fake queue responses, a temporary SQLite database and a fake printer.
