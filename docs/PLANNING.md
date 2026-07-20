# BoxingPro — Product Planning

_Last updated: 2026-07-20 · Status: draft, awaiting owner review_

## 1. Working assumption

"BoxingPro" is interpreted as a **boxing training & coaching platform**: an app where fighters follow structured training, track progress, and optionally connect with coaches or a gym. This is an assumption — see [Open questions](#6-open-questions) before committing to build.

Alternative interpretations to rule out explicitly:

- A **gym management** tool (memberships, class schedules, billing)
- A **fight analytics / prediction** product (fighters, bouts, odds, stats)
- A **content/media** product (tutorials, courses, pay-per-view)

The current plan centers on training + coaching, with gym features as a later phase.

## 2. Target users

| User | Core need |
|------|-----------|
| Amateur/hobbyist boxer | Structured programs, technique guidance, progress tracking |
| Competitive fighter | Fight-camp planning, conditioning metrics, weight management |
| Coach | Assign programs, monitor athletes, give feedback |
| Gym owner (later) | Roster, classes, membership management |

## 3. Feature scope

### MVP (Phase 1)

- Account creation and profiles (fighter or coach role)
- Workout library: bag work, shadowboxing, footwork, conditioning, sparring prep
- Program builder: multi-week plans composed of workouts
- Session logging: completed workouts, rounds, intensity, notes
- Basic progress dashboard: streaks, volume, weight over time

### Phase 2

- Coach–fighter linking: coaches assign programs and review logs
- Technique video library with drill breakdowns
- Timers: round/rest interval timer built into sessions

### Phase 3+

- Gym/team spaces, class scheduling
- Community features (challenges, leaderboards)
- Wearable/HR integrations
- Monetization: subscriptions for premium programs or coach tools

### Explicitly out of scope (for now)

- Live video coaching / streaming
- Betting or odds of any kind
- Native mobile apps (start responsive-web-first; revisit after MVP)

## 4. Success criteria for MVP

- A fighter can sign up, pick or build a program, log sessions, and see progress — end to end without a coach involved.
- A returning user can log a session in under 30 seconds.
- Deployed and usable on mobile browsers.

## 5. Risks

- **Scope ambiguity** — the product concept is assumed, not confirmed (biggest risk; resolve first).
- **Content cost** — a workout/technique library needs real curated content; MVP should ship with a small seed set.
- **Retention** — habit-tracking apps live or die on friction; keep logging trivially fast.

## 6. Open questions (need owner answers)

1. Is the training/coaching interpretation correct, or is BoxingPro one of the alternatives above?
2. Web-first acceptable, or is mobile-native a hard requirement?
3. Single-user (fighters only) MVP, or must coaches be in from day one?
4. Any existing brand, designs, or content to incorporate?
5. Monetization intent — free, freemium, or paid from the start?
