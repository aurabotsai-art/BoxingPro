# Drill Library (content, versioned)

Structured drills the coach engine prescribes (docs/06 §7). The LLM selects and sequences from this library; it can never invent a drill. Every drill declares a **measurable success criterion** over Metrics Core outputs so the coaching loop closes (prescribe → measure → adapt).

**Status: v0 seed (14 drills, all cross-referenced by faults).** Target ~60 for MVP with coach-panel authorship. Video demos are production assets, tracked by ID here. Cross-references enforced by `tools/lint_content.py` in CI.

Schema:

```yaml
id: stable key (referenced by faults' fixes_by_cause and plan items)
name: user-facing
targets_faults: [fault ids]
mode: shadowboxing | reaction | technique | bag | footwork | defense | conditioning
equipment: none | bag | ...
space: small | medium
duration_default: e.g. 3x2min
difficulty: 1-5, with ramp notes
protocol: what the app calls/does, round by round (prompt-response spec)
success_criterion: expression over metrics that marks the drill "working"
video_asset: id or TODO
status: seed | panel_reviewed | live
```
