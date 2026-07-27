# S0.1 pose bake-off — CI half (E3)

Same-footage comparison of browser-deployable pose models: fps + wrist
retention (both wrists scored ≥0.3). Footage: 150 frames @30fps, 1000×666,
one boxer, real gym clip (`pose_test.mp4`, session scratch — not committed;
any clip works, keep it constant across rows).

## Results

| model | pose detected | both wrists ≥0.3 | latency (this container, CPU) | status |
|---|---|---|---|---|
| MediaPipe PoseLandmarker full | 100% | **100%** | ~90 ms/frame wall (batch ingest incl. I/O; live E2E in headless Chromium runs 13–16 fps) | measured 2026-07-27 |
| MoveNet SinglePose Lightning | — | — | — | **blocked**: model hosts (tfhub.dev, kaggle.com) are denied by this environment's egress proxy; storage.googleapis.com mirrors 403/404 |
| MoveNet SinglePose Thunder | — | — | — | blocked (same) |
| RTMPose-m (ONNX web) | — | — | — | not attempted yet (model host TBD; likely same egress issue) |

Notes:
- Latency numbers from this container are NOT phone numbers — use them only
  to compare models against each other on identical frames. Phone-browser
  fps comes from M1 (the live app's fps pill measures it per session).
- MediaPipe's 100%/100% on a clean, well-lit, full-body clip is a ceiling
  check, not a claim about gym conditions — occlusion/lighting stress rows
  need the M2 footage.

## Unblocking the MoveNet/RTMPose rows

Either: (a) allow `tfhub.dev` (or `www.kaggle.com`) in the environment's
network policy, or (b) download the tfjs model files elsewhere and drop them
into the session (the bench takes a local `model.json` path via tfjs's
`file://` handler with a one-line change).

## Running

```
# frames extraction (any mp4):
python3 -c "import cv2,os; cap=cv2.VideoCapture('clip.mp4'); os.makedirs('frames',exist_ok=True); n=0
while True:
    ok,f=cap.read()
    if not ok: break
    cv2.imwrite(f'frames/f{n:04d}.png',f); n+=1"

# MoveNet (needs npm i @tensorflow/tfjs-node @tensorflow-models/pose-detection
# NEXT TO the script or run a copy from that directory):
node movenet_bench.mjs frames lightning

# MediaPipe column: tools/ingest/ingest.py --video clip.mp4 --out outdir,
# then count frames whose canonical joints 7 & 8 have c >= 0.3.
```
