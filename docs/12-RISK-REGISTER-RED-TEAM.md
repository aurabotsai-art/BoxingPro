# 12 — Risk Register, Failure Modes & Red-Team Log

_Walked at every phase gate. Scores: Likelihood × Impact (1–5 each). Mitigations must name a doc/owner, not a vibe._

## 1. Risk register

| # | Risk | L×I | Mitigation | Where |
|---|---|---|---|---|
| R1 | **Perception accuracy below coach-credibility bar** (blur, occlusion, devices) | 4×5 | Phase-0 gate G0 kills/pivots cheaply; layered capture mitigations; honesty tiers keep claims inside measured reality | [02](02-CV-RESEARCH.md), [11](11-ROADMAP.md) |
| R2 | Fast punches unmeasurable at consumer fps | 3×5 | 60fps floor, HFR drill mode, trajectory fitting, range-reporting | [02](02-CV-RESEARCH.md) §3.1 |
| R3 | Coaching feels generic → churn | 3×5 | Fault-cause discrimination, longitudinal closed loop, coach panel evals, one-cue discipline | [06](06-COACHING-ENGINE.md) |
| R4 | LLM hallucination breaks trust | 3×4 | Deterministic-numbers contract, echo-check, schema validation, frozen eval set | [06](06-COACHING-ENGINE.md) §6, [07](07-DATA-STRATEGY-MLOPS.md) §6 |
| R5 | Thermal throttling mid-session | 4×3 | Duty cycling, downshift ladder, round structure, honest UI | [02](02-CV-RESEARCH.md) §3.4 |
| R6 | Dataset too small for extended classes | 4×3 | Class-by-class ship gates (core-6 first), flywheel, synthetic augmentation | [07](07-DATA-STRATEGY-MLOPS.md) |
| R7 | Biometric-privacy legal exposure (BIPA-class) | 2×5 | Launch-blocking counsel checklist, consent-first design, keypoints-over-video defaults | [10](10-SECURITY-PRIVACY.md) §2 |
| R8 | Solo-dev scope explosion | 5×4 | Phase gates, tier system cuts T4s, iOS-only v1, content (drills/faults) as data not code | [11](11-ROADMAP.md), [03](03-FEASIBILITY.md) |
| R9 | Incumbent copies surface features | 3×3 | Moat = dataset + taxonomy + longitudinal model, all compounding; speed through phases | [01](01-PRODUCT-VISION.md) §5 |
| R10 | Setup friction (framing/space) kills activation | 4×4 | Setup assistant as MVP-critical feature, remembered spots, small-space drill variants, activation metric gate | [05](05-PERCEPTION-PIPELINE.md) §1, [09](09-APP-EXPERIENCE.md) |
| R11 | Users game metrics (leaderboard camera tricks) | 3×2 | Improvement/consistency-ranked boards, cohorting, plausibility checks vs. body profile | [09](09-APP-EXPERIENCE.md) §4 |
| R12 | Injury attributed to app guidance | 2×5 | Non-medical framing, conservative progressions, disclaimers, no weight-cut advice, counsel-reviewed ToS | [10](10-SECURITY-PRIVACY.md) §2 |
| R13 | Deep-tier COGS blowout | 2×3 | Keypoint-input jobs default, $0.05 budget measured at G2, on-device deep tier research (RQ5) | [04](04-SYSTEM-ARCHITECTURE.md) §7 |
| R14 | Demographic accuracy gaps (skin tone, body type) | 3×4 | Stratified golden set + fairness slice gates; diverse P0/P3 collection quotas | [07](07-DATA-STRATEGY-MLOPS.md) §5 |
| R15 | Apple platform dependency (Vision API changes, review policy) | 2×3 | RTMPose fallback path kept warm; camera/pose behind interfaces | [02](02-CV-RESEARCH.md), [04](04-SYSTEM-ARCHITECTURE.md) |
| R16 | Session memory growth OOMs low-end phones (measured: 848B/frame × 2 sequences = 87MB @ 30fps·30min, 175MB @ 60fps·30min) | 3×3 | Shipped: 54k-frame cap + UI auto-end (saves summary+archive at the cap); profile-refresh sorts stop at 3k frames. Planned: packed f32 frame storage (~4× smaller) before long-session/HFR features | core-wasm MAX_SESSION_FRAMES |

## 2. Failure-mode playbook (runtime fallbacks)

| Failure | Detection | Fallback behavior |
|---|---|---|
| Pose quality collapse (lighting/framing drift) | FramingQuality + confidence monitors | Live "fix framing" prompt; metrics auto-suppress below threshold; session tagged, never silently wrong |
| Classifier uncertain | open-set thresholds | `unclassified_strike` counted honestly; film study shows it; user can label (flywheel) |
| Thermal critical | OS thermal state | Downshift ladder → worst case: capture-only mode, full analysis async after cooldown |
| Deep-tier job failure | job retries exhausted | Tier-2-lite results stand; user sees "deep analysis delayed", auto-retry; never a blank report |
| LLM unavailable/over-budget | API errors/quota | Template-based film study (deterministic engine output rendered directly) — degraded voice, full correctness |
| Sync unavailable | network monitors | Offline-first continues fully; queue drains later |
| Model regression post-update | golden-clip CI + canary cohort | Staged rollout, model-version pinning, one-tap server-side rollback of Tier-2 models |

## 3. Red-team log (self-critique rounds on this planning suite)

