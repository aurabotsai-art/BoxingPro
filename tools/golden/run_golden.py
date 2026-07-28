#!/usr/bin/env python3
"""Golden-clip regression harness (E15, docs/04 §8).

Runs known clips through `boxingpro analyze` and diffs against committed
expected outputs. Any change to the Metrics Core's numbers must show up
here as a deliberate golden update in the same commit — never as silent
drift.

Seeded with synthetic clips (deterministic, no footage needed). Real
labeled clips join the case list when M2 footage lands: drop the archive
in tools/golden/clips/ and add a ("name", ["analyze-file", path]) case.

Usage:
  tools/golden/run_golden.py           # verify (CI mode)
  tools/golden/run_golden.py --update  # regenerate expected outputs
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = Path(__file__).parent / "expected"
CLI = ROOT / "target/debug/boxingpro"
ROUND = 6  # decimal places — full f64 noise is not signal

CASES = [
    ("jab_60fps_180cm", ["synth-jab", "60", "1.8"]),
    ("jab_30fps_170cm", ["synth-jab", "30", "1.7"]),
    ("hook_60fps_180cm", ["synth-hook", "60", "1.8"]),
    ("hook_120fps_190cm", ["synth-hook", "120", "1.9"]),
]


def run(args: list[str]) -> str:
    out = subprocess.run([str(CLI), *args], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"{args}: {out.stderr.strip()}")
    return out.stdout


def normalize(v):
    if isinstance(v, float):
        return round(v, ROUND)
    if isinstance(v, dict):
        return {k: normalize(x) for k, x in v.items()}
    if isinstance(v, list):
        return [normalize(x) for x in v]
    return v


def diff_paths(a, b, path=""):
    if type(a) is not type(b):
        yield f"{path}: type {type(a).__name__} != {type(b).__name__}"
    elif isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                yield f"{path}.{k}: missing in expected"
            elif k not in b:
                yield f"{path}.{k}: missing in actual"
            else:
                yield from diff_paths(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        if len(a) != len(b):
            yield f"{path}: len {len(a)} != {len(b)}"
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                yield from diff_paths(x, y, f"{path}[{i}]")
    elif a != b:
        yield f"{path}: {a} != {b}"


def main() -> int:
    update = "--update" in sys.argv
    EXPECTED.mkdir(exist_ok=True)
    subprocess.run(["cargo", "build", "-q", "-p", "boxingpro-cli"], cwd=ROOT, check=True)

    failures = 0
    for name, synth_args in CASES:
        archive = Path(f"/tmp/golden_{name}.json")
        archive.write_text(run(synth_args))
        actual = normalize(json.loads(run(["analyze", str(archive)])))
        exp_path = EXPECTED / f"{name}.json"
        if update:
            exp_path.write_text(json.dumps(actual, indent=1, sort_keys=True) + "\n")
            print(f"[golden] updated {name}")
            continue
        if not exp_path.exists():
            print(f"[golden] ✗ {name}: no expected file (run --update)")
            failures += 1
            continue
        expected = json.loads(exp_path.read_text())
        diffs = list(diff_paths(expected, actual))
        if diffs:
            failures += 1
            print(f"[golden] ✗ {name}: {len(diffs)} difference(s)")
            for d in diffs[:10]:
                print(f"    {d}")
        else:
            print(f"[golden] ✓ {name}")
    if not update:
        print(f"golden: {'FAIL' if failures else 'OK'} ({len(CASES)} cases)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
