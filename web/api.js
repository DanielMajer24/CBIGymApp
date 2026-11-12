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
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options, signal: controller.signal,
      headers: headers(token, options.headers),
    });
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const error = fail(body?.message || body?.error || `Request failed (${response.status})`, body?.hint || body?.details || "");
      error.code = body?.code;
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw fail("Saving took too long. Your changes are still on this device; try again.");
    throw error;
  } finally { clearTimeout(deadline); }
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
    select: "id,session_id,programmed_sessions!session_assignments_session_id_fkey!inner(id,session_date,name,description,session_type,estimated_duration_minutes)",
    athlete_id: `eq.${athleteId}`,
    "programmed_sessions.session_date": `gte.${startDate}`,
    "programmed_sessions.and": `(session_date.lte.${endDate})`,
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
  return db.rpc("finish_workout", { p_workout_log_id: logId, p_session_rpe: rpe ?? null, p_notes: notes || null }, token);
}

export async function saveWorkout(log, sets, complete, rpe, notes, token) {
  const response = await db.rpc("save_workout", {
    p_workout_log_id: log.id, p_athlete_id: log.athlete_id, p_sets: sets,
    p_expected_updated_at: log.updated_at, p_complete: complete,
    p_session_rpe: rpe ?? null, p_notes: notes || null,
  }, token);
  const saved = Array.isArray(response) ? response[0] : response;
  if (!saved?.updated_at || saved.id !== log.id || saved.athlete_id !== log.athlete_id || (complete && saved.status !== "completed")) {
    throw fail("The server did not confirm the save. Your changes are still on this device.");
  }
  return saved;
}

async function matchingSessionIds(startDate, endDate, { teamId, ageGroup } = {}, token) {
  if (!teamId && !ageGroup) return null;
  const params = {
    select: "session_id,programmed_sessions!session_assignments_session_id_fkey!inner(session_date),teams!inner(age_group)",
    "programmed_sessions.session_date": `gte.${startDate}`,
    "programmed_sessions.and": `(session_date.lte.${endDate})`,
  };
  if (teamId) params.assigned_team_id = `eq.${teamId}`;
  if (ageGroup) params["teams.age_group"] = `eq.${ageGroup}`;
  const rows = await db.list("session_assignments", params, token);
  return new Set(rows.map(row => row.session_id));
}

export async function getTeamCalendar(startDate, endDate, token, filters = {}) {
  // Bounded month query, paginated so large schedules aren't silently truncated.
  // Team/age-group filtering is resolved separately against session_assignments
  // (database-side) so unfiltered callers still see unassigned sessions.
  const matching = await matchingSessionIds(startDate, endDate, filters, token);
  const sessions = [];
  for (let offset = 0; ; offset += 200) {
    const page = await db.list("programmed_sessions", {
      select: "id,name,session_date,session_type,description,estimated_duration_minutes,session_assignments(assigned_team_id,teams(id,name,age_group))",
      session_date: `gte.${startDate}`, and: `(session_date.lte.${endDate})`,
      order: "session_date.asc,id.asc", limit: "200", offset,
    }, token);
    sessions.push(...page);
    if (page.length < 200) break;
  }
  return sessions.filter(session => !matching || matching.has(session.id)).map(session => {
    const teams = new Map();
    for (const assignment of session.session_assignments || []) {
      const team = Array.isArray(assignment.teams) ? assignment.teams[0] : assignment.teams;
      if (team) teams.set(team.id, team);
    }
    return { session, teams: [...teams.values()], coach: true };
  });
}

export async function getSessionsPage({ startDate, endDate, page = 0, pageSize = 20 } = {}, token) {
  const params = { select: "*", order: "session_date.desc,id.desc", limit: String(pageSize + 1), offset: String(page * pageSize) };
  if (startDate) params.session_date = `gte.${startDate}`;
  if (endDate) params.and = `(session_date.lte.${endDate})`;
  const rows = await db.list("programmed_sessions", params, token);
  return { sessions: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

export function previewDuplication(sourceStart, sourceEnd, destinationStart, sourceTeamId, token) {
  return db.rpc("preview_training_period_duplication", {
    p_source_start: sourceStart, p_source_end: sourceEnd, p_destination_start: destinationStart,
    p_source_team_id: sourceTeamId || null,
  }, token);
}

export function duplicateTrainingPeriod(sourceStart, sourceEnd, destinationStart, conflictMode, excludeSessionIds, destinationTeamId, sourceTeamId, token) {
  return db.rpc("duplicate_training_period", {
    p_source_start: sourceStart, p_source_end: sourceEnd, p_destination_start: destinationStart,
    p_conflict_mode: conflictMode, p_exclude_session_ids: excludeSessionIds || [], p_destination_team_id: destinationTeamId || null,
    p_source_team_id: sourceTeamId || null,
  }, token);
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
