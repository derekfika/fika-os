from pathlib import Path
from docx import Document
import difflib
import json
import re
import shutil
import textwrap

ROOT = Path(r"C:\FIKA\.codex-staging\pack-3-approved-export-schema\03 Pack 3")
OUT = ROOT / "Pack 3 Approved Export and Schema Draft"
BASE_MD = ROOT / "_baseline_markdown"
TEXT = ROOT / "_extracted_text"

if OUT.exists():
    shutil.rmtree(OUT)
if BASE_MD.exists():
    shutil.rmtree(BASE_MD)
for rel in [
    "markdown",
    "schemas/fixtures/valid",
    "schemas/fixtures/invalid",
    "reports",
    "scripts",
]:
    (OUT / rel).mkdir(parents=True, exist_ok=True)
BASE_MD.mkdir(parents=True, exist_ok=True)


def docx_lines(path):
    return [p.text.strip() for p in Document(path).paragraphs if p.text.strip()]


def slug(title):
    text = title.lower().replace("&", "and")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text + ".md"


def parse_register():
    lines = docx_lines(ROOT / "Pack 3 Governed Decision Register.docx")
    entries = {}
    current = None
    buf = []
    for idx, line in enumerate(lines):
        next_line = lines[idx + 1] if idx + 1 < len(lines) else ""
        if re.match(r"^SVC-\d{3}\b", line) and next_line.startswith("Review status:"):
            if current:
                entries[current] = buf
            current = line[:7]
            buf = [line]
        elif current:
            buf.append(line)
    if current:
        entries[current] = buf
    return entries


def field(lines, label):
    prefix = label + ":"
    for idx, line in enumerate(lines):
        if line.startswith(prefix):
            value = line[len(prefix):].strip()
            if value:
                return value
            if idx + 1 < len(lines):
                return lines[idx + 1].strip()
    return ""

def section(lines, start, stops):
    active = False
    body = []
    for line in lines:
        if line == start + ":":
            active = True
            continue
        if active and any(line == stop + ":" for stop in stops):
            break
        if active:
            body.append(line)
    return "\n".join(body).strip()


REGISTER = parse_register()


def parse_bdr(path):
    lines = docx_lines(path)
    meta = {}
    i = 1
    while i < len(lines):
        if lines[i] == "Context":
            break
        if ":" in lines[i]:
            k, v = lines[i].split(":", 1)
            meta[k.strip()] = v.strip()
        i += 1
    sections = {}
    current = None
    for line in lines[i:]:
        if line == "Review Notes":
            break
        if line in {
            "Context",
            "Business rationale",
            "Positive consequences",
            "Trade-offs",
            "Implementation implications",
            "Related decisions",
            "Evidence",
            "Supersedes / Superseded by",
            "Future considerations",
        }:
            current = line
            sections[current] = []
            continue
        if line.startswith("Decision") and ("Canonical" in line or line == "Decision"):
            current = "Decision"
            sections[current] = []
            continue
        if line == "The Decision section is canonical and locked. Do not edit it.":
            continue
        if current:
            sections[current].append(line)
    return {"title": lines[0], "meta": meta, "sections": sections}


def md_from_bdr(record, title_override=None, decision_override=None):
    title = title_override or record["title"].replace(" â€” ", ": ", 1)
    meta = record["meta"]
    lines = [f"# {title}", ""]
    for src, dst in [
        ("Decision ID", "Decision ID"),
        ("Workbook Decision ID", "Workbook Decision ID"),
        ("Current Status", "Status"),
        ("Date", "Date"),
        ("Decision Owner", "Decision owner"),
        ("Related Domains", "Related domains"),
    ]:
        value = meta.get(src, "")
        if dst == "Status":
            value = "Accepted"
        if dst == "Decision owner":
            value = value.replace("Derek / ", "Role-based authority via AUTHMOD / ")
        lines.append(f"- **{dst}:** {value}")
    lines.append("")
    for sec in [
        "Context",
        "Decision",
        "Business rationale",
        "Positive consequences",
        "Trade-offs",
        "Implementation implications",
        "Related decisions",
        "Evidence",
        "Supersedes / Superseded by",
        "Future considerations",
    ]:
        body = record["sections"].get(sec, [])
        if sec == "Decision" and decision_override:
            body = [decision_override]
        lines += [f"## {sec}", ""]
        for item in body:
            if item.startswith("**") or item.startswith("["):
                lines.append("- " + item)
            elif item.startswith("- "):
                lines.append(item)
            else:
                lines.append(item)
                lines.append("")
    return "\n".join(line.rstrip() for line in lines).rstrip() + "\n"


