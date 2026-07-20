# BoxingPro

**The world's best AI boxing coach — phone camera only.** No sensors, no gloves, no trackers. BoxingPro watches you train (shadowboxing, heavy bag, footwork, defense), analyzes every movement with computer vision, and coaches you like an elite trainer: what's breaking down, *why* it matters, and exactly how to fix it — then runs the training plan that gets you there.

> **Status: Phase 0 (de-risking) in progress.** The planning suite in [`docs/`](docs/00-INDEX.md) governs all work. Environment-independent groundwork is built; device-dependent spikes (pose bake-off, dataset bootstrap) are next.

## Repository layout

```
docs/        Planning suite (00-INDEX.md is the map) — binding on all work
core/        Metrics Core: shared Rust biomechanics library (zero deps, golden tests)
contracts/   Versioned JSON Schemas: SkeletonArchive, SessionAnalysis, CoachOutput
content/     Coaching knowledge as data: fault taxonomy + drill library (YAML)
supabase/    Database migrations (Postgres + RLS per docs/08)
```

Verify the core: `cd core && cargo test` (also `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` — CI enforces all three).

## Planning suite

Start at [`docs/00-INDEX.md`](docs/00-INDEX.md) — it maps all twelve documents and the ten load-bearing decisions. Highlights:

- [Product vision & competitive landscape](docs/01-PRODUCT-VISION.md)
- [Computer-vision research: models, runtimes, camera physics](docs/02-CV-RESEARCH.md)
- [Feasibility honesty matrix — what monocular video can and cannot measure](docs/03-FEASIBILITY.md)
- [System architecture](docs/04-SYSTEM-ARCHITECTURE.md) · [Perception pipeline](docs/05-PERCEPTION-PIPELINE.md) · [Coaching engine](docs/06-COACHING-ENGINE.md)
- [Data strategy & MLOps](docs/07-DATA-STRATEGY-MLOPS.md) · [Data model](docs/08-DATA-MODEL.md)
- [App experience & gamification](docs/09-APP-EXPERIENCE.md) · [Security & privacy](docs/10-SECURITY-PRIVACY.md)
- [Roadmap & gates](docs/11-ROADMAP.md) · [Risk register & red-team log](docs/12-RISK-REGISTER-RED-TEAM.md)

## Architecture in one breath

Web-first PWA (Next.js on Vercel, ADR-003 in docs/04): browser camera → in-browser pose estimation (MediaPipe Tasks / TF.js) → the shared Rust Metrics Core compiled to WASM → real-time coaching cues (Tier 1), with deep post-session "film study" analysis (Tier 2) on GPU workers, a deterministic fault engine, and Claude-powered coach narration. Supabase backend, on-device-by-default privacy. Same Rust core runs in browser, server, and any future native shell — identical numbers everywhere.

## Rules of engagement

1. Implementation follows the plan. Undocumented architecture decisions get documented first, then built.
2. Every capability respects its [feasibility tier](docs/03-FEASIBILITY.md) — no fake precision, ever.
3. Every phase ends at its [measurable gate](docs/11-ROADMAP.md) — the roadmap bends to the gates, never the reverse.
