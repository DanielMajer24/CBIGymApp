-- Development-only data. Run after schema.sql. Dates move with the calendar so
-- all primary states are immediately testable.

insert into public.teams (id, name) values
  ('00000000-0000-4000-8000-000000000101', 'Development Squad'),
  ('00000000-0000-4000-8000-000000000102', 'Rehab Group')
on conflict (id) do update set name = excluded.name;

insert into public.profiles (id, role, name, active) values
  ('00000000-0000-4000-8000-000000000001', 'athlete', 'Daniel Majer', true),
  ('00000000-0000-4000-8000-000000000002', 'athlete', 'Athlete 2', true),
  ('00000000-0000-4000-8000-000000000003', 'athlete', 'Athlete 3', true),
  ('00000000-0000-4000-8000-000000000004', 'athlete', 'Athlete 4', true)
on conflict (id) do update set name = excluded.name, active = excluded.active;

insert into public.athlete_teams (athlete_id, team_id) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000101')
on conflict do nothing;

insert into public.exercises (id, name, category, tracking_type, default_instructions) values
  ('00000000-0000-4000-8000-000000000201', 'Back Squat', 'Squat', 'weight_reps', 'Brace before every rep and use a controlled descent.'),
  ('00000000-0000-4000-8000-000000000202', 'Trap Bar Deadlift', 'Hinge', 'weight_reps', 'Push the floor away and keep the handles close.'),
  ('00000000-0000-4000-8000-000000000203', 'Romanian Deadlift', 'Hinge', 'weight_reps', 'Maintain a soft knee and long spine as the hips travel back.'),
  ('00000000-0000-4000-8000-000000000204', 'Bench Press', 'Push', 'weight_reps', 'Set shoulders, touch with control, and drive evenly.'),
  ('00000000-0000-4000-8000-000000000205', 'Pull Up', 'Pull', 'reps_only', 'Use a full hang and keep the movement controlled.'),
  ('00000000-0000-4000-8000-000000000206', 'Bulgarian Split Squat', 'Single Leg', 'weight_reps', 'Complete the prescribed reps on each side.'),
  ('00000000-0000-4000-8000-000000000207', 'Calf Raise', 'Other', 'weight_reps', 'Pause briefly at the top and bottom.'),
  ('00000000-0000-4000-8000-000000000208', 'Countermovement Jump', 'Plyometric', 'height', 'Reset between jumps and make every jump maximal.'),
  ('00000000-0000-4000-8000-000000000209', 'Broad Jump', 'Plyometric', 'distance', 'Stick the landing before measuring.'),
  ('00000000-0000-4000-8000-000000000210', '20m Sprint', 'Speed', 'duration', 'Use a full recovery before the next rep.'),
  ('00000000-0000-4000-8000-000000000211', 'Assault Bike', 'Conditioning', 'conditioning', 'Record the most useful result: calories, watts, or time.')
on conflict (id) do update set name = excluded.name, category = excluded.category, tracking_type = excluded.tracking_type;

insert into public.session_templates (id, name, description) values
  ('00000000-0000-4000-8000-000000000251', 'Lower Strength A', 'A reusable lower-body strength base session.')
on conflict (id) do update set name = excluded.name, description = excluded.description;

insert into public.template_exercises (id, template_id, exercise_id, position, exercise_name, tracking_type, sets, prescribed_reps, target_rpe, rest_seconds) values
  ('00000000-0000-4000-8000-000000000261', '00000000-0000-4000-8000-000000000251', '00000000-0000-4000-8000-000000000201', 1, 'Back Squat', 'weight_reps', 4, 5, 7, 150),
  ('00000000-0000-4000-8000-000000000262', '00000000-0000-4000-8000-000000000251', '00000000-0000-4000-8000-000000000203', 2, 'Romanian Deadlift', 'weight_reps', 3, 8, 7, 90),
  ('00000000-0000-4000-8000-000000000263', '00000000-0000-4000-8000-000000000251', '00000000-0000-4000-8000-000000000206', 3, 'Bulgarian Split Squat', 'weight_reps', 3, 8, 7, 90),
  ('00000000-0000-4000-8000-000000000264', '00000000-0000-4000-8000-000000000251', '00000000-0000-4000-8000-000000000207', 4, 'Calf Raise', 'weight_reps', 3, 12, 7, 60)
on conflict (id) do update set sets = excluded.sets, prescribed_reps = excluded.prescribed_reps, target_rpe = excluded.target_rpe;

