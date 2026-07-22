#!/usr/bin/env python3
"""Deterministic Coach Brain renderer — the LLM-unavailable fallback path
(docs/06 §6, docs/12 failure playbook), built FIRST so the structure is
honest before any generative layer exists.

analysis JSON + content taxonomy → CoachOutput v1 JSON.
Numbers come only from the analysis input; text comes only from the
taxonomy and fixed templates. Nothing here can hallucinate.

Usage:
  python3 coach_brain/render_template.py <analysis.json> [--coached-log coached.json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
from lint_content import parse_simple_yaml, flow_map_drills  # noqa: E402  (shared parser)

# Mirrors core/src/prioritize.rs — same formula, same constants. The Rust
# implementation is canonical; this port exists because the Coach Brain runs
# server-side in Python. Divergence here is a bug (cross-checked in CI later
# via shared golden cases).
def novelty_decay(sessions_since):
    return {0: 0.4, 1: 0.7}.get(sessions_since, 1.0)


def load_taxonomy() -> dict:
    out = {}
    for p in sorted((REPO / "content" / "faults").glob("*.yaml")):
        d = parse_simple_yaml(p)
        out[d["id"]] = d
    return out


def load_drills() -> dict:
    out = {}
    for p in sorted((REPO / "content" / "drills").glob("*.yaml")):
        d = parse_simple_yaml(p)
        out[d["id"]] = d
    return out


def severity_of(fault: dict, freq: float) -> float:
    # Extract the exposure weight from the taxonomy severity model
    # ("frequency × 0.9" → 0.9). Full expression evaluation ships with the
    # production engine; the weight captures the coaching-priority intent.
    # Fault `frequency` inputs must be occurrences-per-opportunity (0..1) —
    # index-style metrics are normalized to threshold exceedance upstream.
    import re as _re
    m = _re.findall(r"[×x]\s*([0-9.]+)", str(fault.get("severity_model", "")))
    return float(m[-1]) if m else 0.5


def prioritize(fault_instances, taxonomy, coached_log):
    detected_ids = {f["fault_id"] for f in fault_instances}
    scored = []
    for f in fault_instances:
        tax = taxonomy.get(f["fault_id"])
        if not tax:
            continue
        prereqs = tax.get("prerequisites", []) or []
        gated = any(p in detected_ids for p in prereqs)
        prio = (
            severity_of(tax, f["frequency"])
            * min(1.0, f["frequency"])
            * float(tax.get("trainability", 0.5))
            * (0.0 if gated else 1.0)
            * novelty_decay(coached_log.get(f["fault_id"]))
        )
        if prio > 0:
            scored.append((prio, f, tax))
    scored.sort(key=lambda x: -x[0])
    return scored


def render(analysis: dict, coached_log: dict) -> dict:
    taxonomy = load_taxonomy()
    drills = load_drills()
    scored = prioritize(analysis.get("faults", []), taxonomy, coached_log)

    strikes = analysis.get("counts", {}).get("strikes", 0)
    duration_min = analysis.get("counts", {}).get("duration_ms", 0) / 60000.0
    blocks = [{
        "type": "praise",
        "text": f"Session logged: {strikes} strikes over {duration_min:.1f} minutes of work. "
                "Showing up is the whole game — everything below is refinement.",
        "metric_refs": ["counts.strikes", "counts.duration_ms"],
    }]

    if scored:
        prio, inst, tax = scored[0]
        cause = inst.get("cause_estimate")
        fixes = tax.get("fixes_by_cause", {})
        fix_val = str(fixes.get(cause, next(iter(fixes.values()), "")))
        drill_ids = [d for d in flow_map_drills(fix_val) if d in drills]
        blocks.append({
            "type": "primary_focus",
            "fault_id": tax["id"],
            "text": f"THE ONE THING: {tax['title'].lower()} — on {inst['frequency']:.0%} of opportunities. "
                    f"{tax.get('explanation', '').strip()}",
            "evidence_event_ids": [str(t) for t in inst.get("evidence_t_ms", [])[:5]],
            "metric_refs": ["faults.frequency"],
        })
        if drill_ids:
            d0 = drills[drill_ids[0]]
            blocks.append({
                "type": "prescription",
                "drill_ids": drill_ids,
                "fault_id": tax["id"],
                "text": f"Tomorrow: {d0['name']} ({d0.get('duration_default', '3x2min')}). "
                        f"Done when: {d0.get('success_criterion', 'coach review')}.",
            })
        for prio2, inst2, tax2 in scored[1:3]:
            blocks.append({
                "type": "secondary_mention",
                "fault_id": tax2["id"],
                "text": f"Also on the radar: {tax2['title'].lower()} ({inst2['frequency']:.0%}). Logged, not today's job.",
            })
    else:
        blocks.append({
            "type": "narrative",
            "text": "No coachable fault pattern cleared the evidence bar this session. "
                    "Clean work — next session raises the intensity.",
        })

    return {
        "version": 1,
        "session_id": analysis.get("session_id"),
        "kind": "film_study",
        "source_analysis_id": analysis.get("session_id") or "unknown",
        "generator": {"llm_model": None, "prompt_version": None, "persona": "template"},
        "blocks": blocks,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("analysis", type=Path)
    ap.add_argument("--coached-log", type=Path, help="JSON {fault_id: sessions_since_coached}")
    args = ap.parse_args()
    coached = json.loads(args.coached_log.read_text()) if args.coached_log else {}
    analysis = json.loads(args.analysis.read_text())
    print(json.dumps(render(analysis, coached), indent=2))


if __name__ == "__main__":
    main()
