# 11 — Roadmap, Milestones & Gates

_Sequenced by risk: the plan attacks perception risk first (it can kill the product), coaching quality second (it makes the product), scale last (it grows the product). Every phase ends at a **gate** with measurable exit criteria — no gate, no next phase._

## Phase 0 — De-risk the physics (≈4–6 weeks)

Tech spikes only; throwaway code allowed; decisions documented as ADR appendices to this suite.

| Spike | Question | Output |
|---|---|---|
| S0.1 Pose bake-off | RQ1: Apple Vision 3D vs RTMPose-m Core ML — wrist retention under real punches, fps, thermals on device matrix | Model decision + measured accuracy tables |
| S0.2 Fast-punch capture | RQ2: 30 vs 60 vs 120fps classification/speed-metric viability | Capture spec confirmation |
| S0.3 Event detector | Wrist-kinematics punch detection recall on scripted footage | Detector v0 + thresholds |
| S0.4 Bootstrap dataset | P0 collection: founder + local boxers, scripted matrix ([07](07-DATA-STRATEGY-MLOPS.md) §2) | ~10k labeled reps + labeler tool v0 |
| S0.5 Classifier v0 | Core-6 F1 at 60fps on held-out set | Go/no-go evidence |
| S0.6 Metrics core toolchain | ✅ **Done: Rust** (ADR-001, docs/04). `core/` crate live: types, One-Euro filter, geometry/COM, strike detection, per-strike metrics — 12 tests incl. synthetic ground-truth recovery and the 30/60/120fps accuracy ablation | Language decision |
| S0.7 3D lifting eval | RQ3: rotation-angle fidelity vs side-view ground truth | Tier-2 pipeline decision |

**GATE G0 (product viability):** on mid-tier iPhone: 60fps sustained pose ≥10 min; punch-event recall ≥95% scripted; core-6 F1 ≥85% (v0 bar); hand-speed estimates within ±15% of HFR-derived ground truth. **Miss badly → pivot conversation** (e.g., bag-mounted-phone product, drill-only product) happens here, cheaply, not after a year of building.

## Phase 1 — MVP: the magic loop (≈10–14 weeks)

Scope: iOS shadowboxing + reaction mode, Tier-1 live coaching, Tier-2-lite film study (on-device fault engine; server tier can lag), calibration ritual, fault taxonomy v1 (~40 faults), drill library v1 (~60 drills), plans v1, core gamification (XP/streaks/skill-tree v1), Supabase backend, privacy dashboard v1, coach panel retained ([06](06-COACHING-ENGINE.md) §8).

Sprint skeleton (2-week sprints):
1. Capture + setup assistant + pose integration (winner model)
2. Tracking/smoothing/normalization + SkeletonArchive + Metrics Core scaffold
3. Events + classifier v1 integration + live counters
4. Metrics v1 (speed/extension/guard-recovery/stance tracks) + golden-clip CI
5. Fault engine v1 + cue arbiter + audio coaching
6. Calibration ritual + body profile + film study UI (report + scrubber)
7. Coach Brain (Claude narratives + plans) + drill delivery + onboarding
8. Gamification v1 + polish + device-matrix hardening + closed beta (~50 users incl. coach panel's gyms)

**GATE G1 (magic gate):** activation ≥50% (beta), magic-moment view ≥60%, fault "wrong" reports <15%, coach panel rates ≥70% of film studies "technically correct"; crash-free ≥99.5%; thermal survival: 10×3 min rounds on base iPhone. Beta feedback loop runs 4+ weeks before public.

## Phase 2 — Depth & trust (≈10–12 weeks)

- Server deep tier live (whole-body pose, 3D lifting, kinetic-chain metrics) + "old sessions re-analyzed" moment
- Heavy bag mode (occlusion-tuned) + technique mode (HFR per-rep analysis)
- Extended punch classes as F1 gates pass; telegraph + exposure metrics; style detection v1
- Flywheel v1: consented contributions + active learning loop + trust-button labeling
- Public launch (App Store) + subscription live
- **Power-index validation study** vs. instrumented bag (publishable honesty artifact, marketing asset)

**GATE G2:** D28 retention ≥30% (paying cohort), deep-tier cost ≤$0.05/session measured, extended-class F1 gates green, coach-panel correctness ≥80%, zero P1 privacy incidents, App Store rating ≥4.5 sustained.

## Phase 3 — Breadth & growth (≈12+ weeks)

- Android (Kotlin + LiteRT/NCNN; shared Metrics Core pays off here)
- Conditioning, double-end/speed bag, pads mode with partner scripts + two-person tracking v1
- Leaderboards/challenges/seasons; fighter-similarity "Style DNA"; localization ES/PT
- Fine-tuned pose decision point (only if Phase-2 error analysis demands it — [02](02-CV-RESEARCH.md) §1.3)

**GATE G3:** Android parity on golden-clip benchmarks (±5% of iOS metrics); growth loop (K-factor from shareable film-study clips) measured; infra costs linear with revenue.

## Phase 4+ — The horizon (explicitly speculative, re-planned at G3)

Sparring review (multi-person contact CV — hardest problem, own research track), coach/gym B2B tier, fight simulation depth, wheelchair-boxing mode research, mesh-based body tracking upgrades, AR glasses experiments, competitive "belt" seasons with skill-verified ranking.

## Standing tracks (every phase)

- **Benchmark discipline:** golden-clip CI + device matrix + field-realism suite per release ([04](04-SYSTEM-ARCHITECTURE.md) §8); honesty scorecard updated and reviewed.
- **Coach-in-the-loop:** monthly panel review of taxonomy, transcripts, drills ([06](06-COACHING-ENGINE.md) §8).
- **Risk review:** [12-RISK-REGISTER](12-RISK-REGISTER-RED-TEAM.md) walked at every gate; mitigations re-scored.
- **Privacy audits:** consent flows, deletion verification, access logs quarterly ([10](10-SECURITY-PRIVACY.md)).

## What we deliberately do NOT schedule

No sensor/hardware line. No web app for fighters (film study stays where the camera is; a web *coach dashboard* is Phase-4 B2B scope). No social feed. No punch-count marketing. No feature ships ahead of its feasibility tier ([03](03-FEASIBILITY.md)) or its accuracy gate — the roadmap bends to the gates, never the reverse.
