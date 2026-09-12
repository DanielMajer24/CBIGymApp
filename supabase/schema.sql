-- CBI Strength & Conditioning PWA schema
-- Run this complete file in a new Supabase project's SQL editor.
-- It deliberately does not use the legacy Streamlit tables.

create extension if not exists pgcrypto;

create type public.profile_role as enum ('athlete', 'coach');
create type public.workout_status as enum ('not_started', 'in_progress', 'completed');
create type public.tracking_type as enum (
  'weight_reps', 'reps_only', 'duration', 'distance', 'height', 'power',
  'conditioning', 'custom'
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  role public.profile_role not null default 'athlete',
  first_name text not null check (char_length(trim(first_name)) > 0),
  last_name text not null,
  name text generated always as (trim(first_name || ' ' || last_name)) stored not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Secrets used by server-side helper functions. There are deliberately no
-- direct grants or RLS policies for this table.
create table public.app_settings (
  setting_key text primary key,
  setting_value text not null,
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age_group text not null check (age_group in ('U12', 'U14', 'U16', 'U18')),
  unique (age_group, name),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.athlete_teams (
  athlete_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  created_at timestamptz not null default now(),
  primary key (athlete_id, team_id)
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'Other',
  tracking_type public.tracking_type not null default 'weight_reps',
  default_instructions text,
  video_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.session_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  session_type text check (session_type is null or session_type in ('strength', 'power', 'conditioning', 'recovery', 'court', 'custom')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prescriptions are deliberately stored as one row per exercise, not one row per set.
create table public.template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.session_templates(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  position integer not null check (position > 0),
  superset_group text check (superset_group is null or superset_group ~ '^[A-Z0-9]{1,8}$'),
  exercise_name text not null,
  tracking_type public.tracking_type not null,
  sets integer not null default 3 check (sets between 1 and 30),
  prescribed_reps numeric(7,2),
  prescribed_load_kg numeric(7,2),
  prescribed_percent numeric(5,2),
  target_rpe numeric(3,1) check (target_rpe between 0 and 10),
  target_rir numeric(3,1) check (target_rir between 0 and 10),
  tempo text,
  rest_seconds integer check (rest_seconds >= 0),
  coach_notes text,
  instructions text,
  video_url text,
  custom_unit text,
  unique (template_id, position)
);

create table public.programmed_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  name text not null,
  description text,
  session_type text check (session_type is null or session_type in ('strength', 'power', 'conditioning', 'recovery', 'court', 'custom')),
  estimated_duration_minutes integer check (estimated_duration_minutes > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.programmed_sessions(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  position integer not null check (position > 0),
  superset_group text check (superset_group is null or superset_group ~ '^[A-Z0-9]{1,8}$'),
  exercise_name text not null,
  tracking_type public.tracking_type not null,
  sets integer not null default 3 check (sets between 1 and 30),
  prescribed_reps numeric(7,2),
  prescribed_load_kg numeric(7,2),
  prescribed_percent numeric(5,2),
  target_rpe numeric(3,1) check (target_rpe between 0 and 10),
  target_rir numeric(3,1) check (target_rir between 0 and 10),
  tempo text,
  rest_seconds integer check (rest_seconds >= 0),
  coach_notes text,
  instructions text,
  video_url text,
  custom_unit text,
  unique (session_id, position)
);

create table public.session_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.programmed_sessions(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id),
  assigned_team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (session_id, athlete_id)
);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id),
  session_id uuid not null references public.programmed_sessions(id),
  session_date date not null,
  session_name text not null,
  session_description text,
  session_type text check (session_type is null or session_type in ('strength', 'power', 'conditioning', 'recovery', 'court', 'custom')),
  estimated_duration_minutes integer,
  status public.workout_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  session_rpe numeric(3,1) check (session_rpe between 0 and 10),
  athlete_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, session_id),
  check ((status <> 'completed') or completed_at is not null)
);

-- These snapshot both the exercise label and prescription at start time. They
-- remain correct even after a coach changes a library exercise or session.
create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs(id) on delete cascade,
  source_session_exercise_id uuid,
  exercise_id uuid,
  position integer not null,
  superset_group text check (superset_group is null or superset_group ~ '^[A-Z0-9]{1,8}$'),
  exercise_name text not null,
  tracking_type public.tracking_type not null,
  sets integer not null,
  prescribed_reps numeric(7,2),
  prescribed_load_kg numeric(7,2),
  prescribed_percent numeric(5,2),
  target_rpe numeric(3,1),
  target_rir numeric(3,1),
  tempo text,
  rest_seconds integer,
  coach_notes text,
  instructions text,
  video_url text,
  custom_unit text,
  created_at timestamptz not null default now(),
  unique (workout_log_id, position)
);

