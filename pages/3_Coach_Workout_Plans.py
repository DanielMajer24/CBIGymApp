import streamlit as st
from supabase import create_client
# from dotenv import load_dotenv
# from pathlib import Path
import os
from datetime import date
from collections import defaultdict

# --- Load Supabase config ---
# load_dotenv(dotenv_path=Path("/Users/dmaje23/Documents/dev/envfiles/gymapp/gym_app_secrets.env"))
SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

st.set_page_config(page_title="Plan a Workout", layout="centered")
st.title("📝 Plan or Edit a Workout")

# --- Get logged-in user ID ---
user_id = st.session_state.get("user_id")
if not user_id:
    st.warning("You must be logged in to view this page.")
    st.stop()

# --- Fetch user profile to check 'coach' status ---
user_resp = supabase.table("users").select("coach, name").eq("id", user_id).maybe_single().execute()
user_data = user_resp.data
if not user_data or not user_data.get("coach", False):
    st.error("Only coaches can access this page.")
    st.stop()

st.info(f"Logged in as Coach {user_data['name']}")

# --- Fetch all athletes, build name/ID mappings ---
athletes_resp = supabase.table("users").select("id, name").eq("coach", "false").order("name").execute()
athletes = athletes_resp.data or []
athlete_options = {u["name"]: u["id"] for u in athletes}
id_to_name = {u["id"]: u["name"] for u in athletes}
all_athlete_names = list(athlete_options.keys())

# --- Fetch exercises ---
exercises_resp = supabase.table("exercises").select("id, name, description, video_url").order("name").execute()
exercises = exercises_resp.data or []
exercise_options = {ex["name"]: ex for ex in exercises}

# --- Fetch scheduled sessions for this coach ---
past_sessions_resp = supabase.table("scheduled_workouts").select("id, scheduled_date, notes").eq("user_id", user_id).order("scheduled_date", desc=True).limit(10).execute()
past_sessions = past_sessions_resp.data or []
session_choices = {f"{ps['scheduled_date']}: {ps.get('notes','') or '(No title)'}": ps["id"] for ps in past_sessions}

# --- Determine editing session ---
editing_session_id = st.session_state.get("editing_session_id")
dropdown_edit_session_id = None
session_choice = st.selectbox(
    "Edit an Existing Session (or leave blank to create new)",
    [""] + list(session_choices.keys()),
    key="session_choice"
)
if session_choice and session_choice in session_choices:
    dropdown_edit_session_id = session_choices[session_choice]

editing_session_id = editing_session_id or dropdown_edit_session_id

