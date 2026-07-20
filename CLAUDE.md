# BoxingPro — AI session context

## What this project is

An AI boxing coach for smartphones using **only the phone camera** (no sensors/hardware): real-time pose-based analysis of stance, punches, defense, footwork and rhythm, plus deep post-session "film study" and a periodized coaching engine.

**Current status: planning phase.** The full planning suite is in `docs/` (start at `docs/00-INDEX.md`). No implementation until the suite's red-team open items (docs/12 §3) are closed and Phase 0 begins.

## Non-negotiable rules for any session in this repo

1. **Plan-first:** implementation must follow the docs. If a needed architecture decision isn't documented, write a short ADR into the relevant doc *before* building.
2. **Honesty tiers:** every user-facing metric respects its tier in `docs/03-FEASIBILITY.md` (T0 measurable → T4 not credible). Never ship pseudo-precision; T4 features are cut or manual-input.
3. **Deterministic numbers, generative words:** all metrics come from the deterministic Metrics Core; the LLM narrates and plans but never invents measurements (`docs/06` §6).
4. **Privacy defaults:** raw video never leaves the device without per-session opt-in; keypoint archives are the default cloud payload (`docs/10`).
5. **Gates over dates:** phase exit criteria in `docs/11-ROADMAP.md` are binding; scope sheds before gates do.

## Key architecture facts (details in docs/04 & 05)

- iOS-first fully native (Swift/SwiftUI, AVFoundation, Core ML/Vision); Android in Phase 3 (Kotlin, LiteRT/NCNN).
- One shared C++/Rust **Metrics Core** (post-keypoint biomechanics math) used by iOS, Android, and server — identical numbers everywhere.
- **Two-tier analysis:** Tier 1 live on-device (60fps pose, ≤300 ms cue latency, one cue at a time); Tier 2 async film study (whole-body pose + 3D lifting on GPU workers, or Tier-2-lite fully on-device).
- Capture spec: 720p@60fps minimum, short-exposure priority; 120/240fps HFR drill mode processed async.
- Backend: Supabase (Postgres+RLS, Auth, Storage) + serverless GPU workers + Claude API coach brain. Schema in `docs/08`.
- Canonical artifacts/contracts: SkeletonArchive v1, SessionAnalysis v1, CoachOutput v1 (`docs/04` §6) — version-bump discipline applies.

## Working conventions

- Branch per feature; `main` stays releasable; commit messages descriptive.
- Perception/metrics changes require golden-clip CI runs once that harness exists (`docs/04` §8).
- Update `docs/12` red-team log when new risks/decisions surface; update roadmap checkmarks as gates pass.
