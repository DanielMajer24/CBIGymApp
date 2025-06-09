import streamlit as st
from supabase import create_client
# from dotenv import load_dotenv
# from pathlib import Path
import os

# --- Load Supabase config ---
# load_dotenv(dotenv_path=Path("/Users/dmaje23/Documents/dev/envfiles/gymapp/gym_app_secrets.env"))
SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Get query parameters ---
query_params = st.query_params if hasattr(st, "query_params") else st.experimental_get_query_params()
access_token = query_params.get("access_token", [None])
refresh_token = query_params.get("refresh_token", [None])
event_type = query_params.get("type", [None])

# --- UI / logic based on action type ---
if access_token:
    if event_type == "signup":
        # Optionally log user in (set session)
        try:
            session = supabase.auth.set_session(access_token=access_token, refresh_token=refresh_token)
            user = session.user if session else None
        except Exception:
            user = None
        st.success("✅ Email confirmed! You are now logged in.")

        # Store in session_state
        st.session_state["user"] = user
        if user:
            st.session_state["user_id"] = user.id  # <-- ADDED
        st.session_state["access_token"] = access_token
        st.session_state["refresh_token"] = refresh_token

        if st.button("Go to Dashboard"):
            st.switch_page("CBI_Gym_App.py")  # Replace with your actual dashboard page

    elif event_type == "recovery":
        # Password reset UI
        try:
            session = supabase.auth.set_session(access_token=access_token, refresh_token=refresh_token)
            user = session.user if session else None
            # Store in session_state
            st.session_state["user"] = user
            if user:
                st.session_state["user_id"] = user.id  # <-- ADDED
            st.session_state["access_token"] = access_token
            st.session_state["refresh_token"] = refresh_token

            st.subheader("Reset Your Password")
            new_password = st.text_input("New Password", type="password")
            confirm_password = st.text_input("Confirm Password", type="password")
            if st.button("Reset Password"):
                if new_password != confirm_password:
                    st.error("Passwords do not match.")
                elif len(new_password) < 6:
                    st.error("Password must be at least 6 characters.")
                else:
                    try:
                        supabase.auth.update_user({"password": new_password})
                        st.success("Password reset successful! Please log in.")
                        st.switch_page("pages/1_Login.py")
                    except Exception as update_err:
                        st.error(f"Password update error: {str(update_err)}")
        except Exception as e:
            st.error(f"Session error: {str(e)}")

    elif event_type == "email_change":
        try:
            session = supabase.auth.set_session(access_token=access_token, refresh_token=refresh_token)
            user = session.user if session else None
            # Store in session_state
            st.session_state["user"] = user
            if user:
                st.session_state["user_id"] = user.id  # <-- ADDED
            st.session_state["access_token"] = access_token
            st.session_state["refresh_token"] = refresh_token
        except Exception:
            user = None
        st.success("✅ Your email has been changed and verified!")
        if st.button("Go to Dashboard"):
            st.switch_page("CBI_Gym_App.py")
    else:
        st.info(f"Token detected but unknown event type: {event_type}")
        st.write(query_params)
else:
    st.warning("Missing or invalid link. Please check your email link or contact support.")
