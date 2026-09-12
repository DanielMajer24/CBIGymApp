const config = window.CBI_CONFIG || {};
const baseUrl = (config.supabaseUrl || "").replace(/\/$/, "");
const anonKey = config.supabaseAnonKey || "";

export const configured = Boolean(baseUrl && anonKey && !baseUrl.includes("your-project"));

function fail(message, details = "") {
  const error = new Error(message);
  error.details = details;
  return error;
}

function headers(token, extra = {}) {
  const bearer = token || anonKey;
  return { apikey: anonKey, Authorization: `Bearer ${bearer}`, ...extra };
}

function queryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const result = search.toString();
  return result ? `?${result}` : "";
}

async function request(path, options = {}, token) {
  if (!configured) throw fail("Supabase is not configured", "Copy web/app-config.example.js to web/app-config.js and add your project URL and anon key.");
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: headers(token, options.headers),
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw fail(body?.message || body?.error || `Request failed (${response.status})`, body?.hint || body?.details || "");
  return body;
}

export const db = {
  list(table, params, token) {
    return request(`/rest/v1/${table}${queryString(params)}`, {}, token);
  },
  single(table, params, token) {
    return request(`/rest/v1/${table}${queryString(params)}`, { headers: { Accept: "application/vnd.pgrst.object+json" } }, token);
  },
  insert(table, body, token) {
    return request(`/rest/v1/${table}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(body),
    }, token);
  },
  update(table, params, body, token) {
    return request(`/rest/v1/${table}${queryString(params)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(body),
    }, token);
  },
  remove(table, params, token) {
    return request(`/rest/v1/${table}${queryString(params)}`, { method: "DELETE", headers: { Prefer: "return=representation" } }, token);
  },
  upsert(table, body, conflictColumns, token) {
    return request(`/rest/v1/${table}${queryString({ on_conflict: conflictColumns })}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(body),
    }, token);
  },
  rpc(name, body, token) {
    return request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, token);
  },
};

export const auth = {
  async signIn(email, password) {
    return request("/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  },
  async signInAnonymously() {
    return request("/auth/v1/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  },
  async refresh(refreshToken) {
    return request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },
  async user(accessToken) {
    return request("/auth/v1/user", {}, accessToken);
  },
  async signOut(accessToken) {
    return request("/auth/v1/logout", { method: "POST" }, accessToken);
  },
};

export async function getActiveAthletes(token) {
  return db.list("profiles", { select: "id,first_name,last_name,name", role: "eq.athlete", active: "eq.true", order: "name.asc" }, token);
}

export async function getAthleteTeams(athleteId, token) {
  return db.list("athlete_teams", { select: "team_id,teams(id,name,age_group)", athlete_id: `eq.${athleteId}` }, token);
}

export async function getAssignedSessions(athleteId, date, token) {
  return getAssignedSessionsInRange(athleteId, date, date, token);
}

function normaliseAssignment(assignment) {
  return {
    ...assignment,
    session: Array.isArray(assignment.programmed_sessions) ? assignment.programmed_sessions[0] : assignment.programmed_sessions,
  };
}

export async function getAssignedSessionsInRange(athleteId, startDate, endDate, token) {
  const assignments = await db.list("session_assignments", {
    select: "id,session_id,programmed_sessions!session_assignments_session_id_fkey(id,session_date,name,description,session_type,estimated_duration_minutes)",
    athlete_id: `eq.${athleteId}`,
  }, token);
  return assignments
    .map(normaliseAssignment)
    .filter(({ session }) => session?.session_date >= startDate && session?.session_date <= endDate)
    .sort((a, b) => a.session.session_date.localeCompare(b.session.session_date) || a.session.name.localeCompare(b.session.name));
}

export async function getAssignedSession(athleteId, sessionId, token) {
  const assignments = await db.list("session_assignments", {
    select: "id,session_id,programmed_sessions!session_assignments_session_id_fkey(id,session_date,name,description,session_type,estimated_duration_minutes)",
    athlete_id: `eq.${athleteId}`,
    session_id: `eq.${sessionId}`,
    limit: "1",
  }, token);
  return assignments[0] ? normaliseAssignment(assignments[0]) : null;
}

export function getSessionExercises(sessionId, token) {
  return db.list("session_exercises", { select: "*", session_id: `eq.${sessionId}`, order: "position.asc" }, token);
}

export async function getWorkout(athleteId, sessionId, token) {
  const logs = await db.list("workout_logs", {
    select: "*", athlete_id: `eq.${athleteId}`, session_id: `eq.${sessionId}`, limit: "1",
  }, token);
  return logs[0] || null;
}

export async function getWorkoutDetail(logId, token) {
  const [log, exercises] = await Promise.all([
    db.single("workout_logs", { select: "*", id: `eq.${logId}` }, token),
    db.list("workout_exercises", { select: "*", workout_log_id: `eq.${logId}`, order: "position.asc" }, token),
  ]);
  const sets = exercises.length
    ? await db.list("set_logs", { select: "*", workout_exercise_id: `in.(${exercises.map((exercise) => exercise.id).join(",")})`, order: "set_number.asc" }, token)
    : [];
  return { log, exercises: exercises.map((exercise) => ({ ...exercise, setLogs: sets.filter((set) => set.workout_exercise_id === exercise.id) })) };
}

export async function startWorkout(athleteId, sessionId, token) {
  const result = await db.rpc("start_or_resume_workout", { p_athlete_id: athleteId, p_session_id: sessionId }, token);
  return Array.isArray(result) ? result[0] : result;
}

export function saveSet(set, token) {
  return db.upsert("set_logs", set, "workout_exercise_id,set_number", token);
}

export function finishWorkout(logId, rpe, notes, token) {
  return db.rpc("finish_workout", { p_workout_log_id: logId, p_session_rpe: rpe || null, p_notes: notes || null }, token);
}

export function getPreviousSets(athleteId, exerciseId, currentLogId, token) {
  if (!exerciseId) return Promise.resolve([]);
  return db.rpc("last_exercise_sets", {
    p_athlete_id: athleteId, p_exercise_id: exerciseId, p_exclude_log_id: currentLogId,
  }, token);
}

export function getExerciseHistory(athleteId, exerciseId, token) {
  return db.rpc("exercise_history", { p_athlete_id: athleteId, p_exercise_id: exerciseId }, token);
}

export function getWorkoutHistory(athleteId, token) {
  return db.list("workout_logs", {
    select: "id,session_date,session_name,session_type,status,completed_at,session_rpe", athlete_id: `eq.${athleteId}`,
    status: "eq.completed", order: "session_date.desc", limit: "40",
  }, token);
}

export function getWorkoutLogsInRange(athleteId, startDate, endDate, token) {
  return db.list("workout_logs", {
    select: "id,session_id,session_date,session_name,session_type,status,completed_at,session_rpe",
    athlete_id: `eq.${athleteId}`,
    session_date: `gte.${startDate}`,
    and: `(session_date.lte.${endDate})`,
    order: "session_date.asc",
    limit: "100",
  }, token);
}

export function getInProgressWorkouts(athleteId, token) {
  return db.list("workout_logs", {
    select: "id,session_id,session_name,session_type,session_date,status", athlete_id: `eq.${athleteId}`,
    status: "eq.in_progress", order: "session_date.desc", limit: "20",
  }, token);
}

export async function getCoachProfile(accessToken) {
  const user = await auth.user(accessToken);
  const profiles = await db.list("profiles", { select: "id,first_name,last_name,name,role,active", auth_user_id: `eq.${user.id}`, limit: "1" }, accessToken);
  return { user, profile: profiles[0] || null };
}

export function verifyAthleteEntryPin(ageGroup, pin) {
  return db.rpc("verify_athlete_entry_pin", { p_age_group: ageGroup, p_pin: pin });
}

export function setAthleteEntryPin(ageGroup, pin, accessToken) {
  return db.rpc("set_athlete_entry_pin", { p_age_group: ageGroup, p_pin: pin }, accessToken);
}
