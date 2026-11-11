import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, asUser, id } from './support/database.mjs';
import { WorkoutSaver } from '../web/workout-saver.js';

test('PostgreSQL: atomic completion, editing, idempotency, isolation, constraints, PINs and RLS', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const call = (name,params,user=id(901)) => asUser(db,user,tx=>tx.query(`select * from ${name}(${params.map((_,i)=>'$'+(i+1)).join(',')})`,params)).then(r=>r.rows[0]);
  const log = await call('start_or_resume_workout',[id(1),id(31)]);
  const ex = (await db.query('select * from workout_exercises where workout_log_id=$1 order by position',[log.id])).rows;
  const sets = [{workout_exercise_id:ex[0].id,set_number:1,load_kg:65,reps:5,rpe:7,notes:'retained'}, {workout_exercise_id:ex[1].id,set_number:1,duration_seconds:4.2}];
  const save = (records,version,complete=true,rpe=7,notes='Test',athlete=id(1),user=id(901)) => call('save_workout',[log.id,athlete,JSON.stringify(records),version,complete,rpe,notes],user);
  await t.test('anonymous key cannot save; wrong athlete and foreign exercise are rejected', async () => {
    await assert.rejects(save(sets,log.updated_at,true,7,'Test',id(1),null),e=>e.code==='42501');
    await assert.rejects(save(sets,log.updated_at,true,7,'Test',id(2)),e=>e.code==='42501');
    await assert.rejects(save([{...sets[0],workout_exercise_id:id(999)}],log.updated_at),e=>e.code==='22023');
  });
  await t.test('one invalid row rolls back all sets and completion',async()=>{
    await assert.rejects(save([sets[0],{...sets[1],rpe:11}],log.updated_at));
    assert.equal((await db.query('select count(*)::int as n from set_logs')).rows[0].n,0);
    assert.equal((await db.query('select status from workout_logs where id=$1',[log.id])).rows[0].status,'in_progress');
  });
  const completed = await save(sets,log.updated_at);
  await t.test('completion persists supported measurements and permits partial workouts',async()=>{
    assert.equal(completed.status,'completed');
    assert.ok(completed.completed_at);
    assert.equal((await db.query('select count(*)::int as n from set_logs')).rows[0].n,2);
    assert.equal((await save(sets,log.updated_at)).updated_at,completed.updated_at,'lost-response retry must be idempotent');
  });
  const edited = await save([{workout_exercise_id:ex[0].id,set_number:1,load_kg:70,reps:6}],completed.updated_at,true,0,'Edited');
  await t.test('edits preserve IDs, omitted fields, completion time, and snapshot',async()=>{
    assert.equal(edited.completed_at,completed.completed_at);
    assert.equal(Number(edited.session_rpe),0);
    assert.equal(edited.athlete_notes,'Edited');
    const row=(await db.query('select * from set_logs where workout_exercise_id=$1',[ex[0].id])).rows[0];
    assert.equal(Number(row.load_kg),70);assert.equal(Number(row.reps),6);
    assert.equal(Number(row.rpe),7);assert.equal(row.notes,'retained');
    assert.equal((await db.query('select count(*)::int as n from set_logs')).rows[0].n,2);
    const snapshot=(await db.query('select * from workout_exercises where id=$1',[ex[0].id])).rows[0];
    assert.equal(Number(snapshot.prescribed_load_kg),50);
  });
  await t.test('stale conflicting writes, duplicate sets, invalid set numbers, negative and protected fields fail',async()=>{
    await assert.rejects(save([{...sets[0],load_kg:80}],completed.updated_at),e=>e.code==='40001');
    for(const records of [[sets[0],sets[0]],[{...sets[0],set_number:4}],[{...sets[0],load_kg:-1}],[{...sets[0],id:id(555)}]]) await assert.rejects(save(records,edited.updated_at));
    await assert.rejects(save([{...sets[0],load_kg:80}],edited.updated_at,false),e=>e.code==='22023');
  });
  await t.test('completed sets remain protected from direct REST-style writes',async()=>{
    const rows=await asUser(db,id(901),tx=>tx.query('update set_logs set load_kg=999 where workout_exercise_id=$1 returning *',[ex[0].id]));
    assert.equal(rows.rows.length,0);
    await assert.rejects(asUser(db,id(901),tx=>tx.query('insert into set_logs(workout_exercise_id,set_number,reps) values ($1,2,99)',[ex[0].id])),e=>e.code==='42501');
  });
  await t.test('resume returns same log and never changes prescriptions or revision',async()=>{
    await db.exec(`insert into session_exercises (session_id,position,exercise_name,tracking_type,sets) values ('${id(31)}',3,'Later programme addition','reps_only',2)`);
    const resumed=await call('start_or_resume_workout',[id(1),id(31)]);
    assert.equal(resumed.id,log.id);assert.equal(resumed.updated_at,edited.updated_at);
    assert.equal((await db.query('select count(*)::int as n from workout_exercises where workout_log_id=$1',[log.id])).rows[0].n,2);
  });
  await t.test('another athlete has independent workout and sets',async()=>{
    const other=await call('start_or_resume_workout',[id(2),id(31)]);
    assert.notEqual(other.id,log.id);
    assert.equal((await db.query('select count(*)::int as n from set_logs sl join workout_exercises we on we.id=sl.workout_exercise_id where we.workout_log_id=$1',[other.id])).rows[0].n,0);
  });
  await t.test('explicit individual Auth linkage is honoured',async()=>{
    await db.exec(`insert into auth.users values ('${id(902)}'); update profiles set auth_user_id='${id(902)}' where id='${id(1)}'`);
    await assert.rejects(save([],edited.updated_at),e=>e.code==='42501');
    await db.exec(`update profiles set auth_user_id=null where id='${id(1)}'`);
  });
  await t.test('Coaches PIN is validated server-side and never grants management rights',async()=>{
    assert.equal((await call('verify_athlete_entry_pin',['Coaches','1357'],null)).verify_athlete_entry_pin,true);
    assert.equal((await call('verify_athlete_entry_pin',['Coaches','0000'],null)).verify_athlete_entry_pin,false);
    await assert.rejects(call('set_athlete_entry_pin',['Coaches','0000']),e=>e.code==='42501');
    await assert.rejects(asUser(db,id(901),tx=>tx.query("insert into teams(name,age_group) values ('Forbidden','Coaches')")),e=>e.code==='42501');
    await assert.rejects(asUser(db,id(901),tx=>tx.query('select * from app_settings')),e=>e.code==='42501');
    await call('set_athlete_entry_pin',['Coaches','1357'],id(900));
  });
});

