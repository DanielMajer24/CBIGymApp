# Supabase database

Run schema.sql and then seed.sql in a new Supabase project. The legacy
Streamlit tables are structurally incompatible with this application, so a
separate project is the lowest-risk migration path.

For an already deployed CBI Performance database, run each numbered file in
migrations/ once, in order. To enable supersets now, run
migrations/001_add_supersets.sql before deploying the matching frontend.

## Coach account

1. In Supabase Studio, create the coach under Authentication → Users.
2. Copy that user’s UUID.
3. Run the following in the SQL editor, replacing the placeholders:

    insert into public.profiles (auth_user_id, role, name)
    values ('AUTH_USER_UUID', 'coach', 'Coach Name');

The application only grants coach screens to an authenticated user linked to
an active coach profile. Never use a service-role key in the browser.

## Security model

RLS is enabled on every table in schema.sql.

- Anonymous athlete mode can read active roster/session data and call the
  narrowly scoped start/resume and finish functions. It can only write actual
  set values while a workout is in progress.
- Authenticated coaches can manage athletes, teams, exercises, templates and
  programming, and review results.
- Athlete profiles are intentionally not private. With no athlete login, it is
  not possible to cryptographically bind a browser write to one person; a
  trusted-squad user could impersonate another roster entry. The policies
  prevent that anonymous client from altering programming/reference data.

If the team later needs athlete-level write attribution, introduce Supabase
anonymous sign-in or individual accounts and bind policies to auth.uid().

## Data model

programmed_sessions and session_exercises are the editable program.
session_assignments resolves team and individual delivery. Starting a workout
calls start_or_resume_workout, which atomically enforces one log per
athlete/session and copies all prescriptions into workout_logs and
workout_exercises. Superset groups are copied at the same time. set_logs
contains actual performance. Historical screens use these snapshots, never
mutable library or programme rows.
