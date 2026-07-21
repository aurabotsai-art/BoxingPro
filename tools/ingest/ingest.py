#!/usr/bin/env python3
"""BoxingPro ingestion tool: video → SkeletonArchive v1 JSON.

Sources (docs/07 §2.1, ledger in data/sources/):
  --id yt_XXXX       registry entry: downloads via yt-dlp, stamps ledger metadata
  --video path.mp4   local file (owner footage, M2 capture days)

Pipeline: decode frames → MediaPipe PoseLandmarker (video mode) → map 33
landmarks onto the canonical 21-joint skeleton → confidence-gate →
pseudo-metric scaling (assumed stature for uncalibrated sources) →
SkeletonArchive v1 JSON (contracts/skeleton_archive.v1.schema.json).

Honesty rules enforced here:
  - Landmarks below --min-confidence become null (never fabricated).
  - Uncalibrated sources are stamped scale_anchor="uncalibrated" and carry
    the assumed height used for pseudo-metric scaling in capture metadata.
  - Keypoints only: pass --keep-video to retain the download; default is
    delete after extraction (registry policy).

Usage:
  python3 tools/ingest/ingest.py --id yt_HLPU9Qk7ZVw --out data/archives/
  python3 tools/ingest/ingest.py --video my_session.mp4 --out data/archives/
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import uuid
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
REGISTRY = REPO / "data" / "sources" / "youtube_registry.yaml"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
)
MODEL_PATH = Path(__file__).parent / "pose_landmarker_full.task"
MODEL_ID = "mediapipe-pose-landmarker-full@0.10"

# MediaPipe landmark index → canonical joint index (core/src/types.rs order).
# Chin (19) and MidChest (20) have no MediaPipe source → always null.
MP_TO_CANON = {
    0: 0,   # nose
    7: 1,   # left ear
    8: 2,   # right ear
    11: 3,  # left shoulder
    12: 4,  # right shoulder
    13: 5,  # left elbow
    14: 6,  # right elbow
    15: 7,  # left wrist
    16: 8,  # right wrist
    23: 9,  # left hip
    24: 10, # right hip
    25: 11, # left knee
    26: 12, # right knee
    27: 13, # left ankle
    28: 14, # right ankle
    29: 15, # left heel
    30: 16, # right heel
    31: 17, # left foot index → toe
    32: 18, # right foot index → toe
}
JOINT_COUNT = 21


def load_registry_entry(entry_id: str) -> dict:
    import yaml

    entries = yaml.safe_load(REGISTRY.read_text())
    for e in entries:
        if e["id"] == entry_id:
            return e
    sys.exit(f"error: {entry_id} not found in {REGISTRY}")


def download(entry: dict, workdir: Path) -> Path:
    out = workdir / f"{entry['id']}.mp4"
    # 720p cap: pose input is ~256px; more pixels = pure decode cost.
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]",
        "--no-playlist", "-o", str(out), entry["url"],
    ]
    print(f"[ingest] downloading {entry['url']}", file=sys.stderr)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        sys.exit(f"error: download failed:\n{r.stderr[-2000:]}")
    return out


def ensure_model() -> Path:
    if MODEL_PATH.exists():
        return MODEL_PATH
    import urllib.request

    print(f"[ingest] fetching pose model → {MODEL_PATH}", file=sys.stderr)
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def extract(video: Path, min_conf: float, assumed_height_m: float) -> dict:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        sys.exit(f"error: cannot open {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(ensure_model())),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)

    frames = []
    scale_samples = []
    idx = 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        t_ms = idx * 1000.0 / fps
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = landmarker.detect_for_video(mp_img, int(t_ms))

        joints = [None] * JOINT_COUNT
        if res.pose_landmarks:
            lms = res.pose_landmarks[0]
            for mp_i, canon_i in MP_TO_CANON.items():
                lm = lms[mp_i]
                conf = min(getattr(lm, "visibility", 1.0) or 1.0,
                           getattr(lm, "presence", 1.0) or 1.0)
                if conf >= min_conf:
                    # Aspect-corrected image space; y flipped to y-up
                    # (canonical convention, core/src/synthetic.rs).
                    joints[canon_i] = {
                        "x": lm.x * (width / height),
                        "y": (1.0 - lm.y),
                        "z": None,
                        "c": round(conf, 3),
                    }
            n, la = joints[0], joints[13]
            if n and la:
                span = abs(n["y"] - la["y"]) / 0.88  # nose ≈ 88% of stature
                if span > 0.1:
                    scale_samples.append(span)
        frames.append({"t_ms": round(t_ms, 3), "joints": joints})
        idx += 1
    cap.release()
    landmarker.close()

    # Pseudo-metric: scale so the subject's apparent stature = assumed height.
    if scale_samples:
        scale_samples.sort()
        scale = assumed_height_m / scale_samples[len(scale_samples) // 2]
        for f in frames:
            for j in f["joints"]:
                if j:
                    j["x"] = round(j["x"] * scale, 4)
                    j["y"] = round(j["y"] * scale, 4)

    observed = sum(1 for f in frames if any(f["joints"]))
    return {
        "frames": frames,
        "fps": fps,
        "width": width,
        "height": height,
        "observed_frac": observed / max(len(frames), 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--id", help="registry entry id (yt_...)")
    src.add_argument("--video", type=Path, help="local video file")
    ap.add_argument("--out", type=Path, default=REPO / "data" / "archives")
    ap.add_argument("--min-confidence", type=float, default=0.5)
    ap.add_argument("--assumed-height-m", type=float, default=1.75,
                    help="stature assumption for pseudo-metric scaling (uncalibrated sources)")
    ap.add_argument("--keep-video", action="store_true")
    ap.add_argument("--max-seconds", type=float, default=None,
                    help="truncate processing (spike/testing use)")
    args = ap.parse_args()

    entry = load_registry_entry(args.id) if args.id else None
    args.out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        if entry:
            video = download(entry, Path(td))
        else:
            video = args.video
            if not video.exists():
                sys.exit(f"error: {video} not found")

        if args.max_seconds:
            clipped = Path(td) / f"clip_{video.name}"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
                 "-t", str(args.max_seconds), "-c", "copy", str(clipped)],
                check=True,
            )
            video = clipped

        result = extract(video, args.min_confidence, args.assumed_height_m)

        if entry and not args.keep_video:
            pass  # temp dir deletion handles it — keypoints-only policy

    source_id = entry["id"] if entry else args.video.stem
    archive = {
        "version": 1,
        "session_id": str(uuid.uuid5(uuid.NAMESPACE_URL, source_id)),
        "capture": {
            "fps_nominal": result["fps"],
            "width": result["width"],
            "height": result["height"],
            "pose_model_id": MODEL_ID,
            "device_model": f"ingest:{source_id}",
            "framing_quality": round(result["observed_frac"], 3),
        },
        "calibration_ref": {
            "body_profile_id": str(uuid.uuid5(uuid.NAMESPACE_URL, source_id + ":auto")),
            "scale_anchor": "uncalibrated",
        },
        "coordinate_space": "camera_metric",
        "ingest_meta": {
            "source": source_id,
            "assumed_height_m": args.assumed_height_m,
            "accessed": date.today().isoformat(),
            "min_confidence": args.min_confidence,
        },
        "frames": result["frames"],
    }

    out_path = args.out / f"{source_id}.skeleton.json"
    out_path.write_text(json.dumps(archive))
    print(f"[ingest] wrote {out_path} "
          f"({len(result['frames'])} frames @ {result['fps']:.1f}fps, "
          f"observed {result['observed_frac']:.0%})", file=sys.stderr)


if __name__ == "__main__":
    main()
