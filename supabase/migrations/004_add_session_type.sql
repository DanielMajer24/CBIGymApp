-- Add an explicit coach-selected session type. Workout logs retain a snapshot
-- so changing a program later cannot recolour historical training records.

alter table public.session_templates
  add column if not exists session_type text;
alter table public.programmed_sessions
  add column if not exists session_type text;
alter table public.workout_logs
  add column if not exists session_type text;

alter table public.session_templates
  drop constraint if exists session_templates_session_type_check,
  add constraint session_templates_session_type_check
    check (session_type is null or session_type in ('strength', 'power', 'conditioning', 'recovery', 'court', 'custom'));
alter table public.programmed_sessions
  drop constraint if exists programmed_sessions_session_type_check,
  add constraint programmed_sessions_session_type_check
    check (session_type is null or session_type in ('strength', 'power', 'conditioning', 'recovery', 'court', 'custom'));
alter table public.workout_logs
  drop constraint if exists workout_logs_session_type_check,
  add constraint workout_logs_session_type_check
    check (session_type is null or session_type in ('strength', 'power', 'conditioning', 'recovery', 'court', 'custom'));

-- Preserve the original calendar behaviour for existing data once, then use
-- the new field rather than guessing from titles at runtime.
update public.session_templates
set session_type = case
  when lower(concat_ws(' ', name, description)) ~ '(power|speed|plyo|jump|sprint)' then 'power'
  when lower(concat_ws(' ', name, description)) ~ '(condition|engine|aerobic|bike|fitness|metcon)' then 'conditioning'
  when lower(concat_ws(' ', name, description)) ~ '(recover|mobility|rehab|prehab|restore)' then 'recovery'
  when lower(concat_ws(' ', name, description)) ~ '(skill|court|shoot|basketball|game)' then 'court'
  else 'strength'
end
where session_type is null;

update public.programmed_sessions
set session_type = case
  when lower(concat_ws(' ', name, description)) ~ '(power|speed|plyo|jump|sprint)' then 'power'
  when lower(concat_ws(' ', name, description)) ~ '(condition|engine|aerobic|bike|fitness|metcon)' then 'conditioning'
  when lower(concat_ws(' ', name, description)) ~ '(recover|mobility|rehab|prehab|restore)' then 'recovery'
  when lower(concat_ws(' ', name, description)) ~ '(skill|court|shoot|basketball|game)' then 'court'
  else 'strength'
end
where session_type is null;

update public.workout_logs
set session_type = case
  when lower(concat_ws(' ', session_name, session_description)) ~ '(power|speed|plyo|jump|sprint)' then 'power'
  when lower(concat_ws(' ', session_name, session_description)) ~ '(condition|engine|aerobic|bike|fitness|metcon)' then 'conditioning'
  when lower(concat_ws(' ', session_name, session_description)) ~ '(recover|mobility|rehab|prehab|restore)' then 'recovery'
  when lower(concat_ws(' ', session_name, session_description)) ~ '(skill|court|shoot|basketball|game)' then 'court'
  else 'strength'
end
where session_type is null;

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
