# BoxingPro — AI session context

## What this project is

A boxing training & coaching platform (working assumption — see `docs/PLANNING.md`, especially the open questions, before making product decisions). Currently in the **planning phase**: no application code exists yet.

## Key documents

- `docs/PLANNING.md` — product vision, users, feature scope, open questions
- `docs/ROADMAP.md` — phased build order; Phase 0 (scaffolding) is next
- `docs/ARCHITECTURE.md` — proposed stack: Next.js + TypeScript + Tailwind, Supabase, Vercel

## Working rules

- Don't start Phase 1 features until the open questions in PLANNING.md are answered by the owner.
- When scaffolding begins: Next.js App Router + TypeScript + Tailwind; Supabase for DB/auth/storage; deploy on Vercel.
- Database schema changes go through Supabase migrations committed to `supabase/migrations/` — never ad-hoc dashboard edits.
- Keep `main` deployable; develop on feature branches.
- Update the roadmap checkboxes and this file as phases complete.
