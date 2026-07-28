#!/usr/bin/env python3
"""Feature extraction for the strike classifier (E14, docs/05 stage 6).

Takes SkeletonArchive files, runs `boxingpro analyze`, and emits one CSV row
per detected strike event: label + deterministic kinematic features. Labels
come either from --label (synthetic/single-class archives) or from a labeler
export JSON (--labels, matched to events by time overlap).

Features are exactly the Metrics Core numbers — the classifier consumes the
same deterministic measurements every other tier sees.
"""
import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

FIELDS = ["label", "peak_speed", "straightness", "extension_frac", "duration_ms", "hand"]


def analyze(cli: str, archive: Path) -> dict:
    out = subprocess.run([cli, "analyze", str(archive)], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"analyze failed for {archive}: {out.stderr.strip()}")
    return json.loads(out.stdout)


def label_for(event: dict, labels: list[dict] | None, fixed: str | None) -> str | None:
    if fixed is not None:
        return fixed
    if labels is None:
        return None
    mid = (event["t_start_ms"] + event["t_end_ms"]) / 2
    for lab in labels:
        if lab["t_start_ms"] <= mid <= lab["t_end_ms"]:
            return lab["class"]
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("archives", nargs="+", type=Path)
    ap.add_argument("--label", help="fixed class label for ALL events (synthetic mode)")
    ap.add_argument("--labels", type=Path, help="labeler export JSON (time-ranged classes)")
    ap.add_argument("--cli", default="target/debug/boxingpro", help="path to the boxingpro binary")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    labels = json.loads(args.labels.read_text())["labels"] if args.labels else None
    rows = []
    skipped = 0
    for arc in args.archives:
        analysis = analyze(args.cli, arc)
        for e in analysis["events"]:
            lab = label_for(e, labels, args.label)
            if lab is None:
                skipped += 1
                continue
            m = e["metrics"]

            def val(key):
                v = m.get(key)
                return v["value"] if v else ""

            rows.append({
                "label": lab,
                "peak_speed": val("peak_speed"),
                "straightness": val("straightness"),
                "extension_frac": val("extension_frac"),
                "duration_ms": e["t_end_ms"] - e["t_start_ms"],
                "hand": e["hand"],
            })

    with args.out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"[extract] {len(rows)} labeled events -> {args.out}"
          + (f" ({skipped} unlabeled skipped)" if skipped else ""))


if __name__ == "__main__":
    main()
