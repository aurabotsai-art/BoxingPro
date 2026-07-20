# 03 — Feasibility: The Honesty Matrix

_Every requested capability, graded for what monocular phone video can actually deliver. This doc is the contract between marketing ambition and physics. Product copy, UI, and the coach engine must respect these tiers._

## 1. Tier definitions

| Tier | Meaning | Product treatment |
|---|---|---|
| **T0 — Measurable** | Directly computable from keypoints with known error bounds | Show as a number/score |
| **T1 — Estimable** | Computable with calibration and/or temporal aggregation; meaningful error bars | Show with confidence range ("reach ≈ 178–184 cm") |
| **T2 — Proxy** | The true quantity is unobservable; we compute a correlated kinematic index | Show as a relative index/score, labeled ("Power Index", never "Watts") |
| **T3 — Inferable trend** | Only meaningful across many sessions, not per-event | Show in longitudinal views only |
| **T4 — Not credible** | Cannot be honestly derived from phone video | Do not ship; offer manual input or omit |

Cross-cutting rule: **anything at T1+ hides its number below a minimum-confidence threshold** and shows "couldn't measure this — try better lighting/framing" instead of a guess.

## 2. Body analysis requests

| Requested | Tier | How / Why |
|---|---|---|
| Height | T1 | Calibration scan + reference object or user input; AR floor-plane scale where available. ±2–3 cm |
| Reach / arm length / leg length / torso ratio / shoulder & hip width | T1 | From calibrated skeleton + mesh-recovery scan (T-pose ritual). Ratios (ape index, leg/torso) are T0 once scale exists |
| Weight | T2/T4 | Silhouette+mesh volume regression gives ±5–8 kg at best → ask the user (they know); show estimated *only* if unstated, clearly labeled |
| Body fat % | T4 | Not credible from clothed video. Omit. Manual entry allowed for trend tracking |
| Neck length / limb proportions | T1 | From calibration scan |
| Dominant hand | T1 | Inferred from stance + punch-volume asymmetry over first sessions; confirm with one onboarding question (ask — it's free signal) |
| Posture (kyphosis-ish cues, pelvic tilt tendency) | T2 | Static-scan angle heuristics; framed as "posture observations," never medical language |
| Muscle balance | T4 as imaging; T3 as movement asymmetry | Reframe: left/right kinematic asymmetry (speed, rotation, balance) across sessions |
| Mobility / flexibility limits | T1 | *Only* via a guided mobility screen (overhead reach, squat depth, hip rotation drills) — a deliberate assessment mode, not passive inference |
| Athleticism estimate | T2 | Composite index from measured speed, coordination, balance metrics; labeled composite |
| Reaction speed | T0 (in reaction mode) | On-screen stimulus → first-movement latency = directly measurable in Reaction Training mode. Passive estimation: T4 |
| Age / gender estimate | **Rejected** | Face-analysis inference is privacy-hostile and unnecessary — ask during onboarding. Hard product decision, see [10](10-SECURITY-PRIVACY.md) |
| Somatotype / body type | T2 | Coarse classification from mesh scan; used only to flavor style recommendations |
| Injury risk flags | T2, guarded | Pattern flags ("knee collapses inward on pivot") with strong non-medical framing + disclaimer; never diagnoses |
| Natural advantages/disadvantages | T1 composite | Derived from proportions (reach vs height, leg length) + measured attributes; this is the fun, shippable version of body analysis |
| Stance recommendation | T1 | From dominance, proportions, measured attributes + style quiz; framed as starting-point advice |

## 3. The calibration ritual (unlocks most T1s)

90-second onboarding flow, repeatable anytime:
1. Phone placed per setup assistant; AR floor-plane detection grabs metric scale where supported.
2. User states height (or scans an A4/credit-card reference if they prefer not to).
3. Guided poses: T-pose (limb lengths, reach), profile stance (posture cues), 3 slow jabs + 3 fast jabs (per-user speed normalization baseline), one guided mobility screen (optional).
4. Output: **Fighter Body Profile** — calibrated skeleton scale, limb measurements with confidence, movement baselines. All downstream metrics reference this profile.

## 4. Stance analysis requests

All computable per-frame from keypoints once calibrated; the honest caveats are view-dependence and occlusion.

- **T0:** foot placement/width, toe angle (needs feet keypoints — drives the 26-kp/whole-body model choices in [02](02-CV-RESEARCH.md)), knee bend, hand height, hand spacing, elbow position, head position, shoulder alignment, stance detection (orthodox/southpaw/switch — trivial), heel lift.
- **T1:** weight distribution & center of gravity (COM estimated from segment-mass anthropometric tables + calibrated skeleton; front/back split ±10%), chin tuck (face landmarks; degraded when guard occludes), hip rotation (needs decent z → best from side view or server 3D lifting).
- **T2 composite scores:** stance efficiency / power / mobility / defense scores — weighted rubrics over the T0/T1 primitives, designed with coaches ([06](06-COACHING-ENGINE.md)), shown with their contributing factors expandable.

## 5. Punch detection & analysis requests

### Detection (classification head over keypoint sequences, [05](05-PERCEPTION-PIPELINE.md))
- **Core 6 (jab, cross, lead/rear hook, lead/rear uppercut): T0** — MVP scope, target >90% F1 at 60fps.
- **Extended set (overhand, body variants, shovel/check/long hook): T1** — needs our dataset to mature; ship per-class as F1 crosses threshold ([07](07-DATA-STRATEGY-MLOPS.md)).
- **Feints/half-punches: T1** — detected as "initiation without commitment" kinematic signature.
- **Corkscrew/gazelle/esoteric named punches: T2** — recognized as variants of core classes + attribute tags (rotation, leap) rather than standalone classes. Honest and more useful.
- **Unknown/hybrid punches: T0 as a class** — "unclassified strike" bucket is mandatory (open-set recognition); never force-classify.
- **Illegal mechanics (e.g., slapping, backhand): T1** — rule flags on top of classification.

### Per-punch metrics
| Metric | Tier | Notes |
|---|---|---|
| Hand speed (peak/avg), acceleration, retraction speed | T1 | Spline-fit wrist trajectory; ranges at 60fps, tight at 120fps+ |
| Extension %, straightness/arc, trajectory | T0/T1 | Vs. user's own calibrated reach; view-aware |
| Snap (accel→decel sharpness) | T1 | Second-derivative feature; HFR mode improves |
| Guard recovery time | T0 | Frames from full extension → hand back at guard line. Coaches love this; cheap to compute. Signature metric |
| Hip engagement, shoulder rotation, weight transfer, foot drive | T1 | Rotation angles from 3D-lifted pose; front-view versions are coarser (flagged); side-view protocol for precision |
| Kinetic chain efficiency / sequencing | T1/T2 | Timing lag between hip-peak, shoulder-peak, fist-peak velocities — measurable and genuinely diagnostic; efficiency *score* is a rubric |
| Power / force / ground force | **T2, flagship proxy** | "Power Index" = f(effective mass proxy, hand speed, weight transfer, chain sequencing), normalized to user baseline. NEVER Newtons/Watts/PSI. Roadmap: validation study vs. instrumented bag ([11](11-ROADMAP.md) Phase 3) to publish honest correlation |
| Telegraphing | T1 | Pre-punch tells: shoulder hitch, hand dip, weight rock before initiation — pattern detection over pre-strike windows. High coaching value |
| Exposure after punch / risk score | T1/T2 | Openness (chin exposed, hand down, squared hips) during and post punch; rubric score |
| Accuracy | T0 only vs. a target | Shadowboxing has no target → reframed as consistency/placement-repeatability (T1). True accuracy arrives with bag/pad modes |
| Consistency | T0 | Variance of the above across repetitions |
| Energy efficiency | T2 | Motion-economy proxy (extraneous movement per output); labeled |
| Frame-by-frame critique | T0 (deep tier) | Film-study view: scrub any punch, overlaid skeleton + per-phase annotations. This is a UX deliverable of the deep tier, not a new measurement |

## 6. Defense, footwork, movement requests

- **Defensive move detection** (slip, roll, duck, pullback, parry-ish, shoulder roll, blocks, guard styles incl. high guard/Philly shell/peekaboo/long guard/cross guard): T0/T1 classification problem — same temporal-model machinery as punches; guard *styles* are posture clusters (easier). Parry/catch vs. incidental hand motion without an incoming punch is ambiguous in shadowboxing → tie defense detection to **shadow-scenario prompts** (app calls "slip left!" and scores the response) which converts T2 ambiguity into T0 measurement. This prompt-response design is a core UX idea ([09](09-APP-EXPERIENCE.md)).
- **Footwork** (steps, pivots, L-step, shuffle, bounce, switches, crossing feet, heel-lift, stance-width drift): T0/T1 from feet+ankle keypoints — requires the feet-capable model choice; ring cutting/escape angles: T1 in drill contexts with virtual targets, T4 passively (no opponent exists in shadowboxing).
- **Movement/rhythm** (cadence, tempo, rhythm regularity, flow, weight shifts, COM path, momentum, explosiveness, recovery, head-movement rate, coordination): T0/T1 signal-processing over keypoint streams (FFT-class rhythm features, COM tracking). Rhythm *predictability* ("you slip on a 1-2 beat, every time") is a killer coaching insight and cheap to compute: T1.
- **Balance: T1** — COM over base-of-support polygon; degrades gracefully with framing quality.
- **Reaction time: T0** in reaction mode (stimulus→response), T4 passively.

## 7. Style detection

- Style inference (out-boxer, pressure, counter-puncher, swarmer, boxer-puncher, slugger + guard-style traditions like peekaboo/Philly shell; regional labels used as "influences" not boxes): **T1/T3** — a fingerprint over aggregated features (punch mix, range preference, guard posture, movement direction bias, tempo). Needs several sessions; confidence grows over time. Rule-based rubric v1 → learned embedding later ([06](06-COACHING-ENGINE.md) §5).
- **Pro-fighter similarity %: T2, entertainment-grade.** Built from *public archetype profiles* of famous fighters' measurable tendencies (hand-crafted feature vectors, cosine similarity). Explicitly framed as fun ("style DNA"), never as skill comparison. Legal note: use factual style descriptions of public figures; no NIL implication of endorsement ([10](10-SECURITY-PRIVACY.md) §6).

## 8. Multi-person / equipment requests

| Requested | Verdict |
|---|---|
| Heavy bag detection | T0 (single-class detector); Phase 2 |
| Glove detection | T1 (improves hand tracking priors); Phase 2 |
| Ring detection | T3/T4 — home users lack rings; low priority |
| Multi-person tracking (pads, sparring) | T1 detection / T2 analysis — pads Phase 3, sparring Phase 4+; contact occlusion is the hardest CV problem in this plan |
| Distance/depth estimation | T1 after calibration (user↔camera, user↔bag); user↔partner T2 |

## 9. Summary: what the MVP promises

MVP ships **only T0/T1 capabilities in shadowboxing mode**: stance analysis, core-6 punch detection with speed/extension/guard-recovery/telegraph metrics, footwork basics, rhythm, prompt-response defense drills, calibrated body profile, and the coach engine narrating it. Everything T2 ships labeled as an index. Everything T4 is cut or replaced by manual input. This is enforced by the tier column in every feature ticket.
