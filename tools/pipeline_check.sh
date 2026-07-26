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

archive="${1:-}"
if [ -z "$archive" ]; then
  archive="$tmp/synth.json"
  cargo run -q -p boxingpro-cli -- synth-jab > "$archive"
fi

python3 - "$archive" <<'EOF'
import json, sys, jsonschema
doc = json.load(open(sys.argv[1]))
jsonschema.validate(doc, json.load(open("contracts/skeleton_archive.v1.schema.json")))
print(f"archive: schema-valid ({len(doc['frames'])} frames)")
EOF

cargo run -q -p boxingpro-cli -- analyze "$archive" > "$tmp/analysis.json"
python3 coach_brain/render_template.py "$tmp/analysis.json" > "$tmp/coach.json"

python3 - "$tmp" <<'EOF'
import json, sys, jsonschema
from pathlib import Path
tmp = Path(sys.argv[1])
for name, schema in [("analysis", "session_analysis"), ("coach", "coach_output")]:
    doc = json.load(open(tmp / f"{name}.json"))
    jsonschema.validate(doc, json.load(open(f"contracts/{schema}.v1.schema.json")))
    print(f"{name}: schema-valid")
EOF

echo "pipeline check: PASS"
