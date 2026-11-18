"""Disabled-by-default Xchange print agent foundation.

This module deliberately contains no CUPS integration or service entry point.
The Printer protocol is the only boundary that may eventually submit paper.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Protocol

MAX_PDF_BYTES = 20 * 1024 * 1024
STAGING_CPU_ORIGIN = "https://cpu-staging.fikacatering.com"
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class AgentError(Exception):
    pass


class DisabledError(AgentError):
    pass


class IntegrityError(AgentError):
    pass


class QueueProtocolError(AgentError):
    pass


class Printer(Protocol):
    def submit_a4_pdf(self, pdf_bytes: bytes, *, job_id: str, site_id: str) -> str:
        """Submit one A4 copy and return the local scheduler's receipt ID."""


class QueueApi(Protocol):
    def claim(self, request_id: str) -> dict[str, Any] | None: ...

    def download_pdf(self, job_id: str, lease_id: str) -> bytes: ...

    def report_receipt(self, receipt: dict[str, str]) -> None: ...


@dataclass(frozen=True)
class MachineCredential:
    agent_id: str
    token: str

    def __post_init__(self) -> None:
        if not JOB_ID_RE.fullmatch(self.agent_id):
            raise ValueError("A stable print-agent ID is required")
        if not self.token or "\n" in self.token or "\r" in self.token:
            raise ValueError("A dedicated machine credential is required")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request: Any, file: Any, code: int, message: str,
                         headers: Any, new_url: str) -> None:
        return None


def _safe_open(request: urllib.request.Request, timeout: float) -> Any:
    # Machine credentials must never be forwarded to a redirect target.
    return urllib.request.build_opener(_NoRedirect()).open(request, timeout=timeout)


@dataclass(frozen=True)
class AgentConfig:
    enabled: bool = False
    api_origin: str | None = None
    credential: MachineCredential | None = None
    max_pdf_bytes: int = MAX_PDF_BYTES

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "AgentConfig":
        values = os.environ if env is None else env
        enabled = values.get("FIKA_XCHANGE_PRINT_AGENT_ENABLED", "").strip().lower() in {"1", "true", "yes"}
        if not enabled:
            return cls()
        origin = values.get("FIKA_XCHANGE_CPU_ORIGIN", "").strip()
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Enabled print agent requires an HTTPS CPU origin without credentials or query data")
        if parsed.port not in (None, 443) or parsed.path not in ("", "/"):
            raise ValueError("CPU origin must be an HTTPS origin on the standard port")
        normalized_origin = f"https://{parsed.netloc.lower()}"
        if normalized_origin != STAGING_CPU_ORIGIN:
            raise ValueError("This disabled foundation is restricted to the approved CPU staging origin")
        credential = MachineCredential(
            values.get("FIKA_XCHANGE_PRINT_AGENT_ID", "").strip(),
            values.get("FIKA_XCHANGE_PRINT_AGENT_TOKEN", ""),
        )
        return cls(enabled=True, api_origin=normalized_origin, credential=credential)


