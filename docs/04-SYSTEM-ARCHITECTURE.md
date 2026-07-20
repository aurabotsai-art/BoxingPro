# 04 — System Architecture

## 1. The shape of the system

```
┌────────────────────────── PHONE (primary compute) ──────────────────────────┐
│  Camera (AVFoundation/CameraX, 60fps)                                       │
│    → Perception Core [native]: pose → track → smooth → events → classify    │
│    → Metrics Core [shared C++/Rust]: biomechanics, scores, fault primitives │
│    → Realtime Coach [native]: cue arbiter → audio/visual feedback           │
│    → Session Recorder: keypoint archive (+optional video), local store      │
│  UI shell (SwiftUI) · local DB (SQLite/GRDB) · sync client                  │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │  skeleton archives, session summaries (default)
                │  raw video (ONLY with explicit opt-in, per session)
                ▼
┌────────────── BACKEND ──────────────┐      ┌────────── DEEP ANALYSIS ───────┐
│ Supabase                            │      │ GPU workers (Modal-class)      │
│  · Postgres (profiles, sessions,    │─jobs→│  · whole-body pose (RTMW)      │
│    metrics, plans, gamification)    │←rslt─│  · temporal 3D lifting         │
│  · Auth · Storage · Edge Functions  │      │  · re-classification, film cut │
│  · RLS everywhere                   │      └────────────────────────────────┘
│         │                           │
│         ▼                           │
│ Coach Brain service                 │
│  · deterministic fault engine       │
│  · Claude API (narrative, plans)    │
│  · drill/program library            │
└─────────────────────────────────────┘
```

## 2. Decision: client platform

**Chosen: iOS-first, fully native (Swift/SwiftUI), Android in Phase 3 (Kotlin/Compose), with one shared C++/Rust Metrics Core.**

| Option | Verdict | Reasoning |
|---|---|---|
| Flutter everywhere | ❌ for v1 | Camera→ML→overlay hot path crosses the platform-channel boundary per frame; fighting the framework where we can least afford it. Flutter remains an option for *coach-side dashboard* later |
| React Native + JSI native modules | ❌ | Same boundary problem, larger runtime, no advantage for a camera-first app |
| Native both platforms simultaneously | ❌ | Doubles CV integration/benchmarking work before product-market fit |
| **Native iOS first** | ✅ | Best camera stack (exposure control, 120/240fps APIs), ANE inference, LiDAR/ARKit calibration, highest-paying fitness demographic. Android arrives once the perception recipes are proven |

Shared **Metrics Core** (C++ or Rust; final call = Phase-0 spike on toolchain ergonomics with Swift/Kotlin/WASM bindings): all post-keypoint math — geometry, filters, event detection features, scores. Same code runs on iOS, Android, and server workers → identical numbers everywhere, golden-file unit tests, no metric drift between tiers.

## 3. Decision: two-tier analysis

| | **Tier 1: Live** (on-device, during session) | **Tier 2: Film Study** (async, minutes after) |
|---|---|---|
| Latency budget | cue within **300 ms** of event | ≤ 5 min post-session |
| Models | fast pose (17–26 kp), light temporal classifier, rules | whole-body pose, 3D lifting, full classifier, full fault engine, Claude narrative |
| Output | ONE prioritized cue at a time; live counters | full report: per-punch scrubber, faults w/ explanations, trends, next-session plan |
| Runs on | phone only | phone-overnight (goal, RQ5 in [02](02-CV-RESEARCH.md)) or GPU worker (v1 default for opted-in users); **on-device-only users still get Tier-2-lite** (full fault engine on Tier-1 keypoints — no re-pose, no 3D lifting) |

Why two tiers instead of one: a single real-time tier caps analysis quality at what a phone does in 16 ms/frame forever; a single deep tier kills the "coach watching you live" magic. The pairing is also the privacy/COGS architecture: Tier 1 never uploads anything; Tier 2's default input is the **keypoint archive** (~1–2 MB/session vs ~500 MB video), so server-tier users usually upload skeletons, not footage.

## 4. Client architecture (iOS v1)

