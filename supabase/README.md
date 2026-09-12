# Supabase database

Run schema.sql and then seed.sql in a new Supabase project. The legacy
Streamlit tables are structurally incompatible with this application, so a
separate project is the lowest-risk migration path.

For an already deployed CBI High Performance database, run each numbered file in
migrations/ once, in order. Run 004_add_session_type.sql before its matching
frontend so session colour types and workout snapshots exist, then run
005_lock_athlete_access_to_authenticated.sql before releasing the new athlete
authentication flow. Run 006_add_profile_names.sql before releasing the
first/last-name athlete editor. Migration 003_add_u18_marlins_roster.sql
replaces the seed athlete roster with the U18 Marlins without deleting
historical logs. Run 007_add_age_group_codes.sql before releasing the
age-group athlete entry flow.

## Coach account

1. In Supabase Studio, create the coach under Authentication → Users.
2. Copy that user’s UUID.
3. Run the following in the SQL editor, replacing the placeholders:

    insert into public.profiles (auth_user_id, role, first_name, last_name)
    values ('AUTH_USER_UUID', 'coach', 'Coach', 'Name');

The application only grants coach screens to an authenticated user linked to
an active coach profile. Never use a service-role key in the browser.

## Age-group athlete entry codes

After applying migration 007, sign into Coach mode and open Dashboard →
Manage beside “Athlete entry codes”. Set a four-digit code for each age group
you use: U12, U14, U16, and/or U18. Athletes choose their age group, enter that
group's code, then select their team and public profile. The code is verified
server-side and is not stored in the delivered JavaScript or browser storage.
It is a casual access deterrent, not individual authentication.

Every team belongs to one age group. The migration assigns the existing U18
Marlins team to U18 and transfers the former single entry code to U18. Open
each other active team in Coach mode and choose its age group before athletes
use the new flow. Coaches use normal Supabase Auth and do not use an age-group
code. Team names may repeat across age groups, such as U12 Marlins and U18
Marlins.

Before releasing migration 005, open Supabase Dashboard → Authentication →
General Configuration (or Sign In / Providers in the current dashboard) and
enable **Allow anonymous sign-ins**. After a correct PIN, the app creates and
stores an anonymous Supabase Auth session, then uses that session for all
athlete data calls. If this setting is off, athletes will correctly remain at
the entry-code screen because the app cannot obtain the required session.

## Security model

RLS is enabled on every table in schema.sql.

- For database access, the public `anon` key can only call the boolean
  age-group code-verification function; it has no direct table access and
  cannot start, finish, or edit workouts.
- After the group code is accepted, the app creates an anonymous Auth user. That
  authenticated session can read active roster/session data, call the narrowly
  scoped start/resume and finish functions, and write actual set values only
  while a workout is in progress.
- Authenticated coaches can manage athletes, teams, exercises, templates and
  programming, and review results.
- Athlete profiles are intentionally not private. With no athlete login, it is
  not possible to cryptographically bind a browser write to one person; a
  trusted-squad user could impersonate another roster entry. The policies
  prevent that athlete client from altering programming/reference data.

This is a deliberate improvement, not a claim that an age-group code is strong
authentication. Anonymous sign-in is an unauthenticated Supabase endpoint, so
someone who deliberately uses the public key to create their own anonymous
session can reach the same shared-squad athlete access. It stops casual direct
REST access with only the key and makes the normal app flow require a code.
Per-athlete identity and write attribution would require individual athlete
accounts, which is a separate product decision.

## Athlete names and season rollover

Profiles now have separately stored first and last names, with `name` generated
as their full-name convenience value. The U18 Marlins migration created its
existing roster from first names only, so its athletes have blank `last_name`
values after migration 006. Open each athlete in Coach mode and enter their
real last name once before relying on picker disambiguation for that squad.

When an athlete moves to a different age group or season, edit their existing
profile's team membership. Do not create a second profile: their workout
history remains correctly attached to the original profile.

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
