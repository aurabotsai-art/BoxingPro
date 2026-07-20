# BoxingPro — Roadmap

Phases are sequential; each ends in something deployed and usable. Timeboxes are rough and assume part-time, AI-assisted development.

## Phase 0 — Confirm & scaffold (now)

- [x] Repository created
- [x] Planning docs (this folder)
- [ ] Owner confirms product direction ([open questions](PLANNING.md#6-open-questions))
- [ ] Create Supabase project and Vercel project, wire environments
- [ ] Scaffold Next.js + TypeScript + Tailwind app with CI (lint, typecheck, build)

## Phase 1 — MVP: solo fighter experience (~2–4 weeks)

- [ ] Supabase Auth: email/password + OAuth sign-in, fighter profile
- [ ] Data model: profiles, workouts, programs, sessions (see ARCHITECTURE.md)
- [ ] Seed workout library (~20 workouts across bag work, shadowboxing, footwork, conditioning)
- [ ] Program builder: assemble weekly plans from workouts
- [ ] Session logging with round/intensity/notes
- [ ] Progress dashboard: streaks, weekly volume, weight log
- [ ] Responsive layout, deployed to production on Vercel

**Exit criteria:** a stranger can sign up and complete a full train-log-review loop on their phone.

## Phase 2 — Coaching layer (~2–3 weeks)

- [ ] Coach role and coach–fighter invitations
- [ ] Coaches assign programs and view athlete logs
- [ ] Feedback/comments on sessions
- [ ] Built-in round timer for guided sessions
- [ ] Technique video library (hosted via Supabase Storage or embeds)

## Phase 3 — Growth & depth

- [ ] Gym/team spaces and class schedules
- [ ] Challenges and leaderboards
- [ ] Wearable / heart-rate data import
- [ ] Subscription billing (Stripe) if monetizing
- [ ] Evaluate native mobile (Expo/React Native) based on usage

## Working agreements

- `main` stays deployable; feature work on branches, merged via PR.
- Every phase ships behind real deployment, not just local dev.
- Schema changes go through Supabase migrations checked into the repo.
