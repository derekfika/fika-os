import hashlib
import json
import tempfile
import unittest
import urllib.request
from pathlib import Path
from datetime import datetime, timedelta, timezone

from agent import (
    AgentConfig,
    ClaimedJob,
    DisabledError,
    HttpQueueApi,
    IntegrityError,
    JobStore,
    MachineCredential,
    PrintAgent,
    QueueProtocolError,
    _NoRedirect,
)


PDF = b"%PDF-1.4\nsynthetic A4 test page\n%%EOF"
AGENT_ID = "fika-xchange-brother-test"
CREDENTIAL = MachineCredential(AGENT_ID, "synthetic-test-token")


def claim(pdf=PDF, **changes):
    value = {
        "jobId": "print-job:synthetic:1",
        "siteId": "oploc:xchange",
        "serviceDate": "2026-11-18",
        "sourceRevision": "publication-revision:synthetic:3",
        "manifestSha256": "a" * 64,
        "leaseId": "lease:synthetic:1",
        "leaseExpiresAt": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
        "pdfSha256": hashlib.sha256(pdf).hexdigest(),
        "copies": 1,
        "media": "A4",
    }
    return {**value, **changes}


class FakeQueue:
    def __init__(self, job=None, pdf=PDF, receipt_error=False):
        self.job = job if job is not None else claim(pdf)
        self.pdf = pdf
        self.receipt_error = receipt_error
        self.claim_count = 0
        self.download_count = 0
        self.receipts = []
        self.claim_request_ids = []

    def claim(self, request_id):
        self.claim_count += 1
        self.claim_request_ids.append(request_id)
        return self.job

    def download_pdf(self, job_id, lease_id):
        self.download_count += 1
        return self.pdf

    def report_receipt(self, receipt):
        self.receipts.append(receipt)
        if self.receipt_error:
            self.receipt_error = False
            raise QueueProtocolError("Queue API request failed (TimeoutError)")


class FakePrinter:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    def submit_a4_pdf(self, pdf_bytes, *, job_id, site_id):
        self.calls.append((pdf_bytes, job_id, site_id))
        if self.error:
            raise self.error
        return f"cups-{len(self.calls)}"


class FakeResponse:
    def __init__(self, body, content_type="application/json"):
        self.body = body
        self.headers = {"Content-Type": content_type, "Content-Length": str(len(body))}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def read(self, size=-1):
        return self.body[:size]


class PrintAgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "agent.sqlite"

    def tearDown(self):
        self.temp.cleanup()

    def make_agent(self, queue=None, printer=None, *, enabled=True):
        queue = queue or FakeQueue()
        printer = printer or FakePrinter()
        config = AgentConfig(enabled=enabled, api_origin="https://cpu-staging.fikacatering.com",
                             credential=CREDENTIAL if enabled else None)
        return PrintAgent(config, queue, JobStore(self.database), printer), queue, printer

    def test_disabled_by_default_and_does_not_claim_or_print(self):
        config = AgentConfig.from_env({})
        queue, printer = FakeQueue(), FakePrinter()
        agent = PrintAgent(config, queue, JobStore(self.database), printer)
        with self.assertRaises(DisabledError):
            agent.run_once()
        self.assertEqual(queue.claim_count, 0)
        self.assertEqual(printer.calls, [])

    def test_enabled_configuration_requires_https_and_machine_identity(self):
        with self.assertRaises(ValueError):
            AgentConfig.from_env({"FIKA_XCHANGE_PRINT_AGENT_ENABLED": "1",
                                  "FIKA_XCHANGE_CPU_ORIGIN": "http://cpu.example.com",
                                  "FIKA_XCHANGE_PRINT_AGENT_ID": AGENT_ID,
                                  "FIKA_XCHANGE_PRINT_AGENT_TOKEN": "token"})
        with self.assertRaises(ValueError):
            AgentConfig.from_env({"FIKA_XCHANGE_PRINT_AGENT_ENABLED": "1",
                                  "FIKA_XCHANGE_CPU_ORIGIN": "https://cpu.example.com",
                                  "FIKA_XCHANGE_PRINT_AGENT_ID": AGENT_ID})
        with self.assertRaises(ValueError):
            AgentConfig.from_env({"FIKA_XCHANGE_PRINT_AGENT_ENABLED": "1",
                                  "FIKA_XCHANGE_CPU_ORIGIN": "https://cpu.example.com",
                                  "FIKA_XCHANGE_PRINT_AGENT_ID": AGENT_ID,
                                  "FIKA_XCHANGE_PRINT_AGENT_TOKEN": "token"})

    def test_authenticated_claim_uses_machine_identity_and_idempotency_key(self):
        seen = []

        def opener(request, timeout):
            seen.append((request, timeout))
            return FakeResponse(json.dumps({"job": None}).encode())

        api = HttpQueueApi("https://cpu-staging.fikacatering.com", CREDENTIAL, opener=opener)
        self.assertIsNone(api.claim("claim-request-1"))
        request, timeout = seen[0]
        self.assertEqual(request.full_url, "https://cpu-staging.fikacatering.com/api/print-queue/v1/claim")
        self.assertEqual(request.get_header("Authorization"), f"Bearer {CREDENTIAL.token}")
        self.assertEqual(request.get_header("X-fika-print-agent"), AGENT_ID)
        self.assertEqual(request.get_header("Idempotency-key"), f"claim:{AGENT_ID}:claim-request-1")
        self.assertEqual(timeout, 10.0)

    def test_document_download_binds_authorized_lease(self):
        seen = []

        def opener(request, timeout):
            seen.append(request)
            return FakeResponse(PDF, "application/pdf")

        api = HttpQueueApi("https://cpu-staging.fikacatering.com", CREDENTIAL, opener=opener)
        self.assertEqual(api.download_pdf("print-job:synthetic:1", "lease:synthetic:1"), PDF)
        self.assertEqual(seen[0].get_header("X-fika-print-lease"), "lease:synthetic:1")

    def test_http_client_refuses_non_https_and_redirects(self):
        with self.assertRaises(ValueError):
            HttpQueueApi("http://cpu.example.com", CREDENTIAL)
        handler = _NoRedirect()
        request = urllib.request.Request("https://cpu.example.com")
        self.assertIsNone(handler.redirect_request(request, None, 302, "Found", {}, "https://other.example.com"))

    def test_success_is_persisted_and_duplicate_claim_does_not_print_twice(self):
        agent, queue, printer = self.make_agent()
        self.assertEqual(agent.run_once(), "submitted")
        self.assertEqual(agent.run_once(), "submitted")
        self.assertEqual(len(printer.calls), 1)
        self.assertEqual(queue.receipts[0]["printerReceipt"], "cups-1")
        self.assertEqual(queue.receipts[0]["status"], "submitted")
        self.assertEqual(len(queue.receipts), 1)
        self.assertNotEqual(queue.claim_request_ids[0], queue.claim_request_ids[1])

    def test_printer_error_becomes_uncertain_and_is_never_retried_automatically(self):
        queue, printer = FakeQueue(), FakePrinter(RuntimeError("CUPS transport lost after submit"))
        agent, _, _ = self.make_agent(queue, printer)
        self.assertEqual(agent.run_once(), "uncertain")
        printer.error = None
        self.assertEqual(agent.run_once(), "uncertain")
        self.assertEqual(len(printer.calls), 1)

    def test_crash_after_pre_submit_reservation_is_marked_uncertain_without_print(self):
        raw = claim()
        job = ClaimedJob.from_claim(raw)
        store = JobStore(self.database)
        state, _ = store.reserve(AGENT_ID, job)
        self.assertEqual(state, "reserved")
        self.assertTrue(store.transition(job.job_id, "reserved", "submitting"))
        agent, _, printer = self.make_agent()
        self.assertEqual(agent.run_once(), "uncertain")
        self.assertEqual(printer.calls, [])

    def test_hash_mismatch_is_rejected_before_any_reservation_or_print(self):
        queue = FakeQueue(pdf=b"%PDF-1.4\nother content")
        queue.job = claim(PDF)
        agent, _, printer = self.make_agent(queue)
        with self.assertRaises(IntegrityError):
            agent.run_once()
        self.assertEqual(printer.calls, [])

    def test_reused_job_id_with_changed_hash_fails_closed(self):
        agent, queue, printer = self.make_agent()
        self.assertEqual(agent.run_once(), "submitted")
        changed = b"%PDF-1.4\nchanged but valid bytes"
        queue.job = claim(changed)
        queue.pdf = changed
        with self.assertRaises(IntegrityError):
            agent.run_once()
        self.assertEqual(len(printer.calls), 1)

    def test_receipt_retry_never_reprints(self):
        queue, printer = FakeQueue(receipt_error=True), FakePrinter()
        agent, _, _ = self.make_agent(queue, printer)
        self.assertEqual(agent.run_once(), "submitted_receipt_pending")
        self.assertEqual(agent.retry_receipts(), 1)
        self.assertEqual(agent.retry_receipts(), 0)
        self.assertEqual(len(printer.calls), 1)
        self.assertEqual(len(queue.receipts), 2)

    def test_rejects_multiple_copies_and_non_a4_jobs(self):
        for changes in ({"copies": 2}, {"media": "Letter"}):
            with self.subTest(changes=changes), self.assertRaises(QueueProtocolError):
                ClaimedJob.from_claim(claim(**changes))


if __name__ == "__main__":
    unittest.main()
