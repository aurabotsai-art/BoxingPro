#!/usr/bin/env python3
"""Run eval cases against the template renderer (LLM path plugs in at M5)."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from render_template import render  # noqa: E402

def main():
    failures = []
    for case_path in sorted(Path(__file__).parent.glob("cases/*.json")):
        case = json.loads(case_path.read_text())
        out = render(case["analysis"], case.get("coached_log", {}))
        types = [b["type"] for b in out["blocks"]]
        exp = case["expect"]
        def fail(msg): failures.append(f"{case_path.stem}: {msg}")
        for t in exp.get("block_types_include", []):
            if t not in types: fail(f"missing block {t} (got {types})")
        for t in exp.get("block_types_exclude", []):
            if t in types: fail(f"forbidden block {t} present")
        if "primary_fault" in exp:
            prim = next((b for b in out["blocks"] if b["type"] == "primary_focus"), None)
            if not prim or prim.get("fault_id") != exp["primary_fault"]:
                fail(f"primary {prim and prim.get('fault_id')} != {exp['primary_fault']}")
        if exp.get("unknown_faults_ignored"):
            # No block may reference a fault_id outside the content taxonomy.
            known = {p.stem for p in (Path(__file__).parents[2] / "content/faults").glob("*.yaml")}
            for b in out["blocks"]:
                fid = b.get("fault_id")
                if fid and fid not in known:
                    fail(f"block references unknown fault '{fid}'")
        if "prescribed_drill_in" in exp:
            rx = next((b for b in out["blocks"] if b["type"] == "prescription"), None)
            drills = (rx or {}).get("drill_ids", [])
            if not any(d in exp["prescribed_drill_in"] for d in drills):
                fail(f"prescription {drills} has none of {exp['prescribed_drill_in']}")
        for key in exp:
            if key not in ("block_types_include", "block_types_exclude",
                           "primary_fault", "prescribed_drill_in",
                           "unknown_faults_ignored"):
                fail(f"unknown expectation key '{key}' — evaluator would ignore it")
    if failures:
        print(f"coach eval: {len(failures)} failure(s)")
        [print("  ✗", f) for f in failures]
        return 1
    n = len(list(Path(__file__).parent.glob("cases/*.json")))
    print(f"coach eval: OK ({n} cases, template path)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
