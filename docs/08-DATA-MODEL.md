# 08 — Data Model & Storage

_Postgres (Supabase) is the cloud source of truth; SQLite mirrors the user's own slice for offline-first. Schema favors: append-only session facts, versioned analysis artifacts, JSONB for fast-evolving metric payloads with typed columns for anything queried/aggregated._

## 1. Entity overview

```
auth.users ─ profiles ─┬─ fighter_body_profiles (versioned calibrations)
                       ├─ fighter_models (longitudinal state, 1 live row + history)
                       ├─ sessions ─┬─ session_artifacts (skeleton archive, video refs)
                       │            ├─ analyses (per tier, versioned) ─ events (punches/defense/steps)
                       │            │                                  └─ fault_instances
                       │            └─ coach_outputs (narratives, plans)
                       ├─ training_plans ─ plan_items ─→ drills
                       ├─ goals / streaks / xp_ledger / achievements_unlocked
                       └─ consents (versioned, auditable)
drills / faults_catalog / style_archetypes   (content tables, app-versioned)
label_tasks / label_annotations               (flywheel, isolated schema)
jobs                                          (deep-analysis queue)
```

## 2. Core tables (abbreviated DDL-intent)

```sql
profiles              id (=auth.users.id), handle, stance, level, goals jsonb,
                      coach_tone, units, created_at
fighter_body_profiles id, user_id, captured_at, height_cm, height_source,
                      reach_cm, limb_lengths jsonb, confidences jsonb,
                      scale_anchor (user_stated|reference_scan|ar_lidar), active bool
fighter_models        id, user_id, as_of, fault_curves jsonb, baselines jsonb,
                      style_fingerprint jsonb, coaching_history jsonb, version
sessions              id, user_id, mode (shadow|bag|reaction|drill|...), started_at,
                      duration_s, rounds int, framing_quality real, device jsonb,
                      capture jsonb (fps, res, thermal_events), deleted_at
session_artifacts     id, session_id, kind (skeleton_v1|video|hfr_clip),
                      storage_ref, bytes, checksum, retention_class
analyses              id, session_id, tier (live|deep_lite|deep), pipeline_versions jsonb,
                      summary jsonb (scores, aggregates), created_at
events                id, analysis_id, t_start_ms, t_end_ms, kind, class, attributes jsonb,
                      metrics jsonb (speed, extension, guard_recovery...), confidence
fault_instances       id, analysis_id, fault_id →faults_catalog, severity, frequency,
                      evidence jsonb (event_ids, timestamps), cause_estimate,
                      user_feedback (null|confirmed|wrong)      -- trust metric + labels
coach_outputs         id, session_id, kind (film_study|plan_update|chat), input_hash,
                      output jsonb (CoachOutput v1), model_version, created_at
training_plans        id, user_id, horizon (day|week|month|camp), state jsonb, active
plan_items            id, plan_id, day, drill_id, params jsonb, status,
                      result_metrics jsonb           -- closes the coaching loop
jobs                  id, user_id, session_id, kind, status, priority, payload jsonb,
                      attempts, locked_by, timestamps...
consents              id, user_id, kind (cloud_video|flywheel|leaderboard|minor_guardian),
                      granted bool, version, at    -- append-only
```

Indexing: `(user_id, started_at desc)` on sessions; `(analysis_id, kind, class)` on events; GIN on jsonb metric fields actually queried; partial index on jobs(status='queued').

## 3. Design decisions & alternatives

- **JSONB metric payloads + typed hot columns** — metric definitions will churn for years; migrating typed columns weekly is worse than JSONB with schema-versioned payloads (`metrics._v`). Anything used in leaderboards/trends gets promoted to a typed generated column when it stabilizes. Alternative (all-typed star schema) rejected for iteration speed at this stage.
- **Analyses are versioned rows, not updates** — re-running a better pipeline on an old archive appends a new analysis; history is never destroyed; "your old sessions, re-analyzed by the new coach" becomes a feature.
- **events as rows (not blob)** — per-punch queries power trends ("cross guard-recovery over 90 days"), the film scrubber, and labeling export. Volume is fine: ~500 events/session ⇒ tens of millions of rows at 10k MAU — trivial for Postgres with the right indexes; partition by month when needed.
- **fighter_models snapshot+history** — one live row for reads, history rows for "progress movie" features and debugging coaching decisions.
- **RLS everywhere**: user-scoped tables keyed by user_id with owner-only policies; content tables read-only to clients; labeling schema service-role only. Coach/gym sharing (Phase 4) adds a grants table — designed later, RLS-compatible by construction.

## 4. Storage & sync

- **Media:** Supabase Storage buckets by retention class: `skeletons/` (default sync, ~1–2 MB/session), `video/` (opt-in only, lifecycle-deleted per user setting: 7/30/∞ days), `golden/` (internal, consented, access-audited). Client uploads via signed URLs; checksums verified.
- **Offline-first sync:** local SQLite is authoritative for a device's unsynced sessions; push-based sync with idempotent upserts (session UUIDs client-generated); pull for plans/content/gamification. Conflict policy: session facts are append-only (no conflicts by design); profile/settings use last-write-wins with server timestamp. No CRDT complexity — the domain doesn't need it.
- **Local cap:** device store prunes synced media by LRU under a user-set size budget; skeleton archives kept locally for the film scrubber's instant loads.

## 5. Analytics & privacy split

Product analytics events (activation, magic-moment, retention funnels from [01](01-PRODUCT-VISION.md) §9) go to a separate analytics pipeline keyed by pseudonymous id — never raw video/keypoints, never in the operational DB. Aggregates only cross back (e.g., cohort curves). Detail in [10](10-SECURITY-PRIVACY.md).
