-- Apply this migration to an existing CBI Performance Supabase project.
-- New projects receive these fields from supabase/schema.sql automatically.

alter table public.template_exercises
  add column if not exists superset_group text
  check (superset_group is null or superset_group ~ '^[A-Z0-9]{1,8}$');

alter table public.session_exercises
  add column if not exists superset_group text
  check (superset_group is null or superset_group ~ '^[A-Z0-9]{1,8}$');

alter table public.workout_exercises
  add column if not exists superset_group text
  check (superset_group is null or superset_group ~ '^[A-Z0-9]{1,8}$');

-- Replace the start function so the coach's superset pairing is preserved in
-- the immutable athlete workout snapshot.
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
    estimated_duration_minutes, status
  )
  select p_athlete_id, s.id, s.session_date, s.name, s.description,
         s.estimated_duration_minutes, 'in_progress'
  from public.programmed_sessions s where s.id = p_session_id
  on conflict (athlete_id, session_id) do update set updated_at = now()
  returning * into created_log;

  insert into public.workout_exercises (
    workout_log_id, source_session_exercise_id, exercise_id, position, superset_group,
    exercise_name, tracking_type, sets, prescribed_reps, prescribed_load_kg,
    prescribed_percent, target_rpe, target_rir, tempo, rest_seconds,
    coach_notes, instructions, video_url, custom_unit
  )
  select created_log.id, se.id, se.exercise_id, se.position, se.superset_group,
    se.exercise_name, se.tracking_type, se.sets, se.prescribed_reps,
    se.prescribed_load_kg, se.prescribed_percent, se.target_rpe, se.target_rir,
    se.tempo, se.rest_seconds, se.coach_notes, se.instructions, se.video_url,
    se.custom_unit
  from public.session_exercises se where se.session_id = p_session_id
  on conflict (workout_log_id, position) do nothing;

  return created_log;
end;
$$;
