import {
  configured, auth, db, getActiveAthletes, getAthleteTeams, getAssignedSessions,
  getWorkout, getWorkoutDetail, startWorkout, saveSet, finishWorkout,
  getPreviousSets, getExerciseHistory, getWorkoutHistory, getCoachProfile,
} from "./api.js";

const root = document.querySelector("#app");
const athleteKey = "cbi-athlete-id";
const coachKey = "cbi-coach-session";
const state = { athlete: null, athleteTeams: [], coachSession: null, coachProfile: null, builder: null, timers: new Map(), saves: new Map() };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
}
function day() {
  const parts = new Intl.DateTimeFormat("en", {timeZone:"Australia/Brisbane",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type,part.value]));
  return value.year + "-" + value.month + "-" + value.day;
}
function dateLabel(value) { return new Intl.DateTimeFormat("en-AU", { weekday:"long", day:"numeric", month:"long" }).format(new Date(value + "T12:00:00")); }
function shortDate(value) { return new Intl.DateTimeFormat("en-AU", { day:"numeric", month:"short" }).format(new Date(value + "T12:00:00")); }
function route() {
  const raw = (location.hash || "#today").slice(1);
  const pair = raw.split("?");
  return { path: pair[0], params: new URLSearchParams(pair[1] || "") };
}
function go(path) { location.hash = "#" + path; }
function coachToken() { return state.coachSession?.access_token; }
function numeric(value) { return value === "" || value === null || value === undefined ? null : Number(value); }
function html(parts) { return parts.join(""); }
function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3000);
}
function failure(error) {
  console.error(error);
  toast(error.details ? error.message + ": " + error.details : error.message);
}
function athleteNav() {
  const active = route().path;
  return '<nav class="bottom-nav" aria-label="Athlete navigation">' +
    '<a class="' + (active === "today" ? "active" : "") + '" href="#today"><span>◉</span>Today</a>' +
    '<a class="' + (active === "history" ? "active" : "") + '" href="#history"><span>◷</span>History</a>' +
    '<a class="' + (active === "profile" ? "active" : "") + '" href="#profile"><span>◎</span>Profile</a></nav>';
}
function coachNav() {
  const current = route().path;
  return '<nav class="coach-nav" aria-label="Coach navigation">' +
    [["dashboard","Dashboard"],["sessions","Sessions"],["templates","Templates"],["athletes","Athletes"],["exercises","Exercises"]]
      .map((item) => '<a class="' + (current.indexOf("coach/" + item[0]) >= 0 ? "active" : "") + '" href="#coach/' + item[0] + '">' + item[1] + "</a>").join("") + "</nav>";
}
function shell(content, coach) {
  root.innerHTML = '<main class="shell"><header class="topbar">' +
    '<a class="brand" href="#' + (coach ? "coach/dashboard" : "today") + '"><span class="brand-mark">C</span><span>CBI Performance</span></a>' +
    (coach ? '<button class="button small ghost" data-action="coach-signout">Sign out</button>' :
      '<button class="button small ghost" data-action="change-athlete">' + esc(state.athlete?.name || "Coach") + "</button>") +
    "</header>" + (coach ? coachNav() : "") + content + "</main>" + (coach ? "" : athleteNav());
}
function loading() { root.innerHTML = '<main class="shell"><header class="topbar"><span class="brand"><span class="brand-mark">C</span><span>CBI Performance</span></span></header><div class="empty">Loading training…</div></main>'; }
function empty(message) { return '<div class="card empty">' + esc(message) + "</div>"; }
function statusPill(status) {
  const text = status === "completed" ? "Complete" : status === "in_progress" ? "In progress" : "Not started";
  return '<span class="pill ' + (status === "completed" ? "lime" : "") + '">' + text + "</span>";
}
function plan(exercise) {
  const values = [];
  if (exercise.sets) values.push(exercise.sets + " sets");
  if (exercise.prescribed_reps != null) values.push(exercise.prescribed_reps + " reps");
  if (exercise.prescribed_load_kg != null) values.push(exercise.prescribed_load_kg + " kg");
  if (exercise.prescribed_percent != null) values.push(exercise.prescribed_percent + "%");
  if (exercise.target_rpe != null) values.push("RPE " + exercise.target_rpe);
  if (exercise.target_rir != null) values.push(exercise.target_rir + " RIR");
  if (exercise.tempo) values.push("Tempo " + exercise.tempo);
  if (exercise.rest_seconds != null) values.push(exercise.rest_seconds + "s rest");
  return values.map((value) => "<span>" + esc(value) + "</span>").join("");
}