### Round 1 — findings & resolutions
1. **"Analyze everything" vs. honesty collision** — original feature list contains physically impossible promises (body fat, passive reaction speed, force in Newtons). → Resolved: tier system ([03](03-FEASIBILITY.md)) is the binding contract; T4s cut or replaced with manual input; marketing constrained by it.
2. **Single-tier latency/depth contradiction** — real-time and deep analysis have incompatible budgets. → Resolved: two-tier architecture ([04](04-SYSTEM-ARCHITECTURE.md) §3).
3. **Shadowboxing defense ambiguity** (slip from nothing = noise?) → Resolved: prompt-response drill design converts to measurable stimulus-response ([03](03-FEASIBILITY.md) §6).
4. **Feet keypoints missing in default models** (17-kp sets) would silently gut footwork analysis. → Resolved: feet-capable model requirement made explicit selection criterion ([02](02-CV-RESEARCH.md) §1.3).
5. **Metric drift across platforms/tiers** → Resolved: single shared Metrics Core with golden-file tests ([04](04-SYSTEM-ARCHITECTURE.md) §2).

### Round 2 — findings & resolutions
6. **Front-view rotation blindness** — hip/shoulder rotation (core power mechanics) is weakly observable head-on; plan originally over-promised it in Tier 1. → Resolved: rotation metrics gated to Tier-2 3D lifting + side-view protocol; Tier-1 versions labeled coarse ([03](03-FEASIBILITY.md) §5, [05](05-PERCEPTION-PIPELINE.md) §4).
7. **Data flywheel consent risk** — training on user data without airtight consent is both wrong and BIPA-fatal. → Resolved: keypoints-only, opt-in, revocable with propagation ([07](07-DATA-STRATEGY-MLOPS.md) §7, [10](10-SECURITY-PRIVACY.md)).
8. **Coach quality unverifiable by engineers** — we can't self-certify boxing correctness. → Resolved: retained coach panel with monthly blind evals as a standing track ([06](06-COACHING-ENGINE.md) §8).
9. **Gamification vs. coaching conflict** — volume rewards encourage sloppy high-rep training. → Resolved: quality-weighted XP, skill-gated ranks, periodization-aware streaks ([09](09-APP-EXPERIENCE.md) §4).
10. **Bystander privacy** (family member walks through frame) → Resolved: single-subject lock discards non-subject detections immediately; no bystander data persisted ([05](05-PERCEPTION-PIPELINE.md) §3); added to test matrix.

### Round 3 — findings & resolutions
11. **Phase-0 gate had no pivot plan** — a failed gate with no alternative = sunk-cost pressure to ship a bad product. → Resolved: named pivot options at G0 ([11](11-ROADMAP.md)).
12. **On-device-only users originally got no film study** — punishing the most privacy-conscious users. → Resolved: Tier-2-lite (full fault engine on-device) guaranteed for everyone ([04](04-SYSTEM-ARCHITECTURE.md) §3).
13. **Golden-set leakage risk** (beta users' data in both train and eval) → Resolved: frozen, user-disjoint golden sets per release ([07](07-DATA-STRATEGY-MLOPS.md) §2, §5).
14. **Famous-fighter similarity legal exposure** → Resolved: archetype framing, counsel review, drop-name fallback ([10](10-SECURITY-PRIVACY.md) §6).
15. **Roadmap timeboxes read as promises** — solo/small-team velocity uncertainty is high. → Resolved: gates are the commitments; timeboxes labeled estimates; scope sheds per the tier system, never the gates.

### Round 4 — platform pivot to web (ADR-003, owner decision 2026-07-20)
16. **Browser fps ceiling reopens R2** — getUserMedia tops out at 30–60fps with no HFR; the fast-punch risk widens. → Mitigated, not resolved: measured-fps-conditioned confidence on every speed metric, upload-slow-mo path for technique mode, capture-then-analyze fallback mode defined before any native retreat (ADR-003). R2 likelihood re-scored 3→4; watch at G0.
17. **iOS Safari variability** (WebGPU/WebGL performance, wake-lock, camera quirks) becomes the new device-fragmentation risk, replacing Android fragmentation. → Backend feature-detect ladder + per-session backend/fps telemetry (docs/02 §2.1); iOS Safari explicitly in the G0 test matrix.
18. **Pivot dividend recorded:** app-store gatekeeping risk (old R15) retired; distribution friction near zero; entire bake-off now CI-executable. M-track shrank from 14 items to 13 with the 4 heaviest (Mac/Xcode/Apple account/App Store) deleted (docs/13).

### Open items (must close before Phase-1 build start)
- O1: Coach panel recruitment (2–3 credentialed coaches) — blocks taxonomy v1 sign-off.
- O2: Counsel selection for biometric/consent review — blocks public beta.
- ~~O3~~ Rescoped by ADR-003 (2026-07): browser matrix needs only borrowed phones (docs/13 M12); HFR ground truth = any recent phone's native slow-mo (docs/14 block S1). Closed as owner-checklist items M12/M13.
- ~~O4~~ Done 2026-07: `docs/ADR-TEMPLATE.md`; ADR-001..004 already follow it.

## 4. Standing red-team protocol

At every gate: re-walk §1 scores with fresh eyes; add one adversarial session ("how would a competitor/regulator/angry user attack us today"); every new finding gets a numbered entry above with a resolution or an owner+date. A finding without a resolution blocks the gate.
