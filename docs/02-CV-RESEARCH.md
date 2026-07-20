# 02 — Computer Vision Research: Models, Runtimes, Camera Physics

_The technology survey underpinning every perception decision. Verify benchmarks on real devices in Phase 0 — numbers here are planning estimates from published literature and must be re-measured._

## 1. Pose estimation model survey

### 1.1 Real-time on-device candidates

| Model | Keypoints | 3D? | Mobile speed (est.) | Strengths | Weaknesses for boxing |
|---|---|---|---|---|---|
| **MediaPipe BlazePose (Full/Heavy)** | 33 | Pseudo-3D (root-relative z) | 30–60fps GPU on mid phones | Battle-tested mobile stack, z-estimates, built-in smoothing, hands/face variants | z is coarse; struggles with motion blur; single-person focus |
| **MoveNet Thunder** | 17 | No | 30–50fps | Robust to fast motion (trained on fitness video), good temporal stability | 2D only; 17 kp lacks feet detail (heel/toe needed for footwork) |
| **MoveNet Lightning** | 17 | No | 60fps+ | Fastest option; good cue-latency floor | Jittery; accuracy too low for form scoring |
| **Apple Vision `VNDetectHumanBodyPose3D`** (iOS 17+) | 17 (3D) / 19 (2D) | Yes (metric-ish 3D) | Realtime on ANE | Free, zero-download, Neural-Engine optimized, metric 3D with camera-height hint | iOS only; opaque model, limited control; 17 joints |
| **RTMPose-m/s (deployed via Core ML/NCNN/ONNX)** | 17–26 (body/feet) | 2D (+lifting) | 30–60fps quantized | Best accuracy/latency tradeoff in open source; 26-kp variant includes feet | Integration work; needs our own smoothing/tracking glue |
| **YOLO11-pose (n/s)** | 17 | No | 30–45fps | Person detection + pose in one; handles multi-person | Accuracy below RTMPose at same budget |

### 1.2 Server-grade (deep analysis tier)

| Model | Notes |
|---|---|
| **ViTPose / ViTPose+ (huge)** | SOTA-class 2D accuracy; fine for async server jobs; basis for our "film study" keypoints |
| **RTMPose-l / RTMW (133-kp whole-body)** | Whole-body incl. hands+feet — gloves/fist orientation, heel/toe detail; excellent server throughput |
| **Temporal 3D lifting: MotionBERT / VideoPose3D-class** | Lifts 2D keypoint sequences to smooth 3D; where our joint-angle biomechanics becomes trustworthy |
| **SMPL-family mesh recovery (HMR2/4D-Humans class)** | Full body mesh → limb lengths, body-shape estimates; used for calibration scan, not per-frame |

### 1.3 Decisions

