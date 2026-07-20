# 06 — Coaching Engine

_How measurements become coaching. This is the product's soul: competitors can count punches; only a real coaching model creates "world-champion coach" feel._

## 1. The coaching model (how elite coaches actually work)

Codified from coaching literature + advisor input (a credentialed coach panel is a Phase-1 hiring requirement, see §8):

1. **Diagnose causes, not symptoms.** A slow cross is a symptom; the cause might be no hip rotation, which itself might be caused by a squared stance. Coaches fix the *root*.
2. **One thing at a time.** Working memory under fatigue holds one cue. Prioritization is the coach's core skill.
3. **Praise-correct-praise.** Motivation is load-bearing; a firehose of faults makes users quit.
4. **Progressive overload of skill.** Fix order: stance → defense-while-punching → mechanics → speed/power → style. Never coach power onto broken mechanics.
5. **Individualize.** Same fault, different fix for a tall out-boxer vs. a short swarmer.

## 2. Fault taxonomy

A versioned knowledge base (data files, not code) — each fault:

```yaml
id: hands_drop_after_cross
category: defense_during_offense       # stance | offense_mechanics | defense | footwork | rhythm | conditioning
detector: guard_recovery_time > adaptive_threshold(user, punch=cross)
severity_model: frequency × exposure_cost      # how often × how dangerous
root_causes: [fatigue, balance_forward, habit]
cause_discriminators:                  # measurements that pick the likely cause
  fatigue: fault_rate rises within-session
  balance_forward: COM forward of base at extension
  habit: uniform rate, COM normal
explanation: why this loses fights (counter right hand lives here)
fixes_by_cause: {habit: [drill:mirror_return_high, cue:"glue it back"], ...}
prerequisites: []                      # faults that must be addressed first (stance before mechanics)
```

~40 faults at MVP across the six categories; grown continuously with coach input. The taxonomy IS the encoded domain expertise — reviewed line-by-line by the coach panel, versioned, and A/B-testable.

## 3. Prioritization (the coach's brain, deterministic)

Per session, faults are scored: `priority = severity × frequency × trainability × prerequisite_gate × novelty_decay`
- *trainability*: how fast this typically improves (quick wins early build trust)
- *prerequisite_gate*: zeroes faults whose prerequisites are unaddressed (never coach power mechanics while stance is broken)
- *novelty_decay*: don't repeat yesterday's lecture; rotate focus while tracking the stubborn fault

Output: **one primary focus**, ≤2 secondary mentions, everything else logged silently to the fighter model. Same algorithm feeds Tier-1 live cues (using its lightweight fault subset) and Tier-2 film study.

## 4. The longitudinal fighter model

Persistent per-user state, updated every session — this is the moat's memory:
- Fault frequency curves (per fault, per context: fresh vs. fatigued, punch type, round #)
- Attribute baselines and trends (speed, guard recovery, rhythm predictability, balance)
- Style fingerprint (§5), body profile ([03](03-FEASIBILITY.md) §3), stated goals + schedule
- Coaching history: what was prescribed, was it done, did the targeted metric move → **closed-loop coaching** ("guard recovery improved 18% since we started the mirror drill — it's working, one more week")

This closed loop — prescribe, measure, adapt — is what no competitor does and what makes retention compound.

## 5. Style detection

- v1: rubric fingerprint = {punch-mix distribution, range/extension preference, guard posture cluster, movement direction bias, tempo/variance, counter vs. lead ratio (drill contexts)} → weighted match against 8 style archetype profiles (out-boxer, pressure, counter-puncher, swarmer, boxer-puncher, slugger, peekaboo-tradition, shell-tradition). Confidence shown; multi-label allowed ("pressure boxer-puncher").
- Famous-fighter similarity: cosine similarity vs. hand-built archetype vectors of public fighters' *measurable tendencies*; entertainment framing ("Style DNA: 62% pressure — closest pro archetype: Julio César Chávez school"). Guardrails in [03](03-FEASIBILITY.md) §7 and [10](10-SECURITY-PRIVACY.md) §6.
- Style feeds coaching individualization (§1.5) and drill selection; it is advisory, never a cage ("your build favors X — want to lean in or round out?").
- Later: learned embeddings over session archives once the dataset supports it ([07](07-DATA-STRATEGY-MLOPS.md)).

## 6. LLM integration (Claude) — the voice, never the referee

**Contract:** deterministic engine computes every number, fault, priority, and drill candidate list. Claude receives structured JSON (session metrics, prioritized faults with evidence, fighter model deltas, drill candidates, style, goals) and produces: film-study narrative, cue phrasing, plan rationale, Q&A chat over the fighter's own data. Claude may *select and sequence* from the drill candidate list; it may not invent metrics, faults, drills, or medical advice.

Safety rails: output schema validation (CoachOutput v1, [04](04-SYSTEM-ARCHITECTURE.md) §6); numeric echo-check (any number in prose must appear in input JSON, else regenerate); tone system ("firm-encouraging trainer", user-tunable intensity); refusal templates for medical/weight-cut questions → deterministic disclaimers. Prompts + few-shots version-controlled with eval suite ([07](07-DATA-STRATEGY-MLOPS.md) §6).

Why this split (vs. LLM-does-analysis): trust (a coach that hallucinates one fake stat is dead), testability, cost, latency, and offline capability (Tier-1 cues are template-based, no LLM needed live; template library authored *with* Claude at design time, shipped static).

## 7. Prescription: drills, workouts, plans

- **Drill library:** structured records (id, name, targets faults[], equipment, space, duration, difficulty ramp, video demo, *measurable success criterion* — e.g., mirror_return_high passes when guard-recovery p75 < 450 ms). Authored with the coach panel; every fault's fixes reference real library entries.
- **Session generator:** goals + available time/equipment + prioritized faults + periodization state → structured workout (warmup, technique block targeting the primary fault, conditioning block, cooldown), rendered as guided rounds with the app coaching *during* the drill (prompt-response design from [03](03-FEASIBILITY.md) §6 — the app calls the drill and scores compliance live).
- **Periodization:** lightweight weekly microcycles (technique/volume/intensity balance), monthly focus arcs from the fighter model, deload weeks on volume signals; daily/weekly/monthly goals surfaced through gamification ([09](09-APP-EXPERIENCE.md)). If user declares a fight date: simple camp taper template (with amateur-appropriate conservatism and disclaimers).
- Mitt/pad routines & sparring objectives: generated as *partner scripts* (printable/shareable card for the human partner) — the app can't hold pads, but it can direct the person who does, then analyze the footage (Phase 3).

## 8. Human expertise pipeline

- Retain 2–3 credentialed coaches (advisor equity/fee) from Phase 1: validate taxonomy thresholds, author drills, review coach-output transcripts monthly, veto anything that smells wrong.
- "Coach review" eval: sample of real session reports blind-graded by the panel vs. a human-coach-written report; gap analysis drives taxonomy/prompt iteration. Target: panel rates ≥80% of app reports "useful and technically correct" by Phase-2 exit ([11](11-ROADMAP.md)).