async function restoreAthlete() {
  const athleteId = localStorage.getItem(athleteKey);
  if (!athleteId) return;
  const athletes = await getActiveAthletes();
  state.athlete = athletes.find((athlete) => athlete.id === athleteId) || null;
  if (!state.athlete) { localStorage.removeItem(athleteKey); return; }
  state.athleteTeams = await getAthleteTeams(athleteId);
}
async function athletePicker() {
  const athletes = await getActiveAthletes();
  shell('<section class="login"><div class="eyebrow">Athlete mode</div><h1>Who are you?</h1>' +
    '<p class="subtle">Choose your profile once. This device will remember it.</p><div class="stack">' +
    athletes.map((athlete) => '<button class="list-button" data-action="select-athlete" data-id="' + esc(athlete.id) + '"><strong>' + esc(athlete.name) + "</strong><span>›</span></button>").join("") +
    "</div>" + (!athletes.length ? empty("No active athletes yet. A coach can add one in Coach mode.") : "") +
    '<p class="right"><a href="#coach/login">Coach login</a></p></section>', false);
}
async function athleteToday() {
  if (!state.athlete) return athletePicker();
  const assignments = await getAssignedSessions(state.athlete.id, day());
  const cards = await Promise.all(assignments.map(async (assignment) => {
    const session = assignment.session;
    const log = await getWorkout(state.athlete.id, session.id);
    let action = '<button class="button primary" data-action="start-workout" data-session="' + esc(session.id) + '">Start session</button>';
    if (log?.status === "completed") action = '<span class="pill lime">Complete</span>';
    if (log?.status === "in_progress") action = '<button class="button primary" data-action="open-workout" data-log="' + esc(log.id) + '">Resume session</button>';
    return '<article class="card hero"><div class="eyebrow">Today’s session</div><h1>' + esc(session.name) + "</h1>" +
      '<p class="subtle">' + esc(session.description || "Your coach has programmed this session for you.") + "</p>" +
      '<div class="split"><span class="pill">' + (session.estimated_duration_minutes ? "Estimated " + session.estimated_duration_minutes + " min" : "Train well") + "</span>" + action + "</div></article>";
  }));
  shell('<section class="page-head"><div class="eyebrow">' + esc(state.athlete.name) + "</div><h1>" + dateLabel(day()) + "</h1></section>" +
    (cards.join("") || '<article class="card hero"><div class="eyebrow">Today</div><h1>Recovery day</h1><p class="subtle">There is no programmed session assigned to you today.</p></article>') +
    '<section class="card tight"><div class="split"><div><h3>Training history</h3><p class="subtle">Review your completed sessions.</p></div><a href="#history">History ›</a></div></section>', false);
}
function fields(exercise) {
  const rpe = { key:"rpe", label:"RPE", step:"0.5", min:"0", max:"10" };
  if (exercise.tracking_type === "weight_reps") return [{key:"load_kg",label:"kg",step:"0.5",min:"0"},{key:"reps",label:"reps",step:"0.5",min:"0"},rpe];
  if (exercise.tracking_type === "reps_only") return [{key:"reps",label:"reps",step:"0.5",min:"0"},rpe];
  if (exercise.tracking_type === "duration") return [{key:"duration_seconds",label:"seconds",step:"0.01",min:"0"},rpe];
  if (exercise.tracking_type === "distance") return [{key:"distance_m",label:"metres",step:"0.01",min:"0"},rpe];
  if (exercise.tracking_type === "height") return [{key:"height_cm",label:"cm",step:"0.1",min:"0"},rpe];
  if (exercise.tracking_type === "power") return [{key:"power_watts",label:"watts",step:"1",min:"0"},rpe];
  return [{key:"value",label:exercise.custom_unit || "result",step:"0.1",min:"0"},rpe];
}
function draftStore(logId) {
  try { return JSON.parse(localStorage.getItem("cbi-drafts-" + logId) || "{}"); } catch { return {}; }
}
function draftPut(logId, record) {
  const drafts = draftStore(logId);
  drafts[record.workout_exercise_id + ":" + record.set_number] = record;
  localStorage.setItem("cbi-drafts-" + logId, JSON.stringify(drafts));
}
function draftRemove(logId, record, expected) {
  const drafts = draftStore(logId);
  const key = record.workout_exercise_id + ":" + record.set_number;
  if (JSON.stringify(drafts[key]) === JSON.stringify(expected)) {
    delete drafts[key];
    localStorage.setItem("cbi-drafts-" + logId, JSON.stringify(drafts));
  }
}
function startingValue(exercise, field) {
  if (field === "load_kg") return exercise.prescribed_load_kg ?? "";
  if (field === "reps") return exercise.prescribed_reps ?? "";
  if (field === "rpe") return exercise.target_rpe ?? "";
  return "";
}
function formattedSet(set, kind) {
  let result = "";
  if (kind === "weight_reps") result = (set.load_kg ?? "—") + " kg × " + (set.reps ?? "—");
  else if (kind === "reps_only") result = (set.reps ?? "—") + " reps";
  else if (kind === "duration") result = (set.duration_seconds ?? "—") + " sec";
  else if (kind === "distance") result = (set.distance_m ?? "—") + " m";
  else if (kind === "height") result = (set.height_cm ?? "—") + " cm";
  else if (kind === "power") result = (set.power_watts ?? "—") + " W";
  else result = set.value ?? "—";
  return result + (set.rpe != null ? " @" + set.rpe : "");
}
function setInput(exercise, setNumber, logId, disabled) {
  const saved = exercise.setLogs.find((entry) => entry.set_number === setNumber) || {};
  const draft = draftStore(logId)[exercise.id + ":" + setNumber] || {};
  const value = { ...saved, ...draft };
  const fieldList = fields(exercise);
  return '<div class="number-row" style="--fields:' + fieldList.length + '" data-set-row data-log="' + esc(logId) + '" data-exercise="' + esc(exercise.id) + '" data-number="' + setNumber + '">' +
    '<div class="set-number">' + setNumber + "</div>" + fieldList.map((field) =>
      '<label><span class="field-label">' + esc(field.label) + '</span><input data-set-input data-field="' + field.key + '" type="number" inputmode="decimal" min="' + field.min + '"' +
      (field.max ? ' max="' + field.max + '"' : "") + ' step="' + field.step + '" value="' + esc(value[field.key] ?? startingValue(exercise, field.key)) + '"' +
      (disabled ? " disabled" : "") + ' aria-label="Set ' + setNumber + " " + esc(field.label) + '"></label>').join("") + "</div>";
}
function exerciseCard(exercise, previous, logId, done) {
  const prior = previous.length ? previous.map((entry) => '<div class="previous-line"><span>Set ' + entry.set_number + "</span><span>" + formattedSet(entry, exercise.tracking_type) + "</span></div>").join("") : "<p>No previous completed result.</p>";
  const rows = Array.from({length:exercise.sets}, (_, index) => setInput(exercise, index + 1, logId, done)).join("");
  return '<article class="card exercise-card"><div class="exercise-top"><div><div class="eyebrow">Exercise ' + exercise.position + '</div><h2 class="exercise-title">' + esc(exercise.exercise_name) + "</h2></div>" +
    '<button class="button small ghost" data-action="copy-previous" data-exercise="' + esc(exercise.id) + '"' + (done ? " disabled" : "") + ">Same as previous</button></div>" +
    '<div class="prescription">' + plan(exercise) + "</div>" + (exercise.coach_notes ? '<p class="notice">' + esc(exercise.coach_notes) + "</p>" : "") +
    (exercise.instructions ? '<p class="subtle">' + esc(exercise.instructions) + "</p>" : "") +
    (exercise.video_url ? '<p><a target="_blank" rel="noreferrer" href="' + esc(exercise.video_url) + '">View exercise demo ↗</a></p>' : "") +
    '<div class="history"><details><summary>Last time' + (previous.length ? " · " + shortDate(previous[0].session_date) : "") + "</summary>" + prior + '</details><button class="button small ghost" data-action="exercise-history" data-library-exercise="' + esc(exercise.exercise_id || "") + '">View history</button></div><div class="divider"></div><div class="field-label">Today</div>' + rows + "</article>";
}
async function athleteWorkout(logId) {
  const workout = await getWorkoutDetail(logId);
  if (workout.log.athlete_id !== state.athlete?.id) throw new Error("Select the athlete who owns this workout.");
  const previous = await Promise.all(workout.exercises.map((exercise) => getPreviousSets(state.athlete.id, exercise.exercise_id, logId).catch(() => [])));
  const done = workout.log.status === "completed";
  const head = '<section class="page-head"><div class="split"><div><div class="eyebrow">' + (done ? "Completed session" : "Training now") + "</div><h1>" + esc(workout.log.session_name) + '</h1></div><span id="save-status" class="status saved">Saved ✓</span></div><p class="subtle">' + dateLabel(workout.log.session_date) + (workout.log.estimated_duration_minutes ? " · " + workout.log.estimated_duration_minutes + " min" : "") + "</p></section>";
  let foot = '<button class="button primary full" data-action="finish-workout" data-log="' + esc(logId) + '">Finish session</button>';
  if (done) foot = '<article class="card hero"><div class="eyebrow">Session complete ✓</div><h1>Great work.</h1><p class="subtle">' + workout.exercises.filter((item) => item.setLogs.length).length + "/" + workout.exercises.length + " exercises recorded" + (workout.log.session_rpe != null ? " · Session RPE " + workout.log.session_rpe : "") + "</p></article>";
  shell(head + workout.exercises.map((item, index) => exerciseCard(item, previous[index], logId, done)).join("") + foot, false);
}
async function athleteHistory() {
  if (!state.athlete) return athletePicker();
  const sessions = await getWorkoutHistory(state.athlete.id);
  shell('<section class="page-head"><div class="eyebrow">' + esc(state.athlete.name) + '</div><h1>Training history</h1><p class="subtle">Completed sessions are preserved exactly as performed.</p></section>' +
    (sessions.map((log) => '<button class="list-button" data-action="open-workout" data-log="' + esc(log.id) + '"><span><strong>' + esc(log.session_name) + "</strong><br><span class=\"muted\">" + shortDate(log.session_date) + (log.session_rpe != null ? " · RPE " + log.session_rpe : "") + '</span></span><span class="pill lime">View</span></button>').join("") || empty("Finish a session and it will appear here.")), false);
}
async function athleteProfile() {
  if (!state.athlete) return athletePicker();
  const teams = state.athleteTeams.map((entry) => entry.teams?.name).filter(Boolean);
  shell('<section class="page-head"><div class="eyebrow">Athlete profile</div><h1>' + esc(state.athlete.name) + "</h1><p class=\"subtle\">" + esc(teams.join(" · ") || "No team assignment") + '</p></section><article class="card"><h2>This device</h2><p class="subtle">Your athlete profile is remembered on this device. Profiles are deliberately not private accounts.</p><button class="button full ghost" data-action="change-athlete">Change athlete</button></article><p class="right"><a href="#coach/login">Coach mode</a></p>', false);
}

