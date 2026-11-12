import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, asUser, id, today } from './support/database.mjs';

function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test('PostgreSQL: training period duplication is atomic, idempotent-by-skip, team-aware and never touches history', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const set = (name, params, user = id(900)) =>
    asUser(db, user, tx => tx.query(`select * from ${name}(${params.map((_, i) => '$' + (i + 1)).join(',')})`, params)).then(r => r.rows);
  const preview = (start, end, dest, sourceTeam = null, user) => set('preview_training_period_duplication', [start, end, dest, sourceTeam], user);
  const duplicate = (start, end, dest, mode = 'add', exclude = [], team = null, sourceTeam = null, user) =>
    set('duplicate_training_period', [start, end, dest, mode, exclude, team, sourceTeam], user);
  const destWeek = addDays(today, 7);

  await t.test('preview shows both same-day sessions with exercise counts and team names, no conflict yet', async () => {
    const rows = await preview(today, today, destWeek);
    assert.equal(rows.length, 2);
    const marlins = rows.find(r => r.session_name === 'Fixture Strength');
    assert.equal(Number(marlins.exercise_count), 2);
    assert.deepEqual(marlins.team_names, ['Test Marlins']);
    assert.equal(marlins.new_date.slice(0, 10), destWeek);
    assert.equal(marlins.would_conflict, false);
  });

  await t.test('filtering to a team only previews and duplicates that team\'s sessions, not every session in the date range', async () => {
    const marlinsOnly = await preview(today, today, destWeek, id(11));
    assert.equal(marlinsOnly.length, 1);
    assert.equal(marlinsOnly[0].session_name, 'Fixture Strength');
    const coachesOnly = await preview(today, today, destWeek, id(12));
    assert.equal(coachesOnly.length, 1);
    assert.equal(coachesOnly[0].session_name, 'Coaches Training');

    const beforeCount = (await db.query('select count(*)::int as n from programmed_sessions')).rows[0].n;
    const added = await duplicate(today, today, addDays(today, 90), 'add', [], null, id(11));
    assert.equal(added.length, 1);
    assert.equal(added[0].status, 'added');
    const copy = (await db.query('select name from programmed_sessions where id=$1', [added[0].new_session_id])).rows[0];
    assert.equal(copy.name, 'Fixture Strength');
    assert.equal((await db.query('select count(*)::int as n from programmed_sessions')).rows[0].n, beforeCount + 1, 'only the filtered team\'s session should be copied');
  });

  await t.test('empty source period and invalid range are handled without error or mutation', async () => {
    assert.deepEqual(await preview(addDays(today, 100), addDays(today, 100), destWeek), []);
    assert.deepEqual(await duplicate(addDays(today, 100), addDays(today, 100), destWeek), []);
    await assert.rejects(duplicate(addDays(today, 1), today, destWeek), e => e.code === '22023');
  });

  await t.test('only a coach can duplicate; anonymous and athlete callers are rejected', async () => {
    await assert.rejects(duplicate(today, today, destWeek, 'add', [], null, null, null), e => e.code === '42501');
    await assert.rejects(duplicate(today, today, destWeek, 'add', [], null, null, id(1)), e => e.code === '42501');
  });

  const added = await duplicate(today, today, destWeek);
  await t.test('duplication copies both sessions with correct offset date, new IDs, and preserved prescriptions/team assignments', async () => {
    assert.equal(added.length, 2);
    assert.ok(added.every(r => r.status === 'added' && r.new_session_id));
    assert.ok(added.every(r => r.new_date.slice(0, 10) === destWeek));
    assert.notEqual(added[0].new_session_id, added[0].source_session_id);
    const copy = (await db.query('select * from programmed_sessions where id=$1', [added.find(r => r.source_session_id === id(31)).new_session_id])).rows[0];
    assert.equal(copy.name, 'Fixture Strength');
    assert.equal(copy.duplicated_from_session_id, id(31));
    const exercises = (await db.query('select * from session_exercises where session_id=$1 order by position', [copy.id])).rows;
    assert.equal(exercises.length, 2);
    assert.equal(Number(exercises[0].prescribed_load_kg), 50);
    assert.notEqual(exercises[0].id, (await db.query('select id from session_exercises where session_id=$1 order by position limit 1', [id(31)])).rows[0].id);
    const assignments = (await db.query('select athlete_id,assigned_team_id from session_assignments where session_id=$1 order by athlete_id', [copy.id])).rows;
    assert.deepEqual(assignments.map(a => a.assigned_team_id), [id(11), id(11)]);
  });

  await t.test('editing a copied session leaves the original untouched', async () => {
    const copyId = added.find(r => r.source_session_id === id(31)).new_session_id;
    await asUser(db, id(900), tx => tx.query('update session_exercises set prescribed_reps=8 where session_id=$1 and position=1', [copyId]));
    const originalReps = (await db.query('select prescribed_reps from session_exercises where session_id=$1 and position=1', [id(31)])).rows[0].prescribed_reps;
    assert.equal(Number(originalReps), 5, 'original session must not change when the copy is edited');
  });

  await t.test('skip mode detects the already-duplicated session and creates nothing new; add mode still creates another copy', async () => {
    const beforeCount = (await db.query('select count(*)::int as n from programmed_sessions')).rows[0].n;
    const skipped = await duplicate(today, today, destWeek, 'skip');
    assert.ok(skipped.every(r => r.status === 'skipped' && r.new_session_id === null));
    assert.equal((await db.query('select count(*)::int as n from programmed_sessions')).rows[0].n, beforeCount, 'skip mode must not insert duplicate rows');
    const addedAgain = await duplicate(today, today, destWeek, 'add');
    assert.ok(addedAgain.every(r => r.status === 'added'));
    assert.equal((await db.query('select count(*)::int as n from programmed_sessions')).rows[0].n, beforeCount + 2);
  });

  await t.test('reassigning to a destination team uses that team\'s current roster, not the source team\'s athlete IDs', async () => {
    const [reassigned] = await duplicate(today, today, addDays(today, 30), 'add', [id(32)], id(12));
    const assignments = (await db.query('select athlete_id,assigned_team_id from session_assignments where session_id=$1', [reassigned.new_session_id])).rows;
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].athlete_id, id(3));
    assert.equal(assignments[0].assigned_team_id, id(12));
  });

  await t.test('excluded sessions are skipped entirely and historical result tables are never touched', async () => {
    const [onlyOne] = await duplicate(today, today, addDays(today, 60), 'add', [id(32)]);
    assert.equal(onlyOne.source_session_id, id(31));
    assert.equal((await db.query("select count(*)::int as n from programmed_sessions where session_date=$1", [addDays(today, 60)])).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from workout_logs')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from workout_exercises')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from set_logs')).rows[0].n, 0);
  });
});
