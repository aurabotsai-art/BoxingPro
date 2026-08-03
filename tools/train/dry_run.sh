#!/usr/bin/env bash
# Training-pipeline dry run (E14): synthetic 3-class shape check.
#
# Generates jab / hook / uppercut archives across an fps × height grid,
# extracts Metrics Core features with fixed labels, trains the logreg,
# and requires all three classes in the model. Synthetic classes are
# trivially separable — this checks PLUMBING (archive → analyze →
# features → k-fold → portable model.json), not accuracy. Real training
# needs labeled footage (M2 → labeler → --labels mode).
#
# Usage: tools/train/dry_run.sh   (from anywhere; needs python3 + sklearn)
set -euo pipefail
cd "$(dirname "$0")/../.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cargo build -q -p boxingpro-cli
cli=target/debug/boxingpro

for cls in jab hook uppercut; do
  for fps in 30 60 120; do
    for h in 1.6 1.75 1.9; do
      "$cli" "synth-$cls" "$fps" "$h" > "$tmp/${cls}_${fps}_${h}.json"
    done
  done
  python3 tools/train/extract_features.py "$tmp/${cls}"_*.json \
    --label "$cls" --cli "$cli" --out "$tmp/feat_${cls}.csv"
done

# Merge per-class CSVs (single header).
head -1 "$tmp/feat_jab.csv" > "$tmp/features.csv"
for cls in jab hook uppercut; do
  tail -n +2 "$tmp/feat_${cls}.csv" >> "$tmp/features.csv"
done

python3 tools/train/train.py "$tmp/features.csv" --out "$tmp/model.json"

python3 - "$tmp/model.json" <<'PYEOF'
import json, sys
m = json.load(open(sys.argv[1]))
classes = set(m["classes"])
want = {"jab", "hook", "uppercut"}
assert classes == want, f"model classes {classes} != {want}"
print(f"dry run: OK — 3-class model, {len(m['coef'][0])} features, classes {sorted(classes)}")
PYEOF
