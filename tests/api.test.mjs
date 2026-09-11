import assert from "node:assert/strict";
import test from "node:test";

global.window = {
  CBI_CONFIG: {
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
  },
};

const api = await import("../web/api.js");

test("REST upsert uses a conflict target and merge preference", async () => {
  let received;
  global.fetch = async (url, options) => {
    received = { url:String(url), options };
    return new Response(JSON.stringify([{ id:"set-id" }]), {status:201,headers:{"Content-Type":"application/json"}});
  };

  await api.db.upsert("set_logs", {workout_exercise_id:"exercise-id",set_number:1,reps:5}, "workout_exercise_id,set_number");

  assert.match(received.url, /rest\/v1\/set_logs\?on_conflict=workout_exercise_id%2Cset_number/);
  assert.equal(received.options.headers.Prefer, "resolution=merge-duplicates,return=representation");
  assert.equal(received.options.headers.apikey, "public-anon-key");
  assert.deepEqual(JSON.parse(received.options.body), {workout_exercise_id:"exercise-id",set_number:1,reps:5});
});

test("in-progress workouts query is scoped to the athlete and status", async () => {
  let received;
  global.fetch = async (url) => {
    received = String(url);
    return new Response(JSON.stringify([]), {status:200,headers:{"Content-Type":"application/json"}});
  };

  await api.getInProgressWorkouts("athlete-9");

  assert.match(received, /workout_logs\?/);
  assert.match(received, /athlete_id=eq\.athlete-9/);
  assert.match(received, /status=eq\.in_progress/);
});

test("athlete entry code is verified through a server RPC", async () => {
  let received;
  global.fetch = async (url, options) => {
    received = { url:String(url), options };
    return new Response("true", {status:200,headers:{"Content-Type":"application/json"}});
  };

  const allowed = await api.verifyAthleteEntryPin("2468");

  assert.equal(allowed, true);
  assert.match(received.url, /rest\/v1\/rpc\/verify_athlete_entry_pin$/);
  assert.deepEqual(JSON.parse(received.options.body), {p_pin:"2468"});
});

test("anonymous athlete sign-in creates a token-bearing Auth session", async () => {
  let received;
  global.fetch = async (url, options) => {
    received = { url:String(url), options };
    return new Response(JSON.stringify({access_token:"athlete-access-token",refresh_token:"refresh-token",expires_at:9999999999}), {status:200,headers:{"Content-Type":"application/json"}});
  };

  const session = await api.auth.signInAnonymously();

  assert.equal(session.access_token, "athlete-access-token");
  assert.match(received.url, /auth\/v1\/signup$/);
  assert.equal(received.options.headers.Authorization, "Bearer public-anon-key");
  assert.deepEqual(JSON.parse(received.options.body), {});
});

test("only a coach session can set the athlete entry code", async () => {
  let received;
  global.fetch = async (url, options) => {
    received = { url:String(url), options };
    return new Response("null", {status:200,headers:{"Content-Type":"application/json"}});
  };

  await api.setAthleteEntryPin("2468", "coach-access-token");

  assert.match(received.url, /rest\/v1\/rpc\/set_athlete_entry_pin$/);
  assert.equal(received.options.headers.Authorization, "Bearer coach-access-token");
  assert.deepEqual(JSON.parse(received.options.body), {p_pin:"2468"});
});

test("today assignments normalize embedded relations and use the athlete token", async () => {
  let received;
  global.fetch = async (url, options) => {
    received = { url:String(url), options };
    return new Response(JSON.stringify([
      { id:"assignment-1", session_id:"session-1", programmed_sessions:[{id:"session-1",session_date:"2026-09-11",name:"Power",session_type:"power"}] },
      { id:"assignment-2", session_id:"session-2", programmed_sessions:[{id:"session-2",session_date:"2026-09-12",name:"Upper",session_type:"strength"}] },
    ]), {status:200,headers:{"Content-Type":"application/json"}});
  };

  const sessions = await api.getAssignedSessions("athlete-1", "2026-09-11", "athlete-access-token");

  assert.equal(received.options.headers.Authorization, "Bearer athlete-access-token");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session.id, "session-1");
  assert.equal(sessions[0].session.name, "Power");
  assert.equal(sessions[0].session.session_type, "power");
});

test("calendar assignments include the complete requested month range", async () => {
  let received;
  global.fetch = async (url) => {
    received = String(url);
    return new Response(JSON.stringify([
      { id:"assignment-1", session_id:"session-1", programmed_sessions:[{id:"session-1",session_date:"2026-09-02",name:"Strength"}] },
      { id:"assignment-2", session_id:"session-2", programmed_sessions:[{id:"session-2",session_date:"2026-09-30",name:"Power"}] },
      { id:"assignment-3", session_id:"session-3", programmed_sessions:[{id:"session-3",session_date:"2026-10-01",name:"Conditioning"}] },
    ]), {status:200,headers:{"Content-Type":"application/json"}});
  };

  const sessions = await api.getAssignedSessionsInRange("athlete-1", "2026-09-01", "2026-09-30");

  assert.match(received, /session_assignments\?/);
  assert.match(received, /athlete_id=eq\.athlete-1/);
  assert.equal(sessions.map((entry) => entry.session.name).join(","), "Strength,Power");
});

test("calendar workout logs are scoped to the athlete and date window", async () => {
  let received;
  global.fetch = async (url) => {
    received = String(url);
    return new Response(JSON.stringify([]), {status:200,headers:{"Content-Type":"application/json"}});
  };

  await api.getWorkoutLogsInRange("athlete-9", "2026-09-01", "2026-09-30");

  assert.match(received, /workout_logs\?/);
  assert.match(received, /athlete_id=eq\.athlete-9/);
  assert.match(received, /session_date=gte\.2026-09-01/);
  assert.match(received, /session_date\.lte\.2026-09-30/);
});

test("athlete workout writes and RPCs send the anonymous Auth token", async () => {
  const received = [];
  global.fetch = async (url, options) => {
    received.push({ url:String(url), options });
    return new Response(JSON.stringify([{ id:"workout-id" }]), {status:200,headers:{"Content-Type":"application/json"}});
  };

  await api.startWorkout("athlete-1", "session-1", "athlete-access-token");
  await api.saveSet({workout_exercise_id:"exercise-1",set_number:1,reps:5}, "athlete-access-token");
  await api.finishWorkout("workout-id", 7, "Good", "athlete-access-token");

  assert.equal(received.length, 3);
  received.forEach((request) => assert.equal(request.options.headers.Authorization, "Bearer athlete-access-token"));
  assert.match(received[0].url, /rpc\/start_or_resume_workout$/);
  assert.match(received[1].url, /rest\/v1\/set_logs\?on_conflict=/);
  assert.match(received[2].url, /rpc\/finish_workout$/);
});
