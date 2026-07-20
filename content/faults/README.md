# Fault Taxonomy (content, versioned)

Machine-readable coaching knowledge (docs/06-COACHING-ENGINE.md §2). Each YAML file is one fault. Detectors reference Metrics Core outputs by name; thresholds marked `adaptive` are scaled per-user from calibration baselines and skill level — thresholds are coaching policy and require coach-panel sign-off before changing.

**Status: v0 seed (4 faults).** Target ~40 for MVP (docs/11 Phase 1). Cross-references (drills, prerequisites, root-cause↔fix pairing, Rust fault-id constants) are enforced by `tools/lint_content.py` in CI. Every fault must name: detector expression, severity model, root causes with discriminators, explanation ("why this loses fights"), and fixes-by-cause referencing real drill IDs in `content/drills/`.

Schema per file:

```yaml
id: string                 # stable key, referenced by analyses & coach output
category: stance | offense_mechanics | defense_during_offense | defense | footwork | rhythm | conditioning
title: coach-facing name
detector: expression over Metrics Core outputs
severity_model: how severity 0..1 is computed
prerequisites: [fault ids that must be addressed first]
root_causes: [ids]
cause_discriminators: {cause_id: measurement rule}
explanation: why this matters in a fight (coach voice source material)
fixes_by_cause: {cause_id: {drills: [drill ids], cue: short live cue}}
tier: honesty tier of the underlying detection (docs/03)
status: seed | panel_reviewed | live
```