def append_register_refinements(md, reg):
    additions = []
    reason = section(reg, "Reason for amendment", ["Explanatory refinements", "Discovery / follow-up", "Ready for export"])
    refinements = section(reg, "Explanatory refinements", ["Discovery / follow-up", "Ready for export"])
    follow_up = section(reg, "Discovery / follow-up", ["Ready for export"])
    if reason:
        additions += ["## Governed amendment rationale", "", *reason.splitlines(), ""]
    if refinements:
        additions += ["## Governed explanatory refinements", "", *refinements.splitlines(), ""]
    if follow_up:
        additions += ["## Governed follow-up", "", *follow_up.splitlines(), ""]
    return md.rstrip() + "\n\n" + "\n".join(additions).rstrip() + "\n"


review_errors = []
review_warnings = []
revised_files = []
retitled = []
amendments = 0

for docx in sorted(ROOT.glob("SVC-*.docx")):
    did = docx.name[:7]
    record = parse_bdr(docx)
    reg = REGISTER[did]
    status = field(reg, "Review status")
    ready = field(reg, "Ready for export")
    if status != "Approved" or ready != "Yes":
        review_errors.append(f"{did}: not approved and ready for export")
        continue
    canonical = field(reg, "Canonical Decision")
    proposed = section(reg, "Proposed canonical Decision", ["Reason for amendment", "Reason for replacement", "Explanatory refinements", "Discovery / follow-up"])
    decision = proposed or canonical
    if not decision:
        review_errors.append(f"{did}: no canonical decision found in register")
        continue
    title_line = reg[0].replace(" â€” ", ": ", 1)
    replacement_title = field(reg, "Proposed replacement title")
    if replacement_title:
        title_line = replacement_title.replace(" â€” ", ": ", 1)
        retitled.append(f"{did}: {replacement_title}")
    original = md_from_bdr(record)
    revised = md_from_bdr(record, title_override=title_line, decision_override=decision)
    revised = append_register_refinements(revised, reg)
    # Register explicitly removes Service Occurrence from revised explanatory material where applicable.
    revised = revised.replace("Service Occurrence", "retired dated-occurrence concept")
    revised = revised.replace("Deprecated Service Occurrence term", "retired dated-occurrence concept")
    revised = revised.replace("svc-006-service-occurrence-booking-boundary.md", "svc-006-scheduled-work-and-booking-boundary.md")
    revised = revised.replace("SVC-006 — retired dated-occurrence concept and Booking Boundary", "SVC-006 — Scheduled Work and Booking Boundary")
    # Restore canonical decision exactly after broad terminology note.
    revised = re.sub(
        r"(## Decision\s*\n\s*)(.*?)(\n## Business rationale)",
        lambda m: m.group(1) + decision + "\n" + m.group(3),
        revised,
        flags=re.S,
    )
    old_name = slug(record["title"])
    new_name = slug(title_line)
    (BASE_MD / old_name).write_text(original, encoding="utf-8")
    (OUT / "markdown" / new_name).write_text(revised, encoding="utf-8")
    revised_files.append(new_name)
    if decision != " ".join(record["sections"].get("Decision", [])).strip():
        amendments += 1

