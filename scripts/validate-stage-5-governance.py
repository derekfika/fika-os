"""Validate Stage 5 BDR, traceability, and relative-link integrity."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BDR_PATTERN = re.compile(
    r"\b(?:BRAND|BOOK|CAP|CFG|CLIENT|EVT|LOC|MOB|PROD|ROLE|SVC|TYPE|WASTE)-\d{3}\b"
)


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def main() -> int:
    failures: list[str] = []
    bdr_ids: dict[str, Path] = {}

    for path in sorted((ROOT / "docs" / "business-decisions").glob("*.md")):
        if path.name in {"000-template.md", "README.md"}:
            continue
        content = read_text(path)
        match = re.search(r"^- \*\*Decision ID:\*\*\s*(\S+)", content, re.MULTILINE)
        decision = re.search(
            r"^## Decision\s*\n(.*?)(?=\n## |\Z)", content, re.MULTILINE | re.DOTALL
        )
        if not match:
            failures.append(f"{path.relative_to(ROOT)}: missing Decision ID")
            continue
        decision_id = match.group(1)
        if decision_id in bdr_ids:
            failures.append(
                f"duplicate Decision ID {decision_id}: {bdr_ids[decision_id]} and {path}"
            )
        bdr_ids[decision_id] = path
        if not decision or not decision.group(1).strip():
            failures.append(f"{path.relative_to(ROOT)}: missing Decision section")

    for pack in range(1, 9):
        traceability = (
            ROOT / "docs" / "schema-reviews" / f"pack-{pack}-bdr-to-schema-traceability.md"
        )
        if not traceability.exists():
            failures.append(f"{traceability.relative_to(ROOT)}: missing traceability record")
            continue
        content = read_text(traceability)
        for decision_id in sorted(set(BDR_PATTERN.findall(content))):
            if decision_id not in bdr_ids:
                failures.append(
                    f"{traceability.relative_to(ROOT)}: unknown BDR {decision_id}"
                )
        normalised_traceability = normalise(content)
        for schema_path in sorted((ROOT / "schemas" / f"pack-{pack}").glob("*.schema.json")):
            schema = json.loads(read_text(schema_path))
            filename_key = normalise(schema_path.name.removesuffix(".schema.json"))
            title_key = normalise(schema.get("title", ""))
            if filename_key not in normalised_traceability and (
                not title_key or title_key not in normalised_traceability
            ):
                failures.append(
                    f"{traceability.relative_to(ROOT)}: no traceability entry for {schema_path.name}"
                )

    links_checked = 0
    for path in ROOT.rglob("*.md"):
        content = read_text(path)
        for target in re.findall(r"(?<!!)\[[^\]]*\]\(([^)]+)\)", content):
            relative = target.strip().split("#", 1)[0]
            if not relative or re.match(r"^[a-z]+:", relative, re.IGNORECASE):
                continue
            links_checked += 1
            resolved = (path.parent / relative.replace("\\", "/")).resolve()
            if not resolved.exists():
                failures.append(
                    f"{path.relative_to(ROOT)}: broken relative link {target}"
                )

    print(
        json.dumps(
            {
                "bdrs": len(bdr_ids),
                "packs": 8,
                "relativeLinksChecked": links_checked,
                "failures": failures,
            },
            indent=2,
        )
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