@dataclass(frozen=True)
class ClaimedJob:
    job_id: str
    site_id: str
    service_date: str
    source_revision: str
    manifest_sha256: str
    lease_id: str
    lease_expires_at: str
    pdf_sha256: str
    copies: int = 1
    media: str = "A4"

    @classmethod
    def from_claim(cls, value: dict[str, Any]) -> "ClaimedJob":
        job = cls(
            job_id=str(value.get("jobId", "")),
            site_id=str(value.get("siteId", "")),
            service_date=str(value.get("serviceDate", "")),
            source_revision=str(value.get("sourceRevision", "")),
            manifest_sha256=str(value.get("manifestSha256", "")),
            lease_id=str(value.get("leaseId", "")),
            lease_expires_at=str(value.get("leaseExpiresAt", "")),
            pdf_sha256=str(value.get("pdfSha256", "")),
            copies=value.get("copies", 1),
            media=value.get("media", "A4"),
        )
        if not JOB_ID_RE.fullmatch(job.job_id) or not JOB_ID_RE.fullmatch(job.site_id):
            raise QueueProtocolError("Claim must include stable job and site IDs")
        try:
            date.fromisoformat(job.service_date)
            lease_expiry = datetime.fromisoformat(job.lease_expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise QueueProtocolError("Claim must include an ISO service date and lease expiry") from None
        if len(job.service_date) != 10 or not JOB_ID_RE.fullmatch(job.source_revision) or not JOB_ID_RE.fullmatch(job.lease_id):
            raise QueueProtocolError("Claim must include source revision and lease identity")
        if not lease_expiry.tzinfo or lease_expiry.astimezone(timezone.utc) <= datetime.now(timezone.utc):
            raise QueueProtocolError("Claim lease is expired or has no timezone")
        if not SHA256_RE.fullmatch(job.pdf_sha256) or not SHA256_RE.fullmatch(job.manifest_sha256):
            raise QueueProtocolError("Claim must include SHA-256 PDF and source-manifest digests")
        if job.copies != 1 or job.media != "A4":
            raise QueueProtocolError("Only one A4 copy is supported")
        return job


class HttpQueueApi:
    """Small authenticated client for the future CPU queue API.

    Endpoint names are a versioned proposal until the CPU backend is merged.
    Instantiate only from separately approved runtime configuration; tests inject
    an opener, and this repository does not install/start the agent.
    """

    def __init__(self, origin: str, credential: MachineCredential, *, timeout: float = 10.0,
                 opener: Any = _safe_open, max_pdf_bytes: int = MAX_PDF_BYTES):
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("Queue API origin must be a clean HTTPS origin")
        if parsed.port not in (None, 443):
            raise ValueError("Queue API must use the standard HTTPS port")
        self.origin = f"https://{parsed.netloc.lower()}"
        if self.origin != STAGING_CPU_ORIGIN:
            raise ValueError("This disabled foundation is restricted to the approved CPU staging origin")
        self.credential = credential
        self.timeout = timeout
        self.opener = opener
        self.max_pdf_bytes = max_pdf_bytes

    def _request(self, method: str, path: str, *, body: dict[str, Any] | None = None,
                 idempotency_key: str | None = None, lease_id: str | None = None,
                 max_bytes: int = 64 * 1024) -> tuple[bytes, str]:
        headers = {
            "Authorization": f"Bearer {self.credential.token}",
            "X-Fika-Print-Agent": self.credential.agent_id,
            "Accept": "application/json, application/pdf",
        }
        payload = None
        if body is not None:
            payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        if lease_id:
            headers["X-Fika-Print-Lease"] = lease_id
        request = urllib.request.Request(self.origin + path, data=payload, headers=headers, method=method)
        try:
            with self.opener(request, timeout=self.timeout) as response:
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > max_bytes:
                    raise QueueProtocolError("Queue response exceeds the configured size limit")
                data = response.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise QueueProtocolError("Queue response exceeds the configured size limit")
                return data, response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as error:
            # Do not log response bodies, which may contain private operational data.
            raise QueueProtocolError(f"Queue API returned HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise QueueProtocolError(f"Queue API request failed ({type(error).__name__})") from None

    def claim(self, request_id: str) -> dict[str, Any] | None:
        if not JOB_ID_RE.fullmatch(request_id):
            raise QueueProtocolError("Claim request ID is invalid")
        body, content_type = self._request("POST", "/api/print-queue/v1/claim",
            body={"agentId": self.credential.agent_id},
            idempotency_key=f"claim:{self.credential.agent_id}:{request_id}")
        if "application/json" not in content_type:
            raise QueueProtocolError("Queue claim response was not JSON")
        try:
            value = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise QueueProtocolError("Queue claim response was invalid JSON") from None
        if value is None or (isinstance(value, dict) and value.get("job") is None):
            return None
        if not isinstance(value, dict) or not isinstance(value.get("job"), dict):
            raise QueueProtocolError("Queue claim job was malformed")
        return value["job"]

    def download_pdf(self, job_id: str, lease_id: str) -> bytes:
        if not JOB_ID_RE.fullmatch(job_id) or not JOB_ID_RE.fullmatch(lease_id):
            raise QueueProtocolError("Invalid job or lease ID")
        body, content_type = self._request("GET", f"/api/print-queue/v1/jobs/{urllib.parse.quote(job_id, safe='')}/pdf",
            lease_id=lease_id, max_bytes=self.max_pdf_bytes)
        if "application/pdf" not in content_type.lower():
            raise QueueProtocolError("Queue artifact was not a PDF")
        if not body.startswith(b"%PDF-"):
            raise QueueProtocolError("Queue artifact did not contain a PDF header")
        return body

    def report_receipt(self, receipt: dict[str, str]) -> None:
        job_id, receipt_id = receipt.get("jobId", ""), receipt.get("receiptId", "")
        if not JOB_ID_RE.fullmatch(job_id) or not JOB_ID_RE.fullmatch(receipt_id):
            raise QueueProtocolError("Receipt must include stable job and receipt IDs")
        lease_id = receipt.get("leaseId", "")
        if not JOB_ID_RE.fullmatch(lease_id):
            raise QueueProtocolError("Receipt must include its claim lease ID")
        body, content_type = self._request("POST", f"/api/print-queue/v1/jobs/{urllib.parse.quote(job_id, safe='')}/receipt",
            body=receipt, idempotency_key=f"receipt:{receipt_id}")
        if body and "application/json" not in content_type:
            raise QueueProtocolError("Queue receipt response was malformed")


class JobStore:
    """Durable local dedupe/uncertainty ledger, separate from business records."""

    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS print_jobs (
                job_id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                pdf_sha256 TEXT NOT NULL,
                service_date TEXT NOT NULL,
                source_revision TEXT NOT NULL,
                manifest_sha256 TEXT NOT NULL,
                lease_id TEXT NOT NULL,
                state TEXT NOT NULL CHECK (state IN ('reserved','submitting','submitted','uncertain')),
                receipt_id TEXT NOT NULL,
                printer_receipt TEXT,
                receipt_reported_at INTEGER,
                updated_at INTEGER NOT NULL
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS agent_state (
                state_id INTEGER PRIMARY KEY CHECK (state_id=1),
                claim_request_id TEXT NOT NULL
            )""")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        connection.execute("PRAGMA busy_timeout=5000")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    @staticmethod
    def receipt_id(agent_id: str, job: ClaimedJob) -> str:
        raw = f"fika-print-receipt:v1:{agent_id}:{job.job_id}:{job.pdf_sha256}".encode()
        return "receipt-" + hashlib.sha256(raw).hexdigest()

    def reserve(self, agent_id: str, job: ClaimedJob) -> tuple[str, str]:
        receipt_id = self.receipt_id(agent_id, job)
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT pdf_sha256,state,receipt_id,site_id,service_date,source_revision,manifest_sha256,lease_id FROM print_jobs WHERE job_id=?", (job.job_id,)).fetchone()
            if row:
                if row[0] != job.pdf_sha256 or (row[3], row[4], row[5], row[6]) != (job.site_id, job.service_date, job.source_revision, job.manifest_sha256):
                    connection.execute("ROLLBACK")
                    raise IntegrityError("A known job ID was presented with different PDF content")
                if row[1] == "submitting":
                    connection.execute("UPDATE print_jobs SET state='uncertain',updated_at=? WHERE job_id=?", (int(time.time()), job.job_id))
                    connection.execute("COMMIT")
                    return "uncertain", row[2]
                if row[1] == "reserved" and row[7] != job.lease_id:
                    connection.execute("UPDATE print_jobs SET lease_id=?,updated_at=? WHERE job_id=? AND state='reserved'",
                        (job.lease_id, int(time.time()), job.job_id))
                connection.execute("COMMIT")
                return row[1], row[2]
            connection.execute(
                "INSERT INTO print_jobs(job_id,site_id,pdf_sha256,service_date,source_revision,manifest_sha256,lease_id,state,receipt_id,updated_at) VALUES(?,?,?,?,?,?,?,'reserved',?,?)",
                (job.job_id, job.site_id, job.pdf_sha256, job.service_date, job.source_revision, job.manifest_sha256, job.lease_id, receipt_id, int(time.time())),
            )
            connection.execute("COMMIT")
        return "reserved", receipt_id

    def transition(self, job_id: str, from_state: str, to_state: str, *, printer_receipt: str | None = None) -> bool:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "UPDATE print_jobs SET state=?,printer_receipt=COALESCE(?,printer_receipt),updated_at=? WHERE job_id=? AND state=?",
                (to_state, printer_receipt, int(time.time()), job_id, from_state),
            )
            return cursor.rowcount == 1

    def pending_receipts(self) -> list[dict[str, str]]:
        with closing(self._connect()) as connection:
            rows = connection.execute("SELECT job_id,receipt_id,COALESCE(printer_receipt,''),lease_id FROM print_jobs WHERE state='submitted' AND receipt_reported_at IS NULL ORDER BY updated_at,job_id LIMIT 100").fetchall()
        return [{"jobId": row[0], "receiptId": row[1], "printerReceipt": row[2], "leaseId": row[3], "status": "submitted"} for row in rows]

    def claim_request_id(self) -> str:
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT claim_request_id FROM agent_state WHERE state_id=1").fetchone()
            if row:
                connection.execute("COMMIT")
                return row[0]
            request_id = "claim-" + uuid.uuid4().hex
            connection.execute("INSERT INTO agent_state(state_id,claim_request_id) VALUES(1,?)", (request_id,))
            connection.execute("COMMIT")
            return request_id

    def clear_claim_request(self, request_id: str) -> None:
        with closing(self._connect()) as connection:
            connection.execute("DELETE FROM agent_state WHERE state_id=1 AND claim_request_id=?", (request_id,))

    def clear_active_claim_request(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("DELETE FROM agent_state WHERE state_id=1")

    def submitted_receipt(self, job_id: str) -> dict[str, str] | None:
        with closing(self._connect()) as connection:
            row = connection.execute("SELECT receipt_id,COALESCE(printer_receipt,''),lease_id FROM print_jobs WHERE job_id=? AND state='submitted' AND receipt_reported_at IS NULL", (job_id,)).fetchone()
        if not row:
            return None
        return {"jobId": job_id, "receiptId": row[0], "printerReceipt": row[1], "leaseId": row[2], "status": "submitted"}

    def mark_receipt_reported(self, job_id: str) -> None:
        with closing(self._connect()) as connection:
            connection.execute("UPDATE print_jobs SET receipt_reported_at=?,updated_at=? WHERE job_id=? AND state='submitted' AND receipt_reported_at IS NULL",
                (int(time.time()), int(time.time()), job_id))

    def mark_uncertain(self, job_id: str) -> None:
        self.transition(job_id, "submitting", "uncertain")


class PrintAgent:
    def __init__(self, config: AgentConfig, queue: QueueApi, store: JobStore, printer: Printer):
        self.config, self.queue, self.store, self.printer = config, queue, store, printer

    def run_once(self) -> str:
        if not self.config.enabled or self.config.credential is None:
            raise DisabledError("Print agent is disabled")
        claim_request_id = self.store.claim_request_id()
        raw = self.queue.claim(claim_request_id)
        if raw is None:
            self.store.clear_claim_request(claim_request_id)
            return "idle"
        job = ClaimedJob.from_claim(raw)
        pdf = self.queue.download_pdf(job.job_id, job.lease_id)
        if len(pdf) > self.config.max_pdf_bytes:
            raise QueueProtocolError("PDF exceeds the configured size limit")
        if hashlib.sha256(pdf).hexdigest() != job.pdf_sha256:
            raise IntegrityError("Downloaded PDF does not match the server-provided SHA-256")
        expiry = datetime.fromisoformat(job.lease_expires_at.replace("Z", "+00:00"))
        if expiry.astimezone(timezone.utc) <= datetime.now(timezone.utc):
            raise QueueProtocolError("Claim lease expired before submission")
        state, receipt_id = self.store.reserve(self.config.credential.agent_id, job)
        if state == "submitted":
            receipt = self.store.submitted_receipt(job.job_id)
            if receipt is None:
                self.store.clear_claim_request(claim_request_id)
                return "submitted"
            try:
                self.queue.report_receipt(receipt)
            except QueueProtocolError:
                return "submitted_receipt_pending"
            self.store.mark_receipt_reported(job.job_id)
            self.store.clear_claim_request(claim_request_id)
            return "submitted"
        if state == "uncertain":
            return state
        if state != "reserved" or not self.store.transition(job.job_id, "reserved", "submitting"):
            return "uncertain"
        try:
            printer_receipt = self.printer.submit_a4_pdf(pdf, job_id=job.job_id, site_id=job.site_id)
            if not printer_receipt:
                raise RuntimeError("Printer did not return a scheduler receipt")
        except Exception:
            self.store.mark_uncertain(job.job_id)
            return "uncertain"
        if not self.store.transition(job.job_id, "submitting", "submitted", printer_receipt=printer_receipt):
            # The physical result may exist; preserve ambiguity and never retry automatically.
            self.store.mark_uncertain(job.job_id)
            return "uncertain"
        try:
            self.queue.report_receipt({"jobId": job.job_id, "receiptId": receipt_id, "leaseId": job.lease_id,
                "printerReceipt": printer_receipt, "status": "submitted"})
        except QueueProtocolError:
            # Durable state remains submitted; a later poll may replay only the receipt.
            return "submitted_receipt_pending"
        self.store.mark_receipt_reported(job.job_id)
        self.store.clear_claim_request(claim_request_id)
        return "submitted"

    def retry_receipts(self) -> int:
        if not self.config.enabled or self.config.credential is None:
            raise DisabledError("Print agent is disabled")
        sent = 0
        for receipt in self.store.pending_receipts():
            try:
                self.queue.report_receipt(receipt)
                self.store.mark_receipt_reported(receipt["jobId"])
                self.store.clear_active_claim_request()
                sent += 1
            except QueueProtocolError:
                continue
        return sent