diff_lines = []
for old_path in sorted(BASE_MD.glob("*.md")):
    did = old_path.name[:7]
    candidates = [p for p in (OUT / "markdown").glob("*.md") if p.name.startswith(did.lower())]
    if not candidates:
        # Retitle may not share slug prefix reliably, fall back by Decision ID in file body.
        candidates = [p for p in (OUT / "markdown").glob("*.md") if f"**Decision ID:** {did.upper()}" in p.read_text(encoding="utf-8")]
    if not candidates:
        continue
    new_path = candidates[0]
    old = old_path.read_text(encoding="utf-8").splitlines()
    new = new_path.read_text(encoding="utf-8").splitlines()
    if old != new:
        diff_lines += list(difflib.unified_diff(old, new, fromfile=f"a/{old_path.name}", tofile=f"b/{new_path.name}", lineterm=""))
        diff_lines.append("")
(OUT / "markdown" / "governed-export-unified.diff").write_text("\n".join(diff_lines).rstrip() + "\n", encoding="utf-8")

for p in (OUT / "markdown").glob("svc-*.md"):
    text = p.read_text(encoding="utf-8")
    did_match = re.search(r"\*\*Decision ID:\*\* (SVC-\d{3})", text)
    if not did_match:
        review_errors.append(f"{p.name}: missing Decision ID metadata")
        continue
    did = did_match.group(1)
    reg = REGISTER[did]
    proposed = section(reg, "Proposed canonical Decision", ["Reason for amendment", "Reason for replacement", "Explanatory refinements", "Discovery / follow-up"])
    canonical = field(reg, "Canonical Decision")
    expected = proposed or canonical
    actual = re.search(r"## Decision\s*\n\s*(.*?)(?=\n## )", text, re.S)
    if not actual or actual.group(1).strip() != expected.strip():
        review_errors.append(f"{p.name}: Decision text does not match register")
    for required in ["Context", "Decision", "Business rationale", "Evidence", "Future considerations"]:
        if f"## {required}" not in text:
            review_errors.append(f"{p.name}: missing heading {required}")
    for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        if link.startswith("http") or link.startswith("#"):
            continue
        review_warnings.append(f"{p.name}: linked document outside ZIP or not supplied: {link}")

(OUT / "markdown" / "governed-export-validation-report.md").write_text(
    "\n".join(
        [
            "# Governed Markdown Export Validation Report",
            "",
            "- Pack: Pack 3",
            f"- BDRs reviewed: {len(list(ROOT.glob('SVC-*.docx')))}",
            f"- Approved amendments/replacements applied: {amendments}",
            f"- Revised Markdown files: {len(revised_files)}",
            f"- Retitled BDRs: {', '.join(retitled) if retitled else 'None'}",
            f"- Errors: {len(review_errors)}",
            f"- Warnings: {len(review_warnings)}",
            "",
            "## Errors",
            "",
            *(f"- ERROR: {e}" for e in review_errors),
            *([] if review_errors else ["- None"]),
            "",
            "## Warnings",
            "",
            *(f"- WARNING: {w}" for w in review_warnings),
            *([] if review_warnings else ["- None"]),
        ]
    )
    + "\n",
    encoding="utf-8",
)