- **Capture:** AVCaptureSession, 720p60, exposure-priority; frames → pose via Vision/Core ML on a dedicated queue; ring buffer of (timestamp, keypoints, confidences). HFR drill mode records 120/240fps video for async processing only.
- **Perception Core:** per [05](05-PERCEPTION-PIPELINE.md). Strict pipeline stages, each a testable unit consuming/emitting typed streams. Skeleton archive format: flat-buffer keypoint stream + model/version metadata — the canonical session artifact.
- **Realtime Coach:** subscribes to fault primitives; **cue arbiter** picks at most one audio cue per N seconds by priority × novelty × user setting (silence, minimal, chatty). Audio-first (user isn't looking at the screen mid-round); big-text/haptic secondary.
- **Storage:** sessions, metrics, plans in local SQLite; media in files with lifecycle rules ([10](10-SECURITY-PRIVACY.md)). Offline-first: everything works with zero connectivity except deep-tier server jobs and leaderboards; sync is eventual.
- **Rendering:** skeleton/trajectory overlays via Metal-backed layer in film-study scrubber; live view keeps overlays minimal (perf + user attention).

## 5. Backend architecture

- **Supabase** (already provisioned in owner tooling): Postgres + RLS as source of truth for accounts, session summaries, fighter profiles, plans, gamification; Storage for opted-in media and skeleton archives; Edge Functions for lightweight API (job submission, webhooks). Schema in [08](08-DATA-MODEL.md).
- **Deep-analysis workers:** containerized Python (PyTorch/ONNX) on serverless GPU (Modal-class). Job = (skeleton archive | video) → enriched analysis JSON + film-study index. Queue via Postgres job table + worker poll (simple, observable); upgrade to a real queue only when metrics demand.
- **Coach Brain:** service layer that (a) runs the deterministic fault engine over deep-tier output, (b) calls Claude with structured metrics/faults/history to produce narratives and plans ([06](06-COACHING-ENGINE.md) §6 contract — the LLM receives numbers, returns words; never the reverse). Prompt templates + few-shots version-controlled and eval'd ([07](07-DATA-STRATEGY-MLOPS.md) §6).
- **Why not "everything in Edge Functions":** GPU inference and LLM orchestration need long-running compute and Python ML ecosystem; Edge Functions stay thin.

## 6. Data flow contracts (the seams that must stay stable)

1. **SkeletonArchive v1** — timestamped keypoints + confidences + device/model metadata + calibration ref. Produced by Tier 1; consumed by Metrics Core, Tier 2, data flywheel. Versioned; backward-readable.
2. **SessionAnalysis v1** — punches[], defenses[], footwork[], rhythm, faults[], scores{}, all with tier/confidence tags. Produced by either tier (Tier-2 output supersedes Tier-1 by field).
3. **CoachOutput v1** — narrative blocks, priority list, drill prescriptions with structured drill IDs. Produced by Coach Brain; rendered by app; never free-text-only (UI needs structure).

These three schemas are the API between every subsystem; they get golden-file tests and explicit version bumps.

## 7. Scalability & cost posture

- Compute-heavy work rides user devices by design; server cost scales only with deep-tier opt-ins. Budget: ≤$0.05/deep session (≈ keypoint-input jobs on shared GPU: seconds of compute; video-input jobs: tens of seconds — priced into Pro tier).
- Claude calls: one film-study narrative + one plan update per session; cached fighter-profile context; budget ≤$0.02/session at planned context sizes.
- Postgres scales trivially at these row counts for years; Storage lifecycle rules cap media growth ([10](10-SECURITY-PRIVACY.md)).
- Leaderboards/social: read-heavy, cache-friendly, deferred to Phase 3 — no architectural risk.

## 8. Testing & benchmarking architecture (built with, not after)

- **Golden clips:** curated, labeled video set (per [07](07-DATA-STRATEGY-MLOPS.md)) runs through the full pipeline in CI on every perception/metrics change; per-metric regression thresholds.
- **Metrics Core:** pure-function unit tests with synthetic skeletons (known angles/velocities in, exact expected numbers out).
- **Device lab:** minimum matrix = iPhone SE-class (floor), current base iPhone, current Pro; fps/thermal/battery benchmarks per release ([11](11-ROADMAP.md) gates).
- **Field realism suite:** dark clothing, gloves, low light, cluttered background, partial framing — accuracy measured per condition, published internally as the honesty scorecard.

---

## ADRs

### ADR-001 (2026-07-20) — Metrics Core language: Rust

Spike S0.6 resolved. **Rust** over C++ for the shared Metrics Core (`core/`):
memory safety without a GC (real-time audio/video adjacency), first-class test
tooling (the golden-file strategy lives or dies on cheap tests), zero-dependency
`no-I/O` crate keeps the portability surface minimal, and mature binding paths
(swift-bridge/UniFFI for iOS, JNI for Android, native/WASM for server). C++
retained no advantage for pure math with no legacy code to link. The crate is
dependency-free by policy; adding any dependency requires a new ADR.

### ADR-002 (2026-07-20) — Strike detection: out+return merged as one event

The kinematic detector (hysteresis on wrist speed) naturally produces two
bursts per punch — extension and retraction — separated by the near-zero-speed
apex. These are merged into a single strike candidate when the gap is below
`merge_gap_ms` (60 ms default). Rationale: a punch *is* out-and-back; guard
recovery is measured from the apex within the same event; and the classifier
receives one window per punch. Consequence: genuine double-jabs must exceed
the merge gap to count as two — verified acceptable at 60fps in core tests;
re-examined against real footage in S0.3.
