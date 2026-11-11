-- Apply to STAGING first, after migration 007 (or the current base schema).
-- No new tables or wider set_logs RLS grants. Measurements remain separate from
-- immutable prescription snapshots. See docs/STAGING_IMPLEMENTATION.md.
begin;

create or replace function public.save_workout(
  p_workout_log_id uuid, p_athlete_id uuid, p_sets jsonb,
  p_expected_updated_at timestamptz, p_complete boolean default false,
  p_session_rpe numeric default null, p_notes text default null
) returns public.workout_logs
language plpgsql security definer set search_path = public as $$
declare result public.workout_logs; same_sets boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- The existing shared-profile model is intentional. Honour individual Auth
  -- linkage when present; a client-provided athlete ID is not itself identity.
  if not exists (select 1 from public.profiles where id = p_athlete_id
      and role = 'athlete' and active
      and (auth_user_id is null or auth_user_id = auth.uid())) then
    raise exception 'Athlete access required' using errcode = '42501';
  end if;
  select * into result from public.workout_logs
    where id = p_workout_log_id and athlete_id = p_athlete_id for update;
  if result.id is null then
    raise exception 'Workout not available for this athlete' using errcode = '42501';
  end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' then
    raise exception 'Sets must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_sets) > 1000 or octet_length(p_sets::text) > 500000
      or p_complete is null or p_expected_updated_at is null
      or p_session_rpe < 0 or p_session_rpe > 10
      or char_length(p_notes) > 10000 then
    raise exception 'Invalid workout values' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sets) e where jsonb_typeof(e) <> 'object') then
    raise exception 'Invalid set' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sets) e, jsonb_object_keys(e) k
    where k not in ('workout_exercise_id','set_number','load_kg','reps','rpe',
      'duration_seconds','distance_m','height_cm','power_watts','value','notes')) then
    raise exception 'Unexpected set field' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_sets) as s(workout_exercise_id uuid, set_number integer)
    left join public.workout_exercises we on we.id = s.workout_exercise_id
    where we.id is null or we.workout_log_id <> result.id
      or s.set_number is null or s.set_number < 1 or s.set_number > we.sets
  ) or exists (
    select 1 from jsonb_to_recordset(p_sets) as s(workout_exercise_id uuid, set_number integer)
    group by workout_exercise_id, set_number having count(*) > 1
  ) then
    raise exception 'Set does not belong to this workout or is duplicated' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sets) e, jsonb_each(e) f
    where f.key not in ('workout_exercise_id','set_number','notes')
      and f.value <> 'null'::jsonb
      and (jsonb_typeof(f.value) <> 'number' or f.value::text::numeric < 0)) then
    raise exception 'Measurements must be nonnegative numbers' using errcode = '22023';
  end if;
  select not exists (
    select 1 from jsonb_array_elements(p_sets) e
    left join public.set_logs sl on sl.workout_exercise_id = (e->>'workout_exercise_id')::uuid
      and sl.set_number = (e->>'set_number')::integer
    where sl.id is null or not (to_jsonb(sl) @> e)
  ) into same_sets;
  if result.updated_at is distinct from p_expected_updated_at then
    -- A committed request whose response was lost can be retried safely.
    if same_sets and (not p_complete or (result.status = 'completed'
        and result.session_rpe is not distinct from p_session_rpe
        and result.athlete_notes is not distinct from p_notes)) then return result; end if;
    raise exception 'Workout changed on another device. Review saved results before retrying.' using errcode = '40001';
  end if;
  if result.status = 'completed' and not p_complete then
    if same_sets then return result; end if;
    raise exception 'Use Save changes to edit a completed workout' using errcode = '22023';
  end if;

  insert into public.set_logs (workout_exercise_id,set_number,load_kg,reps,rpe,
      duration_seconds,distance_m,height_cm,power_watts,value,notes)
  select s.workout_exercise_id,s.set_number,s.load_kg,s.reps,s.rpe,
      s.duration_seconds,s.distance_m,s.height_cm,s.power_watts,s.value,s.notes
  from jsonb_array_elements(p_sets) e
  left join public.set_logs old on old.workout_exercise_id=(e->>'workout_exercise_id')::uuid
    and old.set_number=(e->>'set_number')::integer
  cross join lateral jsonb_populate_record(null::public.set_logs, coalesce(to_jsonb(old),'{}'::jsonb) || e) s
  on conflict (workout_exercise_id,set_number) do update set
    -- The row was merged above: omitted fields survive; explicit null clears.
    load_kg=excluded.load_kg, reps=excluded.reps, rpe=excluded.rpe,
    duration_seconds=excluded.duration_seconds, distance_m=excluded.distance_m,
    height_cm=excluded.height_cm, power_watts=excluded.power_watts,
    value=excluded.value, notes=excluded.notes;

  update public.workout_logs set
    status = case when p_complete then 'completed'::public.workout_status else status end,
    completed_at = case when p_complete then coalesce(completed_at, now()) else completed_at end,
    session_rpe = case when p_complete then p_session_rpe else session_rpe end,
    athlete_notes = case when p_complete then p_notes else athlete_notes end,
    updated_at = now()
  where id = result.id returning * into result;
  return result;
end;
$$;
revoke all on function public.save_workout(uuid,uuid,jsonb,timestamptz,boolean,numeric,text) from public, anon;
grant execute on function public.save_workout(uuid,uuid,jsonb,timestamptz,boolean,numeric,text) to authenticated;

-- Existing snapshots must not acquire newly programmed exercises on resume.
create or replace function public.start_or_resume_workout(p_athlete_id uuid, p_session_id uuid)
returns public.workout_logs language plpgsql security definer set search_path = public as $$
declare created_log public.workout_logs;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles
    where id=p_athlete_id and role='athlete' and active
      and (auth_user_id is null or auth_user_id=auth.uid())) then
    raise exception 'Athlete access required' using errcode='42501';
  end if;
  select * into created_log from public.workout_logs
    where athlete_id=p_athlete_id and session_id=p_session_id;
  if found then return created_log; end if;
  if not exists (select 1 from public.session_assignments where athlete_id=p_athlete_id and session_id=p_session_id) then
    raise exception 'This session is not assigned to that athlete' using errcode='42501';
  end if;
  insert into public.workout_logs (athlete_id,session_id,session_date,session_name,
    session_description,session_type,estimated_duration_minutes,status)
  select p_athlete_id,id,session_date,name,description,session_type,estimated_duration_minutes,'in_progress'
    from public.programmed_sessions where id=p_session_id
    on conflict (athlete_id,session_id) do nothing returning * into created_log;
  if created_log.id is null then
    select * into created_log from public.workout_logs where athlete_id=p_athlete_id and session_id=p_session_id;
    return created_log;
  end if;
  insert into public.workout_exercises (workout_log_id,source_session_exercise_id,exercise_id,
    position,superset_group,exercise_name,tracking_type,sets,prescribed_reps,prescribed_load_kg,
    prescribed_percent,target_rpe,target_rir,tempo,rest_seconds,coach_notes,instructions,video_url,custom_unit)
  select created_log.id,id,exercise_id,position,superset_group,exercise_name,tracking_type,sets,
    prescribed_reps,prescribed_load_kg,prescribed_percent,target_rpe,target_rir,tempo,rest_seconds,
    coach_notes,instructions,video_url,custom_unit from public.session_exercises where session_id=p_session_id;
  return created_log;
end;
$$;
commit;
