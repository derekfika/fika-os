"""Validate all integrated Stage 5 schemas and fixtures with Draft 2020-12."""

from __future__ import annotations

import json
import importlib.util
import sys
from pathlib import Path
from urllib.parse import unquote

sys.dont_write_bytecode = True

try:
    from jsonschema import Draft202012Validator, FormatChecker
    from jsonschema.exceptions import SchemaError
    from referencing import Registry, Resource
except ImportError as exc:
    raise SystemExit(
        "Missing validation dependencies. Run: "
        "python -m pip install -r requirements-validation.txt"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
PACKS = range(1, 9)


def load_pack_1_semantic_validator():
    path = ROOT / "scripts" / "validate-pack-1-schemas.py"
    spec = importlib.util.spec_from_file_location("pack_1_validator", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load Pack 1 semantic validator: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.semantic_errors


PACK_1_SEMANTIC_ERRORS = load_pack_1_semantic_validator()


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def iter_references(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "$ref" and isinstance(child, str):
                yield child
            else:
                yield from iter_references(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_references(child)


def resolve_pointer(document: dict, fragment: str):
    value = document
    if not fragment:
        return value
    if not fragment.startswith("/"):
        raise KeyError(f"unsupported fragment #{fragment}")
    for part in fragment[1:].split("/"):
        key = unquote(part).replace("~1", "/").replace("~0", "~")
        value = value[key]
    return value


def fixture_directories(pack: int) -> tuple[Path, Path]:
    if pack == 1:
        base = ROOT / "fixtures" / "pack-1"
    else:
        base = ROOT / "schemas" / f"pack-{pack}" / "fixtures"
    return base / "valid", base / "invalid"


def fixture_schema_slug(pack: int, path: Path) -> str:
    if pack == 1:
        return path.parent.name
    if pack == 5:
        return "event"
    name = path.stem
    for prefix in ("valid-", "invalid-"):
        if name.startswith(prefix):
            return name.removeprefix(prefix)
    return path.parent.name


def main() -> int:
    schema_paths = [
        path
        for pack in PACKS
        for path in sorted((ROOT / "schemas" / f"pack-{pack}").glob("*.schema.json"))
    ]
    schemas = {path: load_json(path) for path in schema_paths}
    schemas_by_id = {schema["$id"]: schema for schema in schemas.values()}
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
    )

    failures: list[str] = []
    results: dict[int, dict[str, int]] = {}

    for path, schema in schemas.items():
        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            failures.append(f"{path.relative_to(ROOT)}: invalid schema: {exc.message}")
        for reference in iter_references(schema):
            target_id, separator, fragment = reference.partition("#")
            target = schema if not target_id else schemas_by_id.get(target_id)
            if target is None:
                failures.append(
                    f"{path.relative_to(ROOT)}: unresolved external $ref {reference}"
                )
                continue
            if separator:
                try:
                    resolve_pointer(target, fragment)
                except (KeyError, TypeError) as exc:
                    failures.append(
                        f"{path.relative_to(ROOT)}: unresolved $ref {reference}: {exc}"
                    )

    for pack in PACKS:
        pack_schemas = {
            path.name.removesuffix(".schema.json"): (path, schema)
            for path, schema in schemas.items()
            if path.parent.name == f"pack-{pack}"
        }
        valid_dir, invalid_dir = fixture_directories(pack)
        result = {"schemas": len(pack_schemas), "valid": 0, "invalid": 0}

        for expected, directory in (("valid", valid_dir), ("invalid", invalid_dir)):
            fixture_paths = sorted(directory.rglob("*.json"))
            for fixture_path in fixture_paths:
                slug = fixture_schema_slug(pack, fixture_path)
                if slug not in pack_schemas:
                    failures.append(
                        f"{fixture_path.relative_to(ROOT)}: no matching {slug}.schema.json"
                    )
                    continue

                schema_path, schema = pack_schemas[slug]
                instance = load_json(fixture_path)
                validator = Draft202012Validator(
                    schema, registry=registry, format_checker=FormatChecker()
                )
                errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
                semantic_errors = PACK_1_SEMANTIC_ERRORS(slug, instance) if pack == 1 else []
                result[expected] += 1

                if expected == "valid" and (errors or semantic_errors):
                    first_error = errors[0].message if errors else semantic_errors[0]
                    failures.append(
                        f"{fixture_path.relative_to(ROOT)} unexpectedly failed against "
                        f"{schema_path.name}: {first_error}"
                    )
                if expected == "invalid" and not errors and not semantic_errors:
                    failures.append(
                        f"{fixture_path.relative_to(ROOT)} unexpectedly passed against "
                        f"{schema_path.name}"
                    )

        results[pack] = result

    print(json.dumps({"packs": results, "failures": failures}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