function storedCoachSession() {
  try { return JSON.parse(localStorage.getItem(coachKey) || "null"); } catch { return null; }
}
function saveCoachSession(session) {
  state.coachSession = session;
  localStorage.setItem(coachKey, JSON.stringify(session));
}
async function checkCoach() {
  state.coachSession = storedCoachSession();
  if (!state.coachSession) return false;
  try {
    if (state.coachSession.expires_at && state.coachSession.expires_at * 1000 < Date.now() + 60000) {
      saveCoachSession(await auth.refresh(state.coachSession.refresh_token));
    }
    const response = await getCoachProfile(coachToken());
    if (!response.profile || response.profile.role !== "coach" || !response.profile.active) throw new Error("This account is not an active coach.");
    state.coachProfile = response.profile;
    return true;
  } catch (error) {
    localStorage.removeItem(coachKey);
    state.coachSession = null;
    state.coachProfile = null;
    return false;
  }
}
function coachLogin(message) {
  shell('<section class="login card"><div class="eyebrow">Protected area</div><h1>Coach login</h1><p class="subtle">Use the Supabase account linked to your coach profile.</p>' +
    (message ? '<div class="error-box">' + esc(message) + "</div>" : "") +
    '<form data-form="coach-login" class="stack"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary full">Sign in</button></form><p class="subtle">No PIN or admin secret is stored in the browser.</p></section>', true);
}
async function coachDashboard() {
  const access = coachToken();
  const results = await Promise.all([
    db.list("programmed_sessions", {select:"*",session_date:"eq." + day(),order:"created_at.desc"}, access),
    getActiveAthletes(access),
    db.list("workout_logs", {select:"id,status",session_date:"eq." + day()}, access),
  ]);
  const sessions = results[0], athletes = results[1], logs = results[2], done = logs.filter((log) => log.status === "completed").length;
  shell('<section class="page-head"><div class="eyebrow">Coach dashboard</div><h1>Today</h1><p class="subtle">' + dateLabel(day()) + "</p></section>" +
    '<div class="grid three"><article class="card tight"><div class="metric">' + sessions.length + '</div><div class="metric-label">Sessions</div></article><article class="card tight"><div class="metric">' + done + "/" + logs.length + '</div><div class="metric-label">Complete</div></article><article class="card tight"><div class="metric">' + athletes.length + '</div><div class="metric-label">Athletes</div></article></div>' +
    '<div class="toolbar"><a class="button primary" href="#coach/session/new">+ Create session</a><a class="button" href="#coach/athlete/new">+ Athlete</a><a class="button" href="#coach/exercise/new">+ Exercise</a></div>' +
    '<section class="card"><h2>Today’s sessions</h2>' + (sessions.map((session) => '<button class="list-button" data-action="review-session" data-session="' + esc(session.id) + '"><span><strong>' + esc(session.name) + '</strong><br><span class="muted">' + (session.estimated_duration_minutes || "—") + " min · " + esc(session.description || "No description") + '</span></span><span>›</span></button>').join("") || '<p class="subtle">No sessions scheduled today.</p>') + "</section>", true);
}
async function coachSessions() {
  const sessions = await db.list("programmed_sessions", {select:"*",order:"session_date.desc",limit:"100"}, coachToken());
  shell('<section class="page-head"><div class="split"><div><div class="eyebrow">Programming</div><h1>Sessions</h1></div><a class="button primary" href="#coach/session/new">+ Create</a></div><p class="subtle">Create once, assign, and review completion without modifying athlete logs.</p></section>' +
    (sessions.map((session) => '<article class="card"><div class="split"><div><div class="eyebrow">' + shortDate(session.session_date) + '</div><h2>' + esc(session.name) + '</h2><p class="subtle">' + esc(session.description || "No description") + '</p></div><div class="stack"><button class="button small" data-action="review-session" data-session="' + esc(session.id) + '">Review</button><button class="button small ghost" data-action="edit-session" data-session="' + esc(session.id) + '">Edit</button></div></div></article>').join("") || empty("No sessions yet. Create your first session.")), true);
}
async function coachReview(sessionId) {
  const access = coachToken();
  const session = await db.single("programmed_sessions", {select:"*",id:"eq." + sessionId}, access);
  const data = await Promise.all([
    db.list("session_assignments", {select:"athlete_id,profiles!session_assignments_athlete_id_fkey(id,name)",session_id:"eq." + sessionId}, access),
    db.list("workout_logs", {select:"id,athlete_id,status,session_rpe,completed_at",session_id:"eq." + sessionId}, access),
  ]);
  const assignments = data[0], logs = data[1];
  shell('<section class="page-head"><div class="eyebrow">' + dateLabel(session.session_date) + '</div><h1>' + esc(session.name) + '</h1><p class="subtle">Athlete results are read-only in coach review.</p></section><section class="card"><h2>Completion</h2>' +
    assignments.map((assignment) => {
      const profile = Array.isArray(assignment.profiles) ? assignment.profiles[0] : assignment.profiles;
      const log = logs.find((entry) => entry.athlete_id === assignment.athlete_id);
      const status = log?.status || "not_started";
      return '<button class="list-button" ' + (log ? 'data-action="review-log" data-log="' + esc(log.id) + '"' : "disabled") + '><span><strong>' + esc(profile?.name || "Athlete") + '</strong><br><span class="' + status.replace("_","-") + '">' + status.replace("_"," ") + '</span></span>' + (log ? statusPill(status) : statusPill("not_started")) + "</button>";
    }).join("") + "</section>", true);
}
async function coachLogDetail(logId) {
  const workout = await getWorkoutDetail(logId, coachToken());
  shell('<section class="page-head"><div class="eyebrow">Athlete result · ' + shortDate(workout.log.session_date) + '</div><h1>' + esc(workout.log.session_name) + '</h1><p class="subtle">' + statusPill(workout.log.status) + (workout.log.session_rpe != null ? " Session RPE " + workout.log.session_rpe : "") + "</p></section>" +
    workout.exercises.map((exercise) => '<article class="card session-log"><h2>' + esc(exercise.exercise_name) + '</h2><div class="prescription">' + plan(exercise) + "</div>" +
      Array.from({length:exercise.sets}, (_, index) => { const set = exercise.setLogs.find((row) => row.set_number === index + 1); return '<div class="previous-line"><span>Set ' + (index + 1) + "</span><strong>" + (set ? formattedSet(set, exercise.tracking_type) : "—") + "</strong></div>"; }).join("") + "</article>").join("") +
    (workout.log.athlete_notes ? '<article class="card"><h3>Athlete notes</h3><p>' + esc(workout.log.athlete_notes) + "</p></article>" : ""), true);
}
function blankEntry(exercise) {
  return { exercise_id:exercise?.id || "", exercise_name:exercise?.name || "", tracking_type:exercise?.tracking_type || "weight_reps", sets:3, prescribed_reps:"", prescribed_load_kg:"", prescribed_percent:"", target_rpe:"", target_rir:"", tempo:"", rest_seconds:"", coach_notes:"", instructions:exercise?.default_instructions || "", video_url:exercise?.video_url || "", custom_unit:"" };
}
async function setupBuilder(kind, id, templateId) {
  const access = coachToken();
  const base = await Promise.all([
    db.list("exercises", {select:"*",active:"eq.true",order:"name.asc"}, access),
    getActiveAthletes(access),
    db.list("teams", {select:"*",active:"eq.true",order:"name.asc"}, access),
    db.list("athlete_teams", {select:"athlete_id,team_id"}, access),
  ]);
  const b = { kind, id:id || null, sourceTemplateId:templateId || null, exercises:base[0], athletes:base[1], teams:base[2], memberships:base[3], entries:[], assignmentIds:[], teamId:"", all:false, date:day(), name:"", description:"", duration:"" };
  if (id) {
    const loaded = await Promise.all([
      db.single(kind === "session" ? "programmed_sessions" : "session_templates", {select:"*",id:"eq." + id}, access),
      db.list(kind === "session" ? "session_exercises" : "template_exercises", {select:"*",[kind === "session" ? "session_id" : "template_id"]:"eq." + id,order:"position.asc"}, access),
    ]);
    const record = loaded[0];
    b.entries = loaded[1];
    b.name = record.name; b.description = record.description || "";
    if (kind === "session") {
      b.date = record.session_date; b.duration = record.estimated_duration_minutes || "";
      const assignments = await db.list("session_assignments", {select:"athlete_id,assigned_team_id",session_id:"eq." + id}, access);
      b.assignmentIds = assignments.map((item) => item.athlete_id);
      b.teamId = assignments.find((item) => item.assigned_team_id)?.assigned_team_id || "";
    }
  } else if (templateId && kind === "session") {
    const template = await db.single("session_templates", {select:"*",id:"eq." + templateId}, access);
    const entries = await db.list("template_exercises", {select:"*",template_id:"eq." + templateId,order:"position.asc"}, access);
    b.name = template.name; b.description = template.description || ""; b.entries = entries;
  }
  if (!b.entries.length && b.exercises.length) b.entries = [blankEntry(b.exercises[0])];
  state.builder = b;
}
function builderInputs(entry, index, library) {
  const choices = ['<option value="">Choose exercise</option>'].concat(library.map((exercise) => '<option value="' + esc(exercise.id) + '"' + (entry.exercise_id === exercise.id ? " selected" : "") + '>' + esc(exercise.name) + "</option>")).join("");
  return '<article class="card coach-builder-item"><div class="split"><h3>Exercise ' + (index + 1) + '</h3><div class="reorder"><button type="button" class="button small ghost" data-action="move-entry" data-index="' + index + '" data-direction="-1">↑</button><button type="button" class="button small ghost" data-action="move-entry" data-index="' + index + '" data-direction="1">↓</button><button type="button" class="button small danger" data-action="remove-entry" data-index="' + index + '">×</button></div></div>' +
    '<div class="grid two"><label>Exercise<select name="exercise_id_' + index + '">' + choices + '</select></label><label>Sets<input name="sets_' + index + '" type="number" min="1" max="30" value="' + esc(entry.sets || 3) + '"></label><label>Reps<input name="reps_' + index + '" type="number" min="0" step=".5" value="' + esc(entry.prescribed_reps || "") + '"></label><label>Load (kg)<input name="load_' + index + '" type="number" min="0" step=".5" value="' + esc(entry.prescribed_load_kg || "") + '"></label><label>Percentage<input name="percent_' + index + '" type="number" min="0" max="100" step=".5" value="' + esc(entry.prescribed_percent || "") + '"></label><label>Target RPE<input name="rpe_' + index + '" type="number" min="0" max="10" step=".5" value="' + esc(entry.target_rpe || "") + '"></label><label>Rest (seconds)<input name="rest_' + index + '" type="number" min="0" value="' + esc(entry.rest_seconds || "") + '"></label><label>Tempo<input name="tempo_' + index + '" value="' + esc(entry.tempo || "") + '"></label></div><label>Coach notes<textarea name="notes_' + index + '">' + esc(entry.coach_notes || "") + '</textarea></label><details><summary>More prescription options</summary><div class="grid two"><label>Target RIR<input name="rir_' + index + '" type="number" min="0" max="10" step=".5" value="' + esc(entry.target_rir || "") + '"></label><label>Custom unit<input name="unit_' + index + '" value="' + esc(entry.custom_unit || "") + '"></label><label>Video URL<input name="video_' + index + '" type="url" value="' + esc(entry.video_url || "") + '"></label></div><label>Exercise instructions<textarea name="instructions_' + index + '">' + esc(entry.instructions || "") + "</textarea></label></details></article>";
}
function builder() {
  const b = state.builder;
  const isSession = b.kind === "session";
  const people = b.athletes.map((athlete) => '<option value="' + esc(athlete.id) + '"' + (b.assignmentIds.includes(athlete.id) ? " selected" : "") + ">" + esc(athlete.name) + "</option>").join("");
  const teams = '<option value="">No team</option>' + b.teams.map((team) => '<option value="' + esc(team.id) + '"' + (b.teamId === team.id ? " selected" : "") + ">" + esc(team.name) + "</option>").join("");
  shell('<section class="page-head"><div class="eyebrow">' + (b.id ? "Edit" : "Create") + " " + b.kind + '</div><h1>' + (isSession ? "Program session" : "Save template") + '</h1><p class="subtle">Fields stay optional so programming remains fast.</p></section><form data-form="builder" class="stack">' +
    '<section class="card"><div class="grid two">' + (isSession ? '<label>Date<input name="date" type="date" value="' + esc(b.date) + '"></label>' : "") + '<label>Name<input name="name" required value="' + esc(b.name) + '"></label>' + (isSession ? '<label>Estimated minutes<input name="duration" type="number" min="1" value="' + esc(b.duration) + '"></label>' : "") + '</div><label>Description<textarea name="description">' + esc(b.description) + '</textarea></label></section>' +
    '<section><div class="split"><h2>Exercises</h2><button type="button" class="button small" data-action="new-exercise">+ New exercise</button></div>' + b.entries.map((entry,index) => builderInputs(entry,index,b.exercises)).join("") + '<button type="button" class="button full ghost" data-action="add-entry">+ Add exercise</button></section>' +
    (isSession ? '<section class="card"><div class="split"><h2>Assign athletes</h2><button type="button" class="button small ghost" data-action="new-team">+ Team</button></div><div class="grid two"><label>Team<select name="team">' + teams + '</select></label><label>Individual athletes<select multiple name="athletes" size="5">' + people + '</select></label></div><label class="inline"><input type="checkbox" name="everyone"' + (b.all ? " checked" : "") + '> Everyone active</label><p class="subtle">A selected team expands to all of its active members. You can also add individual athletes.</p></section>' : "") +
    '<button class="button primary full">Save ' + (isSession ? "session" : "template") + "</button></form>", true);
}
async function coachTemplates() {
  const templates = await db.list("session_templates", {select:"*",order:"updated_at.desc"}, coachToken());
  shell('<section class="page-head"><div class="split"><div><div class="eyebrow">Reusable programming</div><h1>Templates</h1></div><a class="button primary" href="#coach/template/new">+ Template</a></div><p class="subtle">Build a workout once, then schedule a copy whenever you need it.</p></section>' +
    (templates.map((template) => '<article class="card"><div class="split"><div><h2>' + esc(template.name) + '</h2><p class="subtle">' + esc(template.description || "No description") + '</p></div><div class="stack"><a class="button small primary" href="#coach/session/new?template=' + esc(template.id) + '">Use template</a><button class="button small ghost" data-action="edit-template" data-template="' + esc(template.id) + '">Edit</button></div></div></article>').join("") || empty("No templates yet. Save one of your common sessions.")), true);
}
async function coachAthletes() {
  const access = coachToken();
  const results = await Promise.all([getActiveAthletes(access), db.list("profiles", {select:"id,name,active",role:"eq.athlete",order:"name.asc"}, access)]);
  const athletes = results[1];
  shell('<section class="page-head"><div class="split"><div><div class="eyebrow">Squad</div><h1>Athletes</h1></div><div class="toolbar"><button class="button" data-action="new-team">+ Team</button><a class="button primary" href="#coach/athlete/new">+ Athlete</a></div></div><p class="subtle">' + results[0].length + " active athlete" + (results[0].length === 1 ? "" : "s") + " shown in the athlete selector.</p></section>" +
    athletes.map((athlete) => '<button class="list-button" data-action="edit-athlete" data-athlete="' + esc(athlete.id) + '"><span><strong>' + esc(athlete.name) + '</strong><br><span class="muted">' + (athlete.active ? "Active" : "Inactive") + '</span></span><span>›</span></button>').join(""), true);
}
async function athleteEditor(id) {
  const access = coachToken();
  const values = await Promise.all([
    id ? db.single("profiles", {select:"*",id:"eq." + id}, access) : Promise.resolve({name:"",active:true}),
    db.list("teams", {select:"*",order:"name.asc"}, access),
    id ? db.list("athlete_teams", {select:"team_id",athlete_id:"eq." + id}, access) : Promise.resolve([]),
  ]);
  const athlete = values[0], teams = values[1], assigned = values[2].map((entry) => entry.team_id);
  shell('<section class="page-head"><div class="eyebrow">' + (id ? "Edit athlete" : "New athlete") + '</div><h1>' + (id ? esc(athlete.name) : "Add athlete") + '</h1></section><form data-form="athlete" data-athlete="' + esc(id || "") + '" class="stack"><section class="card"><label>Name<input name="name" required value="' + esc(athlete.name) + '"></label><label class="inline"><input type="checkbox" name="active"' + (athlete.active ? " checked" : "") + '> Active in athlete selector</label><label>Teams<select multiple name="teams" size="5">' + teams.map((team) => '<option value="' + esc(team.id) + '"' + (assigned.includes(team.id) ? " selected" : "") + ">" + esc(team.name) + "</option>").join("") + '</select></label></section><button class="button primary full">Save athlete</button></form>' + (id ? '<p class="right"><button class="button ghost" data-action="coach-athlete-history" data-athlete="' + esc(id) + '">View workout history</button></p>' : ""), true);
}
async function coachExercises() {
  const exercises = await db.list("exercises", {select:"*",order:"name.asc"}, coachToken());
  shell('<section class="page-head"><div class="split"><div><div class="eyebrow">Exercise library</div><h1>Exercises</h1></div><a class="button primary" href="#coach/exercise/new">+ Exercise</a></div><p class="subtle">Searchable building blocks with a tracking type that adapts athlete logging.</p><input id="exercise-search" type="search" placeholder="Search exercise library" aria-label="Search exercise library"></section>' +
    exercises.map((exercise) => '<button class="list-button" data-exercise-card data-search="' + esc((exercise.name + " " + exercise.category).toLowerCase()) + '" data-action="edit-exercise" data-exercise="' + esc(exercise.id) + '"><span><strong>' + esc(exercise.name) + '</strong><br><span class="muted">' + esc(exercise.category) + " · " + esc(exercise.tracking_type.replace("_"," + ")) + '</span></span><span class="pill">' + (exercise.active ? "Active" : "Inactive") + "</span></button>").join(""), true);
}
function trackingOptions(selected) {
  return ["weight_reps","reps_only","duration","distance","height","power","conditioning","custom"].map((type) => '<option value="' + type + '"' + (type === selected ? " selected" : "") + ">" + type.replace("_"," + ") + "</option>").join("");
}
async function exerciseEditor(id) {
  const exercise = id ? await db.single("exercises", {select:"*",id:"eq." + id}, coachToken()) : {name:"",category:"Other",tracking_type:"weight_reps",default_instructions:"",video_url:"",active:true};
  const categories = ["Squat","Hinge","Push","Pull","Single Leg","Core","Plyometric","Speed","Conditioning","Mobility","Prehab","Other"];
  shell('<section class="page-head"><div class="eyebrow">' + (id ? "Edit exercise" : "New exercise") + '</div><h1>' + (id ? esc(exercise.name) : "Add exercise") + '</h1></section><form data-form="exercise" data-exercise="' + esc(id || "") + '" class="stack"><section class="card"><div class="grid two"><label>Name<input name="name" required value="' + esc(exercise.name) + '"></label><label>Category<select name="category">' + categories.map((category) => '<option' + (category === exercise.category ? " selected" : "") + ">" + category + "</option>").join("") + '</select></label><label>Tracking type<select name="tracking_type">' + trackingOptions(exercise.tracking_type) + '</select></label><label>Video URL<input name="video_url" type="url" value="' + esc(exercise.video_url || "") + '"></label></div><label>Default instructions<textarea name="instructions">' + esc(exercise.default_instructions || "") + '</textarea></label><label class="inline"><input type="checkbox" name="active"' + (exercise.active ? " checked" : "") + '> Active in library</label></section><button class="button primary full">Save exercise</button></form>', true);
}
function modal(content) {
  document.querySelector(".modal-backdrop")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = '<section class="modal">' + content + "</section>";
  document.body.append(wrap);
}
function closeModal() { document.querySelector(".modal-backdrop")?.remove(); }
function newExerciseModal() {
  modal('<div class="split"><h2>Create exercise</h2><button class="button small ghost" data-action="close-modal">×</button></div><form data-form="quick-exercise" class="stack"><label>Name<input name="name" required autofocus></label><div class="grid two"><label>Category<select name="category"><option>Other</option><option>Squat</option><option>Hinge</option><option>Push</option><option>Pull</option><option>Single Leg</option><option>Core</option><option>Plyometric</option><option>Speed</option><option>Conditioning</option></select></label><label>Tracking<select name="tracking_type">' + trackingOptions("weight_reps") + '</select></label></div><button class="button primary full">Create and add</button></form>');
}
function newTeamModal() {
  modal('<div class="split"><h2>Create team</h2><button class="button small ghost" data-action="close-modal">×</button></div><form data-form="quick-team" class="stack"><label>Team name<input name="name" required autofocus></label><button class="button primary full">Create team</button></form>');
}
function finishModal(logId) {
  modal('<div class="eyebrow">Almost done</div><h2>Finish session?</h2><p class="subtle">You can leave feedback blank. Completed workout sets are locked.</p><form data-form="finish" data-log="' + esc(logId) + '" class="stack"><label>Session RPE (optional)<input name="rpe" type="number" min="1" max="10" step=".5" inputmode="decimal"></label><label>Session notes (optional)<textarea name="notes"></textarea></label><button class="button primary full">Complete session</button><button type="button" class="button full ghost" data-action="close-modal">Keep training</button></form>');
}
async function saveBuilder(form) {
  const b = state.builder, values = new FormData(form), access = coachToken(), isSession = b.kind === "session";
  const entries = b.entries.map((entry,index) => {
    const exercise = b.exercises.find((item) => item.id === values.get("exercise_id_" + index));
    if (!exercise) return null;
    return { exercise_id:exercise.id, exercise_name:exercise.name, tracking_type:exercise.tracking_type, position:index + 1,
      sets:Number(values.get("sets_" + index) || 3), prescribed_reps:numeric(values.get("reps_" + index)), prescribed_load_kg:numeric(values.get("load_" + index)),
      prescribed_percent:numeric(values.get("percent_" + index)), target_rpe:numeric(values.get("rpe_" + index)), target_rir:numeric(values.get("rir_" + index)), rest_seconds:numeric(values.get("rest_" + index)),
      tempo:values.get("tempo_" + index) || null, coach_notes:values.get("notes_" + index) || null, instructions:values.get("instructions_" + index) || exercise.default_instructions || null, video_url:values.get("video_" + index) || exercise.video_url || null, custom_unit:values.get("unit_" + index) || null };
  }).filter(Boolean);
  if (!entries.length) throw new Error("Add at least one exercise.");
  const selected = isSession ? new Set(values.getAll("athletes")) : null;
  const selectedTeam = isSession ? values.get("team") : null;
  if (isSession) {
    if (values.get("everyone")) b.athletes.forEach((athlete) => selected.add(athlete.id));
    if (selectedTeam) b.memberships.filter((membership) => membership.team_id === selectedTeam).forEach((membership) => selected.add(membership.athlete_id));
    if (!selected.size) throw new Error("Assign at least one athlete, team, or everyone.");
  }
  let recordId = b.id;
  const body = {name:values.get("name"),description:values.get("description") || null,created_by:state.coachProfile.id};
  if (isSession) { body.session_date = values.get("date"); body.estimated_duration_minutes = numeric(values.get("duration")); }
  const table = isSession ? "programmed_sessions" : "session_templates";
  if (recordId) {
    await db.update(table, {id:"eq." + recordId}, body, access);
    await db.remove(isSession ? "session_exercises" : "template_exercises", {[isSession ? "session_id" : "template_id"]:"eq." + recordId}, access);
    if (isSession) await db.remove("session_assignments", {session_id:"eq." + recordId}, access);
  } else {
    const created = await db.insert(table, body, access);
    recordId = created[0].id;
  }
  const childKey = isSession ? "session_id" : "template_id";
  await db.insert(isSession ? "session_exercises" : "template_exercises", entries.map((entry) => ({...entry,[childKey]:recordId})), access);
  if (isSession) {
    await db.insert("session_assignments", [...selected].map((athleteId) => ({session_id:recordId,athlete_id:athleteId,assigned_team_id:selectedTeam || null})), access);
  }
  toast(isSession ? "Session saved" : "Template saved");
  go(isSession ? "coach/review/" + recordId : "coach/templates");
}

