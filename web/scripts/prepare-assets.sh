#!/usr/bin/env bash
# Copies MediaPipe's wasm runtime out of node_modules and fetches the pose
# model. Run after npm install; Vercel runs it as part of the build.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/mediapipe/wasm public/models
cp -r node_modules/@mediapipe/tasks-vision/wasm/* public/mediapipe/wasm/
M=public/models/pose_landmarker_full.task
[ -f "$M" ] || curl -fsSL -o "$M" \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
echo "assets ready"
mkdir -p public/core
cp ../web/lib/core/boxingpro_core_wasm_bg.wasm public/core/ 2>/dev/null || cp lib/core/boxingpro_core_wasm_bg.wasm public/core/
echo "core wasm staged"