DEFS = {
    "stableId": {"type": "string", "minLength": 1, "pattern": "^[A-Za-z][A-Za-z0-9_.:-]*$"},
    "isoDateTime": {"type": "string", "format": "date-time"},
    "scopeType": {"type": "string", "enum": ["organisation", "domain", "operational_location", "service", "service_arrangement", "event", "equipment_asset", "client", "other"]},
    "scope": {
        "type": "object",
        "additionalProperties": False,
        "required": ["scopeType", "scopeId"],
        "properties": {"scopeType": {"$ref": "#/$defs/scopeType"}, "scopeId": {"$ref": "#/$defs/stableId"}, "scopeLabel": {"type": "string"}},
    },
    "effectivePeriod": {
        "type": "object",
        "additionalProperties": False,
        "required": ["startAt"],
        "properties": {"startAt": {"$ref": "#/$defs/isoDateTime"}, "endAt": {"type": ["string", "null"], "format": "date-time"}, "reason": {"type": "string"}},
    },
    "approval": {
        "type": "object",
        "additionalProperties": False,
        "required": ["approvedBy", "approvedAt", "authorityGrantId", "reason"],
        "properties": {"approvedBy": {"$ref": "#/$defs/stableId"}, "approvedAt": {"$ref": "#/$defs/isoDateTime"}, "authorityGrantId": {"$ref": "#/$defs/stableId"}, "reason": {"type": "string"}},
    },
    "auditEvent": {
        "type": "object",
        "additionalProperties": False,
        "required": ["eventType", "occurredAt", "actorId"],
        "properties": {"eventType": {"type": "string"}, "occurredAt": {"$ref": "#/$defs/isoDateTime"}, "actorId": {"$ref": "#/$defs/stableId"}, "reason": {"type": "string"}},
    },
    "audit": {
        "type": "object",
        "additionalProperties": False,
        "required": ["version", "createdAt", "createdBy", "updatedAt", "updatedBy", "events"],
        "properties": {"version": {"type": "integer", "minimum": 1}, "createdAt": {"$ref": "#/$defs/isoDateTime"}, "createdBy": {"$ref": "#/$defs/stableId"}, "updatedAt": {"$ref": "#/$defs/isoDateTime"}, "updatedBy": {"$ref": "#/$defs/stableId"}, "events": {"type": "array", "items": {"$ref": "#/$defs/auditEvent"}}},
    },
    "provenance": {
        "type": "object",
        "additionalProperties": False,
        "required": ["sourceBdrIds", "sourceSnapshot", "authorityRank"],
        "properties": {"sourceBdrIds": {"type": "array", "minItems": 1, "items": {"type": "string", "pattern": "^SVC-\\d{3}$"}}, "sourceSnapshot": {"type": "string"}, "authorityRank": {"type": "string", "enum": ["Approved Canon", "Approved Governed Decision Register", "Approved canonical Decision", "Review Doctrine and Authority Model"]}},
    },
}


def schema(name, description, required, properties, bdrs):
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"https://fika.invalid/schemas/pack-3/{name}.schema.json",
        "title": name.replace("-", " ").title(),
        "description": description + " Draft business schema derived from approved Pack 3 BDR authority; not an implementation model.",
        "type": "object",
        "additionalProperties": False,
        "required": ["schemaVersion", *required, "provenance", "audit"],
        "properties": {"schemaVersion": {"type": "string", "const": "pack-3-draft-1"}, **properties, "provenance": {"$ref": "#/$defs/provenance"}, "audit": {"$ref": "#/$defs/audit"}},
        "$defs": DEFS,
        "x-fika-source-bdrs": bdrs,
        "x-fika-status": "Draft for human review; not adopted",
    }


def ref(key):
    return {"$ref": f"#/$defs/{key}"}


