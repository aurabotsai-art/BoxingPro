# 01 — Product Vision & Competitive Landscape

## 1. The product in one paragraph

BoxingPro turns any smartphone into an elite boxing coach. The user props their phone against a wall, trains — shadowboxing, heavy bag, footwork drills — and the app watches every movement: stance, punches, defense, footwork, rhythm. During the session it gives instant, targeted cues ("hands are dropping after the cross"). After the session it delivers a coach's film study: what improved, what's breaking down, why it matters, and exactly what to drill tomorrow. Over weeks it runs a periodized program that adapts to the fighter's measured weaknesses, style, and goals.

## 2. Why now

- **Pose estimation crossed the usability threshold.** On-device models (BlazePose/MoveNet class, Apple Vision framework, RTMPose via mobile runtimes) now run at 30–60fps+ on mid-range phones with joint accuracy sufficient for form analysis. Five years ago this required a mocap lab.
- **Phone cameras got fast.** 60fps is universal; 120–240fps slow-motion capture is common. Fast punches are finally sampleable by consumer hardware.
- **LLMs solved the "last mile" of coaching.** Rules can detect a dropped hand; only a language model can weave twelve detected faults into the *one* piece of advice a good coach would actually give, in the coach's voice, with a drill to fix it.
- **The market has proven demand but shallow supply.** Sensor products (FightCamp, Corner, Rooq, the defunct Hykso) proved people pay for punch data but require hardware. Camera apps exist (Punch AI, PunchLab, assorted "AI boxing coach" apps as of 2026) but do punch counting and single-fault cues, not deep biomechanics or genuine coaching.

## 3. Target users

| Segment | Who | What they need | Willingness to pay |
|---|---|---|---|
| **Solo home boxer** (primary) | Trains in garage/living room, no coach, learned from YouTube | Form correction, structure, confidence they're not building bad habits | High — this is their only coach |
| **Gym member between classes** | 2–3 classes/week, wants to improve faster | Homework that connects to what their coach teaches; measurable progress | Medium-high |
| **Competitive amateur** | Has a real coach | Film-study depth, opponent-style prep, conditioning metrics | Medium (coach is primary) |
| **Fitness boxer** | Boxing as cardio (FightCamp/FitXR audience) | Fun, gamified workouts that happen to improve technique | Medium, churn-prone |
| **Coach (later)** | Trains 5–50 fighters | Roster view, assign drills, review student sessions asynchronously | High (B2B pricing) |

The MVP is built for the **solo home boxer** shadowboxing in a small space. This is deliberate: shadowboxing is the CV-friendliest mode (one person, no bag occlusion, controllable framing), and the solo boxer has the highest need and no substitute.

## 4. Competitive landscape (researched 2026-07)

### Camera-based boxing apps (direct competitors)
- **Punch AI – Boxing Coach** (iOS): real-time body/hand tracking, punch detection, head-movement tracking, session scoring. Closest direct competitor. Depth of analysis appears limited to counting + basic form cues.
- **PunchLab**: heavy-bag-centric workouts with punch tracking (phone camera and/or bag mount modes); strong on workouts/gamification, thin on technique coaching.
- **"AI Boxing Coach" class apps** (several, 2025–2026): real-time cues on chin, elbow, guard. Validates the category; none show biomechanics depth, style modeling, or periodized coaching.
- **Various shadowboxing workout apps**: follow-along video content, no CV.

### Sensor-based (indirect; validate willingness to pay)
- **FightCamp** (bag + punch trackers, subscription), **Corner/Rooq** (wrist sensors, punch stats), **Hykso** (dead — hardware CAC killed it), **StrikeTec**. Lesson: hardware adds friction and COGS; data alone (counts, speed) retains poorly without coaching.

### Adjacent proof points
- **HomeCourt** (basketball): proved phone-camera sports analysis at consumer scale — our closest architectural ancestor.
- **Peloton Guide, Tempo, Kemtai, Exer AI, Sency**: camera fitness form-checking is mainstream; none do combat sports depth.
- **Jabbr / DeepStrike**: multi-camera pro-grade combat analytics for broadcasts/gyms — the accuracy ceiling to aspire toward, but not mobile, not consumer.
- **FitXR / VR boxing**: gamification benchmark; requires headset.

### The gap we occupy
Every competitor stops at **what happened** (punch count, speed, a form cue). Nobody delivers **why it happened, what it costs you, and what to do about it** — the actual job of a coach. Nobody does defense, footwork, and rhythm analysis. Nobody builds a longitudinal model of the fighter. That is BoxingPro.

## 5. Differentiation (defensible, in order of moat depth)

1. **Boxing-motion dataset** — labeled punch/defense/footwork sequences accumulated via opt-in user contributions ([07](07-DATA-STRATEGY-MLOPS.md)). Data compounds; UI can be copied.
2. **Biomechanics + fault engine** — coach-designed, testable fault taxonomy ([06](06-COACHING-ENGINE.md)) built with real boxing coaches. Domain knowledge encoded as software.
3. **Longitudinal fighter model** — every session updates a persistent profile (tendencies, fault frequencies, progress curves) that makes coaching more personal over time. Switching cost grows with use.
4. **Two-tier UX** — instant cues *and* deep film study. Competitors pick one.
5. **Honesty** — confidence-ranged estimates instead of fake precision. Builds the trust a coach relationship requires.

## 6. What BoxingPro is NOT

- Not a hardware product. Ever. Camera only is the identity.
- Not a punch counter with a skin. Counting is table stakes, mentioned nowhere in marketing.
- Not a video-course library. Content exists only in service of drills the coach engine prescribes.
- Not a betting/fight-prediction product.
- Not (in v1) a sparring judge. Multi-person contact analysis is Phase 4+ territory ([03](03-FEASIBILITY.md)).

## 7. Product principles

1. **Coach, don't grade.** Every score must be openable into why + how to fix. A number without a prescription is a bug.
2. **One cue at a time in real time.** Elite coaches don't shout twelve corrections mid-round. Real-time = the single highest-priority cue; depth waits for film study.
3. **Never lie about certainty.** Estimates carry ranges. When the camera can't see something (occluded hand, cropped feet), say so.
4. **Respect the sport.** Terminology, technique standards, and drill design validated by credentialed boxing coaches, not invented by engineers.
5. **The fighter owns their footage.** On-device by default; cloud by explicit consent; deletion is real ([10](10-SECURITY-PRIVACY.md)).
6. **Session in 10 seconds.** From app-open to training must be near-instant; friction kills training habits.

## 8. Business model (working hypothesis)

- **Free tier:** limited sessions/week, real-time cues, basic stats. Enough to prove magic.
- **Pro subscription (~$12–20/mo):** unlimited sessions, deep film study, periodized programs, style analysis, full history.
- **Coach/gym tier (later):** per-seat roster tooling.
- Unit-economics guardrail: deep analysis compute per session must stay under ~$0.05 (drives the on-device-first architecture in [04](04-SYSTEM-ARCHITECTURE.md)).

## 9. North-star metrics

- **Activation:** % of new users completing calibration + first analyzed session in 24h (target >60%).
- **Magic moment:** % of first sessions where user opens the film study and views ≥1 fault explanation (target >70%).
- **Retention:** 4-week training-session retention (target >35% for a training product).
- **Trust:** % of fault detections users mark "wrong" (<10%, tracked in-app — this doubles as labeling data).
