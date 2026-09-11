-- Replace the initial seed roster with the U18 Marlins squad without deleting
-- workout history. The old seed athletes remain in the database as inactive
-- records, so existing historical logs and coach review stay intact.

-- The base schema already enables RLS here; repeat it so this migration is
-- safe when run independently and Supabase's security check sees the intent.
alter table public.athlete_teams enable row level security;

update public.profiles
set active = false
where role = 'athlete'
  and name in ('Daniel Majer', 'Athlete 2', 'Athlete 3', 'Athlete 4');

insert into public.teams (name, active)
values ('U18 Marlins', true)
on conflict (name) do update set active = true, updated_at = now();

with roster(name) as (
  values
    ('Max'),
    ('Thurston'),
    ('Cooper'),
    ('Kereama'),
    ('Jesse'),
    ('Ben'),
    ('Lewis'),
    ('George'),
    ('Harry'),
    ('Axel')
)
insert into public.profiles (name, role, active)
select roster.name, 'athlete', true
from roster
where not exists (
  select 1 from public.profiles profile
  where profile.role = 'athlete' and profile.name = roster.name
);

with roster(name) as (
  values
    ('Max'),
    ('Thurston'),
    ('Cooper'),
    ('Kereama'),
    ('Jesse'),
    ('Ben'),
    ('Lewis'),
    ('George'),
    ('Harry'),
    ('Axel')
)
update public.profiles profile
set active = true
from roster
where profile.role = 'athlete' and profile.name = roster.name;

with roster(name) as (
  values
    ('Max'),
    ('Thurston'),
    ('Cooper'),
    ('Kereama'),
    ('Jesse'),
    ('Ben'),
    ('Lewis'),
    ('George'),
    ('Harry'),
    ('Axel')
), squad as (
  select id from public.teams where name = 'U18 Marlins'
)
insert into public.athlete_teams (athlete_id, team_id)
select profile.id, squad.id
from public.profiles profile
cross join squad
join roster on roster.name = profile.name
where profile.role = 'athlete' and profile.active
on conflict (athlete_id, team_id) do nothing;
