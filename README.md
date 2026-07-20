# BoxingPro

**The world's best AI boxing coach — phone camera only.** No sensors, no gloves, no trackers. BoxingPro watches you train (shadowboxing, heavy bag, footwork, defense), analyzes every movement with computer vision, and coaches you like an elite trainer: what's breaking down, *why* it matters, and exactly how to fix it — then runs the training plan that gets you there.

> **Status: Planning phase.** No implementation yet, by design. The complete planning suite lives in [`docs/`](docs/00-INDEX.md) and must pass its red-team review before code begins.

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

iOS-first native app (Swift/SwiftUI) captures 60fps video → on-device pose estimation → shared C++/Rust biomechanics core → real-time coaching cues (Tier 1), with deep post-session "film study" analysis (Tier 2) via heavier models, a deterministic fault engine, and Claude-powered coach narration. Supabase backend, GPU workers for deep analysis, on-device-by-default privacy.

## Rules of engagement

1. Implementation follows the plan. Undocumented architecture decisions get documented first, then built.
2. Every capability respects its [feasibility tier](docs/03-FEASIBILITY.md) — no fake precision, ever.
3. Every phase ends at its [measurable gate](docs/11-ROADMAP.md) — the roadmap bends to the gates, never the reverse.
