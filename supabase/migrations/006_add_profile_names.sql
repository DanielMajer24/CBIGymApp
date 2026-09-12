-- Keep athlete profiles identifiable across teams and seasons. The generated
-- full name preserves existing reads while first_name and last_name become the
-- fields coaches edit directly.

alter table public.profiles
  add column first_name text,
  add column last_name text;

-- Split only on the first space. A single-word legacy roster entry retains an
-- empty last name for the coach to complete in the athlete editor.
update public.profiles
set
  first_name = split_part(btrim(name), ' ', 1),
  last_name = case
    when strpos(btrim(name), ' ') > 0 then btrim(substr(btrim(name), strpos(btrim(name), ' ') + 1))
    else ''
  end;

alter table public.profiles
  alter column first_name set not null,
  alter column last_name set not null,
  add constraint profiles_first_name_check check (char_length(btrim(first_name)) > 0);

-- PostgreSQL cannot convert an existing regular column into a generated one,
-- so replace it after its data has been copied above. No history references a
-- profile name; workout snapshots already store the workout details they need.
alter table public.profiles drop column name;
alter table public.profiles
  add column name text generated always as (btrim(first_name || ' ' || last_name)) stored;
alter table public.profiles alter column name set not null;
