import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';

export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date());
export async function createDatabase({ migrated = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto }, parsers: { 1082: value => value, 1184: value => value, 1700: Number } });
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await db.exec(await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
  if (migrated) {
    for (const file of ['008_atomic_workout_save.sql', '009_coaches_training_group.sql', '010_training_period_duplication.sql', '011_duplicate_training_period_source_team_filter.sql']) {
      try { await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  await db.exec(`insert into auth.users values ('${id(900)}'), ('${id(901)}');
    insert into profiles (id, first_name, last_name, role, auth_user_id) values
    ('${id(1)}','Alex','Fixture','athlete',null),
    ('${id(2)}','Blair','Fixture','athlete',null),
    ('${id(3)}','Casey','Fixture','athlete',null),
    ('${id(9)}','Admin','Fixture','coach','${id(900)}');
    insert into teams (id, name, age_group) values
    ('${id(11)}','Test Marlins','U18'), ('${id(12)}','Coaches','U18');
    insert into athlete_teams (athlete_id,team_id) values
    ('${id(1)}','${id(11)}'), ('${id(2)}','${id(11)}'), ('${id(3)}','${id(12)}');
    insert into exercises (id,name,tracking_type) values
    ('${id(21)}','Fixture Squat','weight_reps'), ('${id(22)}','Fixture Sprint','duration');
    insert into programmed_sessions (id,session_date,name,session_type) values
    ('${id(31)}','${today}','Fixture Strength','strength'),
    ('${id(32)}','${today}','Coaches Training','conditioning'),
    ('${id(33)}',date '${today}' + interval '1 month','Next Month Session','power');
    insert into session_exercises (session_id,exercise_id,position,exercise_name,tracking_type,sets,prescribed_reps,prescribed_load_kg)
    select s.id, e.id, case when e.id='${id(21)}' then 1 else 2 end, e.name, e.tracking_type, 3, 5, 50
    from programmed_sessions s cross join exercises e;
    insert into session_assignments (session_id,athlete_id,assigned_team_id) values
    ('${id(31)}','${id(1)}','${id(11)}'), ('${id(31)}','${id(2)}','${id(11)}'),
    ('${id(32)}','${id(3)}','${id(12)}'), ('${id(33)}','${id(1)}','${id(11)}');
    insert into app_settings (setting_key,setting_value) values
    ('athlete_entry_pin_hash_u18',crypt('2468',gen_salt('bf',4))),
    ('athlete_entry_pin_hash_coaches',crypt('1357',gen_salt('bf',4)));`);
  if (migrated) {
    const supported = await db.query(`select pg_get_constraintdef(oid) as definition from pg_constraint where conname='teams_age_group_check'`);
    if (supported.rows[0]?.definition.includes('Coaches')) await db.exec(`update teams set age_group='Coaches' where id='${id(12)}'`);
  }
  return db;
}

export function asUser(db, userId, callback) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId || '']);
    return callback(tx);
  });
}
