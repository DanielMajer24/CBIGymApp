# Supabase database

Run schema.sql and then seed.sql in a new Supabase project. The legacy
Streamlit tables are structurally incompatible with this application, so a
separate project is the lowest-risk migration path.

For an already deployed CBI High Performance database, run each numbered file in
migrations/ once, in order. Run 004_add_session_type.sql before its matching
frontend so session colour types and workout snapshots exist, then run
005_lock_athlete_access_to_authenticated.sql before releasing the new athlete
authentication flow. Migration 003_add_u18_marlins_roster.sql replaces the
seed athlete roster with the U18 Marlins without deleting historical logs.

## Coach account

1. In Supabase Studio, create the coach under Authentication → Users.
2. Copy that user’s UUID.
3. Run the following in the SQL editor, replacing the placeholders:

    insert into public.profiles (auth_user_id, role, name)
    values ('AUTH_USER_UUID', 'coach', 'Coach Name');

The application only grants coach screens to an authenticated user linked to
an active coach profile. Never use a service-role key in the browser.

## Shared athlete entry code

After applying migration 002, sign into Coach mode and open Dashboard →
Manage beside “Athlete entry code”. Choose one four-digit squad code. Athletes
enter this once per device before choosing their public profile; the code is
verified server-side and is not stored in the delivered JavaScript or browser
storage. It is a casual access deterrent, not individual authentication.

Before releasing migration 005, open Supabase Dashboard → Authentication →
General Configuration (or Sign In / Providers in the current dashboard) and
enable **Allow anonymous sign-ins**. After a correct PIN, the app creates and
stores an anonymous Supabase Auth session, then uses that session for all
athlete data calls. If this setting is off, athletes will correctly remain at
the entry-code screen because the app cannot obtain the required session.

## Security model

RLS is enabled on every table in schema.sql.

- For database access, the public `anon` key can only call the boolean
  PIN-verification function; it has no direct table access and cannot start,
  finish, or edit workouts.
- After the PIN is accepted, the app creates an anonymous Auth user. That
  authenticated session can read active roster/session data, call the narrowly
  scoped start/resume and finish functions, and write actual set values only
  while a workout is in progress.
- Authenticated coaches can manage athletes, teams, exercises, templates and
  programming, and review results.
- Athlete profiles are intentionally not private. With no athlete login, it is
  not possible to cryptographically bind a browser write to one person; a
  trusted-squad user could impersonate another roster entry. The policies
  prevent that athlete client from altering programming/reference data.

This is a deliberate improvement, not a claim that the shared PIN is strong
authentication. Anonymous sign-in is an unauthenticated Supabase endpoint, so
someone who deliberately uses the public key to create their own anonymous
session can reach the same shared-squad athlete access. It stops casual direct
REST access with only the key and makes the normal app flow require the PIN.
Per-athlete identity and write attribution would require individual athlete
accounts, which is a separate product decision.

If the team later needs athlete-level write attribution, introduce individual
athlete accounts and bind policies to auth.uid().

## Data model

programmed_sessions and session_exercises are the editable program.
session_assignments resolves team and individual delivery. Each session and
template records its coach-selected `session_type`; it is copied to the workout
log at start so historical calendar colour does not change. Starting a workout
calls start_or_resume_workout, which atomically enforces one log per
athlete/session and copies all prescriptions into workout_logs and
workout_exercises. Superset groups are copied at the same time. set_logs
contains actual performance. Historical screens use these snapshots, never
mutable library or programme rows.
