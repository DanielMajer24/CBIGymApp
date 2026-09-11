-- Athlete data access now requires an Auth session. The app obtains one only
-- after the shared entry PIN has been verified, using Supabase anonymous sign-in.
-- This raises the bar above direct REST calls with only the public anon key; it
-- does not make the shared PIN individual authentication because an attacker
-- can deliberately create their own anonymous Auth session outside this UI.

revoke all on public.profiles, public.teams, public.athlete_teams,
  public.exercises, public.session_templates, public.template_exercises,
  public.programmed_sessions, public.session_exercises, public.session_assignments,
  public.workout_logs, public.workout_exercises, public.set_logs from anon;

grant select, insert, update on public.profiles, public.teams, public.athlete_teams,
  public.exercises, public.session_templates, public.template_exercises,
  public.programmed_sessions, public.session_exercises, public.session_assignments,
  public.workout_logs, public.workout_exercises, public.set_logs to authenticated;

revoke all on function public.start_or_resume_workout(uuid, uuid) from public, anon;
revoke all on function public.finish_workout(uuid, numeric, text) from public, anon;
revoke all on function public.last_exercise_sets(uuid, uuid, uuid) from public, anon;
revoke all on function public.exercise_history(uuid, uuid) from public, anon;
grant execute on function public.start_or_resume_workout(uuid, uuid) to authenticated;
grant execute on function public.finish_workout(uuid, numeric, text) to authenticated;
grant execute on function public.last_exercise_sets(uuid, uuid, uuid) to authenticated;
grant execute on function public.exercise_history(uuid, uuid) to authenticated;

-- The PIN check is intentionally the only pre-authenticated database call.
revoke all on function public.verify_athlete_entry_pin(text) from public;
grant execute on function public.verify_athlete_entry_pin(text) to anon, authenticated;

alter policy "public reads active athletes" on public.profiles to authenticated;
alter policy "public reads teams" on public.teams to authenticated;
alter policy "public reads memberships" on public.athlete_teams to authenticated;
alter policy "public reads active exercises" on public.exercises to authenticated;
alter policy "public reads assigned sessions" on public.programmed_sessions to authenticated;
alter policy "public reads session exercises" on public.session_exercises to authenticated;
alter policy "public reads assignments" on public.session_assignments to authenticated;
alter policy "public reads workout logs" on public.workout_logs to authenticated;
alter policy "public reads workout snapshots" on public.workout_exercises to authenticated;
alter policy "public reads set logs" on public.set_logs to authenticated;
alter policy "public writes active set logs" on public.set_logs to authenticated;
alter policy "public updates active set logs" on public.set_logs to authenticated;