create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  load_kg numeric(7,2),
  reps numeric(7,2),
  rpe numeric(3,1) check (rpe between 0 and 10),
  duration_seconds numeric(8,2),
  distance_m numeric(9,2),
  height_cm numeric(8,2),
  power_watts numeric(8,2),
  value numeric(9,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workout_exercise_id, set_number)
);

create index session_assignments_athlete_idx on public.session_assignments (athlete_id, session_id);
create index programmed_sessions_date_idx on public.programmed_sessions (session_date);
create index workout_logs_athlete_date_idx on public.workout_logs (athlete_id, session_date desc);
create index workout_exercises_exercise_idx on public.workout_exercises (exercise_id, workout_log_id);
create index set_logs_workout_exercise_idx on public.set_logs (workout_exercise_id, set_number);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger app_settings_updated_at before update on public.app_settings for each row execute function public.set_updated_at();
create trigger teams_updated_at before update on public.teams for each row execute function public.set_updated_at();
create trigger exercises_updated_at before update on public.exercises for each row execute function public.set_updated_at();
create trigger templates_updated_at before update on public.session_templates for each row execute function public.set_updated_at();
create trigger sessions_updated_at before update on public.programmed_sessions for each row execute function public.set_updated_at();
create trigger workout_logs_updated_at before update on public.workout_logs for each row execute function public.set_updated_at();
create trigger set_logs_updated_at before update on public.set_logs for each row execute function public.set_updated_at();

-- A coach is an authenticated Supabase user whose linked profile has coach role.
create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid() and role = 'coach' and active
  );
$$;

