# CBI High Performance

A lightweight, mobile-first Strength & Conditioning PWA for a small squad.

The main workflow is deliberately short:

1. A coach programs a session once.
2. An athlete chooses their public profile on a shared/trusted device.
3. The athlete records sets with automatic saving.
4. The coach reviews completion and immutable historical results.

## Current implementation

The production application is the dependency-free static PWA in web/. It uses
Supabase Postgres, Row Level Security, and Supabase Auth for coach access.
There is no permanently running Python server to host or maintain.

The original Streamlit prototype remains at the repository root and in pages/.
It is retained as legacy reference while the replacement is verified, but it is
not the application to deploy.

### Why the rebuild

The existing Streamlit/Supabase prototype provided useful proof-of-concept
ideas, but was not suitable for the desired product:

- each athlete required an account and password;
- its single-form manual save flow was poor between sets;
- it had no templates, teams, exercise tracking types, autosave, PWA, history,
  or immutable workout snapshots;
- its SQL and Python code disagreed on profile fields;
- no tests, migration path, or reliable deployment configuration existed.

A static PWA plus managed Postgres is simpler for a small organisation:
Cloudflare Pages hosts the app, Supabase provides persistence and coach
authentication, and the browser directly calls a constrained public API.

## Features

### Athlete mode

- One shared, coach-managed four-digit entry code before athlete selection;
  it is remembered per device and acts as a simple access deterrent.
- Team-first athlete picker that shows only active athletes in the selected
  squad, with the selected athlete remembered in browser local storage.
- Today, History, and Profile navigation designed for phone screens.
- Start or resume prevents duplicate athlete/session logs.
- Fast numeric set cards with inputs appropriate to weight/reps, reps, time,
  distance, height, power, conditioning, and custom results.
- Sensible prescription defaults, Same as previous, blur saves, 600 ms
  debounce, visible saving state, and local draft protection.
- Previous result and exercise-history views.
- Optional session RPE and notes on completion.

### Coach mode

- Supabase Auth login checked against a server-side coach profile.
- Dashboard, sessions, templates, athletes, teams, and exercise library.
- Session builder supports date, duration, team, individual, or everyone
  assignments, accessible up/down exercise ordering, and optional A–F superset
  groups.
- Templates can seed a new scheduled session.
- Workout review is read-only and shows progress plus individual results.

## Data model and snapshots

See supabase/schema.sql for the complete schema and policies, and
supabase/README.md for the security model.

The key boundary is:

    editable programme: programmed_sessions -> session_exercises
    historical record:  workout_logs -> workout_exercises -> set_logs

When an athlete starts a session, start_or_resume_workout atomically creates or
retrieves their single workout log and copies the full prescription into
workout_exercises. Later coach edits cannot alter completed history.

## Local setup

Requirements:

- Python 3 for a simple static local server.
- A Supabase project.
- Node 20+ only if you want to run the included static tests. The app itself
  has no npm dependencies or frontend build step.

1. Create a new Supabase project. Do not run the new schema alongside the old
   Streamlit schema in the same populated project.
2. In Supabase SQL Editor, run supabase/schema.sql, then supabase/seed.sql.
3. Create a Supabase Auth user for the coach and link it to a coach profile as
   described in supabase/README.md.
4. Copy the public configuration template:

       cp web/app-config.example.js web/app-config.js

   Replace the two placeholders with the project URL and anon key. The anon key
   is public by design; never use a service-role key.
5. Serve the web directory:

       python3 -m http.server 8080 --directory web

6. Open http://localhost:8080 and choose Daniel Majer. Use the coach URL at
   http://localhost:8080/#coach/login.

Set the Supabase Auth Site URL and additional redirect URL to the development
and production application addresses in Authentication → URL Configuration.

## Development checks

Run the static checks with:

    node --test tests
    node --check web/app.js
    node --check web/api.js
    node --check web/sw.js

The repository also retains the legacy Python syntax check:

    python3 -m py_compile CBI_Gym_App.py pages/*.py

## Deployment: Cloudflare Pages + Supabase

Cloudflare Pages is the recommended host because this app is static and does
not need a server process.

1. Push this repository to GitHub.
2. In Cloudflare, create a Pages project from the repository.
3. Set Root directory to web.
4. Set Build command to:

       sh build-config.sh

5. Set Build output directory to a single period: .
6. Add SUPABASE_URL and SUPABASE_ANON_KEY as Cloudflare build variables. They
   generate app-config.js during the build and are safe to expose in the
   delivered frontend. Do not set SUPABASE_SERVICE_ROLE_KEY.
7. Set the Supabase Auth Site URL and redirect URLs to the Cloudflare Pages
   production address (and custom domain, if used).
8. Deploy, open the site on a phone, and use Add to Home Screen.

Cloudflare currently offers unlimited static asset requests on Pages and 500
free builds monthly, which is ample here. Supabase Free currently includes a
500 MB database, 50,000 MAUs, and 5 GB egress. Its important operational
limitation is that a free project pauses after seven days with no activity; a
coach should open the app weekly, or use a paid tier if that is unacceptable.
Review provider terms and limits before relying on them long-term:

- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/functions/pricing/
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/free-project-pausing

## Security notes

Coach administration is protected by Supabase Auth plus RLS. No coach password
or PIN is embedded in frontend code.

Athlete mode can use one shared four-digit entry code. It is verified and
stored only by Supabase functions, never embedded in browser code. It is a
casual access deterrent, not private athlete authentication.

Athletes intentionally have no private accounts. RLS allows anonymous users to
read active roster/programme data and write only workout set data for an
in-progress assigned session. Because there is no athlete identity, a member
of the trusted squad could technically submit a set for a different public
profile; this is the unavoidable trade-off for passwordless athlete mode. They
cannot change athletes, teams, exercises, templates, or programming.

The old local Streamlit secrets file contained a real Supabase key during the
audit. It is ignored by this repository, but rotate that project key in
Supabase before production deployment.

## Seed data

supabase/seed.sql provides:

- Daniel Majer and three additional athletes;
- Development Squad and Rehab Group;
- the requested exercise library;
- a reusable Lower Strength A template;
- a completed Lower Strength A session in the past;
- today’s Lower Body — Power session;
- a future Upper Strength session.

## Manual acceptance checklist

Coach:

1. Create an athlete and team, assign the athlete to the team.
2. Create an exercise.
3. Build a session, assign a team and/or individual athlete, and save. Put
   paired exercises in the same Superset group to prescribe them together.
4. Save a template and create a session from it.

Athlete:

1. Change athlete and select an assigned profile.
2. Start the session, enter set values, wait for Saved, then refresh.
3. Confirm the same workout resumes with the entered values.
4. Complete it with optional RPE and notes, then review History and exercise
   history.

Coach review:

1. Open the programmed session.
2. Confirm each athlete’s not-started, in-progress, or complete state.
3. Open a completed log and compare the recorded sets.
4. Edit the future programme; confirm the completed log still displays its
   original prescription.
