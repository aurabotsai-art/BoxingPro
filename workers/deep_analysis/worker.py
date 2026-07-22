#!/usr/bin/env python3
"""Deep-analysis worker skeleton (docs/04 §5). Deploys to Modal-class GPU
infra at M6; runs locally in --once mode against a directory today.

Job contract: input = SkeletonArchive (default) or video (opt-in uploads);
output = SessionAnalysis JSON via the SAME Metrics Core binary the client
uses (boxingpro-cli), plus (later) whole-body re-pose + 3D lifting stages
on GPU. Poll loop targets the Supabase jobs table (docs/08) once E11 lands.
"""
import argparse, json, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CLI = REPO / "target" / "release" / "boxingpro"

def process_archive(archive_path: Path, out_dir: Path) -> Path:
    cli = CLI if CLI.exists() else REPO / "target" / "debug" / "boxingpro"
    r = subprocess.run([str(cli), "analyze", str(archive_path)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"analyze failed: {r.stderr[-500:]}")
    out = out_dir / archive_path.name.replace(".skeleton.json", ".analysis.json")
    out.write_text(r.stdout)
    # TODO(M6/GPU): whole-body re-pose (RTMW) for video-input jobs
    # TODO(Phase 2): temporal 3D lifting -> kinetic-chain metrics
    # TODO(E11): claim/heartbeat/complete against Supabase jobs table
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", type=Path, help="process all *.skeleton.json in this directory and exit")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    if not args.once:
        sys.exit("poll mode requires E11 (Supabase provisioning); use --once <dir>")
    out_dir = args.out or args.once
    done = [process_archive(p, out_dir) for p in sorted(args.once.glob("*.skeleton.json"))]
    print(f"processed {len(done)} archive(s) -> {out_dir}")

if __name__ == "__main__":
    main()
