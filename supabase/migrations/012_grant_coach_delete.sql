-- Fix: every coach delete has been silently broken since the base schema. RLS policies on
-- profiles/teams/athlete_teams/template_exercises/programmed_sessions/session_exercises/
-- session_assignments already say "for all ... using (is_coach())", intending coaches to
-- delete rows in all of them, but the base schema's GRANT only ever covered
-- select/insert/update — Postgres requires both the table-level grant and a passing RLS
-- policy, so every delete has failed with "permission denied" regardless of the policy.
-- This affects: Delete permanently (athlete/team/session) and, less obviously, editing any
-- *existing* session or template at all, since saving an edit deletes and re-inserts its
-- exercise/assignment rows. Scoped to exactly the tables the app ever issues a delete
-- against (see db.remove(...) call sites in web/app.js) — not a blanket re-grant.
begin;
grant delete on public.profiles, public.teams, public.athlete_teams, public.template_exercises,
  public.programmed_sessions, public.session_exercises, public.session_assignments to authenticated;
commit;
