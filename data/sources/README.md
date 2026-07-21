# Data Source Registry

Curated external footage sources per the YouTube protocol (docs/07 §2.1). This registry is the **license ledger** that protocol requires: nothing gets ingested into the training pipeline unless its row here passes the pre-ingestion checklist.

## Pre-ingestion checklist (per video)

1. **Ledger entry:** record the video's stated license and access date (`license` / `license_checked`). Per the owner's posture (docs/07 §2.1), any public registry video may be keypoint-ingested; CC-licensed versions preferred when equivalent material exists. `reference_only` entries (style_archetype bucket) are never ingested — they're watched to derive parameters.
2. **Keypoints only:** videos are processed to SkeletonArchive keypoints; source video files are never retained, redistributed, or shown in-product. The dataset itself is never republished.
3. **Bucket cap:** YouTube-derived sequences ≤50% of any training mix; golden/eval sets remain product-conditions footage only.
4. **Optional goodwill unlock:** channel outreach (credit-for-permission) upgrades a source's status and builds coach relationships — worthwhile for the heaviest-used channels, not a gate. Track in `permission`.

## Buckets

| Bucket | Feeds | Ingestion? |
|---|---|---|
| `class_tutorial` | Weak-labeled punch/defense/footwork reps for the classifier | Yes, if license cleared |
| `fault_exemplar` | Flawed-rep examples for fault-detector thresholds (coaches demonstrate the mistakes) | Yes, if license cleared |
| `product_conditions` | Static-camera full-body continuous movement — closest to deployment input | Yes, if license cleared (highest training value per minute) |
| `elite_reference` | Ideal-form ranges for metric calibration | Reference viewing suffices; ingest if cleared |
| `style_archetype` | Parameters for the Style DNA archetype vectors (docs/06 §5) | Reference viewing only — broadcast fight clips are low training value and highest license risk |

`priority`: 1 = process first (high rep density, clean framing), 3 = nice-to-have.
