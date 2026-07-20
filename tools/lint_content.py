#!/usr/bin/env python3
"""Content linter: the coaching knowledge base must stay internally consistent.

Checks (docs/06 §2, §7):
  1. Every fault YAML has the required fields.
  2. Every drill YAML has the required fields.
  3. Every drill referenced by a fault's fixes_by_cause exists.
  4. Every fault referenced by a drill's targets_faults exists.
  5. Every prerequisite fault exists.
  6. Every root cause has a fix entry, and vice versa.
  7. Fault ids used as Rust constants in core/src/faults.rs exist in content.

Zero-dependency: parses only the subset of YAML this content uses
(top-level scalars, one-level maps, flow lists), so CI needs no pip installs.
Exit 0 clean, 1 with findings.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAULT_REQUIRED = [
    "id", "category", "title", "detector", "severity_model", "root_causes",
    "explanation", "fixes_by_cause", "tier", "status",
]
DRILL_REQUIRED = [
    "id", "name", "targets_faults", "mode", "equipment", "space",
    "duration_default", "difficulty", "protocol", "success_criterion", "status",
]
CATEGORIES = {"stance", "offense_mechanics", "defense_during_offense",
              "defense", "footwork", "rhythm", "conditioning"}
TIERS = {"T0", "T1", "T2", "T3"}


def parse_simple_yaml(path: Path) -> dict:
    """Minimal parser for this repo's flat content files."""
    data: dict = {}
    current_key = None      # for one-level nested maps (fixes_by_cause etc.)
    in_block_scalar = False
    block_lines: list[str] = []

    for raw in path.read_text().splitlines():
        if in_block_scalar:
            if raw.startswith("  ") or raw.strip() == "":
                block_lines.append(raw.strip())
                continue
            data[current_key] = " ".join(block_lines).strip()
            in_block_scalar = False
            current_key = None
        line = raw.split(" #", 1)[0].rstrip() if not raw.lstrip().startswith("#") else ""
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        m = re.match(r"([\w]+):\s*(.*)$", line.strip())
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if indent == 0:
            if val == ">":
                current_key, in_block_scalar, block_lines = key, True, []
            elif val == "":
                current_key = key
                data[key] = {}
            else:
                data[key] = parse_value(val)
                current_key = None
        else:
            if current_key and isinstance(data.get(current_key), dict):
                data[current_key][key] = parse_value(val)
    if in_block_scalar and current_key:
        data[current_key] = " ".join(block_lines).strip()
    return data


def parse_value(val: str):
    val = val.strip()
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        return [v.strip() for v in inner.split(",") if v.strip()] if inner else []
    if val.startswith("{") and val.endswith("}"):
        return val  # flow maps inspected via regex below
    return val


def flow_map_drills(val: str) -> list[str]:
    """Extract drill ids from a fixes_by_cause flow map value."""
    m = re.search(r"drills:\s*\[([^\]]*)\]", val)
    return [d.strip() for d in m.group(1).split(",") if d.strip()] if m else []


def main() -> int:
    errors: list[str] = []
    faults: dict[str, dict] = {}
    drills: dict[str, dict] = {}

    for p in sorted((ROOT / "content" / "faults").glob("*.yaml")):
        d = parse_simple_yaml(p)
        if d.get("id") != p.stem:
            errors.append(f"{p.name}: id '{d.get('id')}' != filename stem")
        faults[d.get("id", p.stem)] = d
        for k in FAULT_REQUIRED:
            if k not in d:
                errors.append(f"{p.name}: missing required field '{k}'")
        if d.get("category") and d["category"] not in CATEGORIES:
            errors.append(f"{p.name}: unknown category '{d['category']}'")
        if d.get("tier") and d["tier"] not in TIERS:
            errors.append(f"{p.name}: unknown tier '{d['tier']}'")

    for p in sorted((ROOT / "content" / "drills").glob("*.yaml")):
        d = parse_simple_yaml(p)
        if d.get("id") != p.stem:
            errors.append(f"{p.name}: id '{d.get('id')}' != filename stem")
        drills[d.get("id", p.stem)] = d
        for k in DRILL_REQUIRED:
            if k not in d:
                errors.append(f"{p.name}: missing required field '{k}'")

    for fid, f in faults.items():
        for pre in f.get("prerequisites", []) or []:
            if pre not in faults:
                errors.append(f"fault {fid}: prerequisite '{pre}' does not exist")
        causes = set(f.get("root_causes", []) or [])
        fixes = f.get("fixes_by_cause", {})
        fix_causes = set(fixes.keys()) if isinstance(fixes, dict) else set()
        for c in causes - fix_causes:
            errors.append(f"fault {fid}: root cause '{c}' has no fixes_by_cause entry")
        for c in fix_causes - causes:
            errors.append(f"fault {fid}: fixes_by_cause '{c}' not in root_causes")
        if isinstance(fixes, dict):
            for cause, val in fixes.items():
                for drill in flow_map_drills(str(val)):
                    if drill not in drills:
                        errors.append(f"fault {fid}: fix for '{cause}' references missing drill '{drill}'")

    for did, d in drills.items():
        for fid in d.get("targets_faults", []) or []:
            if fid not in faults:
                errors.append(f"drill {did}: targets missing fault '{fid}'")

    # Rust fault-id constants must exist in content.
    rust = (ROOT / "core" / "src" / "faults.rs").read_text()
    for m in re.finditer(r'pub const \w+: &str = "([a-z_]+)";', rust):
        if m.group(1) not in faults:
            errors.append(f"core/src/faults.rs: constant '{m.group(1)}' has no content/faults yaml")

    if errors:
        print(f"content lint: {len(errors)} error(s)")
        for e in errors:
            print(f"  ✗ {e}")
        return 1
    print(f"content lint: OK ({len(faults)} faults, {len(drills)} drills, all cross-references valid)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
