# Staging implementation audit

Base: `e81ec02fe0ee5289671f1f9e0ee45c6963c7c934`. Work branch:
`feature/update_submission_speed_and_UI`, initially identical to `staging` and
`main`. No production deployment or remote database writes are authorised here.

## Architecture (before changes)

The deployed application is the dependency-free static PWA in `web/`, not
Streamlit. `index.html` loads generated public configuration and `app.js`;
`api.js` implements fetch-based Supabase Auth/PostgREST access. Hash routes and
module state control navigation. Local storage holds separate coach/anonymous
athlete sessions, selected profile/group and unsynchronised sets. `sw.js` caches
same-origin GETs. `names.js` formats profile names; `styles.css` implements the
existing responsive components, including the athlete month calendar.

`CBI_Gym_App.py` and four `pages/` modules are a legacy account-based prototype.
They recreate Supabase clients on Streamlit reruns and use incompatible tables.
They are not deployed by the documented PWA hosting workflow. They were inspected,
including account creation/reset, scheduling, attendees, per-set writes, and
calendar navigation; changing them would not fix the deployed app.

Athlete flow: group selection → PIN RPC → anonymous Auth signup → active teams
filtered by group → membership/profile picker → assignments →
`start_or_resume_workout` → prescription snapshots → local set drafts → individual
upserts → `finish_workout` → history. Each render validates the Auth session and
reloads the selected profile/memberships. Coach routes separately require Auth
plus an active `profiles.role = 'coach'` linked through `auth_user_id`.

Coach programming uses session/template editors, exercises, teams/memberships and
expanded individual assignments. Session edits currently delete/reinsert child
rows using separate requests. This is a pre-existing nontransactional programming
workflow, separate from the workout-result submission being corrected.

## Complete SQL inventory and reuse

- `profiles`: UUID identity, optional unique Auth user FK, athlete/coach role,
  active flag, structured names and generated full name.
- `teams`: UUID, name, group, active flag; unique `(age_group,name)`.
- `athlete_teams`: membership, composite primary key, profile/team foreign keys.
- `app_settings`: private key/value settings, bcrypt entry-code hashes; no client
  grants or policies. Existing PIN functions verify/set group codes.
- `exercises`: library and eight tracking types.
- `session_templates` / `template_exercises`: reusable programme prescriptions.
- `programmed_sessions` / `session_exercises`: dated programmes/prescriptions,
  unique exercise position per session, session type, superset and measurement
  fields. `session_assignments` expands team delivery to individuals and records
  `assigned_team_id`; unique `(session_id,athlete_id)`.
- `workout_logs`: snapshot header, status, completion time, RPE/notes, existing
  `updated_at`; unique `(athlete_id,session_id)` prevents duplicate workouts.
- `workout_exercises`: prescription snapshot with unique `(workout_log_id,position)`.
- `set_logs`: actual measurements, notes, unique `(workout_exercise_id,set_number)`.

All PWA tables enable RLS. Coach policies use security-definer `is_coach()`.
Authenticated anonymous users can read shared squad data and write in-progress
sets. Completed sets are not directly writable. Workout lifecycle and history
RPCs are security definers. Timestamp triggers cover mutable reference/header/set
tables. Indexes cover session dates, athlete assignments/history, exercise history
and set conflict keys. No PWA views exist. No evidence yet warrants new indexes.

All seven migrations were reviewed: supersets; shared PIN; U18 roster; session
types; authenticated athlete access; structured names; age-group codes. Fresh
schema and migration history differ: old policy names begin `public`, fresh names
begin `athlete`; migrated teams permit null groups, fresh schema requires a group.
Old migrations must not be replayed indiscriminately over the current fresh schema.
The legacy SQL additionally defines `users`, `scheduled_workouts`,
`scheduled_workout_exercises`, `workouts`, `workout_sets`, and a materialized
`personal_bests` view. It omits the attendees table and coach field used by Python.
It is not a suitable schema for the PWA. No new tables are planned.

## Confirmed defects before changes

1. Finish first awaits `flushSaves` before showing a modal; submitting that modal
   flushes every visible set again. Each flush inserts every set into drafts and
   performs one sequential HTTP upsert per set, including untouched prescriptions.
2. Debounce, blur, retry and flush requests can overlap. A stale request can land
   after a newer value; the saves map can lose track of an older in-flight write.
3. No submission lock, immediate finish-button feedback, persistent failure state
   or request deadline. Failures are exposed through short-lived raw-error toasts.
4. Completed inputs/buttons are disabled; opening a completed workout deletes
   its drafts. RLS also prevents completed set updates. `finish_workout` does not
   update completed-session feedback.
5. `athleteAccess` explicitly renders Coaches as `href="#coach/login"`.
   Neither the group list nor SQL PIN/group constraints support Coaches.
6. Coach dashboard only loads today's sessions; calendar is athlete-only.
7. Assigned-session range filtering happens in the browser, risking truncated
   results once the server's default row limit is reached.

## Security and environment findings

Local PWA configuration, `.env`, `.env.local` and generated `dist` all refer to
one Supabase project, with no staging label. Legacy Streamlit secrets refer to a
different project. A different project is not evidence that either is staging.
No staging URL, database credentials or hosting branch rules are available in
tracked configuration. The staging details have been requested. Do not use the
existing ignored configuration for automated tests or writes until identified.

The existing athlete model deliberately does not authenticate individual people:
any anonymous Auth user can access shared roster data. PIN verification is not
bound to the resulting Auth token. A UI athlete-ID check is not a security
boundary. This limitation must be explicit in review; an ID supplied by the
client alone cannot prove ownership. Production data was not accessed or copied.

## Baseline

`node --test tests`: 12/12 passing before application changes. Browser and
database baseline details will be recorded in `STAGING_UI_TEST_RESULTS.md`.
