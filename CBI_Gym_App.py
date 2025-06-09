import streamlit as st
from streamlit_calendar import calendar
import datetime
import time
from supabase import create_client
# from dotenv import load_dotenv
from pathlib import Path
import os

# --- Load Supabase config ---
# load_dotenv(dotenv_path=Path("/Users/dmaje23/Documents/dev/envfiles/gymapp/gym_app_secrets.env"))
SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

st.set_page_config(page_title="CBI Gym App", layout="centered")
st.title("🏋️ Welcome to the CBI Gym App")

# --- Authentication check ---
user = st.session_state.get("user")
user_id = st.session_state.get("user_id")
access_token = st.session_state.get("access_token")

if not user or not access_token or not user_id:
    st.warning("🔒 You are not logged in.")
    st.page_link("pages/1_Login.py", label="🔑 Login or Sign Up")
    st.stop()

# --- Fetch coach status and name, create profile if missing ---
profile_resp = supabase.table("users").select("coach, name").eq("id", user_id).maybe_single().execute()
profile = profile_resp.data if profile_resp and hasattr(profile_resp, "data") else None
if not profile:
    # Auto-create a default profile for the user if missing
    user_name = getattr(user, "user_metadata", {}).get("name", user.email)
    supabase.table("users").insert({
        "id": user_id,
        "name": user_name,
        "date_of_birth": None,
        "gym_experience": "beginner",
        "mobile_number": "",
        "coach": False
    }).execute()
    st.warning("We created your user profile. Please refresh the page to continue.")
    st.stop()

is_coach = bool(profile.get("coach", False))
name = profile.get("name", user.email if user else "User")

st.success(f"Logged in as {name} ({'Coach' if is_coach else 'Athlete'})")

# --- Fetch relevant scheduled workouts ---
today = datetime.date.today()
today_str = today.strftime("%Y-%m-%d")
events = []

if is_coach:
    sw_resp = supabase.table("scheduled_workouts") \
        .select("id, scheduled_date, notes") \
        .eq("user_id", user_id) \
        .gte("scheduled_date", today_str) \
        .order("scheduled_date") \
        .execute()
    sessions = sw_resp.data or []
    for s in sessions:
        events.append({
            "title": s.get("notes") or "(No Title)",
            "color": "#2074d4",
            "start": s["scheduled_date"],
            "end": s["scheduled_date"],
            "scheduled_workout_id": s["id"],
            "extendedProps": { "scheduled_workout_id": s["id"] },
        })
else:
    att_resp = supabase.table("scheduled_workout_attendees") \
        .select("scheduled_workout_id") \
        .eq("user_id", user_id) \
        .execute()
    sw_ids = [a["scheduled_workout_id"] for a in (att_resp.data or [])]
    if sw_ids:
        sw_resp = supabase.table("scheduled_workouts") \
            .select("id, scheduled_date, notes") \
            .in_("id", sw_ids) \
            .gte("scheduled_date", today_str) \
            .order("scheduled_date") \
            .execute()
        sessions = sw_resp.data or []
        for s in sessions:
            events.append({
                "title": s.get("notes") or "(No Title)",
                "color": "#38b000",
                "start": s["scheduled_date"],
                "end": s["scheduled_date"],
                "scheduled_workout_id": s["id"],
                "extendedProps": { "scheduled_workout_id": s["id"] },
            })

# --- Calendar CSS: Smaller, white event text
custom_css = """
.fc-event-title, .fc-event-main {
    color: #fff !important;
    font-weight: 700;
    font-size: 12px !important;
}
"""

calendar_options = {
    "headerToolbar": {
        "left": "today prev,next",
        "center": "title",
        "right": "dayGridDay,dayGridWeek,dayGridMonth",
    },
    "initialDate": today_str,
    "initialView": "dayGridMonth",
}

st.title("📅 Your Gym Sessions")
if not events:
    st.info("No scheduled sessions found.")
else:
    state = calendar(
        events=events,
        options=calendar_options,
        custom_css=custom_css,
        key="calendar_nav_demo"
    )
    if state.get("eventClick") and state["eventClick"].get("event"):
        event = state["eventClick"]["event"]
        event_title = event.get("title", "")
        event_date = event.get("start", "")

        session_id = (
            event.get("scheduled_workout_id")
            or event.get("extendedProps", {}).get("scheduled_workout_id")
        )

        if is_coach and session_id:
            st.session_state["editing_session_id"] = session_id
            st.success(f"Editing: {event_title} ...")
            time.sleep(1)
            st.switch_page("pages/3_Coach_Workout_Plans.py")
        elif not is_coach and session_id:
            st.session_state["workout_date"] = event_date
            st.session_state["scheduled_workout_id"] = session_id
            st.success(f"Logging: {event_title} ...")
            time.sleep(1)
            st.switch_page("pages/2_Athlete_Workouts.py")

# --- Log Out button ---
if st.button("Log Out"):
    for key in [
        "user", "access_token", "refresh_token",
        "user_id", "workout_date", "scheduled_workout_id", "editing_session_id"
    ]:
        if key in st.session_state:
            del st.session_state[key]
    st.rerun()
