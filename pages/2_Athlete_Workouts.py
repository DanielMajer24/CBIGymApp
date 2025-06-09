import streamlit as st
import datetime
from supabase import create_client
# from dotenv import load_dotenv
# from pathlib import Path
import os
from collections import defaultdict
import time

# --- Load Supabase config ---
# load_dotenv(dotenv_path=Path("/Users/dmaje23/Documents/dev/envfiles/gymapp/gym_app_secrets.env"))
SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

st.set_page_config(page_title="Log Workout", layout="centered")
st.title("📓 Log a Workout")

user = st.session_state.get("user")
user_id = st.session_state.get("user_id")
access_token = st.session_state.get("access_token")
scheduled_workout_id = st.session_state.get("scheduled_workout_id")
workout_date_value = st.session_state.get("workout_date")

if not user or not access_token or not user_id or not scheduled_workout_id:
    st.warning("🔒 Please log in to access this page.")
    st.page_link("pages/1_Login.py", label="🔑 Login or Sign Up")
    st.stop()

# --- Fetch planned exercises for this session ---
swe_resp = supabase.table("scheduled_workout_exercises") \
    .select("id, exercise_id, set_number, reps, exertion_metric, target_value") \
    .eq("scheduled_workout_id", scheduled_workout_id) \
    .order("exercise_id") \
    .order("set_number") \
    .execute()
swe_data = swe_resp.data or []

ex_ids = list(set([x["exercise_id"] for x in swe_data]))
if ex_ids:
    exercises_resp = supabase.table("exercises").select("id, name").in_("id", ex_ids).execute()
    exercises = {e["id"]: e["name"] for e in exercises_resp.data or []}
else:
    exercises = {}

planned_sets = defaultdict(list)
for row in swe_data:
    planned_sets[row["exercise_id"]].append(row)

# --- Check if this user has already logged this session ---
existing_workout_resp = supabase.table("workouts") \
    .select("id, date, notes") \
    .eq("user_id", user_id) \
    .eq("scheduled_workout_id", scheduled_workout_id) \
    .maybe_single() \
    .execute()
existing_workout = existing_workout_resp.data

existing_sets = {}
if existing_workout:
    # Fetch their previous entries
    workout_sets_resp = supabase.table("workout_sets") \
        .select("id, exercise_id, set_number, reps, exertion_metric, value") \
        .eq("workout_id", existing_workout["id"]) \
        .execute()
    for s in (workout_sets_resp.data or []):
        existing_sets[(s["exercise_id"], s["set_number"])] = s

existing_notes = existing_workout["notes"] if existing_workout else ""

st.write(f"📅 Workout Date: {workout_date_value}")

with st.form("log_planned_workout_form"):
    updated_entries = []
    for eid, sets in planned_sets.items():
        exname = exercises.get(eid, f"Exercise {eid[:5]}")
        with st.expander(f"{exname}", expanded=True):
            for s in sets:
                k = (eid, s["set_number"])
                prev = existing_sets.get(k, {})
                col1, col2, col3, col4 = st.columns([2, 2, 2, 2])
                with col1:
                    st.text_input("Set #", value=str(s['set_number']), disabled=True, key=f"setnum_{eid}_{s['set_number']}")
                with col2:
                    st.text_input("Metric", value=s['exertion_metric'], disabled=True, key=f"metric_{eid}_{s['set_number']}")
                with col3:
                    st.text_input("Reps", value=str(s['reps']), disabled=True, key=f"reps_{eid}_{s['set_number']}")
                with col4:
                    value = st.number_input(
                        f"Amount (Set {s['set_number']})",
                        min_value=0,
                        step=1,
                        key=f"{eid}_{s['set_number']}",
                        value=int(prev.get("value", 0))
                    )
                updated_entries.append({
                    "exercise_id": eid,
                    "set_number": s["set_number"],
                    "reps": s["reps"],
                    "exertion_metric": s["exertion_metric"],
                    "value": value,
                    "workout_set_id": prev.get("id")  # None if new
                })
    notes = st.text_area("Session Notes (optional)", value=existing_notes)
    submitted = st.form_submit_button("✅ Save Workout")

    if submitted:
        if existing_workout:
            # Update workout notes
            supabase.table("workouts").update({"notes": notes}).eq("id", existing_workout["id"]).execute()
            # Update or insert sets
            for entry in updated_entries:
                if entry["workout_set_id"]:
                    # Update
                    supabase.table("workout_sets").update({
                        "value": entry["value"],
                        "reps": entry["reps"],
                        "exertion_metric": entry["exertion_metric"],
                    }).eq("id", entry["workout_set_id"]).execute()
                else:
                    # Insert if new (shouldn't happen, but for robustness)
                    supabase.table("workout_sets").insert({
                        "workout_id": existing_workout["id"],
                        "exercise_id": entry["exercise_id"],
                        "set_number": entry["set_number"],
                        "reps": entry["reps"],
                        "exertion_metric": entry["exertion_metric"],
                        "value": entry["value"],
                        "notes": ""
                    }).execute()
            st.success("Workout updated!")
            st.balloons()
            time.sleep(2)
            st.switch_page("CBI_Gym_App.py")  # Redirect to main app page
        else:
            # Insert new workout & sets as before
            workout_resp = supabase.table("workouts").insert({
                "user_id": user_id,
                "date": str(workout_date_value),
                "notes": notes,
                "scheduled_workout_id": scheduled_workout_id
            }).execute()
            if workout_resp.data and len(workout_resp.data) > 0:
                workout_id = workout_resp.data[0]["id"]
                for entry in updated_entries:
                    supabase.table("workout_sets").insert({
                        "workout_id": workout_id,
                        "exercise_id": entry["exercise_id"],
                        "set_number": entry["set_number"],
                        "reps": entry["reps"],
                        "exertion_metric": entry["exertion_metric"],
                        "value": entry["value"],
                        "notes": ""
                    }).execute()
                st.success("Workout logged and saved to database!")
                st.balloons()
                time.sleep(2)
                st.switch_page("CBI_Gym_App.py")  # Redirect to main app page
            else:
                st.error("Failed to log workout. Try again.")

if st.button("Log Out"):
    for key in ["user", "access_token", "refresh_token", "user_id", "workout_date", "scheduled_workout_id"]:
        if key in st.session_state:
            del st.session_state[key]
    st.rerun()
