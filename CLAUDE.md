# BoxingPro — AI session context

## What this project is

An AI boxing coach in the browser using **only the phone camera** (no sensors/hardware): real-time pose-based analysis of stance, punches, defense, footwork and rhythm, plus deep post-session "film study" and a periodized coaching engine.

**Current status: Phase 0 in progress.** The planning suite in `docs/` (start at `docs/00-INDEX.md`) governs all work. Built so far: `core/` (Rust Metrics Core, 32 tests: types, filters, geometry/COM, strike events+metrics, footwork, rhythm, fault primitives, combos, guard sampling, telegraph, prioritizer; WASM build verified), `cli/` (`boxingpro analyze|synth-jab`), `tools/ingest` (video→SkeletonArchive, verified on real footage), `tools/labeler` (Playwright-tested web labeler), `coach_brain/` (template renderer + prompts + eval suite), `workers/` (deep-tier skeleton), `contracts/` (three v1 schemas), `content/` (14 faults/14 drills, linted), `data/sources/` (43-video ledger), `supabase/migrations/` (schema v1), CI (workspace fmt+clippy+tests, content lint, schema validation). Post-ADR-003, spikes S0.1–S0.3 are largely executable in CI (Playwright + Chromium); S0.4–S0.5 still need collected footage; phone-browser verification needs only the owner's phone. Red-team open items O1 (coach panel) and O2 (counsel) still block Phase 1; O3/O4 closed.

Verify before committing core changes: `cd core && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`.

## Non-negotiable rules for any session in this repo

1. **Plan-first:** implementation must follow the docs. If a needed architecture decision isn't documented, write a short ADR into the relevant doc *before* building.
2. **Honesty tiers:** every user-facing metric respects its tier in `docs/03-FEASIBILITY.md` (T0 measurable → T4 not credible). Never ship pseudo-precision; T4 features are cut or manual-input.
3. **Deterministic numbers, generative words:** all metrics come from the deterministic Metrics Core; the LLM narrates and plans but never invents measurements (`docs/06` §6).
4. **Privacy defaults:** raw video never leaves the device without per-session opt-in; keypoint archives are the default cloud payload (`docs/10`).
5. **Gates over dates:** phase exit criteria in `docs/11-ROADMAP.md` are binding; scope sheds before gates do.

## Key architecture facts (details in docs/04 & 05)

- **Web-first PWA** (ADR-003 in docs/04): Next.js on Vercel; browser camera (getUserMedia); pose via MediaPipe Tasks Vision (TF.js MoveNet fallback); no native apps unless PMF demands one.
- One shared Rust **Metrics Core** (post-keypoint biomechanics math) compiled to WASM for the browser and natively for servers — identical numbers everywhere. wasm32 build verified.
- **Two-tier analysis:** Tier 1 live on-device (60fps pose, ≤300 ms cue latency, one cue at a time); Tier 2 async film study (whole-body pose + 3D lifting on GPU workers, or Tier-2-lite fully on-device).
- Capture spec: request 60fps via getUserMedia, MEASURE real fps per session (metric confidence conditions on it); HFR = user uploads native-camera slow-mo clips for deep analysis (browsers can't capture HFR).
- Backend: Supabase (Postgres+RLS, Auth, Storage) + serverless GPU workers + Claude API coach brain. Schema in `docs/08`.
- Canonical artifacts/contracts: SkeletonArchive v1, SessionAnalysis v1, CoachOutput v1 (`docs/04` §6) — version-bump discipline applies.

## Working conventions

- Branch per feature; `main` stays releasable; commit messages descriptive.
- Perception/metrics changes require golden-clip CI runs once that harness exists (`docs/04` §8).
- Update `docs/12` red-team log when new risks/decisions surface; update roadmap checkmarks as gates pass.