-- An age-group code is a simple access deterrent, not an athlete identity.
-- The clear-text value never leaves these functions or appears in browser code.
create or replace function public.verify_athlete_entry_pin(p_age_group text, p_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare stored_hash text;
begin
  if p_age_group is null or p_age_group not in ('U12', 'U14', 'U16', 'U18') or p_pin is null or p_pin !~ '^[0-9]{4}$' then return false; end if;
  select setting_value into stored_hash
  from public.app_settings where setting_key = 'athlete_entry_pin_hash_' || lower(p_age_group);
  return stored_hash is not null and crypt(p_pin, stored_hash) = stored_hash;
end;
$$;

create or replace function public.set_athlete_entry_pin(p_age_group text, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  if p_age_group is null or p_age_group not in ('U12', 'U14', 'U16', 'U18') then raise exception 'Choose a valid age group'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'Entry code must be exactly four digits'; end if;
  insert into public.app_settings (setting_key, setting_value)
  values ('athlete_entry_pin_hash_' || lower(p_age_group), crypt(p_pin, gen_salt('bf', 10)))
  on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_at = now();
end;
$$;

-- The only public write entry point for starting a workout. It atomically
-- prevents duplicate logs and snapshots the session prescription.
create or replace function public.start_or_resume_workout(
  p_athlete_id uuid, p_session_id uuid
) returns public.workout_logs
language plpgsql security definer set search_path = public as $$
declare created_log public.workout_logs;
begin
  if not exists (select 1 from public.profiles where id = p_athlete_id and role = 'athlete' and active) then
    raise exception 'Unknown or inactive athlete';
  end if;
  if not exists (select 1 from public.session_assignments where athlete_id = p_athlete_id and session_id = p_session_id) then
    raise exception 'This session is not assigned to that athlete';
  end if;

  insert into public.workout_logs (
    athlete_id, session_id, session_date, session_name, session_description,
    session_type, estimated_duration_minutes, status
  )
  select p_athlete_id, s.id, s.session_date, s.name, s.description,
         s.session_type, s.estimated_duration_minutes, 'in_progress'
  from public.programmed_sessions s where s.id = p_session_id
  on conflict (athlete_id, session_id) do update set updated_at = now()
  returning * into created_log;

  insert into public.workout_exercises (
    workout_log_id, source_session_exercise_id, exercise_id, position, superset_group,
    exercise_name, tracking_type, sets, prescribed_reps, prescribed_load_kg,
    prescribed_percent, target_rpe, target_rir, tempo, rest_seconds,
    coach_notes, instructions, video_url, custom_unit
  )
  select created_log.id, se.id, se.exercise_id, se.position, se.superset_group, se.exercise_name,
    se.tracking_type, se.sets, se.prescribed_reps, se.prescribed_load_kg,
    se.prescribed_percent, se.target_rpe, se.target_rir, se.tempo,
    se.rest_seconds, se.coach_notes, se.instructions, se.video_url, se.custom_unit
  from public.session_exercises se where se.session_id = p_session_id
  on conflict (workout_log_id, position) do nothing;

  return created_log;
end;
$$;

create or replace function public.finish_workout(
  p_workout_log_id uuid, p_session_rpe numeric, p_notes text
) returns public.workout_logs
language plpgsql security definer set search_path = public as $$
declare result public.workout_logs;
begin
  update public.workout_logs set status = 'completed', completed_at = now(),
    session_rpe = p_session_rpe, athlete_notes = p_notes
  where id = p_workout_log_id and status <> 'completed'
  returning * into result;
  if result.id is null then
    select * into result from public.workout_logs where id = p_workout_log_id;
  end if;
  return result;
end;
$$;

create or replace function public.last_exercise_sets(
  p_athlete_id uuid, p_exercise_id uuid, p_exclude_log_id uuid default null
) returns table(session_date date, exercise_name text, set_number integer,
  load_kg numeric, reps numeric, rpe numeric, duration_seconds numeric,
  distance_m numeric, height_cm numeric, power_watts numeric, value numeric)
language sql stable security definer set search_path = public as $$
  with latest as (
    select we.id, wl.session_date, we.exercise_name
    from public.workout_exercises we
    join public.workout_logs wl on wl.id = we.workout_log_id
    where wl.athlete_id = p_athlete_id and we.exercise_id = p_exercise_id
      and wl.status = 'completed' and (p_exclude_log_id is null or wl.id <> p_exclude_log_id)
    order by wl.session_date desc, wl.completed_at desc limit 1
  ) select l.session_date, l.exercise_name, sl.set_number, sl.load_kg, sl.reps,
    sl.rpe, sl.duration_seconds, sl.distance_m, sl.height_cm, sl.power_watts, sl.value
  from latest l join public.set_logs sl on sl.workout_exercise_id = l.id
  order by sl.set_number;
$$;

create or replace function public.exercise_history(p_athlete_id uuid, p_exercise_id uuid)
returns table(session_date date, summary text)
language sql stable security definer set search_path = public as $$
  select wl.session_date,
    string_agg(concat_ws(' × ', nullif(sl.load_kg::text, ''), nullif(sl.reps::text, ''),
      nullif(sl.value::text, '')), ' · ' order by sl.set_number) as summary
  from public.workout_logs wl
  join public.workout_exercises we on we.workout_log_id = wl.id
  join public.set_logs sl on sl.workout_exercise_id = we.id
  where wl.athlete_id = p_athlete_id and we.exercise_id = p_exercise_id and wl.status = 'completed'
  group by wl.id, wl.session_date order by wl.session_date desc limit 12;
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles, public.teams, public.athlete_teams,
  public.exercises, public.session_templates, public.template_exercises,
  public.programmed_sessions, public.session_exercises, public.session_assignments,
  public.workout_logs, public.workout_exercises, public.set_logs to authenticated;
revoke all on function public.start_or_resume_workout(uuid, uuid) from public;
revoke all on function public.finish_workout(uuid, numeric, text) from public;
revoke all on function public.last_exercise_sets(uuid, uuid, uuid) from public;
revoke all on function public.exercise_history(uuid, uuid) from public;
grant execute on function public.start_or_resume_workout(uuid, uuid) to authenticated;
grant execute on function public.finish_workout(uuid, numeric, text) to authenticated;
grant execute on function public.last_exercise_sets(uuid, uuid, uuid) to authenticated;
grant execute on function public.exercise_history(uuid, uuid) to authenticated;
revoke all on function public.set_athlete_entry_pin(text, text) from public;
revoke all on function public.verify_athlete_entry_pin(text, text) from public;
grant execute on function public.verify_athlete_entry_pin(text, text) to anon, authenticated;
grant execute on function public.set_athlete_entry_pin(text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.teams enable row level security;
alter table public.athlete_teams enable row level security;
alter table public.exercises enable row level security;
alter table public.session_templates enable row level security;
alter table public.template_exercises enable row level security;
alter table public.programmed_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.session_assignments enable row level security;
alter table public.workout_logs enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.set_logs enable row level security;

-- Anonymous Auth users (created after the shared PIN) can read workout data
-- and write only active set logs. The public anon key has no table access.
create policy "athlete reads active athletes" on public.profiles for select to authenticated using (role = 'athlete' and active);
create policy "coach manages profiles" on public.profiles for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "athlete reads teams" on public.teams for select to authenticated using (active);
create policy "coach manages teams" on public.teams for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "athlete reads memberships" on public.athlete_teams for select to authenticated using (true);
create policy "coach manages memberships" on public.athlete_teams for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "athlete reads active exercises" on public.exercises for select to authenticated using (active);
create policy "coach manages exercises" on public.exercises for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "coach manages templates" on public.session_templates for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "coach manages template exercises" on public.template_exercises for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "athlete reads assigned sessions" on public.programmed_sessions for select to authenticated using (true);
create policy "coach manages sessions" on public.programmed_sessions for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "athlete reads session exercises" on public.session_exercises for select to authenticated using (true);
create policy "coach manages session exercises" on public.session_exercises for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "athlete reads assignments" on public.session_assignments for select to authenticated using (true);
create policy "coach manages assignments" on public.session_assignments for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "athlete reads workout logs" on public.workout_logs for select to authenticated using (true);
create policy "coach reads workout logs" on public.workout_logs for all to authenticated using (public.is_coach()) with check (public.is_coach());
create policy "athlete reads workout snapshots" on public.workout_exercises for select to authenticated using (true);
create policy "athlete reads set logs" on public.set_logs for select to authenticated using (true);
create policy "athlete writes active set logs" on public.set_logs for insert to authenticated with check (
  exists (select 1 from public.workout_exercises we join public.workout_logs wl on wl.id = we.workout_log_id
    where we.id = workout_exercise_id and wl.status = 'in_progress')
);
create policy "athlete updates active set logs" on public.set_logs for update to authenticated using (
  exists (select 1 from public.workout_exercises we join public.workout_logs wl on wl.id = we.workout_log_id
    where we.id = workout_exercise_id and wl.status = 'in_progress')
) with check (
  exists (select 1 from public.workout_exercises we join public.workout_logs wl on wl.id = we.workout_log_id
    where we.id = workout_exercise_id and wl.status = 'in_progress')
);

-- Dashboard reporting needs a coach-only read of snapshots/sets.
create policy "coach reads workout snapshots" on public.workout_exercises for select to authenticated using (public.is_coach());
create policy "coach reads set logs" on public.set_logs for select to authenticated using (public.is_coach());
