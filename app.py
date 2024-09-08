import streamlit as st
import pandas as pd
import sqlite3

# Create a connection to the SQLite database
conn = sqlite3.connect("lifting_sessions.db")
c = conn.cursor()

# Create the tables for athletes and sessions
c.execute('''
    CREATE TABLE IF NOT EXISTS athletes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        position TEXT
    )
''')

c.execute('''
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        athlete_id INTEGER,
        exercise TEXT,
        set_number INTEGER,
        weight_kg REAL,
        FOREIGN KEY(athlete_id) REFERENCES athletes(id)
    )
''')
conn.commit()

# Helper function to get athlete ID
def get_athlete_id(name):
    c.execute("SELECT id FROM athletes WHERE name = ?", (name,))
    athlete = c.fetchone()
    if athlete:
        return athlete[0]
    return None

# Define the list of exercises and sets
exercises = {
    "Bench Press": 3,
    "Squats": 4,
    "Deadlift": 3,
    "Overhead Press": 3,
    "Barbell Row": 3
}

# Create a simple login form for athletes
st.title("Marlins Team Lifting Weights Tracker")

name = st.text_input("Enter your name:")
position = st.text_input("Enter your position:")

if st.button("Log In"):
    # Check if the athlete exists in the database
    athlete_id = get_athlete_id(name)
    
    if not athlete_id:
        # If the athlete doesn't exist, add them to the database
        c.execute("INSERT INTO athletes (name, position) VALUES (?, ?)", (name, position))
        conn.commit()
        st.success(f"Welcome {name}! Your position as {position} has been recorded.")
        athlete_id = get_athlete_id(name)
    else:
        st.success(f"Welcome back, {name}! You play as {position}.")
    
    # Show only their program after login
    st.write("Enter the weights lifted for each set:")

    # Create a form for entering the weights
    with st.form("weight_entry"):
        df = pd.DataFrame({"Exercise": [], "Set": [], "Weight (kg)": []})
        for exercise, sets in exercises.items():
            for set_num in range(1, sets + 1):
                weight = st.number_input(f"{exercise} - Set {set_num} (kg):", min_value=0, step=1, key=f"{exercise}_{set_num}")
                df = df.append({"Exercise": exercise, "Set": set_num, "Weight (kg)": weight}, ignore_index=True)

        # Submit button for logging the session
        submitted = st.form_submit_button("Submit")
        
        if submitted:
            # Insert the session data into the database
            for _, row in df.iterrows():
                c.execute('''
                    INSERT INTO sessions (athlete_id, exercise, set_number, weight_kg)
                    VALUES (?, ?, ?, ?)
                ''', (athlete_id, row['Exercise'], row['Set'], row['Weight (kg)']))
            conn.commit()
            st.success("Your session has been saved.")

    # Show previous sessions for the athlete
    if st.button("Show Previous Sessions"):
        c.execute('''
            SELECT exercise, set_number, weight_kg FROM sessions
            WHERE athlete_id = ?
        ''', (athlete_id,))
        rows = c.fetchall()
        
        if rows:
            previous_sessions = pd.DataFrame(rows, columns=["Exercise", "Set", "Weight (kg)"])
            st.write("Previous Sessions:")
            st.table(previous_sessions)
        else:
            st.write("No previous sessions found.")
else:
    st.info("Please enter your name and position to log in.")

# Close the database connection
conn.close()
