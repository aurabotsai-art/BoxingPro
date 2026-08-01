#!/usr/bin/env bash
# Full-chain contract check (docs/04 §6): SkeletonArchive → `boxingpro
# analyze` → SessionAnalysis → coach_brain template renderer → CoachOutput,
# with both intermediate artifacts validated against their v1 JSON Schemas.
#
# Usage: tools/pipeline_check.sh [archive.json]
#   No argument: runs on a synthetic jab archive (deterministic, CI-safe).
#   With one:    runs on the given archive (e.g. a browser export).
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

run_chain() {
  local archive="$1" label="$2"

  python3 - "$archive" "$label" <<'PYEOF'
import json, sys, jsonschema
doc = json.load(open(sys.argv[1]))
jsonschema.validate(doc, json.load(open("contracts/skeleton_archive.v1.schema.json")))
print(f"[{sys.argv[2]}] archive: schema-valid ({len(doc['frames'])} frames)")
PYEOF

  cargo run -q -p boxingpro-cli -- analyze "$archive" > "$tmp/analysis.json"
  python3 coach_brain/render_template.py "$tmp/analysis.json" > "$tmp/coach.json"

  python3 - "$tmp" "$label" <<'PYEOF'
import json, sys, jsonschema
from pathlib import Path
tmp = Path(sys.argv[1])
for name, schema in [("analysis", "session_analysis"), ("coach", "coach_output")]:
    doc = json.load(open(tmp / f"{name}.json"))
    jsonschema.validate(doc, json.load(open(f"contracts/{schema}.v1.schema.json")))
    print(f"[{sys.argv[2]}] {name}: schema-valid")
PYEOF
}

if [ -n "${1:-}" ]; then
  run_chain "$1" "given"
else
  # Every synthetic class runs the whole chain — a class-specific field
  # that breaks a contract fails here instead of in production.
  for cls in jab hook uppercut; do
    cargo run -q -p boxingpro-cli -- "synth-$cls" > "$tmp/synth-$cls.json"
    run_chain "$tmp/synth-$cls.json" "$cls"
  done
fi

echo "pipeline check: PASS"
