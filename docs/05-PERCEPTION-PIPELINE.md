# 05 — Perception Pipeline

_Stage-by-stage specification of camera → understanding. Each stage is a typed, independently testable unit. Model choices reference [02-CV-RESEARCH](02-CV-RESEARCH.md); tier boundaries reference [04-SYSTEM-ARCHITECTURE](04-SYSTEM-ARCHITECTURE.md)._

```
[1 Capture] → [2 Pose] → [3 Track/Smooth] → [4 Normalize] → [5 Events] → [6 Classify] → [7 Metrics] → [8 Faults]
                                        └────────── SkeletonArchive persisted after stage 3 ──────────┘
```

## Stage 1 — Capture

- 720p@60fps landscape default; exposure-priority (short shutter) to trade noise for blur reduction; locked focus after setup.
- Setup assistant enforces preconditions before a session can start: full body visible with margin, adequate luma histogram, phone stable (gyro variance check), floor plane found (where AR available). Outputs a **FramingQuality** score stored with the session — every downstream accuracy claim is conditioned on it.
- HFR drill mode: 120/240fps clips (5–15 s bursts) recorded to disk for async analysis; never real-time.
- Thermal governor: subscribes to thermal state; downshifts model tier → fps → resolution in that order; surfaces "cooling down" honestly in UI.

## Stage 2 — Pose estimation

- iOS Tier 1: winner of Phase-0 bake-off (Apple Vision 3D vs RTMPose-m Core ML; criterion = wrist retention under punch motion — RQ1). Output: per-frame keypoints (target ≥26 incl. heel/toe) + confidences (+ coarse z if available).
- Tier 2 (server): RTMW whole-body 133-kp on decoded video (when video was opted in) or skip re-pose and consume the archive (keypoint-only jobs).
- Contract: stage emits `RawPoseFrame{t, kp[], conf[], modelId}` — downstream code never knows which model ran (enables model swaps without touching logic).

## Stage 3 — Tracking & smoothing

- Single-subject lock: largest/centered person selected at session start; identity maintained by IoU+embedding tracker; bystander walk-ins ignored (family/gym-mate robustness is a real-world requirement, tested).
- Filtering: One-Euro filter per keypoint for live display (min lag), parallel Kalman/RTS smoother writing the archive (better accuracy, slight lag is fine for analysis). Two parallel streams by design — display wants latency, analysis wants fidelity.
- Gap handling: ≤3-frame dropouts → model-based interpolation flagged `interpolated=true`; longer gaps → keypoint marked unobserved (never fabricated). The "never fabricate" rule is what makes the honesty tiers in [03](03-FEASIBILITY.md) enforceable.
- **SkeletonArchive** written from this stage's smoothed stream.

## Stage 4 — Normalization

- Anchor to calibrated Fighter Body Profile: scale (user height), root at mid-hip, orientation from shoulder/hip vectors; outputs both camera-space and body-space coordinates.
- Body-space is what classifiers and most metrics consume → view robustness and per-user invariance (a 155 cm and a 200 cm fighter produce comparable features).
- Tier 2 adds temporal 3D lifting (MotionBERT-class) here: 2D archive sequence → smoothed metric-ish 3D. Rotation-dependent metrics (hip/shoulder separation) are computed from lifted 3D only; Tier 1 versions are labeled coarse.

## Stage 5 — Event detection (the tempo backbone)

Kinematic event detectors — cheap, model-free, run everywhere:
- **Strike candidate:** wrist speed/acceleration threshold crossing (body-space, per-user normalized from calibration baselines) → candidate window [t₀−250 ms, t₁+400 ms] handed to classification. Recall-biased on purpose: missing a punch is worse than classifying noise (the classifier's null class cleans up).
- **Defensive-motion candidate:** head lateral/vertical displacement bursts, torso rotation bursts.
- **Step events:** heel-strike / toe-off from foot keypoint vertical velocity + floor plane.
- **Guard state sampler:** continuous hand-position-relative-to-chin classifier (1 Hz summary + event-triggered).
- **Round/rest segmentation:** activity level clustering; aligns with app round timer when active.

Why events-first (vs. running a classifier continuously): 10× compute reduction, clean labeling units for the data flywheel, and it decouples "did something happen" (robust kinematics) from "what happened" (learned model) — each independently improvable.

## Stage 6 — Action classification

- Input: normalized keypoint window around each candidate event (not pixels — smaller models, privacy-clean training data, robustness to lighting/clothing).
- Architecture: temporal conv / lightweight GCN over the pose graph (ST-GCN-class); ~1–2 M params quantized for Tier 1; larger ensemble + longer context on Tier 2. Attribute heads alongside the class head: {body/head target, rotation present, leap present, commitment level} — this is how esoteric punches stay honest ([03](03-FEASIBILITY.md) §5: variants = class + attributes).
- Classes v1: {jab, cross, lead_hook, rear_hook, lead_uppercut, rear_uppercut, feint, defensive_slip, defensive_roll, defensive_duck, defensive_pullback, null}. Open-set: max-softmax + energy threshold → `unclassified_strike` rather than a forced label.
- Combo assembly: strike sequence + inter-strike gap model → combination strings ("1-1-2", "1-2-3-roll-2") — pure post-processing, no ML.
- Training/eval regime in [07](07-DATA-STRATEGY-MLOPS.md); per-class ship gate: F1 ≥ 0.90 on held-out golden set at 60fps, else the class stays in `unclassified` for that release.

## Stage 7 — Metrics computation (shared Metrics Core)

Deterministic functions over (archive, events, classes, Body Profile) → the metric set from [03](03-FEASIBILITY.md), each implemented once in the shared C++/Rust core:
- Per-punch: peak/avg hand speed (spline-fit), extension % of calibrated reach, straightness (path deviation), snap index, retraction time, guard-recovery time, telegraph flags (pre-window pattern checks), exposure sample during/after.
- Kinetic chain (Tier 2): hip-peak → shoulder-peak → wrist-peak velocity timing lags; separation angles from lifted 3D.
- Stance/balance: continuous stance-width/toe-angle/knee-bend/hand-height tracks; COM (anthropometric segment masses) over base-of-support polygon.
- Footwork/rhythm: step statistics, stance-integrity-under-movement, bounce cadence (FFT band), rhythm regularity/predictability indexes.
- Every metric emits `{value, confidence, tier, observedFrac}`; UI hides below-threshold values per the honesty rule.

## Stage 8 — Fault primitives

Thin rule layer mapping metrics → boolean/graded fault detections with evidence pointers (timestamps, clips): `hands_drop_after_cross`, `overextension`, `no_hip_on_rear_hand`, `flat_feet_under_fire`, `predictable_rhythm`, … Full taxonomy and coaching semantics live in [06](06-COACHING-ENGINE.md); this stage only detects and time-stamps. Detection thresholds are per-user-adaptive (novice vs. advanced baselines) and centrally configured — thresholds are coaching policy, not engineering constants.

## Cross-cutting: performance budgets (Tier 1, base-iPhone class)

| Stage | Budget/frame @60fps |
|---|---|
| Pose | ≤ 10 ms |
| Track/smooth/normalize | ≤ 1 ms |
| Events + metrics (incremental) | ≤ 1 ms |
| Classification (event-triggered, amortized) | ≤ 2 ms |
| Headroom (capture, UI, audio) | rest of 16.6 ms |

Cue latency budget end-to-end (event → audio): ≤300 ms. Verified per release on the device matrix ([11](11-ROADMAP.md) gates).
