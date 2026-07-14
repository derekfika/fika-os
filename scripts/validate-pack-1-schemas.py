"""Validate Draft Pack 1 JSON Schemas and their non-production fixtures."""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator, FormatChecker
    from jsonschema.exceptions import SchemaError
    from referencing import Registry, Resource
except ImportError as exc:
    raise SystemExit(
        "Missing validation dependency. Install 'jsonschema' in a local development "
        "environment, then rerun this command."
    ) from exc


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = REPOSITORY_ROOT / "schemas" / "pack-1"
FIXTURE_DIR = REPOSITORY_ROOT / "fixtures" / "pack-1"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def semantic_errors(schema_slug: str, instance: dict) -> list[str]:
    errors: list[str] = []

    if "createdAt" in instance and "updatedAt" in instance:
        if instance["createdAt"] > instance["updatedAt"]:
            errors.append("createdAt must not be later than updatedAt")

    for key in ("effectiveFrom",):
        if key in instance and "effectiveTo" in instance:
            if instance[key] >= instance["effectiveTo"]:
                errors.append("effectiveFrom must be earlier than effectiveTo")

    if schema_slug == "location-type":
        history = instance.get("changeHistory", [])
        if history and history[-1].get("newName") != instance.get("name"):
            errors.append("current Location Type name must match the latest catalogue change")
        if instance.get("catalogueState") == "retired":
            if not history or history[-1].get("changeType") != "retire":
                errors.append("a retired Location Type must end with a retirement change")
        if instance.get("catalogueState") == "active":
            if history and history[-1].get("changeType") == "retire":
                errors.append("an active Location Type cannot end with a retirement change")

    if schema_slug != "operational-location":
        return errors

    operational_location_id = instance.get("operationalLocationId")
    if instance.get("mergedIntoOperationalLocationId") == operational_location_id:
        errors.append("an Operational Location cannot merge into itself")

    history = instance.get("locationTypeHistory", [])
    open_assignments = [entry for entry in history if "effectiveTo" not in entry]
    if len(open_assignments) != 1:
        errors.append("exactly one Location Type assignment must be current")

    current = instance.get("currentLocationTypeAssignment")
    if current and len(open_assignments) == 1:
        if current.get("assignmentId") != open_assignments[0].get("assignmentId"):
            errors.append("currentLocationTypeAssignment must reference the open history entry")

    for assignment in history:
        if assignment.get("operationalLocationId") != operational_location_id:
            errors.append("Location Type history must reference its owning Operational Location")
        if "effectiveTo" in assignment and assignment["effectiveFrom"] >= assignment["effectiveTo"]:
            errors.append("Location Type assignment effectiveFrom must precede effectiveTo")

    lifecycle_history = instance.get("lifecycleHistory", [])
    if lifecycle_history:
        if lifecycle_history[-1].get("toState") != instance.get("lifecycleState"):
            errors.append("current lifecycleState must match the latest transition")

    return errors


def main() -> int:
    schema_paths = sorted(SCHEMA_DIR.glob("*.schema.json"))
    if not schema_paths:
        print("No Pack 1 schemas found.", file=sys.stderr)
        return 1

    schemas = {path.name.removesuffix(".schema.json"): load_json(path) for path in schema_paths}
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
    )

    schema_failures: list[str] = []
    for slug, schema in schemas.items():
        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            schema_failures.append(f"{slug}: {exc.message}")

    fixture_failures: list[str] = []
    valid_count = 0
    invalid_count = 0

    for expectation in ("valid", "invalid"):
        for path in sorted((FIXTURE_DIR / expectation).glob("*/*.json")):
            slug = path.parent.name
            if slug not in schemas:
                fixture_failures.append(f"{path.relative_to(REPOSITORY_ROOT)}: no matching schema")
                continue

            instance = load_json(path)
            validator = Draft202012Validator(
                schemas[slug], registry=registry, format_checker=FormatChecker()
            )
            errors = [error.message for error in validator.iter_errors(instance)]
            errors.extend(semantic_errors(slug, instance))

            if expectation == "valid":
                valid_count += 1
                if errors:
                    fixture_failures.append(
                        f"{path.relative_to(REPOSITORY_ROOT)} unexpectedly failed: "
                        + "; ".join(errors)
                    )
            else:
                invalid_count += 1
                if not errors:
                    fixture_failures.append(
                        f"{path.relative_to(REPOSITORY_ROOT)} unexpectedly passed"
                    )

    failures = schema_failures + fixture_failures
    print(f"Schemas checked: {len(schemas)}")
    print(f"Valid fixtures checked: {valid_count}")
    print(f"Invalid fixtures checked: {invalid_count}")
    if failures:
        print("Validation failures:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Draft Pack 1 schema validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
