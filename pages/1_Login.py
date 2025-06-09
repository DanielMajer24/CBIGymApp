import streamlit as st
from supabase import create_client
# from dotenv import load_dotenv
# from pathlib import Path
import os

# Load environment variables
# load_dotenv(dotenv_path=Path("/Users/dmaje23/Documents/dev/envfiles/gymapp/gym_app_secrets.env"))
SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

st.title("🏋️ Gym App Login / Sign Up")

mode = st.radio("Choose mode:", ["Login", "Sign Up", "Forgot Password"])

# ------------------------
# LOGIN
# ------------------------
if mode == "Login":
    email = st.text_input("Email")
    password = st.text_input("Password", type="password")

    if st.button("Log In"):
        try:
            response = supabase.auth.sign_in_with_password({
                "email": email,
                "password": password
            })
            user = response.user
            session = response.session
            if user and session:
                st.session_state["user"] = user
                st.session_state["user_id"] = user.id  # <-- ADDED
                st.session_state["access_token"] = session.access_token
                st.session_state["refresh_token"] = session.refresh_token
                st.success(f"✅ Logged in as {user.email}")
                st.switch_page("CBI_Gym_App.py")
            else:
                st.error("❌ Login failed. Check credentials or email confirmation.")
        except Exception as e:
            st.error(f"❌ Login error: {str(e)}")

# ------------------------
# SIGN UP
# ------------------------
elif mode == "Sign Up":
    name = st.text_input("Full Name")
    dob = st.date_input("Date of Birth")
    gym_exp = st.selectbox("Gym Experience", ["beginner", "intermediate", "advanced"])
    mobile = st.text_input("Mobile Number")

    email = st.text_input("Email")
    password = st.text_input("Password", type="password")

    if st.button("Create Account"):
        try:
            # Correct structure for supabase client in Anaconda
            response = supabase.auth.sign_up({
                "email": email,
                "password": password
            })
            user = response.user

            if user:
                # Insert extra profile details
                supabase.table("users").insert({
                    "id": user.id,
                    "name": name,
                    "date_of_birth": dob.isoformat(),
                    "gym_experience": gym_exp,
                    "mobile_number": mobile,
                    'coach': False
                }).execute()


                st.success("✅ Account created and profile saved! Please check your email to confirm your address.")
            else:
                st.warning("⚠️ Sign-up succeeded but no user object returned. Check your email for confirmation.")
        except Exception as e:
            st.error(f"❌ Sign-up error: {str(e)}")

# ------------------------
# PASSWORD RESET
# ------------------------
elif mode == "Forgot Password":
    email = st.text_input("Enter your email to reset password")

    if st.button("Send Reset Email"):
        try:
            supabase.auth.reset_password_email(email)
            st.success("✅ Reset email sent! Please check your inbox.")
        except Exception as e:
            st.error(f"❌ Error sending reset email: {str(e)}")
