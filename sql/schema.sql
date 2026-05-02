CREATE TABLE IF NOT EXISTS routes (
  id SERIAL PRIMARY KEY,
  route_name VARCHAR(100) NOT NULL UNIQUE,
  corridor VARCHAR(150) NOT NULL,
  bus_capacity INTEGER NOT NULL DEFAULT 60,
  delay_threshold NUMERIC(6, 2) NOT NULL DEFAULT 12,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trips_clean (
  id SERIAL PRIMARY KEY,
  route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  total_passengers INTEGER NOT NULL,
  average_delay NUMERIC(6, 2) NOT NULL,
  occupancy_rate NUMERIC(7, 4) NOT NULL,
  trip_date DATE NOT NULL,
  trip_hour INTEGER NOT NULL CHECK (trip_hour BETWEEN 0 AND 23),
  trip_count INTEGER NOT NULL DEFAULT 1,
  risk_flag BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (route_id, trip_date, trip_hour)
);

CREATE TABLE IF NOT EXISTS trips_raw (
  id SERIAL PRIMARY KEY,
  route_name VARCHAR(100) NOT NULL,
  passenger_count INTEGER NOT NULL,
  delay_minutes NUMERIC(6, 2) NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline_benchmarks (
  id SERIAL PRIMARY KEY,
  pipeline VARCHAR(20) NOT NULL,
  operation VARCHAR(40) NOT NULL,
  duration_ms NUMERIC(10, 3) NOT NULL,
  rows_processed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_clean_route_date_hour
  ON trips_clean (route_id, trip_date, trip_hour);

CREATE INDEX IF NOT EXISTS idx_trips_raw_route_timestamp
  ON trips_raw (route_name, "timestamp");

CREATE INDEX IF NOT EXISTS idx_pipeline_benchmarks_lookup
  ON pipeline_benchmarks (pipeline, operation, created_at);

INSERT INTO routes (route_name, corridor, bus_capacity, delay_threshold)
VALUES
  ('North Loop', 'Central District -> North Terminal', 60, 12),
  ('Harbor Express', 'Harbor Front -> Financial Center', 55, 10),
  ('University Shuttle', 'West Station -> University Belt', 70, 8),
  ('Airport Connector', 'Airport -> South Exchange', 50, 14),
  ('Riverside Line', 'Riverside Park -> Old Town', 45, 11)
ON CONFLICT (route_name) DO NOTHING;
