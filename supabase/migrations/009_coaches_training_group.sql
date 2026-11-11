-- Reuse the existing group PIN/settings and team/membership model.
-- No team, participant, role or default PIN is created automatically.
begin;
alter table public.teams drop constraint if exists teams_age_group_check;
alter table public.teams add constraint teams_age_group_check
  check (age_group is null or age_group in ('U12','U14','U16','U18','Coaches'));

create or replace function public.verify_athlete_entry_pin(p_age_group text,p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare stored_hash text;
begin
  if p_age_group is null or p_age_group not in ('U12','U14','U16','U18','Coaches')
    or p_pin is null or p_pin !~ '^[0-9]{4}$' then return false; end if;
  select setting_value into stored_hash from public.app_settings
    where setting_key='athlete_entry_pin_hash_' || lower(p_age_group);
  return stored_hash is not null and crypt(p_pin,stored_hash)=stored_hash;
end;
$$;
create or replace function public.set_athlete_entry_pin(p_age_group text,p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_coach() then raise exception 'Coach access required' using errcode='42501'; end if;
  if p_age_group is null or p_age_group not in ('U12','U14','U16','U18','Coaches') then raise exception 'Choose a valid training group'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'Entry code must be exactly four digits'; end if;
  insert into public.app_settings (setting_key,setting_value)
    values ('athlete_entry_pin_hash_' || lower(p_age_group),crypt(p_pin,gen_salt('bf',10)))
    on conflict (setting_key) do update set setting_value=excluded.setting_value,updated_at=now();
end;
$$;
commit;