# --- Load session data if editing ---
if editing_session_id:
    session_resp = supabase.table("scheduled_workouts").select("*").eq("id", editing_session_id).maybe_single().execute()
    session_data = session_resp.data or {}
    workout_date = date.fromisoformat(session_data.get("scheduled_date", str(date.today())))
    notes = session_data.get("notes", "")

    # --- Delete session and Copy session buttons ---
    st.markdown("---")
    action_col1, action_col2, _ = st.columns([1, 1, 5])
    with action_col1:
        if st.button("Delete Session", type="primary"):
            # Cascade: delete all attendees and exercises for this session
            supabase.table("scheduled_workout_attendees").delete().eq("scheduled_workout_id", editing_session_id).execute()
            supabase.table("scheduled_workout_exercises").delete().eq("scheduled_workout_id", editing_session_id).execute()
            supabase.table("scheduled_workouts").delete().eq("id", editing_session_id).execute()
            st.success("Session deleted!")
            # Clean up and rerun
            for key in ["editing_session_id", "copying_session", "copied_session_fields"]:
                if key in st.session_state:
                    del st.session_state[key]
            st.experimental_rerun()
    with action_col2:
        if st.button("Copy Session"):
            # Set a flag to start a new session using current values
            st.session_state["copying_session"] = True
            st.session_state["copied_session_fields"] = {
                "notes": notes,
                "selected_athletes": [],
                "selected_exercises": [],
            }
            # --- Load attendees for copying
            att_resp = supabase.table("scheduled_workout_attendees") \
                .select("user_id") \
                .eq("scheduled_workout_id", editing_session_id) \
                .execute()
            att_data = att_resp.data or []
            selected_athlete_ids = [a["user_id"] for a in att_data]
            st.session_state["copied_session_fields"]["selected_athletes"] = [
                id_to_name[uid] for uid in selected_athlete_ids if uid in id_to_name
            ]
            # --- Load exercises for copying
            swe_resp = supabase.table("scheduled_workout_exercises").select("exercise_id, set_number, reps, exertion_metric").eq("scheduled_workout_id", editing_session_id).execute()
            swe_data = swe_resp.data or []
            ex_group = defaultdict(list)
            for x in swe_data:
                ex_group[x["exercise_id"]].append(x)
            selected_exercises = []
            for eid, sets in ex_group.items():
                name = next((e["name"] for e in exercises if e["id"] == eid), None)
                if name:
                    selected_exercises.append({
                        "exercise_name": name,
                        "sets": len(sets),
                        "reps": sets[0]["reps"],
                        "exertion_metric": sets[0].get("exertion_metric", "kgs")
                    })
            st.session_state["copied_session_fields"]["selected_exercises"] = selected_exercises.copy()
            st.session_state["editing_session_id"] = None  # Disable edit mode!
            st.experimental_rerun()

    # --- Load attendees (by user_id, map to name) ---
    att_resp = supabase.table("scheduled_workout_attendees") \
        .select("user_id") \
        .eq("scheduled_workout_id", editing_session_id) \
        .execute()
    att_data = att_resp.data or []
    selected_athlete_ids = [a["user_id"] for a in att_data]
    selected_athletes = [id_to_name[uid] for uid in selected_athlete_ids if uid in id_to_name]

    # --- Load exercises (with exertion_metric!) ---
    swe_resp = supabase.table("scheduled_workout_exercises").select("exercise_id, set_number, reps, exertion_metric").eq("scheduled_workout_id", editing_session_id).execute()
    swe_data = swe_resp.data or []
    ex_group = defaultdict(list)
    for x in swe_data:
        ex_group[x["exercise_id"]].append(x)
    selected_exercises = []
    for eid, sets in ex_group.items():
        name = next((e["name"] for e in exercises if e["id"] == eid), None)
        if name:
            selected_exercises.append({
                "exercise_name": name,
                "sets": len(sets),
                "reps": sets[0]["reps"],
                "exertion_metric": sets[0].get("exertion_metric", "kgs")
            })
    st.session_state.selected_exercises = selected_exercises.copy()
    st.session_state["editing_session_id"] = editing_session_id

# --- When not editing, check if copying
elif not editing_session_id and st.session_state.get("copying_session"):
    copydata = st.session_state["copied_session_fields"]
    workout_date = date.today()   # Always default to today for new session
    notes = copydata["notes"]
    selected_athletes = copydata["selected_athletes"]
    selected_exercises = copydata["selected_exercises"]
    st.session_state.selected_exercises = selected_exercises.copy()
    st.success("You are copying a session! Adjust the date and details, then save as new.")
else:
    workout_date = date.today()
    notes = ""
    selected_athletes = []
    selected_exercises = []
    if "selected_exercises" not in st.session_state:
        st.session_state.selected_exercises = []

# --- Plan or Edit the workout ---
st.markdown("### Workout Details")
workout_date = st.date_input("Session Date", value=workout_date)
notes = st.text_input("Event Title", value=notes)

st.markdown("### Exercises")
if st.button("Add Exercise"):
    st.session_state.selected_exercises.append({"exercise_name": None, "sets": 3, "reps": 10, "exertion_metric": "kgs"})

