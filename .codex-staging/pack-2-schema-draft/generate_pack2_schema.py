from pathlib import Path
import json
import shutil
import textwrap

ROOT = Path(r"C:\FIKA\.codex-staging\pack-2-schema-draft\02 Pack 2")
OUT = ROOT / "Pack 2 Schema Draft"

if OUT.exists():
    shutil.rmtree(OUT)
for rel in ["schemas", "fixtures/valid", "fixtures/invalid", "reports", "scripts"]:
    (OUT / rel).mkdir(parents=True, exist_ok=True)

SCHEMA_NAMES = [
    "organisational-role",
    "responsibility",
    "assignment",
    "authority-grant",
    "permission-action-vocabulary",
    "approval-publication",
    "access-boundary",
    "emergency-access",
    "operational-capability-catalogue",
    "capability-enablement",
    "capability-dependency-rule",
    "capability-override",
]

DEFS = {
    "stableId": {"type": "string", "minLength": 1, "pattern": "^[A-Za-z][A-Za-z0-9_.:-]*$"},
    "isoDateTime": {"type": "string", "format": "date-time"},
    "lifecycleStatus": {
        "type": "string",
        "enum": ["draft", "active", "inactive", "retired", "expired", "revoked", "superseded"],
    },
    "permissionAction": {
        "type": "string",
        "enum": ["View", "Contribute", "Manage", "Approve", "Publish", "Administer"],
    },
    "scopeType": {
        "type": "string",
        "enum": [
            "organisation",
            "domain",
            "client",
            "brand",
            "operational_capability",
            "operational_location",
            "service",
            "service_arrangement",
            "event",
            "mobilisation",
            "application",
            "user",
            "project",
            "other",
        ],
    },
    "scope": {
        "type": "object",
        "additionalProperties": False,
        "required": ["scopeType", "scopeId"],
        "properties": {
            "scopeType": {"$ref": "#/$defs/scopeType"},
            "scopeId": {"$ref": "#/$defs/stableId"},
            "scopeLabel": {"type": "string"},
            "parentScopeId": {"$ref": "#/$defs/stableId"},
        },
    },
    "effectivePeriod": {
        "type": "object",
        "additionalProperties": False,
        "required": ["startAt"],
        "properties": {
            "startAt": {"$ref": "#/$defs/isoDateTime"},
            "endAt": {"type": ["string", "null"], "format": "date-time"},
            "reason": {"type": "string"},
        },
    },
    "provenance": {
        "type": "object",
        "additionalProperties": False,
        "required": ["sourceBdrIds", "sourceSnapshot", "authorityRank"],
        "properties": {
            "sourceBdrIds": {
                "type": "array",
                "minItems": 1,
                "items": {"type": "string", "pattern": "^[A-Z]+-\\d{3}$"},
            },
            "sourceSnapshot": {"type": "string"},
            "authorityRank": {
                "type": "string",
                "enum": [
                    "Approved Canon",
                    "Approved Pack 2 BDR Decision",
                    "Approved GRR",
                    "Supporting review artefact",
                ],
            },
            "notes": {"type": "string"},
        },
    },
    "auditEvent": {
        "type": "object",
        "additionalProperties": False,
        "required": ["eventType", "occurredAt", "actorId"],
        "properties": {
            "eventType": {"type": "string"},
            "occurredAt": {"$ref": "#/$defs/isoDateTime"},
            "actorId": {"$ref": "#/$defs/stableId"},
            "reason": {"type": "string"},
        },
    },
    "audit": {
        "type": "object",
        "additionalProperties": False,
        "required": ["version", "createdAt", "createdBy", "updatedAt", "updatedBy", "events"],
        "properties": {
            "version": {"type": "integer", "minimum": 1},
            "createdAt": {"$ref": "#/$defs/isoDateTime"},
            "createdBy": {"$ref": "#/$defs/stableId"},
            "updatedAt": {"$ref": "#/$defs/isoDateTime"},
            "updatedBy": {"$ref": "#/$defs/stableId"},
            "events": {"type": "array", "items": {"$ref": "#/$defs/auditEvent"}},
        },
    },
    "approval": {
        "type": "object",
        "additionalProperties": False,
        "required": ["approvedBy", "approvedAt", "authorityGrantId", "reason"],
        "properties": {
            "approvedBy": {"$ref": "#/$defs/stableId"},
            "approvedAt": {"$ref": "#/$defs/isoDateTime"},
            "authorityGrantId": {"$ref": "#/$defs/stableId"},
            "reason": {"type": "string"},
        },
    },
}