- **iOS v1 real-time:** Apple Vision 3D pose as baseline (zero cost, ANE speed), **benchmarked head-to-head in Phase 0 against RTMPose-m (Core ML, fp16)** on: fast-punch keypoint retention, wrist accuracy under blur, feet visibility. Whichever wins on *wrist-under-motion* becomes primary; the loser stays as fallback tier for older devices. Rationale: wrist tracking during punches is our single most business-critical CV capability.
- **Android (Phase 3):** RTMPose-m via LiteRT/NCNN, MediaPipe as fallback. MoveNet rejected as primary (no feet).
- **Server deep tier:** RTMW whole-body + MotionBERT-class temporal lifting. Server models are swappable by design (job takes video → keypoint archive; model version stamped on output).
- **We do not train pose models in v1** (Decision #4 in [00-INDEX](00-INDEX.md)). We *fine-tune later* only if Phase-0 benchmarks show boxing-specific failures (glove-covered hands, blur) that data augmentation on the action-recognition layer can't absorb. Pose fine-tuning is a Phase 4 option with dataset prerequisites in [07](07-DATA-STRATEGY-MLOPS.md).

## 2. Inference runtimes

| Runtime | Verdict |
|---|---|
| **Core ML + ANE (iOS)** | Primary iOS path. Convert via coremltools; fp16; ANE residency verified with Xcode performance reports |
| **Metal Performance Shaders** | Only for custom pre/post kernels (resize, NMS) if profiling shows CPU hotspots — not hand-rolled inference |
| **LiteRT (TFLite) + GPU/NNAPI delegates** | Primary Android path; MediaPipe tasks ride on it |
| **NCNN / MNN** | Android fallback for RTMPose (strong open-source mobile support for MMPose exports) |
| **ONNX Runtime Mobile** | Bridge format + server inference standard; mobile use only if a model resists Core ML/LiteRT conversion |
| **Server GPU** | PyTorch/ONNX on managed GPU workers (Modal-class). Batch by round, not by frame |

**Cross-platform inference core decision:** the *metrics/biomechanics* layer (post-keypoint math) is one shared **C++ (or Rust) library** with Swift/Kotlin bindings — deterministic, unit-testable, identical numbers on both platforms and on the server. Pose inference itself stays platform-native (ANE/LiteRT reach requires it). Alternative rejected: full cross-platform inference via ONNX Runtime everywhere — loses ANE performance on iOS, the single most important perf budget.

## 3. Camera physics — the constraints that shape everything

### 3.1 The fast-punch problem (the #1 technical risk)

A trained jab travels ~6–11 m/s; full extension happens in **50–100 ms**.

- At **30fps** (33 ms/frame): 2–3 frames per punch, heavy motion blur, wrist keypoint frequently lost → speed/trajectory numbers become noise.
- At **60fps**: 4–6 frames — minimum viable for speed estimation and punch-type classification.
- At **120–240fps**: 8–24 frames — proper trajectory, snap, and retraction analysis.

**Mitigations (layered):**
1. Default capture **720p@60fps** (resolution sacrificed before frame rate; pose models downsample to ~256px inputs anyway, so 4K is wasted photons).
2. Where hardware supports it, offer **120/240fps capture** for punch-focused drills; process async (thermals prevent real-time HFR inference).
3. Request **short exposure** (AVCaptureDevice exposure priority) to cut motion blur; accept noise — pose models tolerate noise better than blur.
4. **Velocity-aware temporal interpolation**: fit wrist trajectory across frames (spline/Kalman) rather than trusting per-frame positions; report peak-speed *ranges*.
5. **Punch-event detection from kinematics** (wrist acceleration spike) rather than requiring clean per-frame classification.

### 3.2 Monocular depth ambiguity

A single camera cannot measure absolute scale or distance without a reference. **Mitigations:**
- **Calibration ritual** ([03](03-FEASIBILITY.md) §3): user-stated height (or credit-card/A4-reference scan) anchors skeleton scale → limb lengths, reach, and camera distance become solvable.
- **ARKit/ARCore plane detection + (LiDAR where present)** during setup: floor plane + metric scale for free on supporting devices.
- Movement metrics preferentially defined in **body-relative units** (e.g., "step length = 0.6× shoulder width") which are scale-invariant, with metric conversion after calibration.

### 3.3 Framing, occlusion, environment

- Full-body in frame requires the phone ~2.5–3.5 m away, landscape, roughly hip height. **Setup assistant** with live "step back / all joints visible" feedback is a hard MVP requirement — bad framing is the top cause of garbage output.
- Self-occlusion is intrinsic to boxing (guard hides face/chin; bladed stance hides rear side). Handle via: per-keypoint confidence gating, "unobserved ≠ fault" rule in the coach engine, and optional **second-angle protocol** (record two passes from front and side; merge conclusions — poor man's multi-view).
- Heavy bag occludes 30–60% of the body mid-combo. Heavy-bag mode therefore ships *after* shadowboxing with its own tuned models and reduced metric claims ([11](11-ROADMAP.md)).
- Lighting/clothing: garage gyms are dim; prompt for lighting at setup; test matrix includes dark clothing, gloves on/off, low light ([11](11-ROADMAP.md) benchmark gates).

### 3.4 Thermals & battery

Sustained 60fps capture + GPU/ANE inference throttles mid-range phones in ~10–15 min. **Mitigations:** adaptive duty cycle (full inference during activity, detector-only when idle between rounds), resolution/model downshifting on thermal notifications, round-based structure (1–3 min bursts + rest = natural cooling), battery/thermal telemetry in every session log.

## 4. Known limitations register (each mapped to a mitigation or an honesty label)

| # | Limitation | Consequence | Response |
|---|---|---|---|
| L1 | Motion blur kills wrist keypoints at punch apex | Speed/extension error | §3.1 mitigations; report ranges; HFR mode |
| L2 | No absolute scale from monocular | Height/reach/distance unsolvable raw | Calibration ritual; AR scale; body-relative units |
| L3 | Pseudo-3D (z) from single view is coarse | Rotation metrics (hip/shoulder) unreliable from front view | Temporal 3D lifting (server tier); angle metrics defined view-aware; side-view protocol for rotation-heavy analysis |
| L4 | Self-occlusion in bladed stance | Rear-side joints low confidence | Confidence gating; two-angle protocol; never penalize the unseen |
| L5 | Gloves/wraps alter hand appearance | Wrist/hand keypoint degradation | Phase-0 benchmark with gloves; augmentation; whole-body model on server tier |
| L6 | Force/power not observable optically | "Power" is a proxy, not a measurement | Kinematic power *index* with explicit proxy framing ([03](03-FEASIBILITY.md)); optional validation study vs. instrumented bag |
| L7 | Multi-person contact (sparring) breaks single-person pose | Sparring analysis unreliable | Deferred to Phase 4+; YOLO-pose multi-person + tracking research track |
| L8 | Device heterogeneity (old Androids) | Can't promise 60fps everywhere | Device capability tiers; graceful metric degradation; iOS-first |

## 5. Open research questions (tracked; each has a Phase-0/1 spike)

- RQ1: Apple Vision 3D vs RTMPose-m wrist accuracy under punch blur — measured, not guessed (Phase 0 spike, gate G0-1).
- RQ2: Minimum fps for reliable punch-type classification from keypoints (ablate 30/60/120 on collected data).
- RQ3: Does temporal lifting (MotionBERT-class) on 60fps mobile keypoints yield hip-shoulder separation angles within ±10° of a side-view ground truth?
- RQ4: Glove impact on wrist keypoint confidence across models.
- RQ5: On-device deep tier — can the film-study pipeline run overnight on-phone (privacy + COGS win) or is server GPU required at v1?
