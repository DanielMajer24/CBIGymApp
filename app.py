import streamlit as st
import pandas as pd
import sqlite3

# Create a connection to the SQLite database
conn = sqlite3.connect("lifting_sessions.db")
c = conn.cursor()

# Create a table to store the lifting sessions if it doesn't exist
c.execute('''
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise TEXT,
        set_number INTEGER,
        weight_kg REAL
    )
''')
conn.commit()

# Define the list of exercises and sets
exercises = {
    "Bench Press": 3,
    "Squats": 4,
    "Deadlift": 3,
    "Overhead Press": 3,
    "Barbell Row": 3
}

# Create a DataFrame to hold the exercise data
data = {"Exercise": [], "Set": [], "Weight (kg)": []}
for exercise, sets in exercises.items():
    for set_num in range(1, sets + 1):
        data["Exercise"].append(exercise)
        data["Set"].append(set_num)
        data["Weight (kg)"].append(None)

df = pd.DataFrame(data)

st.title("Lifting Weights Tracker")

st.write("Enter the weights lifted for each set:")

# Create a form for entering the weights
with st.form("weight_entry"):
    for index, row in df.iterrows():
        weight = st.number_input(f"{row['Exercise']} - Set {row['Set']} (kg):", min_value=0, step=1, key=f"weight_{index}")
        df.at[index, "Weight (kg)"] = weight

    # Submit button
    submitted = st.form_submit_button("Submit")

# Show the results after submission
if submitted:
    st.write("Here is your workout session:")
    st.table(df)

    # Insert the session data into the database
    for index, row in df.iterrows():
        c.execute('''
            INSERT INTO sessions (exercise, set_number, weight_kg)
            VALUES (?, ?, ?)
        ''', (row['Exercise'], row['Set'], row['Weight (kg)']))
    conn.commit()
    st.success("Session saved to the database")

# Optionally, display the previous sessions from the database
if st.button("Show Previous Sessions"):
    c.execute("SELECT exercise, set_number, weight_kg FROM sessions")
    rows = c.fetchall()
    
    if rows:
        previous_sessions = pd.DataFrame(rows, columns=["Exercise", "Set", "Weight (kg)"])
        st.write("Previous Sessions:")
        st.table(previous_sessions)
    else:
        st.write("No previous sessions found.")

# Close the database connection when done
conn.close()
