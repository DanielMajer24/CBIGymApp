import streamlit as st
import pandas as pd
import sqlite3

# Create a connection to the SQLite database
conn = sqlite3.connect("lifting_sessions.db")
c = conn.cursor()

# Create the athletes table if it doesn't exist
c.execute('''
    CREATE TABLE IF NOT EXISTS athletes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        position TEXT
    )
''')

# Create the sessions table if it doesn't exist
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

# Check if 'athlete_id' column exists in 'sessions' table
c.execute("PRAGMA table_info(sessions)")
columns = [info[1] for info in c.fetchall()]
if "athlete_id" not in columns:
    c.execute("ALTER TABLE sessions ADD COLUMN athlete_id INTEGER")
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

if st.button("Log In", key="login_button"):
    # Check if the athlete exists in the database
    athlete_id = get_athlete_id(name)
    
    if not athlete_id:
        # If the athlete doesn't exist, add them to the database
        c.execute("INSERT INTO athletes (name, position) VALUES (?, ?)", (name, position))
        conn.commit()
        st.success(f"Welcome {name}! Your position as {position} has been recorded.")
        athlete_id = get_athlete_id(name)
    else:
        # Optionally update the position if it might have changed
        c.execute("UPDATE athletes SET position = ? WHERE id = ?", (position, athlete_id))
        conn.commit()
        st.success(f"Welcome back, {name}! You play as {position}.")
    
    # Show only their program after login
    st.write("Enter the weights lifted for each set:")

    # Create a form for entering the weights with a unique key
    with st.form(key="weight_entry_form"):
        rows = []
        for exercise, sets in exercises.items():
            for set_num in range(1, sets + 1):
                weight = st.number_input(f"{exercise} - Set {set_num} (kg):", min_value=0, step=1, key=f"{exercise}_{set_num}")
                rows.append({"Exercise": exercise, "Set": set_num, "Weight (kg)": weight})

        # Convert the list of rows to a DataFrame
        df = pd.DataFrame(rows)

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

    # Display previous sessions in a collapsible section
    with st.expander("Show Previous Sessions"):
        c.execute('''
            SELECT exercise, set_number, weight_kg FROM sessions
            WHERE athlete_id = ?
            ORDER BY id DESC
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
