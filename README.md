# Bus Route Performance Tracker

Bus Route Performance Tracker is an academic demo system that compares **ETL** and **ELT** architectures using simulated public transport data. The dashboard shows passenger demand, occupancy, delays, peak hours, and route risk so you can clearly explain how the two pipelines behave differently.

## Folder Structure

```text
.
|-- docker-compose.yml
|-- package.json
|-- public
|   |-- app.js
|   |-- index.html
|   |-- samples
|   |   `-- trips-example.csv
|   `-- styles.css
|-- sql
|   `-- schema.sql
`-- src
    |-- config.js
    |-- lib
    |   |-- csv.js
    |   |-- helpers.js
    |   |-- metrics.js
    |   `-- simulator.js
    |-- services
    |   `-- analytics.js
    |-- server.js
    `-- store
        |-- createStore.js
        |-- memoryStore.js
        `-- postgresStore.js
```

## Architecture

### ETL flow

1. Extract trip input from forms, CSV, or simulated data.
2. Transform immediately into route/date/hour summaries.
3. Load processed records into `trips_clean`.

### ELT flow

1. Extract trip input.
2. Load raw events directly into `trips_raw`.
3. Transform during analytics requests to calculate route summaries, peak hours, and delays.

## Database Tables

- `routes`: master list of bus routes and thresholds.
- `trips_clean`: ETL-generated hourly route summaries.
- `trips_raw`: ELT raw trip events.
- `pipeline_benchmarks`: persisted performance history for ETL/ELT inserts and analytics queries.

## Setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL with `docker compose up -d db`.
3. Install dependencies with `npm install`.
4. Start the server with `npm start`.
5. Open `http://localhost:3000`.

If `DATABASE_URL` is unavailable, the app can fall back to an in-memory store for demo purposes by keeping `ENABLE_MEMORY_FALLBACK=true`.

## Deploy on Render

This repo includes a Render Blueprint file at [render.yaml](/C:/Users/ryzen/Desktop/etl/render.yaml:1) that creates:

- one Node web service
- one Render Postgres database

Steps:

1. Push this project to GitHub, GitLab, or Bitbucket.
2. In Render, click `New` -> `Blueprint`.
3. Connect your repository and select the branch that contains this project.
4. Render will detect `render.yaml` and show the planned web service and database.
5. Review the region and plan before first deploy.
6. Click `Apply`.

Important notes:

- The service uses `npm install` as the build command and `npm start` as the start command.
- The app reads the database connection from Render's internal Postgres `connectionString`.
- `ENABLE_MEMORY_FALLBACK` is forced to `false` on Render so the app fails loudly if the database is not connected.
- The server health check path is `/health`.
- The app already runs schema creation on startup by loading [sql/schema.sql](/C:/Users/ryzen/Desktop/etl/sql/schema.sql:1), so no separate migration step is required for the initial deployment.

If you prefer to create the resources manually instead of using Blueprint:

1. Create a `Postgres` database in Render.
2. Create a `Web Service` from this repo.
3. Set `Build Command` to `npm install`.
4. Set `Start Command` to `npm start`.
5. Set `Health Check Path` to `/health`.
6. Add environment variable `DATABASE_URL` using the database's internal URL.
7. Add `ENABLE_MEMORY_FALLBACK=false`.

## Academic Talking Points

- **ETL advantage:** dashboard queries are faster because the data is already cleaned and aggregated.
- **ETL trade-off:** ingestion takes more work because transformation happens before storage.
- **ELT advantage:** raw data remains available for reprocessing and flexible analysis.
- **ELT trade-off:** analytics requests take longer because transformations happen during reads.
- **Benchmark evidence:** the dashboard now stores historical ETL/ELT read and write timings so you can present percentage-based performance comparisons over time.
