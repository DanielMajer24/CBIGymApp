-- Fix: duplicating a training period ignored team scope entirely. A coach
-- who opened the duplicator intending to copy one team's sessions got every
-- session scheduled in the date range, across every team, because the only
-- team parameter (p_destination_team_id) reassigns the new copies — it never
-- filtered which source sessions were read. Add p_source_team_id so a coach
-- can filter to a team before duplicating.
begin;

drop function if exists public.preview_training_period_duplication(date, date, date);
drop function if exists public.duplicate_training_period(date, date, date, text, uuid[], uuid);

create or replace function public.preview_training_period_duplication(
  p_source_start date, p_source_end date, p_destination_start date,
  p_source_team_id uuid default null
) returns table (
  session_id uuid, session_name text, session_date date, new_date date,
  exercise_count bigint, team_names text[], would_conflict boolean
) language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.session_date,
    s.session_date + (p_destination_start - p_source_start),
    (select count(*) from public.session_exercises se where se.session_id = s.id),
    coalesce((select array_agg(distinct t.name order by t.name) from public.session_assignments sa
      join public.teams t on t.id = sa.assigned_team_id where sa.session_id = s.id), '{}'),
    exists (select 1 from public.programmed_sessions existing
      where existing.duplicated_from_session_id = s.id
        and existing.session_date = s.session_date + (p_destination_start - p_source_start))
  from public.programmed_sessions s
  where public.is_coach()
    and p_source_start is not null and p_destination_start is not null
    and p_source_end >= p_source_start
    and s.session_date between p_source_start and p_source_end
    and (p_source_team_id is null or exists (
      select 1 from public.session_assignments sa
      where sa.session_id = s.id and sa.assigned_team_id = p_source_team_id
    ))
  order by s.session_date, s.name;
$$;
revoke all on function public.preview_training_period_duplication(date,date,date,uuid) from public, anon;
grant execute on function public.preview_training_period_duplication(date,date,date,uuid) to authenticated;

-- Atomic copy. A single RPC call is already one transaction; no explicit
-- begin/commit is needed or possible inside a plpgsql function body.
create or replace function public.duplicate_training_period(
  p_source_start date, p_source_end date, p_destination_start date,
  p_conflict_mode text default 'add', p_exclude_session_ids uuid[] default '{}',
  p_destination_team_id uuid default null, p_source_team_id uuid default null
) returns table (source_session_id uuid, new_session_id uuid, new_date date, status text)
language plpgsql security definer set search_path = public as $$
declare
  coach_id uuid; src record; offset_days integer; dest_date date; created_id uuid;
  conflict_exists boolean; dest_members uuid[];
begin
  if not public.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  select id into coach_id from public.profiles where auth_user_id = auth.uid() and role = 'coach' and active;
  if p_source_start is null or p_source_end is null or p_destination_start is null then
    raise exception 'Source and destination dates are required' using errcode = '22023';
  end if;
  if p_source_end < p_source_start then raise exception 'Source end date must not be before the source start date' using errcode = '22023'; end if;
  if p_source_end - p_source_start > 365 then raise exception 'Source period is too large to duplicate in one request' using errcode = '22023'; end if;
  if p_conflict_mode not in ('add', 'skip') then raise exception 'Invalid conflict mode' using errcode = '22023'; end if;
  offset_days := p_destination_start - p_source_start;
  if p_destination_team_id is not null then
    select array_agg(athlete_id) into dest_members from public.athlete_teams at
      join public.profiles p on p.id = at.athlete_id
      where at.team_id = p_destination_team_id and p.active;
  end if;

  for src in
    select * from public.programmed_sessions s
    where s.session_date between p_source_start and p_source_end
      and not (s.id = any (coalesce(p_exclude_session_ids, '{}')))
      and (p_source_team_id is null or exists (
        select 1 from public.session_assignments sa
        where sa.session_id = s.id and sa.assigned_team_id = p_source_team_id
      ))
    order by s.session_date, s.name
  loop
    dest_date := src.session_date + offset_days;
    conflict_exists := exists (
      select 1 from public.programmed_sessions existing
      where existing.duplicated_from_session_id = src.id and existing.session_date = dest_date
    );
    if conflict_exists and p_conflict_mode = 'skip' then
      source_session_id := src.id; new_session_id := null; new_date := dest_date; status := 'skipped';
      return next;
      continue;
    end if;

    insert into public.programmed_sessions (
      session_date, name, description, session_type, estimated_duration_minutes,
      created_by, duplicated_from_session_id
    ) values (
      dest_date, src.name, src.description, src.session_type, src.estimated_duration_minutes,
      coach_id, src.id
    ) returning id into created_id;

    insert into public.session_exercises (
      session_id, exercise_id, position, superset_group, exercise_name, tracking_type, sets,
      prescribed_reps, prescribed_load_kg, prescribed_percent, target_rpe, target_rir, tempo,
      rest_seconds, coach_notes, instructions, video_url, custom_unit
    )
    select created_id, exercise_id, position, superset_group, exercise_name, tracking_type, sets,
      prescribed_reps, prescribed_load_kg, prescribed_percent, target_rpe, target_rir, tempo,
      rest_seconds, coach_notes, instructions, video_url, custom_unit
    from public.session_exercises where session_id = src.id;

    if p_destination_team_id is not null then
      -- Reassigning reuses the destination team's current roster rather than
      -- relabelling the source team's athlete IDs under a different team.
      insert into public.session_assignments (session_id, athlete_id, assigned_team_id)
      select created_id, athlete_id, p_destination_team_id from unnest(coalesce(dest_members, '{}')) as athlete_id
      on conflict (session_id, athlete_id) do nothing;
      insert into public.session_assignments (session_id, athlete_id, assigned_team_id)
      select created_id, athlete_id, null from public.session_assignments
        where session_id = src.id and assigned_team_id is null
      on conflict (session_id, athlete_id) do nothing;
    else
      insert into public.session_assignments (session_id, athlete_id, assigned_team_id)
      select created_id, athlete_id, assigned_team_id from public.session_assignments where session_id = src.id;
    end if;

    source_session_id := src.id; new_session_id := created_id; new_date := dest_date; status := 'added';
    return next;
  end loop;
  return;
end;
$$;
revoke all on function public.duplicate_training_period(date,date,date,text,uuid[],uuid,uuid) from public, anon;
grant execute on function public.duplicate_training_period(date,date,date,text,uuid[],uuid,uuid) to authenticated;
commit;