SCHEMAS = {
    "service": schema("service", "Durable reusable offering that FIKA provides.", ["serviceId", "serviceName", "servicePurpose", "lifecycleStatus"], {"serviceId": ref("stableId"), "serviceName": {"type": "string"}, "servicePurpose": {"type": "string"}, "owningDomainId": ref("stableId"), "lifecycleStatus": {"type": "string", "enum": ["draft", "active", "retired", "superseded"]}}, ["SVC-001", "SVC-002", "SVC-008"]),
    "service-arrangement": schema("service-arrangement", "OPLOC-specific way a Service is provided within one operational scope.", ["serviceArrangementId", "serviceId", "operationalLocationId", "lifecycleStatus"], {"serviceArrangementId": ref("stableId"), "serviceId": ref("stableId"), "operationalLocationId": ref("stableId"), "clientRelationshipReferenceIds": {"type": "array", "items": ref("stableId")}, "commercialOwnershipId": ref("stableId"), "recurringScheduleIds": {"type": "array", "items": ref("stableId")}, "lifecycleStatus": {"type": "string", "enum": ["draft", "active", "paused", "retired", "superseded"]}}, ["SVC-002", "SVC-004", "SVC-007", "SVC-010"]),
    "recurring-schedule": schema("recurring-schedule", "Repeating pattern of planned delivery for a Service Arrangement.", ["recurringScheduleId", "serviceArrangementId", "patternDescription", "effectivePeriod", "lifecycleStatus"], {"recurringScheduleId": ref("stableId"), "serviceArrangementId": ref("stableId"), "patternDescription": {"type": "string"}, "effectivePeriod": ref("effectivePeriod"), "exceptionIds": {"type": "array", "items": ref("stableId")}, "lifecycleStatus": {"type": "string", "enum": ["draft", "active", "paused", "expired", "superseded"]}}, ["SVC-002", "SVC-005", "SVC-007"]),
    "recurring-schedule-exception": schema("recurring-schedule-exception", "Approved amendment, pause or cancellation for a schedule date or period.", ["exceptionId", "recurringScheduleId", "exceptionType", "effectivePeriod", "reason", "approval"], {"exceptionId": ref("stableId"), "recurringScheduleId": ref("stableId"), "exceptionType": {"type": "string", "enum": ["amendment", "pause", "cancellation"]}, "effectivePeriod": ref("effectivePeriod"), "reason": {"type": "string"}, "approval": ref("approval")}, ["SVC-005"]),
    "requested-work-input": schema("requested-work-input", "Demand input into the shared fulfilment workflow while preserving source classification.", ["requestedWorkInputId", "classification", "sourceType", "requestedDateTime", "status"], {"requestedWorkInputId": ref("stableId"), "classification": {"type": "string", "enum": ["hospitality_booking", "recurring_operational_request", "event_request", "other"]}, "sourceType": {"type": "string", "enum": ["hospitality_booking", "recurring_schedule", "event", "manual", "other"]}, "serviceArrangementId": ref("stableId"), "serviceId": ref("stableId"), "requestedDateTime": ref("isoDateTime"), "destination": {"type": "string"}, "quantitiesSummary": {"type": "string"}, "status": {"type": "string", "enum": ["requested", "planned", "cancelled", "fulfilled", "declined"]}}, ["SVC-006", "SVC-005"]),
    "service-event-reference": schema("service-event-reference", "Relationship showing an Event uses, references or purchases Services without becoming a Service Arrangement.", ["referenceId", "eventId", "relationshipType"], {"referenceId": ref("stableId"), "eventId": ref("stableId"), "serviceIds": {"type": "array", "items": ref("stableId")}, "serviceArrangementIds": {"type": "array", "items": ref("stableId")}, "relationshipType": {"type": "string", "enum": ["uses", "references", "purchases"]}}, ["SVC-008"]),
    "service-domain-dependency": schema("service-domain-dependency", "Dependency from a Service Arrangement to a supporting domain capability without transferring ownership.", ["dependencyId", "serviceArrangementId", "supportingDomainId", "capabilityId"], {"dependencyId": ref("stableId"), "serviceArrangementId": ref("stableId"), "supportingDomainId": ref("stableId"), "capabilityId": ref("stableId"), "dependencyDescription": {"type": "string"}}, ["SVC-003"]),
    "equipment-allocation": schema("equipment-allocation", "Allocation of an Equipment asset to a Service Arrangement or Event for a time and location.", ["allocationId", "equipmentAssetId", "allocationTargetType", "allocationTargetId", "effectivePeriod", "locationScope"], {"allocationId": ref("stableId"), "equipmentAssetId": ref("stableId"), "allocationTargetType": {"type": "string", "enum": ["service_arrangement", "event"]}, "allocationTargetId": ref("stableId"), "staffRequirementSummary": {"type": "string"}, "effectivePeriod": ref("effectivePeriod"), "locationScope": ref("scope"), "conflictCheckStatus": {"type": "string", "enum": ["not_checked", "clear", "conflict_detected"]}}, ["SVC-009"]),
    "service-commercial-ownership": schema("service-commercial-ownership", "Role-based commercial ownership and delegated responsibility for a Service or Service Arrangement.", ["commercialOwnershipId", "subjectType", "subjectId", "accountableRoleId", "effectivePeriod"], {"commercialOwnershipId": ref("stableId"), "subjectType": {"type": "string", "enum": ["service", "service_arrangement"]}, "subjectId": ref("stableId"), "accountableRoleId": ref("stableId"), "delegatedRoleIds": {"type": "array", "items": ref("stableId")}, "commercialFrameworkSummary": {"type": "string"}, "approval": ref("approval"), "effectivePeriod": ref("effectivePeriod")}, ["SVC-010"]),
}

