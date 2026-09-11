
-- USERS TABLE
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  date_of_birth DATE,
  gym_experience TEXT CHECK (gym_experience IN ('beginner', 'intermediate', 'advanced')),
  mobile_number TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- EXERCISES TABLE
CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  video_url TEXT
);

-- SCHEDULED WORKOUTS
CREATE TABLE scheduled_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  scheduled_date DATE NOT NULL,
  notes TEXT,
  is_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- SCHEDULED WORKOUT EXERCISES
CREATE TABLE scheduled_workout_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_workout_id UUID REFERENCES scheduled_workouts(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id),
  set_number INT,
  reps INT,
  exertion_metric TEXT CHECK (exertion_metric IN ('kgs', 'calories', 'seconds')),
  target_value NUMERIC(6,2)
);

-- ACTUAL WORKOUTS
CREATE TABLE workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  date DATE NOT NULL,
  notes TEXT,
  scheduled_workout_id UUID REFERENCES scheduled_workouts(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- WORKOUT SETS
CREATE TABLE workout_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id),
  set_number INT NOT NULL,
  reps INT,
  exertion_metric TEXT CHECK (exertion_metric IN ('kgs', 'calories', 'seconds')),
  value NUMERIC(6,2),
  notes TEXT
);

-- MATERIALIZED VIEW: PERSONAL BESTS
CREATE MATERIALIZED VIEW personal_bests AS
SELECT DISTINCT ON (w.user_id, ws.exercise_id, ws.exertion_metric)
  w.user_id,
  ws.exercise_id,
  ws.exertion_metric,
  ws.value AS best_value,
  w.date AS best_date
FROM workout_sets ws
JOIN workouts w ON ws.workout_id = w.id
WHERE ws.value IS NOT NULL
ORDER BY w.user_id, ws.exercise_id, ws.exertion_metric, ws.value DESC, w.date DESC;
