require("dotenv").config();

const path = require("node:path");
const express = require("express");
const { performance } = require("node:perf_hooks");
const config = require("./config");
const { parseCsvText } = require("./lib/csv");
const { normalizeTripInput, roundNumber } = require("./lib/helpers");
const { generateTrips } = require("./lib/simulator");
const { buildBenchmarkInsights, buildComparison, buildEltAnalytics, buildEtlAnalytics } = require("./services/analytics");
const { createStore } = require("./store/createStore");

async function bootstrap() {
  const store = await createStore(config);
  const app = express();
  const zeroMetricStats = {
    ingestion: { averageMs: 0 },
    analytics: { averageMs: 0, latestMs: 0 }
  };

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.resolve(__dirname, "..", "public")));

  function asyncHandler(handler) {
    return (request, response, next) => {
      Promise.resolve(handler(request, response, next)).catch(next);
    };
  }

  async function getBenchmarkInsights(limit = 120) {
    const benchmarks = await store.fetchBenchmarks({ limit });
    return buildBenchmarkInsights(benchmarks);
  }

  async function addTripToEtl(payload) {
    const startedAt = performance.now();
    const trip = normalizeTripInput(payload, config);
    const route = await store.ensureRoute({
      routeName: trip.routeName,
      busCapacity: trip.capacity,
      delayThreshold: trip.delayThreshold
    });

    const transformed = await store.upsertCleanTrip({
      routeId: route.id,
      passengerCount: trip.passengerCount,
      delayMinutes: trip.delayMinutes,
      tripDate: trip.tripDate,
      tripHour: trip.tripHour,
      busCapacity: route.busCapacity,
      delayThreshold: route.delayThreshold
    });

    const durationMs = roundNumber(performance.now() - startedAt);
    await store.insertBenchmark({
      pipeline: "etl",
      operation: "insert",
      durationMs,
      rowsProcessed: 1
    });

    return {
      pipeline: "etl",
      durationMs,
      input: trip,
      transformed: {
        ...transformed,
        routeName: route.routeName,
        busCapacity: route.busCapacity,
        delayThreshold: route.delayThreshold
      }
    };
  }

  async function addTripToElt(payload) {
    const startedAt = performance.now();
    const trip = normalizeTripInput(payload, config);
    const route = await store.ensureRoute({
      routeName: trip.routeName,
      busCapacity: trip.capacity,
      delayThreshold: trip.delayThreshold
    });
    const inserted = await store.insertRawTrip({
      routeName: route.routeName,
      passengerCount: trip.passengerCount,
      delayMinutes: trip.delayMinutes,
      timestamp: trip.timestamp
    });
    const durationMs = roundNumber(performance.now() - startedAt);
    await store.insertBenchmark({
      pipeline: "elt",
      operation: "insert",
      durationMs,
      rowsProcessed: 1
    });

    return {
      pipeline: "elt",
      durationMs,
      rawRecord: inserted,
      route: {
        routeName: route.routeName,
        busCapacity: route.busCapacity,
        delayThreshold: route.delayThreshold
      }
    };
  }

  async function importCsv(pipeline, csvText) {
    const rows = parseCsvText(csvText);
    const outcomes = [];
    const startedAt = performance.now();

    for (const row of rows) {
      if (pipeline === "etl") {
        outcomes.push(await addTripToEtl(row));
      } else {
        outcomes.push(await addTripToElt(row));
      }
    }

    return {
      pipeline,
      imported: outcomes.length,
      durationMs: roundNumber(performance.now() - startedAt),
      sample: outcomes.slice(0, 3)
    };
  }

  async function simulateTrips(pipeline, count) {
    const generated = generateTrips(count);
    const created = [];

    for (const trip of generated) {
      if (pipeline === "both") {
        await addTripToEtl(trip);
        await addTripToElt(trip);
      } else if (pipeline === "etl") {
        await addTripToEtl(trip);
      } else {
        await addTripToElt(trip);
      }

      created.push(trip);
    }

    return {
      pipeline,
      generated: created.length,
      sample: created.slice(0, 5)
    };
  }

  async function getEtlAnalytics() {
    const startedAt = performance.now();
    const [cleanRows, routes] = await Promise.all([store.fetchCleanTrips(), store.listRoutes()]);
    const analytics = buildEtlAnalytics({
      cleanRows,
      routes,
      defaults: config,
      metricStats: zeroMetricStats,
      storageEngine: store.kind
    });
    const durationMs = roundNumber(performance.now() - startedAt);
    await store.insertBenchmark({
      pipeline: "etl",
      operation: "analytics_query",
      durationMs,
      rowsProcessed: cleanRows.length
    });
    const benchmarkInsights = await getBenchmarkInsights();

    analytics.pipeline.averageQueryDurationMs = benchmarkInsights.stats.etl.analytics.averageMs;
    analytics.pipeline.latestQueryDurationMs = benchmarkInsights.stats.etl.analytics.latestMs;
    analytics.pipeline.averageIngestionDurationMs = benchmarkInsights.stats.etl.ingestion.averageMs;

    return analytics;
  }

  async function getEltAnalytics() {
    const startedAt = performance.now();
    const [rawRows, routes] = await Promise.all([store.fetchRawTrips(), store.listRoutes()]);
    const analytics = buildEltAnalytics({
      rawRows,
      routes,
      defaults: config,
      metricStats: zeroMetricStats,
      storageEngine: store.kind
    });
    const durationMs = roundNumber(performance.now() - startedAt);
    await store.insertBenchmark({
      pipeline: "elt",
      operation: "analytics_query",
      durationMs,
      rowsProcessed: rawRows.length
    });
    const benchmarkInsights = await getBenchmarkInsights();

    analytics.pipeline.averageQueryDurationMs = benchmarkInsights.stats.elt.analytics.averageMs;
    analytics.pipeline.latestQueryDurationMs = benchmarkInsights.stats.elt.analytics.latestMs;
    analytics.pipeline.averageIngestionDurationMs = benchmarkInsights.stats.elt.ingestion.averageMs;

    return analytics;
  }

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      storageEngine: store.kind,
      timeZone: config.analyticsTimeZone
    });
  });

  app.get("/routes", asyncHandler(async (_request, response) => {
    response.json(await store.listRoutes());
  }));

  app.post("/etl/add-trip", asyncHandler(async (request, response) => {
    response.status(201).json(await addTripToEtl(request.body));
  }));

  app.post("/elt/add-trip", asyncHandler(async (request, response) => {
    response.status(201).json(await addTripToElt(request.body));
  }));

  app.post("/etl/bulk-upload", asyncHandler(async (request, response) => {
    response.json(await importCsv("etl", request.body.csvText));
  }));

  app.post("/elt/bulk-upload", asyncHandler(async (request, response) => {
    response.json(await importCsv("elt", request.body.csvText));
  }));

  app.post("/etl/simulate", asyncHandler(async (request, response) => {
    const count = Math.max(1, Number(request.body.count || 24));
    response.json(await simulateTrips("etl", count));
  }));

  app.post("/elt/simulate", asyncHandler(async (request, response) => {
    const count = Math.max(1, Number(request.body.count || 24));
    response.json(await simulateTrips("elt", count));
  }));

  app.post("/simulate", asyncHandler(async (request, response) => {
    const count = Math.max(1, Number(request.body.count || 24));
    const pipeline = String(request.body.pipeline || "both").toLowerCase();

    if (!["etl", "elt", "both"].includes(pipeline)) {
      throw new Error("pipeline must be one of: etl, elt, both.");
    }

    response.json(await simulateTrips(pipeline, count));
  }));

  app.get("/etl/analytics", asyncHandler(async (_request, response) => {
    response.json(await getEtlAnalytics());
  }));

  app.get("/elt/analytics", asyncHandler(async (_request, response) => {
    response.json(await getEltAnalytics());
  }));

  app.get("/comparison", asyncHandler(async (_request, response) => {
    const [etlAnalytics, eltAnalytics] = await Promise.all([getEtlAnalytics(), getEltAnalytics()]);
    const benchmarkInsights = await getBenchmarkInsights();

    etlAnalytics.pipeline.averageIngestionDurationMs = benchmarkInsights.stats.etl.ingestion.averageMs;
    etlAnalytics.pipeline.averageQueryDurationMs = benchmarkInsights.stats.etl.analytics.averageMs;
    etlAnalytics.pipeline.latestQueryDurationMs = benchmarkInsights.stats.etl.analytics.latestMs;

    eltAnalytics.pipeline.averageIngestionDurationMs = benchmarkInsights.stats.elt.ingestion.averageMs;
    eltAnalytics.pipeline.averageQueryDurationMs = benchmarkInsights.stats.elt.analytics.averageMs;
    eltAnalytics.pipeline.latestQueryDurationMs = benchmarkInsights.stats.elt.analytics.latestMs;

    const comparison = buildComparison({ etlAnalytics, eltAnalytics, benchmarkInsights });
    response.json({
      ...comparison,
      etlAnalytics,
      eltAnalytics
    });
  }));

  app.get("*", (_request, response) => {
    response.sendFile(path.resolve(__dirname, "..", "public", "index.html"));
  });

  app.use((error, _request, response, _next) => {
    response.status(400).json({
      error: error.message || "Unexpected server error."
    });
  });

  app.listen(config.port, () => {
    console.log(`Bus Route Performance Tracker listening on http://localhost:${config.port}`);
    console.log(`Storage engine: ${store.kind}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start the server.");
  console.error(error);
  process.exit(1);
});