for i, ex in enumerate(st.session_state.selected_exercises):
    st.write(f"**Exercise {i+1}**")
    col1, col2, col3, col4 = st.columns([4, 2, 2, 3])
    with col1:
        exercise_name = st.selectbox(
            f"Exercise",
            options=[""] + list(exercise_options.keys()),
            key=f"exercise_name_{i}",
            index=0 if ex.get("exercise_name") is None else list(exercise_options.keys()).index(ex["exercise_name"]) + 1
        )
    with col2:
        sets = st.number_input("Sets", min_value=1, max_value=10, step=1, value=ex.get("sets", 3), key=f"sets_{i}")
    with col3:
        reps = st.number_input("Reps", min_value=1, max_value=50, step=1, value=ex.get("reps", 10), key=f"reps_{i}")
    with col4:
        exertion_metric = st.selectbox(
            "Exertion Metric",
            options=["kgs", "calories", "seconds"],
            index=["kgs", "calories", "seconds"].index(ex.get("exertion_metric", "kgs")),
            key=f"exertion_metric_{i}"
        )

    st.session_state.selected_exercises[i] = {
        "exercise_name": exercise_name if exercise_name else None,
        "sets": sets,
        "reps": reps,
        "exertion_metric": exertion_metric
    }
    if exercise_name and exercise_name in exercise_options:
        st.caption(exercise_options[exercise_name]["description"])
        st.markdown(f"[📺 Video]({exercise_options[exercise_name]['video_url']})")

if len(st.session_state.selected_exercises) > 1 and st.button("Remove Last Exercise"):
    st.session_state.selected_exercises.pop()

# --- Attendees (multiselect with correct default) ---
st.markdown("### Who's attending?")
multiselect_key = f"athlete_multiselect_{editing_session_id or 'new'}"
selected_athletes = st.multiselect(
    "Select athletes",
    options=all_athlete_names,
    default=selected_athletes,
    key=multiselect_key
)

# --- Save the session plan to the DB ---
if st.button("Save Workout Plan"):
    planned = [
        {
            "exercise_id": exercise_options[ex["exercise_name"]]["id"],
            "name": ex["exercise_name"],
            "sets": ex["sets"],
            "reps": ex["reps"],
            "exertion_metric": ex.get("exertion_metric", "kgs")
        }
        for ex in st.session_state.selected_exercises if ex["exercise_name"]
    ]
    if not planned:
        st.warning("Please select at least one exercise.")
    elif not selected_athletes:
        st.warning("Please select at least one athlete.")
    else:
        if editing_session_id:
            # --- UPDATE session ---
            supabase.table("scheduled_workouts").update({
                "scheduled_date": str(workout_date),
                "notes": notes
            }).eq("id", editing_session_id).execute()
            # Remove existing exercises & attendees
            supabase.table("scheduled_workout_exercises").delete().eq("scheduled_workout_id", editing_session_id).execute()
            supabase.table("scheduled_workout_attendees").delete().eq("scheduled_workout_id", editing_session_id).execute()
            sw_id = editing_session_id
        else:
            # --- INSERT new session ---
            sw_resp = supabase.table("scheduled_workouts").insert({
                "user_id": user_id,
                "scheduled_date": str(workout_date),
                "notes": notes
            }).execute()
            sw_id = sw_resp.data[0]["id"]

        # Insert exercises
        for p in planned:
            for set_number in range(1, p["sets"] + 1):
                supabase.table("scheduled_workout_exercises").insert({
                    "scheduled_workout_id": sw_id,
                    "exercise_id": p["exercise_id"],
                    "set_number": set_number,
                    "reps": p["reps"],
                    "exertion_metric": p["exertion_metric"],
                    "target_value": 0
                }).execute()

        # Insert attendees
        for name in selected_athletes:
            supabase.table("scheduled_workout_attendees").insert({
                "scheduled_workout_id": sw_id,
                "user_id": athlete_options[name],
                "status": "confirmed"
            }).execute()

        st.success("Workout plan created/updated and saved!")
        st.session_state.selected_exercises = []
        # Clean up state after save
        for key in ["editing_session_id", "copying_session", "copied_session_fields"]:
            if key in st.session_state:
                del st.session_state[key]
