-- Apply after 001_add_supersets.sql to add one shared, coach-managed
-- four-digit athlete entry code. It is a casual access deterrent only; it is
-- not an athlete identity or a substitute for authentication.

create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  setting_key text primary key,
  setting_value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create or replace function public.verify_athlete_entry_pin(p_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare stored_hash text;
begin
  if p_pin !~ '^[0-9]{4}$' then return false; end if;
  select setting_value into stored_hash
  from public.app_settings where setting_key = 'athlete_entry_pin_hash';
  return stored_hash is not null and crypt(p_pin, stored_hash) = stored_hash;
end;
$$;

create or replace function public.set_athlete_entry_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'Entry code must be exactly four digits'; end if;
  insert into public.app_settings (setting_key, setting_value)
  values ('athlete_entry_pin_hash', crypt(p_pin, gen_salt('bf', 10)))
  on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_at = now();
end;
$$;

revoke all on function public.set_athlete_entry_pin(text) from public;
grant execute on function public.verify_athlete_entry_pin(text) to anon, authenticated;
grant execute on function public.set_athlete_entry_pin(text) to authenticated;