for name, obj in SCHEMAS.items():
    (OUT / "schemas" / f"{name}.schema.json").write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

AUDIT = {"version": 1, "createdAt": "2026-07-14T17:30:00Z", "createdBy": "role:platform-governance", "updatedAt": "2026-07-14T17:30:00Z", "updatedBy": "role:platform-governance", "events": [{"eventType": "drafted", "occurredAt": "2026-07-14T17:30:00Z", "actorId": "role:platform-governance"}]}


def prov(ids):
    return {"sourceBdrIds": ids, "sourceSnapshot": "03 Pack 3-20260714T172736Z-1-001.zip", "authorityRank": "Approved Governed Decision Register"}


def period(end=None):
    return {"startAt": "2026-07-14T00:00:00Z", "endAt": end, "reason": "Draft fixture"}


def approval():
    return {"approvedBy": "role:authorised-approver", "approvedAt": "2026-07-14T17:30:00Z", "authorityGrantId": "grant:approve-pack-3-fixture", "reason": "Draft fixture approval"}


VALID = {
    "service": {"schemaVersion": "pack-3-draft-1", "serviceId": "svc:sandwich-lunch", "serviceName": "Sandwich Lunch", "servicePurpose": "Durable reusable hospitality offering.", "owningDomainId": "domain:hospitality", "lifecycleStatus": "active", "provenance": prov(["SVC-001", "SVC-002"]), "audit": AUDIT},
    "service-arrangement": {"schemaVersion": "pack-3-draft-1", "serviceArrangementId": "arr:wise-monday-breakfast", "serviceId": "svc:breakfast", "operationalLocationId": "oploc:wise", "clientRelationshipReferenceIds": ["clientrel:wise"], "commercialOwnershipId": "comm:wise-breakfast", "recurringScheduleIds": ["schedule:wise-monday-breakfast"], "lifecycleStatus": "active", "provenance": prov(["SVC-004", "SVC-007"]), "audit": AUDIT},
    "recurring-schedule": {"schemaVersion": "pack-3-draft-1", "recurringScheduleId": "schedule:wise-monday-breakfast", "serviceArrangementId": "arr:wise-monday-breakfast", "patternDescription": "Every Monday morning while active.", "effectivePeriod": period(), "exceptionIds": ["schex:wise-bank-holiday"], "lifecycleStatus": "active", "provenance": prov(["SVC-005", "SVC-007"]), "audit": AUDIT},
    "recurring-schedule-exception": {"schemaVersion": "pack-3-draft-1", "exceptionId": "schex:wise-bank-holiday", "recurringScheduleId": "schedule:wise-monday-breakfast", "exceptionType": "pause", "effectivePeriod": period("2026-08-31T23:59:59Z"), "reason": "Bank holiday pause.", "approval": approval(), "provenance": prov(["SVC-005"]), "audit": AUDIT},
    "requested-work-input": {"schemaVersion": "pack-3-draft-1", "requestedWorkInputId": "req:hospitality-001", "classification": "hospitality_booking", "sourceType": "hospitality_booking", "serviceArrangementId": "arr:angel-court-lunch", "serviceId": "svc:sandwich-lunch", "requestedDateTime": "2026-07-20T12:00:00Z", "destination": "Example destination", "quantitiesSummary": "15 people", "status": "requested", "provenance": prov(["SVC-006"]), "audit": AUDIT},
    "service-event-reference": {"schemaVersion": "pack-3-draft-1", "referenceId": "svcevt:celebration-catering", "eventId": "event:client-celebration", "serviceIds": ["svc:sandwich-lunch"], "serviceArrangementIds": ["arr:angel-court-lunch"], "relationshipType": "uses", "provenance": prov(["SVC-008"]), "audit": AUDIT},
    "service-domain-dependency": {"schemaVersion": "pack-3-draft-1", "dependencyId": "dep:lunch-production", "serviceArrangementId": "arr:angel-court-lunch", "supportingDomainId": "domain:production", "capabilityId": "cap:food-production", "dependencyDescription": "Production supports delivery but owns its own records.", "provenance": prov(["SVC-003"]), "audit": AUDIT},
    "equipment-allocation": {"schemaVersion": "pack-3-draft-1", "allocationId": "alloc:coffee-cart-event", "equipmentAssetId": "equip:coffee-cart-001", "allocationTargetType": "event", "allocationTargetId": "event:client-celebration", "staffRequirementSummary": "Authorised staff required.", "effectivePeriod": period("2026-07-20T16:00:00Z"), "locationScope": {"scopeType": "event", "scopeId": "event:client-celebration", "scopeLabel": "Client celebration"}, "conflictCheckStatus": "clear", "provenance": prov(["SVC-009"]), "audit": AUDIT},
    "service-commercial-ownership": {"schemaVersion": "pack-3-draft-1", "commercialOwnershipId": "comm:wise-breakfast", "subjectType": "service_arrangement", "subjectId": "arr:wise-monday-breakfast", "accountableRoleId": "role:commercial-owner", "delegatedRoleIds": ["role:specialist-operator"], "commercialFrameworkSummary": "Menus, packages, pricing principles and effective-date governance.", "approval": approval(), "effectivePeriod": period(), "provenance": prov(["SVC-010"]), "audit": AUDIT},
}

