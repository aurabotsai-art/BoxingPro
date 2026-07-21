# Ingestion tool

Video → SkeletonArchive v1 JSON (keypoints only), per docs/07 §2.1.

```bash
pip install -r tools/ingest/requirements.txt

# From the source registry (YouTube; runs on a normal network — datacenter
# CI/cloud IPs are typically blocked by both the proxy policy and YouTube):
python3 tools/ingest/ingest.py --id yt_HLPU9Qk7ZVw --out data/archives/

# From a local file (owner capture days, phone footage):
python3 tools/ingest/ingest.py --video session.mp4 --out data/archives/

# Analyze any archive through the real Metrics Core:
cargo run -p boxingpro-cli -- analyze data/archives/<name>.skeleton.json

# No footage handy? Generate a ground-truth synthetic archive:
cargo run -p boxingpro-cli -- synth-jab > jab.json
cargo run -p boxingpro-cli -- analyze jab.json
```

Notes:
- Pose model (`pose_landmarker_full.task`, ~9 MB) auto-downloads on first run; it is gitignored.
- Output is stamped `scale_anchor: "uncalibrated"`; coordinates are pseudo-metric via `--assumed-height-m` (default 1.75). Metrics from these archives are for training/labeling, not user-facing claims.
- `analyze` on uncalibrated archives derives an **auto profile** (arm length = p95 wrist↔shoulder distance). Expect `extension_frac` to read slightly >1.0 on real full extensions — calibrated profiles fix this in-product; treat auto-profile fault outputs as indicative only.
- Linux headless: MediaPipe needs Mesa GLES (`apt install libgles2 libegl1`).