update public.template_exercises set superset_group = 'A'
where id in ('00000000-0000-4000-8000-000000000263', '00000000-0000-4000-8000-000000000264');

insert into public.programmed_sessions (id, session_date, name, description, estimated_duration_minutes) values
  ('00000000-0000-4000-8000-000000000301', current_date - 14, 'Lower Strength A', 'Build quality positions and leave a rep in reserve.', 55),
  ('00000000-0000-4000-8000-000000000302', current_date, 'Lower Body — Power', 'Move with intent. Quality over fatigue.', 55),
  ('00000000-0000-4000-8000-000000000303', current_date + 3, 'Upper Strength', 'Press, pull, and finish with trunk work.', 50)
on conflict (id) do update set session_date = excluded.session_date, name = excluded.name, description = excluded.description;

insert into public.session_exercises (id, session_id, exercise_id, position, exercise_name, tracking_type, sets, prescribed_reps, prescribed_load_kg, target_rpe, rest_seconds, coach_notes) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 1, 'Back Squat', 'weight_reps', 4, 5, 100, 7, 150, 'Smooth reps. Do not chase load.'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000203', 2, 'Romanian Deadlift', 'weight_reps', 3, 8, 70, 7, 90, null),
  ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000208', 1, 'Countermovement Jump', 'height', 3, 3, null, null, 60, 'Record your best jump in each set.'),
  ('00000000-0000-4000-8000-000000000412', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201', 2, 'Back Squat', 'weight_reps', 4, 5, 100, 7, 120, 'Crisp concentric. Stop if bar speed drops.'),
  ('00000000-0000-4000-8000-000000000413', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000203', 3, 'Romanian Deadlift', 'weight_reps', 3, 8, 75, 7, 90, null),
  ('00000000-0000-4000-8000-000000000414', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000209', 4, 'Broad Jump', 'distance', 3, 2, null, null, 60, null),
  ('00000000-0000-4000-8000-000000000415', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000211', 5, 'Assault Bike', 'conditioning', 2, null, null, 7, 90, '8 calories hard, recover fully.'),
  ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000204', 1, 'Bench Press', 'weight_reps', 4, 6, 75, 7, 120, null),
  ('00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000205', 2, 'Pull Up', 'reps_only', 3, 8, null, 7, 90, null)
on conflict (id) do update set sets = excluded.sets, prescribed_reps = excluded.prescribed_reps, prescribed_load_kg = excluded.prescribed_load_kg;

update public.session_exercises set superset_group = 'A'
where id in ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000422');

insert into public.session_assignments (session_id, athlete_id, assigned_team_id)
select s.id, p.id, '00000000-0000-4000-8000-000000000101'
from public.programmed_sessions s cross join public.profiles p
where s.id in ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000303')
and p.id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004')
on conflict do nothing;

-- One historical completed session, including an immutable prescription snapshot.
insert into public.workout_logs (id, athlete_id, session_id, session_date, session_name, session_description, estimated_duration_minutes, status, started_at, completed_at, session_rpe, athlete_notes) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301', current_date - 14, 'Lower Strength A', 'Build quality positions and leave a rep in reserve.', 55, 'completed', now() - interval '14 days', now() - interval '14 days' + interval '52 minutes', 7, 'Felt strong.')
on conflict (athlete_id, session_id) do nothing;

insert into public.workout_exercises (id, workout_log_id, source_session_exercise_id, exercise_id, position, exercise_name, tracking_type, sets, prescribed_reps, prescribed_load_kg, target_rpe, rest_seconds, coach_notes) values
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000201', 1, 'Back Squat', 'weight_reps', 4, 5, 100, 7, 150, 'Smooth reps. Do not chase load.'),
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000203', 2, 'Romanian Deadlift', 'weight_reps', 3, 8, 70, 7, 90, null)
on conflict (workout_log_id, position) do nothing;

insert into public.set_logs (workout_exercise_id, set_number, load_kg, reps, rpe) values
  ('00000000-0000-4000-8000-000000000601', 1, 100, 5, 7),
  ('00000000-0000-4000-8000-000000000601', 2, 100, 5, 7),
  ('00000000-0000-4000-8000-000000000601', 3, 105, 5, 8),
  ('00000000-0000-4000-8000-000000000601', 4, 105, 5, 8),
  ('00000000-0000-4000-8000-000000000602', 1, 70, 8, 7),
  ('00000000-0000-4000-8000-000000000602', 2, 70, 8, 7),
  ('00000000-0000-4000-8000-000000000602', 3, 75, 8, 8)
on conflict do nothing;