for name, data in VALID.items():
    (OUT / "schemas" / "fixtures" / "valid" / f"valid-{name}.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    invalid = json.loads(json.dumps(data))
    invalid.pop("schemaVersion", None)
    invalid["providerPayload"] = "not allowed in canonical schema"
    (OUT / "schemas" / "fixtures" / "invalid" / f"invalid-{name}.json").write_text(json.dumps(invalid, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

(OUT / "schemas" / "schema-index.md").write_text(
    "# Pack 3 Schema Index\n\n" + "\n".join(f"- `{name}.schema.json`" for name in sorted(SCHEMAS)) + "\n",
    encoding="utf-8",
)

(OUT / "reports" / "bdr-to-schema-traceability.md").write_text(
    "# Pack 3 BDR-to-Schema Traceability\n\n"
    "| Schema | Source BDRs | Boundary protected |\n|---|---|---|\n"
    + "\n".join(f"| `{name}.schema.json` | {', '.join(obj['x-fika-source-bdrs'])} | {obj['description'].split('.')[0]}. |" for name, obj in sorted(SCHEMAS.items()))
    + "\n",
    encoding="utf-8",
)

(OUT / "reports" / "schema-design-report.md").write_text(
    textwrap.dedent(
        """\
        # Pack 3 Schema Design Report

        These schemas are draft, technology-neutral business contracts generated from the revised Pack 3 Markdown candidates and the approved Pack 3 Governed Decision Register.

        ## Key modelling choices

        - Service is a durable reusable offering.
        - Service Arrangement is the OPLOC-specific way a Service is provided.
        - Recurring Schedule owns repeating planned delivery patterns and exceptions.
        - Requested Work Input preserves demand classification without adopting the unresolved final name of the shared fulfilment record.
        - Event, Equipment, Production and Training remain separate domains referenced by Service schemas without transferring ownership.
        - Commercial ownership is role-based through AUTHMOD and never assigned to named individuals.

        ## Deferred concepts

        - Service Family and Service Template remain unresolved.
        - The final canonical name of the shared fulfilment/work record remains unresolved.
        - Product and OPEXP are not adopted here.
        """
    ),
    encoding="utf-8",
)

(OUT / "reports" / "cross-pack-dependency-warnings.md").write_text(
    "# Cross-Pack Dependency Warnings\n\n"
    "- WARNING: Pack 3 references Operational Location, AUTHMOD, Operational Capability, Event, Equipment, Hospitality Booking and commercial authority concepts governed in other packs or future packs.\n"
    "- WARNING: Missing links to repository documents outside the ZIP are informational only under the run instructions.\n"
    "- WARNING: A full external Draft 2020-12 validator was not available in the bundled runtime; local structural validation is provided.\n",
    encoding="utf-8",
)

VALIDATOR = r'''#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', 'schemas');
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function typeOk(expected, value) {
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some(t => t === 'array' ? Array.isArray(value) : t === 'object' ? isObject(value) : t === 'integer' ? Number.isInteger(value) : t === 'null' ? value === null : typeof value === t);
}
function resolveRef(schema, ref) { return schema.$defs[ref.slice('#/$defs/'.length)]; }
function validateNode(rootSchema, schema, value, pointer, errors) {
  if (schema.$ref) return validateNode(rootSchema, resolveRef(rootSchema, schema.$ref), value, pointer, errors);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${pointer}: expected const ${schema.const}`);
  if (schema.type && !typeOk(schema.type, value)) { errors.push(`${pointer}: type mismatch`); return; }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${pointer}: value not in enum`);
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) errors.push(`${pointer}: below minLength`);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) errors.push(`${pointer}: below minimum`);
  if (schema.pattern && typeof value === 'string' && !(new RegExp(schema.pattern).test(value))) errors.push(`${pointer}: pattern mismatch`);
  if (schema.format === 'date-time' && typeof value === 'string' && Number.isNaN(Date.parse(value))) errors.push(`${pointer}: invalid date-time`);
  if (schema.type === 'object' && isObject(value)) {
    const props = schema.properties || {};
    for (const req of schema.required || []) if (!(req in value)) errors.push(`${pointer}/${req}: required property missing`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in props)) errors.push(`${pointer}/${key}: additional property not allowed`);
    for (const [key, child] of Object.entries(props)) if (key in value) validateNode(rootSchema, child, value[key], `${pointer}/${key}`, errors);
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${pointer}: below minItems`);
    if (schema.items) value.forEach((item, i) => validateNode(rootSchema, schema.items, item, `${pointer}/${i}`, errors));
  }
}
function validate(schema, data) { const errors = []; validateNode(schema, schema, data, '', errors); return errors; }
let failures = 0;
const results = [];
for (const schemaFile of fs.readdirSync(root).filter(f => f.endsWith('.schema.json')).sort()) {
  const base = schemaFile.replace('.schema.json', '');
  const schema = readJson(path.join(root, schemaFile));
  for (const [kind, expectedPass] of [['valid', true], ['invalid', false]]) {
    const fixture = `${kind}-${base}.json`;
    const errors = validate(schema, readJson(path.join(root, 'fixtures', kind, fixture)));
    const actualPass = errors.length === 0;
    if (actualPass !== expectedPass) failures++;
    results.push({schema: schemaFile, fixture, expected: expectedPass ? 'pass' : 'fail', actual: actualPass ? 'pass' : 'fail', errors});
  }
}
console.log(JSON.stringify({validator: 'local structural JSON Schema subset validator', failures, results}, null, 2));
process.exit(failures ? 1 : 0);
'''
(OUT / "scripts" / "validate-fixtures.js").write_text(VALIDATOR, encoding="utf-8")

(OUT / "staged-file-manifest.md").write_text(
    "# Pack 3 Staged File Manifest\n\n"
    + "\n".join(f"- {p.relative_to(OUT).as_posix()}" for p in sorted(OUT.rglob("*")) if p.is_file())
    + "\n",
    encoding="utf-8",
)

print(OUT)





