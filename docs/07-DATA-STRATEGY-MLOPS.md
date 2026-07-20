# 07 — Data Strategy & MLOps

_The classifier quality ceiling — and therefore the product ceiling — is set by data. This doc plans the dataset before the model._

## 1. What we need labeled

Primary unit: **keypoint sequence windows** (not raw video — smaller, privacy-cleaner, model-agnostic) with labels:
- Action class + attributes (punch/defense/footwork taxonomy from [05](05-PERCEPTION-PIPELINE.md) §6)
- Event boundaries (initiation, apex, recovery) — needed for phase-aware metrics
- Quality annotations on a subset (coach-graded form 1–5 per rep) — powers fault-threshold calibration and future learned scoring
- Condition tags: fps, framing quality, lighting, gloves y/n, skill level, stance

## 2. Acquisition phases

| Phase | Source | Target volume | Notes |
|---|---|---|---|
| P0 Bootstrap | Founder + 5–10 local boxers/coaches, scripted sessions (every class × stance × speed × 3 angles × conditions matrix) | ~10k labeled reps | Enough for v1 core-6 classifier; scripted = labels nearly free |
| P1 Public/licensed video | Boxing tutorial/training footage run through server pose → weak labels via scripts/titles, human-verified | +20k reps | Diversity of bodies/styles; verify licensing per source; keypoints-only retention |
| P2 Beta flywheel | Opt-in users: auto-detected events → in-app "was this a jab?" micro-confirmations + the "wrong detection" button ([01](01-PRODUCT-VISION.md) §9 trust metric = labeling stream) | +100k reps | Active learning: upload only low-confidence/high-novelty windows (keypoints only, consented) |
| P3 Pro sessions | Paid capture days with amateur/pro fighters + coach labeling | Quality gold set | Doubles as marketing content; grade-5 exemplars for "ideal form" references |
| Synthetic | Mocap-driven (licensed boxing mocap packs + retargeting) rendered to keypoints with camera/noise simulation | Augmentation only | Great for rare classes & viewpoint coverage; never test-set |

Golden test set (from P0+P3, coach-labeled, condition-stratified, ~2k reps) is **frozen per release** and never trained on.

## 3. Labeling infrastructure

- Web labeler (internal): video + skeleton overlay side-by-side, scrub, event-boundary marking, class dropdown with keyboard shortcuts; ~10 s/label target. Build thin (Supabase-backed) — commercial tools (CVAT/Labelbox) evaluated first; adopt if temporal keypoint workflow fits.
- Label QA: 10% double-labeled → inter-rater agreement tracked; coach adjudicates disagreements; ambiguous reps get the `ambiguous` tag (excluded from training, kept for open-set eval).
- Taxonomy governance: label schema versioned with migrations (a "shovel hook" definition change must not silently corrupt history).

## 4. Training pipeline

- Reproducible runs (fixed seeds, data snapshot hashes, config-as-code; W&B-class tracking). Model registry with semantic versions; every SkeletonArchive and SessionAnalysis stamps the model versions that produced it ([04](04-SYSTEM-ARCHITECTURE.md) §6).
- Export path: PyTorch → ONNX → Core ML / LiteRT with **parity tests** (same input window → logits within tolerance across runtimes) — quantization drift is a classic silent killer; CI-gated.
- Augmentation: keypoint-space (rotation/scale/mirror-with-label-swap L↔R, temporal resample 30↔120fps, dropout/jitter matched to measured device noise, synthetic occlusion masks mimicking guard/bag).

## 5. Evaluation (release gates, run in CI)

- Per-class F1 on golden set, stratified by condition (fps, lighting, gloves, skill) — a class ships only ≥0.90 overall AND ≥0.85 in every major stratum ([05](05-PERCEPTION-PIPELINE.md) §6).
- Open-set: false-classification rate on non-boxing movement clips (dancing, calisthenics — collected for this) < 5%.
- Event detector: recall ≥ 0.97 on golden punches (missing punches is the cardinal sin), false-event rate budgeted per minute.
- End-to-end metric regression: golden clips → full pipeline → per-metric deltas vs. sealed reference outputs ([04](04-SYSTEM-ARCHITECTURE.md) §8).
- Fairness slice: accuracy parity across body types, heights, skin tones, sexes on the golden set — pose models have documented demographic gaps; we inherit them unless we measure ([12](12-RISK-REGISTER-RED-TEAM.md) R14).

## 6. LLM eval (Coach Brain)

- Frozen eval set of ~100 session JSONs (real + synthesized edge cases: terrible sessions, injured-user questions, absurd metrics) → scored on: numeric fidelity (echo-check pass rate 100%), coaching correctness (coach-panel rubric), tone, schema validity.
- Runs on every prompt/few-shot/model-version change; regressions block deploy. Cheap insurance for the product's voice.

## 7. Data governance

- Consent-first: flywheel contributions are opt-in with plain-language explanation ("keypoint stick-figures, never your video, help train the coach"); revocable; deletion propagates to training snapshots at next cycle ([10](10-SECURITY-PRIVACY.md)).
- Keypoints-only retention wherever possible; raw video kept only for golden/QA sets with explicit consent and access controls.
- Dataset documentation (datasheets) maintained from P0 — cheap now, impossible retroactively.
