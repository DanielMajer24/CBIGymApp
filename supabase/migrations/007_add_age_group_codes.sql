-- Replace the single shared athlete entry code with an age-group hierarchy.
-- Coaches retain normal Supabase Auth access; athlete codes are only for U12,
-- U14, U16, and U18 entry flows.

begin;

alter table public.teams add column age_group text;
alter table public.teams
  add constraint teams_age_group_check
  check (age_group is null or age_group in ('U12', 'U14', 'U16', 'U18'));
alter table public.teams drop constraint if exists teams_name_key;
alter table public.teams add constraint teams_age_group_name_key unique (age_group, name);

-- Preserve the current Marlins flow without guessing the age group for old
-- generic teams. Coaches can assign those teams in the team editor later.
update public.teams
set age_group = 'U18'
where age_group is null and name ~* '(^|[^0-9])u?18([^0-9]|$)';

-- Carry the existing global code forward for the current U18 roster. Once a
-- coach sets a group-specific code, it remains authoritative.
insert into public.app_settings (setting_key, setting_value)
select 'athlete_entry_pin_hash_u18', setting_value
from public.app_settings
where setting_key = 'athlete_entry_pin_hash'
on conflict (setting_key) do nothing;
delete from public.app_settings where setting_key = 'athlete_entry_pin_hash';

create or replace function public.verify_athlete_entry_pin(p_age_group text, p_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare stored_hash text;
begin
  if p_age_group is null or p_age_group not in ('U12', 'U14', 'U16', 'U18') or p_pin is null or p_pin !~ '^[0-9]{4}$' then return false; end if;
  select setting_value into stored_hash
  from public.app_settings where setting_key = 'athlete_entry_pin_hash_' || lower(p_age_group);
  return stored_hash is not null and crypt(p_pin, stored_hash) = stored_hash;
end;
$$;

create or replace function public.set_athlete_entry_pin(p_age_group text, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  if p_age_group is null or p_age_group not in ('U12', 'U14', 'U16', 'U18') then raise exception 'Choose a valid age group'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'Entry code must be exactly four digits'; end if;
  insert into public.app_settings (setting_key, setting_value)
  values ('athlete_entry_pin_hash_' || lower(p_age_group), crypt(p_pin, gen_salt('bf', 10)))
  on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_at = now();
end;
$$;

drop function public.verify_athlete_entry_pin(text);
drop function public.set_athlete_entry_pin(text);
revoke all on function public.verify_athlete_entry_pin(text, text) from public;
revoke all on function public.set_athlete_entry_pin(text, text) from public;
grant execute on function public.verify_athlete_entry_pin(text, text) to anon, authenticated;
grant execute on function public.set_athlete_entry_pin(text, text) to authenticated;

commit;
