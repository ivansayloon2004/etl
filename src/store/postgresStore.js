const fs = require("node:fs/promises");
const { Pool } = require("pg");
const { calculateOccupancy, roundNumber } = require("../lib/helpers");

class PostgresStore {
  constructor(config) {
    this.kind = "postgres";
    this.config = config;
    this.pool = new Pool({
      connectionString: config.databaseUrl
    });
  }

  async init() {
    const schema = await fs.readFile(this.config.schemaPath, "utf8");
    await this.pool.query(schema);
  }

  async listRoutes() {
    const result = await this.pool.query(`
      SELECT
        id,
        route_name AS "routeName",
        corridor,
        bus_capacity AS "busCapacity",
        delay_threshold AS "delayThreshold"
      FROM routes
      ORDER BY route_name;
    `);

    return result.rows;
  }

  async ensureRoute({ routeName, busCapacity, delayThreshold }) {
    const result = await this.pool.query(
      `
        INSERT INTO routes (route_name, corridor, bus_capacity, delay_threshold)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (route_name)
        DO UPDATE SET route_name = EXCLUDED.route_name
        RETURNING
          id,
          route_name AS "routeName",
          corridor,
          bus_capacity AS "busCapacity",
          delay_threshold AS "delayThreshold";
      `,
      [routeName, "Custom route", busCapacity, delayThreshold]
    );

    return result.rows[0];
  }

  async upsertCleanTrip({ routeId, passengerCount, delayMinutes, tripDate, tripHour, busCapacity, delayThreshold }) {
    const initialOccupancy = calculateOccupancy(passengerCount, 1, busCapacity);
    const initialRisk = delayMinutes > delayThreshold;

    const result = await this.pool.query(
      `
        INSERT INTO trips_clean (
          route_id,
          total_passengers,
          average_delay,
          occupancy_rate,
          trip_date,
          trip_hour,
          trip_count,
          risk_flag
        )
        VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
        ON CONFLICT (route_id, trip_date, trip_hour)
        DO UPDATE SET
          total_passengers = trips_clean.total_passengers + EXCLUDED.total_passengers,
          average_delay = ROUND(
            ((trips_clean.average_delay * trips_clean.trip_count) + EXCLUDED.average_delay) /
            (trips_clean.trip_count + 1),
            2
          ),
          occupancy_rate = ROUND(
            (trips_clean.total_passengers + EXCLUDED.total_passengers)::NUMERIC /
            ((trips_clean.trip_count + 1) * $8),
            4
          ),
          trip_count = trips_clean.trip_count + 1,
          risk_flag = ROUND(
            ((trips_clean.average_delay * trips_clean.trip_count) + EXCLUDED.average_delay) /
            (trips_clean.trip_count + 1),
            2
          ) > $9,
          updated_at = NOW()
        RETURNING
          id,
          route_id AS "routeId",
          total_passengers AS "totalPassengers",
          average_delay AS "averageDelay",
          occupancy_rate AS "occupancyRate",
          trip_date AS "tripDate",
          trip_hour AS "tripHour",
          trip_count AS "tripCount",
          risk_flag AS "riskFlag";
      `,
      [routeId, passengerCount, roundNumber(delayMinutes), initialOccupancy, tripDate, tripHour, initialRisk, busCapacity, delayThreshold]
    );

    return result.rows[0];
  }

  async insertRawTrip({ routeName, passengerCount, delayMinutes, timestamp }) {
    const result = await this.pool.query(
      `
        INSERT INTO trips_raw (route_name, passenger_count, delay_minutes, "timestamp")
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          route_name AS "routeName",
          passenger_count AS "passengerCount",
          delay_minutes AS "delayMinutes",
          "timestamp";
      `,
      [routeName, passengerCount, roundNumber(delayMinutes), timestamp]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      routeName: row.routeName,
      passengerCount: Number(row.passengerCount),
      delayMinutes: Number(row.delayMinutes),
      timestamp: row.timestamp
    };
  }

  async fetchCleanTrips() {
    const result = await this.pool.query(`
      SELECT
        id,
        route_id AS "routeId",
        total_passengers AS "totalPassengers",
        average_delay AS "averageDelay",
        occupancy_rate AS "occupancyRate",
        trip_date AS "tripDate",
        trip_hour AS "tripHour",
        trip_count AS "tripCount",
        risk_flag AS "riskFlag"
      FROM trips_clean
      ORDER BY trip_date, trip_hour;
    `);

    return result.rows.map((row) => ({
      ...row,
      totalPassengers: Number(row.totalPassengers),
      averageDelay: Number(row.averageDelay),
      occupancyRate: Number(row.occupancyRate),
      tripHour: Number(row.tripHour),
      tripCount: Number(row.tripCount)
    }));
  }

  async fetchRawTrips() {
    const result = await this.pool.query(`
      SELECT
        id,
        route_name AS "routeName",
        passenger_count AS "passengerCount",
        delay_minutes AS "delayMinutes",
        "timestamp"
      FROM trips_raw
      ORDER BY "timestamp";
    `);

    return result.rows.map((row) => ({
      id: row.id,
      routeName: row.routeName,
      passengerCount: Number(row.passengerCount),
      delayMinutes: Number(row.delayMinutes),
      timestamp: row.timestamp
    }));
  }

  async insertBenchmark({ pipeline, operation, durationMs, rowsProcessed }) {
    const result = await this.pool.query(
      `
        INSERT INTO pipeline_benchmarks (pipeline, operation, duration_ms, rows_processed)
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          pipeline,
          operation,
          duration_ms AS "durationMs",
          rows_processed AS "rowsProcessed",
          created_at AS "createdAt";
      `,
      [pipeline, operation, roundNumber(durationMs, 3), Number(rowsProcessed || 0)]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      pipeline: row.pipeline,
      operation: row.operation,
      durationMs: Number(row.durationMs),
      rowsProcessed: Number(row.rowsProcessed),
      createdAt: row.createdAt
    };
  }

  async fetchBenchmarks({ limit = 120 } = {}) {
    const result = await this.pool.query(
      `
        SELECT
          id,
          pipeline,
          operation,
          duration_ms AS "durationMs",
          rows_processed AS "rowsProcessed",
          created_at AS "createdAt"
        FROM pipeline_benchmarks
        ORDER BY created_at DESC
        LIMIT $1;
      `,
      [Math.max(1, Number(limit || 120))]
    );

    return result.rows
      .map((row) => ({
        id: row.id,
        pipeline: row.pipeline,
        operation: row.operation,
        durationMs: Number(row.durationMs),
        rowsProcessed: Number(row.rowsProcessed),
        createdAt: row.createdAt
      }))
      .reverse();
  }
}

module.exports = {
  PostgresStore
};
