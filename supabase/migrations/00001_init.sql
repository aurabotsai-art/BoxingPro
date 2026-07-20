-- BoxingPro schema v1 — implements docs/08-DATA-MODEL.md.
-- RLS: deny-by-default; owner-only policies on user-scoped tables;
-- content tables readable by all authenticated users, writable by service role only.

create extension if not exists "uuid-ossp";

-- ───────────────────────── user-scoped ─────────────────────────

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  stance text check (stance in ('orthodox','southpaw','unknown')) default 'unknown',
  level text check (level in ('novice','intermediate','advanced','competitive')) default 'novice',
  goals jsonb not null default '{}',
  coach_tone text not null default 'technician',
  units text not null check (units in ('metric','imperial')) default 'metric',
  created_at timestamptz not null default now()
);

create table fighter_body_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  captured_at timestamptz not null default now(),
  height_cm real,
  height_source text check (height_source in ('user_stated','reference_scan','ar_lidar')),
  reach_cm real,
  limb_lengths jsonb not null default '{}',
  confidences jsonb not null default '{}',
  scale_anchor text not null check (scale_anchor in ('user_stated','reference_scan','ar_lidar','uncalibrated')),
  active boolean not null default true
);

create table fighter_models (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  as_of timestamptz not null default now(),
  fault_curves jsonb not null default '{}',
  baselines jsonb not null default '{}',
  style_fingerprint jsonb not null default '{}',
  coaching_history jsonb not null default '{}',
  version int not null default 1,
  is_live boolean not null default true
);

create table sessions (
  id uuid primary key,                    -- client-generated for offline-first idempotency
  user_id uuid not null references profiles(id) on delete cascade,
  mode text not null check (mode in ('shadowboxing','reaction','technique','bag','footwork','conditioning','drill')),
  started_at timestamptz not null,
  duration_s int not null default 0,
  rounds int not null default 0,
  framing_quality real,
  device jsonb not null default '{}',
  capture jsonb not null default '{}',   -- fps, resolution, thermal_events
  deleted_at timestamptz
);
create index sessions_user_time on sessions (user_id, started_at desc);

create table session_artifacts (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  kind text not null check (kind in ('skeleton_v1','video','hfr_clip')),
  storage_ref text not null,
  bytes bigint not null default 0,
  checksum text,
  retention_class text not null check (retention_class in ('default','opt_in_video','golden')) default 'default',
  created_at timestamptz not null default now()
);

create table analyses (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  tier text not null check (tier in ('live','deep_lite','deep')),
  pipeline_versions jsonb not null,      -- metrics_core, classifier, fault_taxonomy, pose_model…
  summary jsonb not null default '{}',   -- SessionAnalysis v1 aggregates
  created_at timestamptz not null default now()
);
create index analyses_session on analyses (session_id, tier, created_at desc);

create table events (
  id uuid primary key default uuid_generate_v4(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  t_start_ms double precision not null,
  t_end_ms double precision not null,
  kind text not null check (kind in ('strike','defense','step','guard_sample','round_boundary')),
  class text,
  class_confidence real,
  attributes jsonb not null default '{}',
  metrics jsonb not null default '{}'    -- name → measurement (SessionAnalysis $defs)
);
create index events_analysis on events (analysis_id, kind, class);

create table fault_instances (
  id uuid primary key default uuid_generate_v4(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  fault_id text not null,                -- key into content faults taxonomy
  severity real not null check (severity between 0 and 1),
  frequency real not null,
  cause_estimate text,
  evidence jsonb not null default '{}',
  user_feedback text check (user_feedback in ('confirmed','wrong')),  -- trust metric + flywheel labels
  created_at timestamptz not null default now()
);
create index fault_instances_analysis on fault_instances (analysis_id, fault_id);

create table coach_outputs (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  kind text not null check (kind in ('film_study','plan_update','live_cue_pack','chat_reply')),
  input_hash text not null,
  output jsonb not null,                 -- CoachOutput v1
  model_version text,
  created_at timestamptz not null default now()
);

create table training_plans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  horizon text not null check (horizon in ('day','week','month','camp')),
  state jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table plan_items (
  id uuid primary key default uuid_generate_v4(),
  plan_id uuid not null references training_plans(id) on delete cascade,
  day date not null,
  drill_id text not null,
  params jsonb not null default '{}',
  status text not null check (status in ('planned','done','skipped')) default 'planned',
  result_metrics jsonb                   -- closes the coaching loop (docs/06 §4)
);

create table consents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('cloud_video','flywheel','leaderboard','minor_guardian')),
  granted boolean not null,
  version text not null,
  at timestamptz not null default now()
);                                        -- append-only: no update/delete policies below

create table jobs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  kind text not null check (kind in ('deep_analysis','reanalysis','export')),
  status text not null check (status in ('queued','running','done','failed','canceled')) default 'queued',
  priority int not null default 0,
  payload jsonb not null default '{}',
  attempts int not null default 0,
  locked_by text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_queued on jobs (priority desc, queued_at) where status = 'queued';

-- ───────────────────────── RLS ─────────────────────────

alter table profiles enable row level security;
alter table fighter_body_profiles enable row level security;
alter table fighter_models enable row level security;
alter table sessions enable row level security;
alter table session_artifacts enable row level security;
alter table analyses enable row level security;
alter table events enable row level security;
alter table fault_instances enable row level security;
alter table coach_outputs enable row level security;
alter table training_plans enable row level security;
alter table plan_items enable row level security;
alter table consents enable row level security;
alter table jobs enable row level security;

create policy own_profile on profiles for all using (id = auth.uid()) with check (id = auth.uid());

create policy own_rows on fighter_body_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on fighter_models for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on training_plans for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Child tables scope through their parent.
create policy own_via_session on session_artifacts for all
  using (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy own_via_session on analyses for all
  using (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy own_via_analysis on events for all
  using (exists (select 1 from analyses a join sessions s on s.id = a.session_id
                 where a.id = analysis_id and s.user_id = auth.uid()))
  with check (exists (select 1 from analyses a join sessions s on s.id = a.session_id
                 where a.id = analysis_id and s.user_id = auth.uid()));
create policy own_via_analysis on fault_instances for all
  using (exists (select 1 from analyses a join sessions s on s.id = a.session_id
                 where a.id = analysis_id and s.user_id = auth.uid()))
  with check (exists (select 1 from analyses a join sessions s on s.id = a.session_id
                 where a.id = analysis_id and s.user_id = auth.uid()));
create policy own_via_session on coach_outputs for all
  using (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy own_via_plan on plan_items for all
  using (exists (select 1 from training_plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from training_plans p where p.id = plan_id and p.user_id = auth.uid()));

-- Consents: user can read and insert; never update/delete (append-only audit).
create policy consents_read on consents for select using (user_id = auth.uid());
create policy consents_insert on consents for insert with check (user_id = auth.uid());

-- Jobs: user may read own and enqueue own; workers use service role.
create policy jobs_read on jobs for select using (user_id = auth.uid());
create policy jobs_insert on jobs for insert with check (user_id = auth.uid());
