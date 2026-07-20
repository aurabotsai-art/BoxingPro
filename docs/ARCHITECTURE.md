# BoxingPro — Proposed Architecture

_Draft — validate against PLANNING.md decisions before building._

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js (App Router) + TypeScript | Full-stack React, server components, great Vercel fit |
| Styling | Tailwind CSS | Fast iteration, consistent design tokens |
| Database | Supabase Postgres | Relational fit for programs/sessions; RLS for per-user data |
| Auth | Supabase Auth | Email + OAuth out of the box, integrates with RLS |
| Storage | Supabase Storage | Technique videos, profile images |
| Hosting | Vercel | Preview deploys per PR, zero-ops |

Both Supabase and Vercel are already connected to the owner's tooling, which keeps provisioning and deploys inside the assistant workflow.

## Initial data model (Phase 1)

```
profiles      id (= auth.users.id), display_name, role (fighter|coach), stance,
              weight_class, created_at
workouts      id, title, category (bag|shadow|footwork|conditioning|sparring),
              description, rounds, round_seconds, rest_seconds, level, is_public,
              created_by
programs      id, title, description, weeks, created_by, is_public
program_items id, program_id, week, day, workout_id, order
sessions      id, user_id, workout_id (nullable for freeform), performed_at,
              rounds_completed, intensity (1-10), duration_seconds, notes
weight_logs   id, user_id, logged_at, weight_kg
```

Phase 2 adds: `coach_links (coach_id, fighter_id, status)`, `assignments`, `session_comments`, `videos`.

### Row-level security

- Users read/write only their own `sessions`, `weight_logs`, private `programs`.
- Public `workouts`/`programs` readable by all authenticated users.
- Phase 2: coaches gain read access to linked fighters' sessions via `coach_links`.

## Application structure

```
app/
  (auth)/         sign-in, sign-up
  (app)/          authenticated shell
    dashboard/    progress overview
    workouts/     library + detail
    programs/     browse, build, follow
    sessions/     log + history
lib/
  supabase/       client helpers, generated types
  ...
supabase/
  migrations/     SQL migrations (checked in)
```

## Conventions

- Migrations via Supabase CLI, committed to `supabase/migrations/`.
- Generated DB types (`supabase gen types`) checked in and used across the app.
- CI on every PR: lint, typecheck, build. Vercel preview deploy per PR.
- Environment variables documented in `.env.example` (never commit real keys).
