#!/usr/bin/env bash
# Stages MediaPipe wasm runtime, the pose model, and the BoxingPro Metrics
# Core wasm for serving. Runs before next build (locally and on Vercel).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/mediapipe/wasm public/models public/core
cp -r node_modules/@mediapipe/tasks-vision/wasm/* public/mediapipe/wasm/
M=public/models/pose_landmarker_full.task
[ -f "$M" ] || curl -fsSL -o "$M" \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
cp lib/core/boxingpro_core_wasm_bg.wasm public/core/
echo "assets ready"
