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

test("today assignments normalize embedded relations and filter by date", async () => {
  global.fetch = async () => new Response(JSON.stringify([
    { id:"assignment-1", session_id:"session-1", programmed_sessions:[{id:"session-1",session_date:"2026-09-11",name:"Power"}] },
    { id:"assignment-2", session_id:"session-2", programmed_sessions:[{id:"session-2",session_date:"2026-09-12",name:"Upper"}] },
  ]), {status:200,headers:{"Content-Type":"application/json"}});

  const sessions = await api.getAssignedSessions("athlete-1", "2026-09-11");

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session.id, "session-1");
  assert.equal(sessions[0].session.name, "Power");
});
