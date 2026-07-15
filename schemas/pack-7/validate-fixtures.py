from pathlib import Path
from datetime import date, datetime
import json
import re

root = Path(__file__).resolve().parent

def resolve_ref(schema, reference):
    if not reference.startswith("#/"):
        raise ValueError(f"Unsupported external reference: {reference}")
    value = schema
    for part in reference[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value

def validate(schema, rule, value, path="$"):
    errors = []
    if "$ref" in rule:
        return validate(schema, resolve_ref(schema, rule["$ref"]), value, path)
    if "required" in rule and isinstance(value, dict):
        for name in rule["required"]:
            if name not in value:
                errors.append(f"{path}.{name}: required property missing")
    if "const" in rule and value != rule["const"]:
        errors.append(f"{path}: must equal {rule['const']!r}")
    if "enum" in rule and value not in rule["enum"]:
        errors.append(f"{path}: value is not in the permitted catalogue")
    expected_type = rule.get("type")
    if expected_type == "object":
        if not isinstance(value, dict):
            return errors + [f"{path}: must be an object"]
        if rule.get("additionalProperties") is False:
            allowed = set(rule.get("properties", {}))
            for name in value:
                if name not in allowed:
                    errors.append(f"{path}.{name}: additional property not allowed")
        for name, child in value.items():
            if name in rule.get("properties", {}):
                errors.extend(validate(schema, rule["properties"][name], child, f"{path}.{name}"))
    elif expected_type == "array":
        if not isinstance(value, list):
            return errors + [f"{path}: must be an array"]
        if len(value) < rule.get("minItems", 0):
            errors.append(f"{path}: contains too few items")
        if rule.get("uniqueItems") and len({json.dumps(item, sort_keys=True) for item in value}) != len(value):
            errors.append(f"{path}: items must be unique")
        for index, child in enumerate(value):
            errors.extend(validate(schema, rule.get("items", {}), child, f"{path}[{index}]"))
    elif expected_type == "string":
        if not isinstance(value, str):
            return errors + [f"{path}: must be a string"]
        if len(value) < rule.get("minLength", 0):
            errors.append(f"{path}: string is too short")
        if len(value) > rule.get("maxLength", len(value)):
            errors.append(f"{path}: string is too long")
        if "pattern" in rule and not re.search(rule["pattern"], value):
            errors.append(f"{path}: string does not match required pattern")
        try:
            if rule.get("format") == "date-time":
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            elif rule.get("format") == "date":
                date.fromisoformat(value)
        except ValueError:
            errors.append(f"{path}: invalid ISO 8601 {rule.get('format')}")
    elif expected_type == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            return errors + [f"{path}: must be an integer"]
        if value < rule.get("minimum", value):
            errors.append(f"{path}: below minimum")
    elif expected_type == "boolean":
        if not isinstance(value, bool):
            errors.append(f"{path}: must be a boolean")
    for branch_set in ("anyOf", "oneOf"):
        if branch_set in rule:
            passes = sum(not validate(schema, branch, value, path) for branch in rule[branch_set])
            if (branch_set == "anyOf" and passes < 1) or (branch_set == "oneOf" and passes != 1):
                errors.append(f"{path}: does not satisfy {branch_set}")
    return errors

results = []
failures = 0
for schema_path in sorted(root.glob("*.schema.json")):
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        raise ValueError(f"{schema_path.name} does not declare Draft 2020-12")
    stem = schema_path.name.removesuffix(".schema.json")
    for expected, folder in (("pass", "valid"), ("fail", "invalid")):
        fixture_path = root / "fixtures" / folder / f"{folder}-{stem}.json"
        instance = json.loads(fixture_path.read_text(encoding="utf-8"))
        errors = validate(schema, schema, instance)
        actual = "fail" if errors else "pass"
        passed = actual == expected
        failures += 0 if passed else 1
        results.append({"schema": schema_path.name, "fixture": fixture_path.name, "expected": expected, "actual": actual, "passed": passed, "errors": errors})

report = {"validator": "local deterministic validator for the Draft 2020-12 keywords used by this pack", "schemaSyntaxValid": True, "failures": failures, "results": results}
(root / "schema-validation-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
raise SystemExit(1 if failures else 0)