function storage() { const map=new Map();return {getItem:key=>map.get(key) || null,setItem:(key,value)=>map.set(key,value)}; }
test('save queue serializes changes and retains newer input while earlier batch is in flight', async()=>{
  let release;const calls=[];const store=storage();
  const saver=new WorkoutSaver({id:'log',athlete_id:'a',updated_at:'v1'},{storage:store,status:()=>{},save:async(log,sets)=>{
    calls.push({log,sets}); if(calls.length===1)await new Promise(resolve=>{release=resolve;});
    return {...log,updated_at:'v'+(calls.length+1)};
  }});
  saver.put({workout_exercise_id:'ex',set_number:1,reps:5});
  const first=saver.flush();await Promise.resolve();
  saver.put({workout_exercise_id:'ex',set_number:1,reps:6});
  const second=saver.flush();release();await Promise.all([first,second]);
  assert.equal(calls.length,2);assert.equal(calls[1].log.updated_at,'v2');assert.equal(calls[1].sets[0].reps,6);
  assert.deepEqual(saver.drafts(),{});
});
test('failure and reload preserve original revision; conflicts are never blindly retried',async()=>{
  const store=storage(),log={id:'log',athlete_id:'a',updated_at:'v1'};let calls=0;
  const options={storage:store,status:()=>{},save:async()=>{calls++;throw Object.assign(new Error('Conflict'),{code:'40001'});}};
  const saver=new WorkoutSaver(log,options);saver.put({workout_exercise_id:'ex',set_number:1,reps:7});
  await assert.rejects(saver.flush());await assert.rejects(saver.flush());assert.equal(calls,1);
  const restored=new WorkoutSaver({...log,updated_at:'v2'},options);
  assert.equal(Object.values(restored.drafts())[0].reps,7);assert.equal(store.getItem(restored.versionKey),'v1');
});

test('a second tab cannot adopt the first tab revision to authorise a stale write',async()=>{
  const store=storage(),log={id:'log',athlete_id:'a',updated_at:'v1'};let version='v1';
  const options={storage:store,status:()=>{},save:async input=>{
    if(input.updated_at!==version)throw Object.assign(new Error('Conflict'),{code:'40001'});
    version='v2';return {...input,updated_at:version};
  }};
  const first=new WorkoutSaver(log,options),second=new WorkoutSaver(log,options);
  first.put({workout_exercise_id:'ex',set_number:1,reps:5});await first.flush();
  second.put({workout_exercise_id:'ex',set_number:1,reps:6});await assert.rejects(second.flush(),e=>e.code==='40001');
  assert.equal(Object.values(second.drafts())[0].reps,6);
});
