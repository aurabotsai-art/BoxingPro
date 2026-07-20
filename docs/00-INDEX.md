# BoxingPro — Master Planning Suite

_Status: Planning phase. No implementation until this suite is reviewed, red-teamed, and frozen._
_Last updated: 2026-07-20_

## Mission

Build the world's best AI boxing coach for a smartphone: **camera only** — no sensors, no gloves, no trackers. The experience target is "a world-champion coach watching every movement," which decomposes into three capabilities no competitor currently combines:

1. **See everything** — a perception pipeline that extracts pose, punches, defense, footwork, and rhythm from monocular phone video, honestly and accurately.
2. **Understand everything** — a biomechanics + boxing-knowledge layer that turns raw motion into faults, causes, and priorities the way a coach does.
3. **Coach like a human** — feedback that explains *why*, *how*, and *how to fix*, then drives a periodized training plan, not just a score.

## Document map

| Doc | Contents | Read when |
|-----|----------|-----------|
| [01-PRODUCT-VISION](01-PRODUCT-VISION.md) | Goal, users, competitive landscape, differentiation, positioning | Deciding what to build and why |
| [02-CV-RESEARCH](02-CV-RESEARCH.md) | Pose model survey, mobile inference runtimes, camera physics, known limitations + mitigations | Choosing/changing any perception tech |
| [03-FEASIBILITY](03-FEASIBILITY.md) | Feature-by-feature honesty matrix (every requested capability, tiered T0–T4) | Scoping any feature |
| [04-SYSTEM-ARCHITECTURE](04-SYSTEM-ARCHITECTURE.md) | Client platform decision, two-tier inference, backend, data flow | Any architectural decision |
| [05-PERCEPTION-PIPELINE](05-PERCEPTION-PIPELINE.md) | Camera → pose → tracking → events → classification → metrics, stage by stage | Building/modifying the CV/ML core |
| [06-COACHING-ENGINE](06-COACHING-ENGINE.md) | Fault taxonomy, scoring, style detection, drill/plan generation, LLM integration | Building the coach layer |
| [07-DATA-STRATEGY-MLOPS](07-DATA-STRATEGY-MLOPS.md) | Dataset acquisition, labeling, training pipeline, evaluation, model versioning | Any ML training work |
| [08-DATA-MODEL](08-DATA-MODEL.md) | Database schema, storage strategy, sync | Backend/schema work |
| [09-APP-EXPERIENCE](09-APP-EXPERIENCE.md) | UX architecture, session flows, real-time feedback design, training modes, gamification | Product/UI work |
| [10-SECURITY-PRIVACY](10-SECURITY-PRIVACY.md) | Threat model, biometric-data handling, compliance, on-device-first policy | Anything touching user video/data |
| [11-ROADMAP](11-ROADMAP.md) | Phases, milestones, sprint plan, exit criteria, benchmarking gates | Sequencing work |
| [12-RISK-REGISTER-RED-TEAM](12-RISK-REGISTER-RED-TEAM.md) | Risk register, failure modes, fallback systems, self-critique log | Before every phase gate |
| [13-EXECUTION-ORDER](13-EXECUTION-ORDER.md) | Machine-executable track vs. owner's manual checklist, sync points, critical path | Deciding what happens next, and by whom |

## The ten load-bearing decisions

Every other choice in this suite hangs off these. Each is argued against alternatives in the linked doc.

1. **Two-tier analysis** — lightweight real-time feedback on-device (60fps pose, instant cues) + deep post-session "film study" analysis (heavier models, server or on-device async). One tier cannot do both jobs. → [04](04-SYSTEM-ARCHITECTURE.md)
2. **iOS-first, native core** — Swift/SwiftUI + AVFoundation + Core ML/Vision for v1; Android follows with Kotlin + LiteRT/MediaPipe sharing the C++ metrics core. Cross-platform UI frameworks are rejected *for the CV core*, considered for the non-realtime shell later. → [04](04-SYSTEM-ARCHITECTURE.md)
3. **High-frame-rate capture is non-negotiable** — punches live in 50–100 ms; 30fps sees 2–3 blurred frames. Capture at 60fps minimum (120/240 for punch bursts where hardware allows), resolution sacrificed before frame rate. → [02](02-CV-RESEARCH.md), [05](05-PERCEPTION-PIPELINE.md)
4. **Pose is a commodity; the moat is on top** — we do not train pose models in v1. We build the boxing-specific layers: temporal action recognition on keypoint streams, biomechanics metrics, fault detection, coaching. → [02](02-CV-RESEARCH.md), [07](07-DATA-STRATEGY-MLOPS.md)
5. **Deterministic metrics, generative language** — every number shown to the user comes from deterministic, testable biomechanics code. The LLM (Claude) narrates, prioritizes, and plans; it never invents measurements. → [06](06-COACHING-ENGINE.md)
6. **Honesty tiers on every estimate** — capabilities are tiered (T0 measurable → T4 not credibly possible from monocular video). Estimates ship with confidence ranges; pseudo-precision is treated as a product defect. → [03](03-FEASIBILITY.md)
7. **Calibration ritual as onboarding** — a 90-second guided body-scan + reference measurement converts many "impossible" monocular estimates (height, reach, distance) into "solved via calibration." → [03](03-FEASIBILITY.md), [09](09-APP-EXPERIENCE.md)
8. **On-device by default, cloud by consent** — raw video never leaves the phone unless the user opts into deep analysis; skeleton/metric data is the default sync payload. This is both the privacy architecture and the COGS architecture. → [10](10-SECURITY-PRIVACY.md)
9. **Data flywheel from day one** — opt-in contribution of labeled pose sequences (not raw video) builds the proprietary boxing-motion dataset that competitors lack. Labeling strategy designed before MVP ships. → [07](07-DATA-STRATEGY-MLOPS.md)
10. **Supabase + GPU workers backend** — Supabase (Postgres/Auth/Storage) for the data plane, dedicated GPU inference workers (Modal or equivalent) for deep analysis jobs, Claude API for the coaching brain. → [04](04-SYSTEM-ARCHITECTURE.md), [08](08-DATA-MODEL.md)

## Planning-phase rules

- No implementation until [11-ROADMAP](11-ROADMAP.md) Phase 0 gates are defined and this suite has passed the red-team loop in [12](12-RISK-REGISTER-RED-TEAM.md).
- Implementation follows the plan. Any architecture decision not documented here gets documented here *first* (small ADR appended to the relevant doc), then built.
- Every phase ends with the benchmark gates in [11](11-ROADMAP.md) — perception accuracy is measured, not assumed.