function readSetRow(row) {
  const result = {workout_exercise_id:row.dataset.exercise,set_number:Number(row.dataset.number)};
  row.querySelectorAll("[data-set-input]").forEach((input) => { result[input.dataset.field] = numeric(input.value); });
  return result;
}
function saveStatus(message, mode) {
  const target = document.querySelector("#save-status");
  if (target) { target.textContent = message; target.className = "status " + (mode || ""); }
}
function scheduleSave(row, instant) {
  const record = readSetRow(row), key = record.workout_exercise_id + ":" + record.set_number, logId = row.dataset.log;
  draftPut(logId, record);
  clearTimeout(state.timers.get(key));
  saveStatus("Saving…", "saving");
  const run = () => {
    const request = saveSet(record).then(() => {
      draftRemove(logId, record, record);
      saveStatus("Saved ✓", "saved");
    }).catch((error) => {
      console.error(error);
      saveStatus("Saved locally — retrying", "error");
    }).finally(() => state.saves.delete(key));
    state.saves.set(key, request);
  };
  if (instant) run();
  else state.timers.set(key, setTimeout(run, 600));
}
async function flushSaves() {
  document.querySelectorAll("[data-set-row]").forEach((row) => {
    const key = row.dataset.exercise + ":" + row.dataset.number;
    if (state.timers.has(key)) { clearTimeout(state.timers.get(key)); scheduleSave(row, true); }
  });
  await Promise.allSettled([...state.saves.values()]);
}
async function showExerciseHistory(exerciseId) {
  if (!exerciseId) return toast("This custom exercise has no library history yet.");
  const rows = await getExerciseHistory(state.athlete.id, exerciseId);
  modal('<div class="split"><div><div class="eyebrow">Previous performance</div><h2>Exercise history</h2></div><button class="button small ghost" data-action="close-modal">×</button></div>' +
    (rows.map((row) => '<div class="previous-line"><strong>' + shortDate(row.session_date) + "</strong><span>" + esc(row.summary || "No result") + "</span></div>").join("") || "<p class='subtle'>No completed history yet.</p>"));
}
async function openWorkoutForSession(sessionId) {
  const log = await startWorkout(state.athlete.id, sessionId);
  go("workout/" + log.id);
}
function copyPrior(exerciseId) {
  const rows = [...document.querySelectorAll('[data-exercise="' + exerciseId + '"]')];
  rows.forEach((row, index) => {
    if (!index) return;
    const source = rows[index - 1];
    row.querySelectorAll("[data-set-input]").forEach((input) => {
      const matching = source.querySelector('[data-field="' + input.dataset.field + '"]');
      if (matching && !input.value) { input.value = matching.value; scheduleSave(row, false); }
    });
  });
}
async function saveAthlete(form) {
  const id = form.dataset.athlete, access = coachToken(), values = new FormData(form);
  const body = {name:values.get("name"),active:Boolean(values.get("active")),role:"athlete"};
  let athleteId = id;
  if (id) {
    await db.update("profiles", {id:"eq." + id}, body, access);
    await db.remove("athlete_teams", {athlete_id:"eq." + id}, access);
  } else {
    const created = await db.insert("profiles", body, access);
    athleteId = created[0].id;
  }
  const teams = values.getAll("teams").map((teamId) => ({athlete_id:athleteId,team_id:teamId}));
  if (teams.length) await db.insert("athlete_teams", teams, access);
  toast("Athlete saved");
  go("coach/athletes");
}
async function saveExercise(form) {
  const id = form.dataset.exercise, values = new FormData(form), access = coachToken();
  const body = {name:values.get("name"),category:values.get("category"),tracking_type:values.get("tracking_type"),video_url:values.get("video_url") || null,default_instructions:values.get("instructions") || null,active:Boolean(values.get("active"))};
  if (id) await db.update("exercises", {id:"eq." + id}, body, access);
  else await db.insert("exercises", body, access);
  toast("Exercise saved");
  go("coach/exercises");
}
async function quickExercise(form) {
  const values = new FormData(form), access = coachToken();
  const created = await db.insert("exercises", {name:values.get("name"),category:values.get("category"),tracking_type:values.get("tracking_type"),active:true}, access);
  const exercise = created[0];
  state.builder.exercises.push(exercise);
  state.builder.entries.push(blankEntry(exercise));
  closeModal();
  builder();
}
async function quickTeam(form) {
  const values = new FormData(form);
  const created = await db.insert("teams", {name:values.get("name"),active:true}, coachToken());
  if (state.builder && route().path.indexOf("coach/session") === 0) state.builder.teams.push(created[0]);
  closeModal();
  toast("Team created");
  return state.builder && route().path.indexOf("coach/session") === 0 ? builder() : render();
}
function captureBuilder() {
  const form = document.querySelector('[data-form="builder"]');
  if (!form || !state.builder) return;
  const values = new FormData(form), b = state.builder;
  b.name = values.get("name") || "";
  b.description = values.get("description") || "";
  b.date = values.get("date") || b.date;
  b.duration = values.get("duration") || "";
  b.teamId = values.get("team") || "";
  b.assignmentIds = values.getAll("athletes");
  b.all = Boolean(values.get("everyone"));
  b.entries = b.entries.map((old, index) => {
    const exercise = b.exercises.find((item) => item.id === values.get("exercise_id_" + index));
    return {...old, exercise_id:exercise?.id || "", exercise_name:exercise?.name || "", tracking_type:exercise?.tracking_type || old.tracking_type,
      sets:values.get("sets_" + index) || 3, prescribed_reps:values.get("reps_" + index) || "", prescribed_load_kg:values.get("load_" + index) || "",
      prescribed_percent:values.get("percent_" + index) || "", target_rpe:values.get("rpe_" + index) || "", target_rir:values.get("rir_" + index) || "", rest_seconds:values.get("rest_" + index) || "",
      tempo:values.get("tempo_" + index) || "", coach_notes:values.get("notes_" + index) || "", instructions:values.get("instructions_" + index) || "", video_url:values.get("video_" + index) || "", custom_unit:values.get("unit_" + index) || ""};
  });
}
async function coachAthleteHistory(athleteId) {
  const profile = await db.single("profiles", {select:"id,name",id:"eq." + athleteId}, coachToken());
  const logs = await getWorkoutHistory(athleteId, coachToken());
  shell('<section class="page-head"><div class="eyebrow">Athlete history</div><h1>' + esc(profile.name) + '</h1><p class="subtle">Completed sessions only.</p></section>' +
    (logs.map((log) => '<button class="list-button" data-action="review-log" data-log="' + esc(log.id) + '"><span><strong>' + esc(log.session_name) + '</strong><br><span class="muted">' + shortDate(log.session_date) + (log.session_rpe != null ? " · RPE " + log.session_rpe : "") + '</span></span><span>›</span></button>').join("") || empty("No completed workouts yet.")), true);
}
async function eventAction(action, element) {
  if (action === "reload") return render();
  if (action === "select-athlete") {
    const athletes = await getActiveAthletes();
    state.athlete = athletes.find((athlete) => athlete.id === element.dataset.id);
    if (!state.athlete) throw new Error("That athlete is no longer active.");
    localStorage.setItem(athleteKey, state.athlete.id);
    state.athleteTeams = await getAthleteTeams(state.athlete.id);
    return go("today");
  }
  if (action === "change-athlete") { localStorage.removeItem(athleteKey); state.athlete = null; return athletePicker(); }
  if (action === "start-workout") return openWorkoutForSession(element.dataset.session);
  if (action === "open-workout") return go("workout/" + element.dataset.log);
  if (action === "copy-previous") return copyPrior(element.dataset.exercise);
  if (action === "exercise-history") return showExerciseHistory(element.dataset.libraryExercise);
  if (action === "finish-workout") { await flushSaves(); return finishModal(element.dataset.log); }
  if (action === "close-modal") return closeModal();
  if (action === "coach-signout") {
    try { await auth.signOut(coachToken()); } catch (error) { console.warn(error); }
    localStorage.removeItem(coachKey); state.coachSession = null; state.coachProfile = null; return go("today");
  }
  if (action === "review-session") return go("coach/review/" + element.dataset.session);
  if (action === "review-log") return go("coach/log/" + element.dataset.log);
  if (action === "edit-session") return go("coach/session/" + element.dataset.session);
  if (action === "edit-template") return go("coach/template/" + element.dataset.template);
  if (action === "edit-athlete") return go("coach/athlete/" + element.dataset.athlete);
  if (action === "coach-athlete-history") return go("coach/athlete-history/" + element.dataset.athlete);
  if (action === "edit-exercise") return go("coach/exercise/" + element.dataset.exercise);
  if (action === "new-exercise") { captureBuilder(); return newExerciseModal(); }
  if (action === "new-team") { captureBuilder(); return newTeamModal(); }
  if (action === "add-entry") {
    captureBuilder();
    const first = state.builder.exercises[0];
    if (!first) throw new Error("Create an exercise before adding it to a workout.");
    state.builder.entries.push(blankEntry(first)); return builder();
  }
  if (action === "remove-entry") {
    captureBuilder();
    state.builder.entries.splice(Number(element.dataset.index), 1);
    if (!state.builder.entries.length && state.builder.exercises.length) state.builder.entries.push(blankEntry(state.builder.exercises[0]));
    return builder();
  }
  if (action === "move-entry") {
    captureBuilder();
    const index = Number(element.dataset.index), next = index + Number(element.dataset.direction);
    if (next >= 0 && next < state.builder.entries.length) {
      const value = state.builder.entries[index]; state.builder.entries[index] = state.builder.entries[next]; state.builder.entries[next] = value;
    }
    return builder();
  }
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  event.preventDefault();
  eventAction(target.dataset.action, target).catch(failure);
});
document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-set-input]");
  if (input) scheduleSave(input.closest("[data-set-row]"), false);
  if (event.target.id === "exercise-search") {
    const search = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-exercise-card]").forEach((card) => card.classList.toggle("hidden", !card.dataset.search.includes(search)));
  }
});
document.addEventListener("focusout", (event) => {
  const input = event.target.closest("[data-set-input]");
  if (input) scheduleSave(input.closest("[data-set-row]"), true);
});
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const task = async () => {
    if (form.dataset.form === "coach-login") {
      const values = new FormData(form);
      const session = await auth.signIn(values.get("email"), values.get("password"));
      saveCoachSession(session);
      if (!await checkCoach()) { localStorage.removeItem(coachKey); return coachLogin("This account is not linked to an active coach profile."); }
      return go("coach/dashboard");
    }
    if (form.dataset.form === "finish") {
      await flushSaves();
      const values = new FormData(form);
      await finishWorkout(form.dataset.log, numeric(values.get("rpe")), values.get("notes"));
      closeModal(); toast("Session complete ✓"); return go("workout/" + form.dataset.log);
    }
    if (form.dataset.form === "builder") return saveBuilder(form);
    if (form.dataset.form === "athlete") return saveAthlete(form);
    if (form.dataset.form === "exercise") return saveExercise(form);
    if (form.dataset.form === "quick-exercise") return quickExercise(form);
    if (form.dataset.form === "quick-team") return quickTeam(form);
  };
  task().catch(failure);
});
async function render() {
  if (!configured) {
    shell('<section class="login card hero"><div class="eyebrow">Setup required</div><h1>Connect your database</h1><p class="subtle">Copy <code>web/app-config.example.js</code> to <code>web/app-config.js</code>, then add your Supabase URL and anon key.</p></section>', false);
    return;
  }
  loading();
  const current = route(), pieces = current.path.split("/");
  try {
    if (pieces[0] === "coach") {
      if (pieces[1] === "login") {
        if (await checkCoach()) return go("coach/dashboard");
        return coachLogin();
      }
      if (!await checkCoach()) return coachLogin("Please sign in to access coach tools.");
      if (pieces[1] === "dashboard") return coachDashboard();
      if (pieces[1] === "sessions") return coachSessions();
      if (pieces[1] === "review") return coachReview(pieces[2]);
      if (pieces[1] === "log") return coachLogDetail(pieces[2]);
      if (pieces[1] === "session") {
        if (!state.builder || state.builder.kind !== "session" || state.builder.id !== (pieces[2] === "new" ? null : pieces[2]) || state.builder.sourceTemplateId !== current.params.get("template")) await setupBuilder("session", pieces[2] === "new" ? null : pieces[2], current.params.get("template"));
        return builder();
      }
      if (pieces[1] === "templates") return coachTemplates();
      if (pieces[1] === "template") {
        if (!state.builder || state.builder.kind !== "template" || state.builder.id !== (pieces[2] === "new" ? null : pieces[2])) await setupBuilder("template", pieces[2] === "new" ? null : pieces[2]);
        return builder();
      }
      if (pieces[1] === "athletes") return coachAthletes();
      if (pieces[1] === "athlete-history") return coachAthleteHistory(pieces[2]);
      if (pieces[1] === "athlete") return athleteEditor(pieces[2] === "new" ? null : pieces[2]);
      if (pieces[1] === "exercises") return coachExercises();
      if (pieces[1] === "exercise") return exerciseEditor(pieces[2] === "new" ? null : pieces[2]);
      return coachDashboard();
    }
    await restoreAthlete();
    if (pieces[0] === "today") return athleteToday();
    if (pieces[0] === "workout") return athleteWorkout(pieces[1]);
    if (pieces[0] === "history") return athleteHistory();
    if (pieces[0] === "profile") return athleteProfile();
    return athleteToday();
  } catch (error) {
    console.error(error);
    shell('<section class="card"><div class="eyebrow">Something went wrong</div><h1>We could not load this screen.</h1><p class="subtle">' + esc(error.message) + '</p><button class="button primary" data-action="reload">Try again</button></section>', pieces[0] === "coach");
  }
}
window.addEventListener("hashchange", render);
window.addEventListener("beforeunload", () => { document.querySelectorAll("[data-set-row]").forEach((row) => draftPut(row.dataset.log, readSetRow(row))); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker unavailable", error));
render();
