# CBI Gym App

A web application for managing athlete workouts, schedules, and gym activities—built with [Streamlit](https://streamlit.io/) and [Supabase](https://supabase.com/).  
Designed for Cairns Basketball coaches, players, and staff.

---

## Table of Contents

- [Features](#features)
- [File Structure](#file-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database Schema](#database-schema)
- [Static Site Redirect](#static-site-redirect)
- [Deployment](#deployment)
- [Usage](#usage)
- [Extending & Contributing](#extending--contributing)
- [License](#license)

---

## Features

- Athlete & coach authentication (Supabase)
- Coaches can create, assign, and manage workout sessions
- Athletes view, log, and track their workouts
- Role-based access: coach vs athlete workflows
- Calendar and scheduling for workouts
- Supabase database integration for persistence
- Secure deployment and private access options
- Static landing page/redirect via GitHub Pages (for custom domains)

---

## File Structure

| File Name                    | Description                                  |
|------------------------------|----------------------------------------------|
| CBI_Gym_App.py               | Main Streamlit app entry point               |
| 1_Login.py                   | Login & signup page                          |
| 2_Athlete_Workouts.py        | Athlete's workout dashboard                  |
| 3_Coach_Workout_Plans.py     | Coach's workout/session creation             |
| 4_Coach_Authentication.py    | Coach-only authentication page               |
| supabase_schema.sql          | (Recommended: Add this file)                 |
| static_redirect/index.html   | Static GitHub Pages redirect (see below)     |
| README.md                    | This documentation                           |



---

## Getting Started

### Prerequisites

- Python 3.11+
- [pip](https://pip.pypa.io/en/stable/) or [conda](https://docs.conda.io/)
- Streamlit
- Supabase Python client (`supabase-py` or `supbase` through anaconda)
- Git (for cloning repo and Pages deployment)

### Installation

1. **Clone the repository**
    ```bash
    git clone https://github.com/DanielMajer24/cbi_gym_app.git
    cd cbi_gym_app
    ```

2. **Install Python dependencies**
    ```bash
    pip install -r requirements.txt
    ```
    *(If `requirements.txt` is not present, install at least:)*  
    ```bash
    pip install streamlit supabase
    ```

3. **Set up environment variables** (see below).

4. **Initialize the Supabase database**  
   - Create a new project at [supabase.com](https://supabase.com/).
   - Run the SQL statements from `supabase_schema.sql` in the SQL editor.

5. **Run the app locally**
    ```bash
    streamlit run CBI_Gym_App.py
    ```

---

## Environment Variables

You’ll need to set the following environment variables (recommended via a `.env` file) or secrets file in streamlit (secrets.toml):

.env
```
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_or_service_key
```

secrets.toml
```secrets.toml
SUPABASE_URL="your_supabase_project_url"
SUPABASE_KEY="your_supabase_anon_or_service_key"
```

## Database Schema

This project uses Supabase (Postgres) for data storage.

**Main tables:**

- `users`: All users (athletes, coaches, etc.)
- `exercises`: List of exercise templates
- `workouts`: Logged athlete workouts
- `workout_sets`: Details of each set performed
- `scheduled_workouts`: Planned sessions by coaches
- `scheduled_workout_exercises`: Exercises assigned to scheduled workouts
- `scheduled_workout_attendees`: User attendance/RSVP for sessions

See `supabase_schema.sql` for full SQL.

**Example ER diagram:**  
(Coach → schedules → session → assigns exercises & athletes → athletes log workouts/sets)


## Static Site Redirect

A [GitHub Pages](https://github.com/DanielMajer24/cbi_gym_static_app) repo serves as a landing page and redirect to your Streamlit app (useful for custom domains and clean navigation).

### Redirect HTML Example

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Redirecting...</title>
  <script>
    // Redirect to deployed Streamlit app
    const STREAMLIT_URL = "https://cairns-basketball-gym-app.streamlit.app/Coach_Authentication";
    if (window.location.hash.length > 1) {
      window.location.href = STREAMLIT_URL + "?" + window.location.hash.substring(1);
    } else {
      window.location.href = STREAMLIT_URL;
    }
  </script>
</head>
<body>
  Redirecting you to the authentication page...
</body>
</html>
```

### How to use

- Place this file as `index.html` in your static repo.
- Configure your GitHub Pages settings for the repo.
- Point your custom domain to this GitHub Pages site.


