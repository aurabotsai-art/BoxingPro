# 09 — App Experience: UX, Training Modes, Gamification

_Design north star: the feeling of a great coach — attentive, specific, encouraging, occasionally hard on you — not the feeling of a dashboard._

## 1. Experience pillars

1. **Coach presence, not analytics presence.** Numbers live behind the coach's words. The first thing after a session is a voice/personality saying the one thing that matters, not a wall of charts.
2. **10 seconds to training.** Open app → resume setup spot (remembered per location) → round starts. Setup assistant runs its checks in the background of the countdown.
3. **Audio-first during training.** The user can't read mid-combo. Screen shows big glanceable state (round clock, live cue icon); the coaching channel is voice + haptics.
4. **Film study is the reward.** Post-session report designed like a ritual: what you did → what improved (praise first, per [06](06-COACHING-ENGINE.md) §1) → the ONE thing → tomorrow's prescription. Depth (per-punch scrubber) is a tap deeper, never the landing screen.
5. **Honesty is visible.** Confidence styling on estimates; "couldn't see your feet this session" said plainly. Trust is the retention engine.

## 2. Core loop & screens

```
HOME (today's plan, streak, coach note)
 → SESSION SETUP (mode picker, framing assistant, round config)
 → LIVE SESSION (rounds; live cues; prompt-response drills)
 → FILM STUDY (coach narrative → faults w/ evidence clips → per-punch scrubber)
 → PLAN (auto-updated tomorrow/week; drill cards with demo videos)
PROGRESS (trends, style DNA, body profile, achievements)
```

- **Live session HUD:** round timer, punch counter (ambient), single-cue banner mirroring the audio cue, thermal/quality indicators. Nothing else.
- **Prompt-response drills** ([03](03-FEASIBILITY.md) §6): the app calls actions ("double jab!", "slip left!") via audio with adjustable tempo; compliance + latency scored live. This turns ambiguous passive detection into measurable reps AND is the reaction-training mode AND generates clean labeled data. Highest-leverage UX mechanic in the product.
- **Film scrubber:** timeline of events; tap a punch → slow-mo skeleton overlay, phase markers (initiation/apex/recovery), fault annotations, side-by-side vs. your best rep or reference form.
- **Coach chat:** ask anything about your own data ("why is my cross slower this week?") — Claude over fighter model + recent analyses, same guardrails as [06](06-COACHING-ENGINE.md) §6.

## 3. Training modes (rollout order justified by CV difficulty, [11](11-ROADMAP.md))

| Mode | Phase | Notes |
|---|---|---|
| Shadowboxing (free + guided) | 1 | Flagship; full analysis |
| Reaction training | 1 | Prompt-response; measurable T0 reaction times |
| Footwork & Defense drills | 1–2 | Guided patterns, prompt-response scoring |
| Technique mode | 2 | Single-punch focus, HFR capture, deepest per-rep analysis |
| Heavy bag | 2 | Occlusion-tuned models; impact-adjacent metrics (cadence, output, recovery); accuracy vs. bag target zones |
| Conditioning | 2 | Output/pace/fatigue-curve focus; punch-output intervals |
| Double-end / speed bag | 3 | Rhythm-centric analysis |
| Pads / partner drills | 3 | Partner scripts ([06](06-COACHING-ENGINE.md) §7) + two-person tracking |
| Fight simulation | 3–4 | Scenario rounds vs. described opponent styles ("southpaw pressure round") via prompt engine |
| Sparring review | 4+ | Upload footage; multi-person analysis; hardest CV |

## 4. Gamification (motivation architecture, not casino)

Principle: reward **consistency and skill growth**, never just volume (volume-rewards train overtraining and sloppy reps — an actual coaching harm).

- **XP & ranks:** XP from completed prescribed work, quality-weighted (a focused technique round with faults improving > 500 sloppy punches). Rank names from boxing culture (Amateur → Prospect → Contender → Champion tiers), each gated by *demonstrated skill checks* (a guided assessment round), not XP alone — rank means something.
- **Streaks:** training-days streak with earned rest-day tokens (periodization-aware — the plan's rest day never breaks a streak; deload weeks protected). Anti-burnout by design.
- **Skill tree:** visual map mirroring the fault taxonomy/curriculum (stance → defense → mechanics → power → style branches, [06](06-COACHING-ENGINE.md) §1.4); nodes unlock via measured criteria ("guard recovery p75 < 450 ms across 3 sessions"). The skill tree literally IS the curriculum made visible.
- **Challenges/missions:** daily (from today's plan), weekly (coach-chosen focus), seasonal arcs with cosmetic unlocks (coach voices, overlay themes, badge art). Cosmetics only — never pay-or-grind for analysis features.
- **Leaderboards (Phase 3):** opt-in, cohorted by level/weight-class-ish bands, ranked on consistency and improvement deltas rather than raw punch counts (fair across body types + resistant to camera-gaming). Ghost mode default per privacy posture.
- **Achievements:** milestone (first 1000 analyzed punches), skill (first clean kinetic chain on the cross), consistency, and fun/easter-egg tiers.

## 5. Onboarding

1. Goals + experience quiz (90 s) → 2. Consent choices, plain language ([10](10-SECURITY-PRIVACY.md)) → 3. Calibration ritual ([03](03-FEASIBILITY.md) §3) → 4. **First analyzed round immediately** → 5. First film study = the magic moment; the coach names one genuine, specific thing about *your* form. Activation metric gates in [01](01-PRODUCT-VISION.md) §9.

## 6. Accessibility & inclusivity

- Full audio coaching path (blind/low-vision usable for guided modes); captions/visual-cue path for deaf/HoH (haptic round bells, on-screen cues); colorblind-safe overlay palette; adjustable coach language intensity; wheelchair-boxer mode acknowledged as a Phase-4 research item (seated stance baselines differ — don't fake support, scope it).
- Localization architecture from day one (string tables, unit systems); launch EN, fast-follow ES/PT (boxing heartlands).

## 7. Visual & voice identity (brief)

- Look: dark-gym palette, high-contrast data ink, skeleton overlays as brand signature; motion design restrained during training, celebratory in progress moments.
- Coach voice: warm-gritty trainer persona; 2–3 selectable personalities at launch (technician / motivator / old-school), same underlying coaching content, different phrasing packs — cheap variety with zero coaching-logic divergence.
