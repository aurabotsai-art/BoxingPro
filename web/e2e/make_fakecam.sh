#!/usr/bin/env bash
# Build the fake-camera y4m for the E2E suite from the committed 36KB clip.
# Chromium's --use-file-for-fake-video-capture needs uncompressed y4m
# (~35MB), which stays out of git; this regenerates it anywhere in seconds.
#
# Usage: e2e/make_fakecam.sh [out.y4m]   (default /tmp/boxingpro-fakecam.y4m)
# Needs any ffmpeg; without one: pip install imageio-ffmpeg
set -euo pipefail
cd "$(dirname "$0")"
out="${1:-/tmp/boxingpro-fakecam.y4m}"
ff="$(command -v ffmpeg || true)"
if [ -z "$ff" ]; then
  ff="$(python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || true)"
fi
if [ -z "$ff" ]; then
  echo "no ffmpeg found — install ffmpeg or: pip install imageio-ffmpeg" >&2
  exit 1
fi
"$ff" -hide_banner -loglevel error -i person_480p.mp4 -pix_fmt yuv420p -y "$out"
echo "fakecam ready: $out  (run: FAKECAM=$out node e2e/app_test.mjs)"