def schema(name, description, required, properties, bdrs):
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"https://fika.invalid/schemas/pack-2/{name}.schema.json",
        "title": name.replace("-", " ").title(),
        "description": description
        + " Draft business schema derived from approved Pack 2 BDR/GRR authority; not an implementation model.",
        "type": "object",
        "additionalProperties": False,
        "required": ["schemaVersion", *required, "provenance", "audit"],
        "properties": {
            "schemaVersion": {"type": "string", "const": "pack-2-draft-1"},
            **properties,
            "provenance": {"$ref": "#/$defs/provenance"},
            "audit": {"$ref": "#/$defs/audit"},
        },
        "$defs": DEFS,
        "x-fika-source-bdrs": bdrs,
        "x-fika-status": "Draft for review; not adopted",
    }


def ref(name):
    return {"$ref": f"#/$defs/{name}"}


SCHEMAS = {
    "permission-action-vocabulary": schema(
        "permission-action-vocabulary",
        "Controlled AUTHMOD business-action vocabulary.",
        ["vocabularyId", "actions", "owner"],
        {
            "vocabularyId": ref("stableId"),
            "owner": {
                "type": "object",
                "additionalProperties": False,
                "required": ["authorityModelOwnerId"],
                "properties": {"authorityModelOwnerId": ref("stableId")},
            },
            "actions": {
                "type": "array",
                "minItems": 6,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["action", "meaning", "doesNotConfer"],
                    "properties": {
                        "action": ref("permissionAction"),
                        "meaning": {"type": "string"},
                        "doesNotConfer": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
        },
        ["ROLE-001", "ROLE-003"],
    ),
    "organisational-role": schema(
        "organisational-role",
        "Durable organisational role in the business Role Catalogue.",
        ["roleId", "roleName", "purpose", "catalogueOwnerRoleId", "lifecycleStatus", "effectivePeriod"],
        {
            "roleId": ref("stableId"),
            "roleName": {"type": "string", "minLength": 1},
            "purpose": {"type": "string", "minLength": 1},
            "catalogueOwnerRoleId": ref("stableId"),
            "owningDomainIds": {"type": "array", "items": ref("stableId")},
            "responsibilityIds": {"type": "array", "items": ref("stableId")},
            "authorityRequirementIds": {"type": "array", "items": ref("stableId")},
            "lifecycleStatus": ref("lifecycleStatus"),
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["ROLE-001", "ROLE-002"],
    ),
    "responsibility": schema(
        "responsibility",
        "Work or accountability owned by a role or business domain.",
        ["responsibilityId", "description", "owningDomainId", "responsibleRoleId", "lifecycleStatus", "effectivePeriod"],
        {
            "responsibilityId": ref("stableId"),
            "description": {"type": "string", "minLength": 1},
            "owningDomainId": ref("stableId"),
            "responsibleRoleId": ref("stableId"),
            "scope": ref("scope"),
            "authorityRequirementIds": {"type": "array", "items": ref("stableId")},
            "lifecycleStatus": ref("lifecycleStatus"),
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["ROLE-001", "ROLE-002"],
    ),
    "assignment": schema(
        "assignment",
        "Effective-dated link between a named person and a role, responsibility or governed scope.",
        ["assignmentId", "assigneeId", "assignmentKind", "scope", "status", "effectivePeriod"],
        {
            "assignmentId": ref("stableId"),
            "assigneeId": ref("stableId"),
            "assignmentKind": {"type": "string", "enum": ["role", "responsibility", "scope", "cover", "delegation"]},
            "roleId": ref("stableId"),
            "responsibilityId": ref("stableId"),
            "scope": ref("scope"),
            "status": {"type": "string", "enum": ["active", "scheduled", "expired", "revoked"]},
            "source": {"type": "string"},
            "approvedBy": ref("stableId"),
            "authorityGrantIds": {"type": "array", "items": ref("stableId")},
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["ROLE-002", "ROLE-004"],
    ),
    "authority-grant": schema(
        "authority-grant",
        "AUTHMOD grant of explicit action authority to an organisational role for a scope and effective period.",
        ["authorityGrantId", "grantedToRoleId", "action", "scope", "status", "effectivePeriod", "approval"],
        {
            "authorityGrantId": ref("stableId"),
            "grantedToRoleId": ref("stableId"),
            "grantedToAssigneeId": ref("stableId"),
            "action": ref("permissionAction"),
            "scope": ref("scope"),
            "status": {"type": "string", "enum": ["active", "scheduled", "expired", "revoked"]},
            "approval": ref("approval"),
            "separationOfDutiesGroup": {"type": "string"},
            "leastPrivilegeJustification": {"type": "string"},
            "delegationSourceGrantId": ref("stableId"),
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["ROLE-001", "ROLE-002", "ROLE-003", "ROLE-004", "ROLE-006", "ROLE-007"],
    ),
    "approval-publication": schema(
        "approval-publication",
        "Record separating approval and publication business actions.",
        ["controlId", "subject", "approvalAction", "publicationAction", "status"],
        {
            "controlId": ref("stableId"),
            "subject": {
                "type": "object",
                "additionalProperties": False,
                "required": ["subjectType", "subjectId"],
                "properties": {"subjectType": {"type": "string"}, "subjectId": ref("stableId")},
            },
            "approvalAction": {
                "type": "object",
                "additionalProperties": False,
                "required": ["authorityGrantId", "actorId", "occurredAt"],
                "properties": {
                    "authorityGrantId": ref("stableId"),
                    "actorId": ref("stableId"),
                    "occurredAt": ref("isoDateTime"),
                    "reason": {"type": "string"},
                },
            },
            "publicationAction": {
                "type": "object",
                "additionalProperties": False,
                "required": ["authorityGrantId", "actorId", "occurredAt", "audienceScope"],
                "properties": {
                    "authorityGrantId": ref("stableId"),
                    "actorId": ref("stableId"),
                    "occurredAt": ref("isoDateTime"),
                    "audienceScope": ref("scope"),
                    "reason": {"type": "string"},
                },
            },
            "sameActorPermitted": {"type": "boolean"},
            "status": {"type": "string", "enum": ["approved", "published", "revoked", "superseded"]},
        },
        ["ROLE-003", "ROLE-005"],
    ),
    "access-boundary": schema(
        "access-boundary",
        "Least-privilege information-access boundary for a governed business purpose and scope.",
        ["accessBoundaryId", "informationCategory", "permittedAction", "scope", "detailLevel", "status", "effectivePeriod"],
        {
            "accessBoundaryId": ref("stableId"),
            "informationCategory": {
                "type": "string",
                "enum": ["workforce", "commercial", "financial", "client", "operational", "allergen", "food_safety", "safeguarding", "audit", "safety", "other"],
            },
            "permittedAction": ref("permissionAction"),
            "scope": ref("scope"),
            "detailLevel": {"type": "string", "enum": ["full_detail", "restricted_fields", "summary", "aggregated_output"]},
            "businessPurpose": {"type": "string"},
            "domainOwnerId": ref("stableId"),
            "status": {"type": "string", "enum": ["active", "scheduled", "expired", "revoked"]},
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["ROLE-006", "ROLE-003", "ROLE-004"],
    ),
    "emergency-access": schema(
        "emergency-access",
        "Exceptional, audited access session for urgent operational, security or continuity situations.",
        ["emergencyAccessId", "requesterId", "authoriserId", "reason", "scope", "status", "effectivePeriod", "accessedActions"],
        {
            "emergencyAccessId": ref("stableId"),
            "requesterId": ref("stableId"),
            "authoriserId": ref("stableId"),
            "reason": {"type": "string", "minLength": 1},
            "scope": ref("scope"),
            "accessedActions": {"type": "array", "minItems": 1, "items": ref("permissionAction")},
            "status": {"type": "string", "enum": ["requested", "authorised", "active", "revoked", "expired", "reviewed"]},
            "review": {
                "type": "object",
                "additionalProperties": False,
                "required": ["reviewedBy", "reviewedAt", "outcome"],
                "properties": {"reviewedBy": ref("stableId"), "reviewedAt": ref("isoDateTime"), "outcome": {"type": "string"}},
            },
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["ROLE-007", "ROLE-006"],
    ),
    "operational-capability-catalogue": schema(
        "operational-capability-catalogue",
        "Organisation-wide catalogue of approved Operational Capabilities.",
        ["catalogueId", "catalogueOwnerRoleId", "capabilities", "lifecycleStatus", "effectivePeriod"],
        {
            "catalogueId": ref("stableId"),
            "catalogueOwnerRoleId": ref("stableId"),
            "capabilities": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["capabilityId", "capabilityName", "owningDomainId", "businessPurpose", "lifecycleStatus", "effectivePeriod"],
                    "properties": {
                        "capabilityId": ref("stableId"),
                        "capabilityName": {"type": "string"},
                        "owningDomainId": ref("stableId"),
                        "businessPurpose": {"type": "string"},
                        "eligibilitySummary": {"type": "string"},
                        "dependencyRuleIds": {"type": "array", "items": ref("stableId")},
                        "lifecycleStatus": ref("lifecycleStatus"),
                        "effectivePeriod": ref("effectivePeriod"),
                    },
                },
            },
            "lifecycleStatus": ref("lifecycleStatus"),
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["CAP-001", "CAP-004"],
    ),
    "capability-enablement": schema(
        "capability-enablement",
        "Governed record that an approved Operational Capability is available within a scope.",
        ["enablementId", "capabilityId", "scope", "state", "businessOwnerRoleId", "effectivePeriod"],
        {
            "enablementId": ref("stableId"),
            "capabilityId": ref("stableId"),
            "scope": ref("scope"),
            "state": {"type": "string", "enum": ["enabled", "disabled", "unavailable", "ineligible"]},
            "businessOwnerRoleId": ref("stableId"),
            "configurationReferenceId": ref("stableId"),
            "dependencyValidation": {
                "type": "object",
                "additionalProperties": False,
                "required": ["validatedAt", "valid"],
                "properties": {"validatedAt": ref("isoDateTime"), "valid": {"type": "boolean"}, "notes": {"type": "string"}},
            },
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["CAP-001", "CAP-002", "CAP-004", "CFG-002", "CFG-003"],
    ),
    "capability-dependency-rule": schema(
        "capability-dependency-rule",
        "Governed dependency, exclusion, eligibility or advisory rule controlling valid capability combinations.",
        ["dependencyRuleId", "subjectCapabilityId", "ruleType", "scope", "owningDomainId", "approval", "effectivePeriod"],
        {
            "dependencyRuleId": ref("stableId"),
            "subjectCapabilityId": ref("stableId"),
            "ruleType": {"type": "string", "enum": ["mandatory_dependency", "conditional_dependency", "advisory_dependency", "exclusion", "eligibility"]},
            "relatedCapabilityId": ref("stableId"),
            "conditionDescription": {"type": "string"},
            "scope": ref("scope"),
            "owningDomainId": ref("stableId"),
            "approval": ref("approval"),
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["CAP-002", "CAP-004"],
    ),
    "capability-override": schema(
        "capability-override",
        "Authorised, effective-dated configuration variation changing an inherited capability value or enablement rule.",
        ["overrideId", "capabilityId", "scope", "inheritedValueReference", "resultingValue", "businessReason", "ownerRoleId", "approval", "status", "effectivePeriod"],
        {
            "overrideId": ref("stableId"),
            "capabilityId": ref("stableId"),
            "scope": ref("scope"),
            "inheritedValueReference": {
                "type": "object",
                "additionalProperties": False,
                "required": ["sourceScope", "valueKey"],
                "properties": {"sourceScope": ref("scope"), "valueKey": {"type": "string"}, "displayValue": {"type": "string"}},
            },
            "resultingValue": {
                "type": "object",
                "additionalProperties": False,
                "required": ["valueKey", "displayValue"],
                "properties": {"valueKey": {"type": "string"}, "displayValue": {"type": "string"}, "valueState": {"type": "string", "enum": ["enabled", "disabled", "unavailable", "ineligible", "other"]}},
            },
            "businessReason": {"type": "string"},
            "ownerRoleId": ref("stableId"),
            "approval": ref("approval"),
            "dependencyValidation": {
                "type": "object",
                "additionalProperties": False,
                "required": ["validatedAt", "valid"],
                "properties": {"validatedAt": ref("isoDateTime"), "valid": {"type": "boolean"}, "notes": {"type": "string"}},
            },
            "status": {"type": "string", "enum": ["active", "expired", "withdrawn", "revoked"]},
            "effectivePeriod": ref("effectivePeriod"),
        },
        ["CAP-003", "CFG-002", "CFG-003"],
    ),
}

for name, obj in SCHEMAS.items():
    (OUT / "schemas" / f"{name}.schema.json").write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

AUDIT = {
    "version": 1,
    "createdAt": "2026-07-14T12:00:00Z",
    "createdBy": "role:platform-governance",
    "updatedAt": "2026-07-14T12:00:00Z",
    "updatedBy": "role:platform-governance",
    "events": [{"eventType": "drafted", "occurredAt": "2026-07-14T12:00:00Z", "actorId": "role:platform-governance", "reason": "Pack 2 schema draft fixture"}],
}


def prov(ids):
    return {"sourceBdrIds": ids, "sourceSnapshot": "02 Pack 2-20260714T164540Z-1-001.zip", "authorityRank": "Approved GRR"}


def period(end=None):
    return {"startAt": "2026-07-14T00:00:00Z", "endAt": end, "reason": "Draft fixture effective period"}


def scope(kind="operational_location", sid="oploc:example", label="Example Operational Location"):
    return {"scopeType": kind, "scopeId": sid, "scopeLabel": label}


def approval():
    return {"approvedBy": "person:derek", "approvedAt": "2026-07-14T10:00:00Z", "authorityGrantId": "grant:approve-pack-2", "reason": "Approved Pack 2 schema fixture"}


VALID = {
    "permission-action-vocabulary": {
        "schemaVersion": "pack-2-draft-1",
        "vocabularyId": "vocab:authmod-actions",
        "owner": {"authorityModelOwnerId": "role:authmod-owner"},
        "actions": [
            {"action": "View", "meaning": "Read information within an authorised scope.", "doesNotConfer": ["Contribute", "Manage", "Approve", "Publish", "Administer"]},
            {"action": "Contribute", "meaning": "Create or amend records within authorised scope.", "doesNotConfer": ["Approve", "Publish", "Administer"]},
            {"action": "Manage", "meaning": "Coordinate operational control within a governed scope.", "doesNotConfer": ["Approve", "Publish"]},
            {"action": "Approve", "meaning": "Formally accept a governed business action or change.", "doesNotConfer": ["Publish", "Administer"]},
            {"action": "Publish", "meaning": "Make approved information available to an authorised audience.", "doesNotConfer": ["Approve", "Administer"]},
            {"action": "Administer", "meaning": "Perform technical or configuration administration.", "doesNotConfer": ["ownership", "commercial authority", "operational authority"]},
        ],
        "provenance": prov(["ROLE-001", "ROLE-003"]),
        "audit": AUDIT,
    },
    "organisational-role": {
        "schemaVersion": "pack-2-draft-1",
        "roleId": "role:operations-leadership",
        "roleName": "Operations Leadership",
        "purpose": "Own organisation-wide role catalogue coherence.",
        "catalogueOwnerRoleId": "role:operations-leadership",
        "owningDomainIds": ["domain:operations"],
        "responsibilityIds": ["resp:role-catalogue-coherence"],
        "authorityRequirementIds": ["grant:manage-role-catalogue"],
        "lifecycleStatus": "active",
        "effectivePeriod": period(),
        "provenance": prov(["ROLE-001", "ROLE-002"]),
        "audit": AUDIT,
    },
    "responsibility": {
        "schemaVersion": "pack-2-draft-1",
        "responsibilityId": "resp:role-catalogue-coherence",
        "description": "Maintain coherent organisational role catalogue meaning.",
        "owningDomainId": "domain:operations",
        "responsibleRoleId": "role:operations-leadership",
        "scope": scope("organisation", "org:fika", "FIKA"),
        "authorityRequirementIds": ["grant:manage-role-catalogue"],
        "lifecycleStatus": "active",
        "effectivePeriod": period(),
        "provenance": prov(["ROLE-001", "ROLE-002"]),
        "audit": AUDIT,
    },
    "assignment": {
        "schemaVersion": "pack-2-draft-1",
        "assignmentId": "assign:ops-leadership-example",
        "assigneeId": "person:example",
        "assignmentKind": "role",
        "roleId": "role:operations-leadership",
        "scope": scope("organisation", "org:fika", "FIKA"),
        "status": "active",
        "source": "Approved role assignment fixture",
        "approvedBy": "person:derek",
        "authorityGrantIds": ["grant:manage-role-catalogue"],
        "effectivePeriod": period(),
        "provenance": prov(["ROLE-002", "ROLE-004"]),
        "audit": AUDIT,
    },
    "authority-grant": {
        "schemaVersion": "pack-2-draft-1",
        "authorityGrantId": "grant:manage-role-catalogue",
        "grantedToRoleId": "role:operations-leadership",
        "action": "Manage",
        "scope": scope("organisation", "org:fika", "FIKA"),
        "status": "active",
        "approval": approval(),
        "separationOfDutiesGroup": "role-catalogue-governance",
        "leastPrivilegeJustification": "Role catalogue management only.",
        "effectivePeriod": period(),
        "provenance": prov(["ROLE-001", "ROLE-002", "ROLE-003", "ROLE-004"]),
        "audit": AUDIT,
    },
    "approval-publication": {
        "schemaVersion": "pack-2-draft-1",
        "controlId": "approvalpub:capability-catalogue",
        "subject": {"subjectType": "operational_capability_catalogue", "subjectId": "catalogue:operational-capabilities"},
        "approvalAction": {"authorityGrantId": "grant:approve-capability-catalogue", "actorId": "person:derek", "occurredAt": "2026-07-14T10:00:00Z", "reason": "Fixture approval"},
        "publicationAction": {"authorityGrantId": "grant:publish-capability-catalogue", "actorId": "person:derek", "occurredAt": "2026-07-14T11:00:00Z", "audienceScope": scope("organisation", "org:fika", "FIKA"), "reason": "Fixture publication"},
        "sameActorPermitted": True,
        "status": "published",
        "provenance": prov(["ROLE-003", "ROLE-005"]),
        "audit": AUDIT,
    },
    "access-boundary": {
        "schemaVersion": "pack-2-draft-1",
        "accessBoundaryId": "access:oploc-workforce-summary",
        "informationCategory": "workforce",
        "permittedAction": "View",
        "scope": scope(),
        "detailLevel": "summary",
        "businessPurpose": "Operational management within assigned scope.",
        "domainOwnerId": "domain:operations",
        "status": "active",
        "effectivePeriod": period(),
        "provenance": prov(["ROLE-006", "ROLE-003", "ROLE-004"]),
        "audit": AUDIT,
    },
    "emergency-access": {
        "schemaVersion": "pack-2-draft-1",
        "emergencyAccessId": "emergency:example-001",
        "requesterId": "person:example",
        "authoriserId": "person:derek",
        "reason": "Urgent operational continuity fixture.",
        "scope": scope("organisation", "org:fika", "FIKA"),
        "status": "reviewed",
        "effectivePeriod": period("2026-07-14T13:00:00Z"),
        "accessedActions": ["View", "Administer"],
        "review": {"reviewedBy": "person:derek", "reviewedAt": "2026-07-14T14:00:00Z", "outcome": "Fixture reviewed; no permanent permission change."},
        "provenance": prov(["ROLE-007", "ROLE-006"]),
        "audit": AUDIT,
    },
    "operational-capability-catalogue": {
        "schemaVersion": "pack-2-draft-1",
        "catalogueId": "catalogue:operational-capabilities",
        "catalogueOwnerRoleId": "role:operations-leadership",
        "capabilities": [{"capabilityId": "cap:hospitality", "capabilityName": "Hospitality", "owningDomainId": "domain:hospitality", "businessPurpose": "Support hospitality work where enabled.", "eligibilitySummary": "Subject to approved dependencies and configuration.", "dependencyRuleIds": ["caprule:hospitality-booking-process"], "lifecycleStatus": "active", "effectivePeriod": period()}],
        "lifecycleStatus": "active",
        "effectivePeriod": period(),
        "provenance": prov(["CAP-001", "CAP-004"]),
        "audit": AUDIT,
    },
    "capability-enablement": {
        "schemaVersion": "pack-2-draft-1",
        "enablementId": "capenable:hospitality-example",
        "capabilityId": "cap:hospitality",
        "scope": scope(),
        "state": "enabled",
        "businessOwnerRoleId": "role:hospitality-owner",
        "configurationReferenceId": "config:capability-enable-example",
        "dependencyValidation": {"validatedAt": "2026-07-14T12:00:00Z", "valid": True, "notes": "Fixture dependencies satisfied."},
        "effectivePeriod": period(),
        "provenance": prov(["CAP-001", "CAP-002", "CAP-004", "CFG-002", "CFG-003"]),
        "audit": AUDIT,
    },
    "capability-dependency-rule": {
        "schemaVersion": "pack-2-draft-1",
        "dependencyRuleId": "caprule:hospitality-booking-process",
        "subjectCapabilityId": "cap:hospitality",
        "ruleType": "mandatory_dependency",
        "relatedCapabilityId": "cap:booking-platform",
        "conditionDescription": "Hospitality capability requires a valid booking process where hospitality bookings are accepted.",
        "scope": scope("domain", "domain:hospitality", "Hospitality"),
        "owningDomainId": "domain:hospitality",
        "approval": approval(),
        "effectivePeriod": period(),
        "provenance": prov(["CAP-002", "CAP-004"]),
        "audit": AUDIT,
    },
    "capability-override": {
        "schemaVersion": "pack-2-draft-1",
        "overrideId": "capoverride:hospitality-example-temporary",
        "capabilityId": "cap:hospitality",
        "scope": scope(),
        "inheritedValueReference": {"sourceScope": scope("domain", "domain:hospitality", "Hospitality"), "valueKey": "enablement.default", "displayValue": "disabled"},
        "resultingValue": {"valueKey": "enablement.default", "displayValue": "enabled for fixture scope", "valueState": "enabled"},
        "businessReason": "Fixture override for governed enablement.",
        "ownerRoleId": "role:hospitality-owner",
        "approval": approval(),
        "dependencyValidation": {"validatedAt": "2026-07-14T12:00:00Z", "valid": True, "notes": "No protected dependency bypassed."},
        "status": "active",
        "effectivePeriod": period("2026-12-31T23:59:59Z"),
        "provenance": prov(["CAP-003", "CFG-002", "CFG-003"]),
        "audit": AUDIT,
    },
}

for name, data in VALID.items():
    (OUT / "fixtures/valid" / f"valid-{name}.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    bad = json.loads(json.dumps(data))
    bad.pop("schemaVersion", None)
    bad["unexpectedImplementationField"] = "must fail because additionalProperties is false"
    (OUT / "fixtures/invalid" / f"invalid-{name}.json").write_text(json.dumps(bad, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

trace_rows = [
    ("organisational-role.schema.json", "ROLE-001, ROLE-002", "Role catalogue ownership; role/responsibility/authority separation", "Role is durable business concept; does not grant authority itself."),
    ("responsibility.schema.json", "ROLE-001, ROLE-002", "Responsibilities owned by roles/domains", "Responsibility is not assignment and not authority."),
    ("assignment.schema.json", "ROLE-002, ROLE-004", "Effective-dated person-to-role/responsibility/scope relationship", "Assignment does not grant authority automatically."),
    ("authority-grant.schema.json", "ROLE-001, ROLE-002, ROLE-003, ROLE-004, ROLE-006, ROLE-007", "Explicit AUTHMOD action grant by role/scope/effective period", "Authority independent of job title, assignment and technical access."),
    ("permission-action-vocabulary.schema.json", "ROLE-001, ROLE-003", "View, Contribute, Manage, Approve, Publish, Administer", "Controlled action vocabulary only."),
    ("approval-publication.schema.json", "ROLE-003, ROLE-005", "Approval and publication are separate actions", "May be same actor only where authority permits."),
    ("access-boundary.schema.json", "ROLE-006, ROLE-003, ROLE-004", "Least-privilege information access by purpose/scope/sensitivity", "Access does not follow automatically from job title or admin."),
    ("emergency-access.schema.json", "ROLE-007, ROLE-006", "Exceptional audited time-limited access", "Not substitute for normal permissions."),
    ("operational-capability-catalogue.schema.json", "CAP-001, CAP-004", "Catalogue of governed reusable business abilities", "Capability does not own domain meaning or permissions."),
    ("capability-enablement.schema.json", "CAP-001, CAP-002, CAP-004, CFG-002, CFG-003", "Approved capability availability in governed scope", "Enablement is not permission or local definition."),
    ("capability-dependency-rule.schema.json", "CAP-002, CAP-004", "Dependency/exclusion/eligibility/advisory rules", "Rules are owned and approved; not inferred by apps."),
    ("capability-override.schema.json", "CAP-003, CFG-002, CFG-003", "Effective-dated variation of inherited capability value/rule", "Override cannot rewrite history or canonical meaning."),
]

trace = ["# Pack 2 BDR-to-Schema Traceability Matrix", "", "| Schema | Source BDRs | Decision basis | Boundary preserved |", "|---|---|---|---|"]
trace += ["| " + " | ".join(row) + " |" for row in trace_rows]
(OUT / "reports" / "bdr-to-schema-traceability.md").write_text("\n".join(trace) + "\n", encoding="utf-8")

(OUT / "reports" / "schema-design-report.md").write_text(textwrap.dedent("""\
    # Pack 2 Schema Design Report

    ## Status

    These JSON Schema Draft 2020-12 contracts are draft business schemas generated from the authorised ZIP snapshot only. They are not adopted schemas, database designs, APIs or implementation models.

    ## Authority used

    1. Approved Canon, where represented in the ZIP supporting artefacts.
    2. Approved Pack 2 BDR Decisions.
    3. Approved Governed Refactoring Register entries in `Pack 2 Governed Refactoring Register.docx`.
    4. Supporting review artefacts in the ZIP.

    ## Design choices

    - Ownership, authority, assignment, capability, configuration and permission concepts are separate schema contracts.
    - Every schema includes `schemaVersion`, provenance, effective dating where relevant, lifecycle/status where relevant, and audit metadata.
    - `additionalProperties: false` is used throughout every object definition authored in this draft.
    - AUTHMOD actions use only the approved vocabulary: View, Contribute, Manage, Approve, Publish and Administer.
    - Capability enablement records availability only; it does not grant authority or redefine domain meaning.
    - Overrides and dependency rules preserve approval, reason, effective period and audit history.
    - Emergency access is modelled as exceptional, time-limited and reviewable.

    ## Deliberately not included

    - Database tables, collections, APIs, provider IDs, application roles, production implementation details or storage-specific constructs.
    - Final business lifecycle catalogues beyond status values needed to express lifecycle, expiry, revocation and retirement in the approved decisions.
    - Named individuals as enduring business owners.

    ## Open review questions

    - Confirm whether the draft lifecycle/status vocabularies should be standardised across Pack 2 or split per domain.
    - Confirm whether `other` should remain available for governed scope and information categories, or be replaced by future approved catalogues.
    - Confirm whether authority grants to named assignees should remain optional as a delegated execution mechanism while role authority remains primary.
    - Confirm whether approval/publication relationships should stay as a separate control record or be embedded by subject schemas in later packs.
    """), encoding="utf-8")

validator = r'''#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function typeOk(expected, value) {
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some(t => t === 'array' ? Array.isArray(value) : t === 'object' ? isObject(value) : t === 'integer' ? Number.isInteger(value) : t === 'null' ? value === null : typeof value === t);
}
function resolveRef(schema, ref) {
  if (!ref.startsWith('#/$defs/')) throw new Error(`Unsupported ref ${ref}`);
  return schema.$defs[ref.slice('#/$defs/'.length)];
}
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
const schemas = fs.readdirSync(path.join(root, 'schemas')).filter(f => f.endsWith('.schema.json')).sort();
for (const schemaFile of schemas) {
  const base = schemaFile.replace('.schema.json', '');
  const schema = readJson(path.join(root, 'schemas', schemaFile));
  for (const [kind, shouldPass] of [['valid', true], ['invalid', false]]) {
    const fixture = `${kind}-${base}.json`;
    const data = readJson(path.join(root, 'fixtures', kind, fixture));
    const errors = validate(schema, data);
    const actualPass = errors.length === 0;
    if (actualPass !== shouldPass) failures++;
    results.push({schema: schemaFile, fixture, expected: shouldPass ? 'pass' : 'fail', actual: actualPass ? 'pass' : 'fail', errors});
  }
}
const output = {validator: 'local structural JSON Schema subset validator for Pack 2 fixtures', failures, results};
console.log(JSON.stringify(output, null, 2));
process.exit(failures ? 1 : 0);
'''
(OUT / "scripts" / "validate-fixtures.js").write_text(validator, encoding="utf-8")

manifest = ["# Pack 2 Schema Draft Manifest", "", "## Schemas", ""]
manifest += [f"- schemas/{p.name}" for p in sorted((OUT / "schemas").glob("*.json"))]
manifest += ["", "## Valid fixtures", ""]
manifest += [f"- fixtures/valid/{p.name}" for p in sorted((OUT / "fixtures/valid").glob("*.json"))]
manifest += ["", "## Invalid fixtures", ""]
manifest += [f"- fixtures/invalid/{p.name}" for p in sorted((OUT / "fixtures/invalid").glob("*.json"))]
manifest += ["", "## Reports and scripts", "", "- reports/bdr-to-schema-traceability.md", "- reports/schema-design-report.md", "- reports/validation-report.json", "- scripts/validate-fixtures.js"]
(OUT / "staged-file-manifest.md").write_text("\n".join(manifest) + "\n", encoding="utf-8")

print(OUT)
