const { performance } = require("node:perf_hooks");
const {
  averageFromWeightedTotal,
  calculateEfficiency,
  calculateOccupancy,
  deriveRiskLevel,
  formatHourLabel,
  getDateBucket,
  roundNumber
} = require("../lib/helpers");

function createRouteMaps(routes) {
  const byId = new Map();
  const byName = new Map();

  for (const route of routes) {
    byId.set(Number(route.id), route);
    byName.set(route.routeName.toLowerCase(), route);
  }

  return { byId, byName };
}

function hydrateCleanRows(cleanRows, routes, defaults) {
  const { byId } = createRouteMaps(routes);

  return cleanRows.map((row) => {
    const route = byId.get(Number(row.routeId)) || {};

    return {
      routeId: Number(row.routeId),
      routeName: route.routeName || `Route ${row.routeId}`,
      tripDate: row.tripDate,
      tripHour: Number(row.tripHour),
      totalPassengers: Number(row.totalPassengers),
      averageDelay: Number(row.averageDelay),
      occupancyRate: Number(row.occupancyRate),
      tripCount: Number(row.tripCount),
      busCapacity: Number(route.busCapacity || defaults.busCapacity),
      delayThreshold: Number(route.delayThreshold || defaults.delayRiskThreshold),
      riskFlag: Boolean(row.riskFlag)
    };
  });
}

function aggregateRawRows(rawRows, routes, defaults) {
  const { byName } = createRouteMaps(routes);
  const grouped = new Map();

  for (const raw of rawRows) {
    const route = byName.get(String(raw.routeName).toLowerCase()) || {
      id: null,
      routeName: raw.routeName,
      busCapacity: defaults.busCapacity,
      delayThreshold: defaults.delayRiskThreshold
    };

    const { tripDate, tripHour } = getDateBucket(raw.timestamp, defaults.analyticsTimeZone);
    const key = `${route.routeName}|${tripDate}|${tripHour}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        routeId: route.id,
        routeName: route.routeName,
        tripDate,
        tripHour,
        totalPassengers: 0,
        totalDelay: 0,
        tripCount: 0,
        busCapacity: Number(route.busCapacity),
        delayThreshold: Number(route.delayThreshold)
      });
    }

    const bucket = grouped.get(key);
    bucket.totalPassengers += Number(raw.passengerCount);
    bucket.totalDelay += Number(raw.delayMinutes);
    bucket.tripCount += 1;
  }

  return [...grouped.values()].map((bucket) => {
    const averageDelay = averageFromWeightedTotal(bucket.totalDelay, bucket.tripCount);
    return {
      routeId: bucket.routeId,
      routeName: bucket.routeName,
      tripDate: bucket.tripDate,
      tripHour: bucket.tripHour,
      totalPassengers: bucket.totalPassengers,
      averageDelay,
      occupancyRate: calculateOccupancy(bucket.totalPassengers, bucket.tripCount, bucket.busCapacity),
      tripCount: bucket.tripCount,
      busCapacity: bucket.busCapacity,
      delayThreshold: bucket.delayThreshold,
      riskFlag: averageDelay > bucket.delayThreshold
    };
  });
}

function buildAnalyticsPayload(rows, meta) {
  const sortedRows = [...rows].sort((left, right) => {
    if (left.tripDate !== right.tripDate) {
      return left.tripDate.localeCompare(right.tripDate);
    }

    if (left.tripHour !== right.tripHour) {
      return left.tripHour - right.tripHour;
    }

    return left.routeName.localeCompare(right.routeName);
  });

  const trendMap = new Map();
  const routeMap = new Map();
  const hourMap = new Map();
  const totalTrips = sortedRows.reduce((sum, row) => sum + row.tripCount, 0);
  const totalPassengers = sortedRows.reduce((sum, row) => sum + row.totalPassengers, 0);
  const weightedDelay = sortedRows.reduce((sum, row) => sum + row.averageDelay * row.tripCount, 0);
  const totalCapacitySlots = sortedRows.reduce((sum, row) => sum + row.tripCount * row.busCapacity, 0);
  const averageDelay = averageFromWeightedTotal(weightedDelay, totalTrips);
  const averageOccupancy = totalCapacitySlots ? roundNumber(totalPassengers / totalCapacitySlots, 4) : 0;
  let onTimeTrips = 0;
  let watchTrips = 0;
  let severeTrips = 0;

  for (const row of sortedRows) {
    const trendKey = row.tripDate;
    const trend = trendMap.get(trendKey) || {
      tripDate: trendKey,
      totalPassengers: 0,
      totalDelay: 0,
      tripCount: 0
    };

    trend.totalPassengers += row.totalPassengers;
    trend.totalDelay += row.averageDelay * row.tripCount;
    trend.tripCount += row.tripCount;
    trendMap.set(trendKey, trend);

    const routeKey = row.routeName;
    const route = routeMap.get(routeKey) || {
      routeName: routeKey,
      totalPassengers: 0,
      totalDelay: 0,
      totalCapacitySlots: 0,
      tripCount: 0,
      delayThreshold: row.delayThreshold
    };

    route.totalPassengers += row.totalPassengers;
    route.totalDelay += row.averageDelay * row.tripCount;
    route.totalCapacitySlots += row.tripCount * row.busCapacity;
    route.tripCount += row.tripCount;
    routeMap.set(routeKey, route);

    const hour = hourMap.get(row.tripHour) || {
      hour: row.tripHour,
      totalPassengers: 0,
      totalDelay: 0,
      tripCount: 0
    };

    hour.totalPassengers += row.totalPassengers;
    hour.totalDelay += row.averageDelay * row.tripCount;
    hour.tripCount += row.tripCount;
    hourMap.set(row.tripHour, hour);

    const riskLevel = deriveRiskLevel(row.averageDelay, row.delayThreshold);

    if (riskLevel === "High Risk") {
      severeTrips += row.tripCount;
    } else if (riskLevel === "Watch") {
      watchTrips += row.tripCount;
    } else {
      onTimeTrips += row.tripCount;
    }
  }

  const routeEfficiency = [...routeMap.values()]
    .map((route) => {
      const routeAverageDelay = averageFromWeightedTotal(route.totalDelay, route.tripCount);
      const routeOccupancy = route.totalCapacitySlots ? roundNumber(route.totalPassengers / route.totalCapacitySlots, 4) : 0;
      const riskLevel = deriveRiskLevel(routeAverageDelay, route.delayThreshold);

      return {
        routeName: route.routeName,
        totalPassengers: route.totalPassengers,
        averageDelay: routeAverageDelay,
        occupancyRate: routeOccupancy,
        occupancyPercent: roundNumber(routeOccupancy * 100),
        efficiencyScore: calculateEfficiency(routeAverageDelay, routeOccupancy),
        tripCount: route.tripCount,
        delayThreshold: route.delayThreshold,
        riskLevel
      };
    })
    .sort((left, right) => right.totalPassengers - left.totalPassengers);

  const passengerTrend = [...trendMap.values()]
    .map((trend) => ({
      tripDate: trend.tripDate,
      totalPassengers: trend.totalPassengers,
      averageDelay: averageFromWeightedTotal(trend.totalDelay, trend.tripCount),
      tripCount: trend.tripCount
    }))
    .sort((left, right) => left.tripDate.localeCompare(right.tripDate));

  const peakHours = Array.from({ length: 24 }, (_, hour) => {
    const bucket = hourMap.get(hour) || {
      totalPassengers: 0,
      totalDelay: 0,
      tripCount: 0
    };

    return {
      hour,
      hourLabel: formatHourLabel(hour),
      totalPassengers: bucket.totalPassengers,
      averageDelay: averageFromWeightedTotal(bucket.totalDelay, bucket.tripCount),
      tripCount: bucket.tripCount
    };
  });

  const busiestHour = peakHours.reduce((best, current) => {
    if (!best || current.totalPassengers > best.totalPassengers) {
      return current;
    }

    return best;
  }, null);

  const riskRoutes = routeEfficiency
    .filter((route) => route.riskLevel !== "Stable")
    .sort((left, right) => right.averageDelay - left.averageDelay)
    .map((route) => ({
      routeName: route.routeName,
      averageDelay: route.averageDelay,
      threshold: route.delayThreshold,
      riskLevel: route.riskLevel,
      explanation: `${route.routeName} is ${route.riskLevel.toLowerCase()} because its historical average delay of ${route.averageDelay} minutes is close to or above the ${route.delayThreshold}-minute threshold.`
    }));

  const worstRoute = routeEfficiency[0]
    ? [...routeEfficiency].sort((left, right) => right.averageDelay - left.averageDelay)[0]
    : null;
  const highestOccupancyRoute = routeEfficiency[0]
    ? [...routeEfficiency].sort((left, right) => right.occupancyRate - left.occupancyRate)[0]
    : null;

  return {
    mode: meta.mode,
    summary: {
      totalTrips,
      totalPassengers,
      averageDelay,
      averageOccupancy,
      averageOccupancyPercent: roundNumber(averageOccupancy * 100),
      busiestHour: busiestHour ? busiestHour.hourLabel : "00:00",
      highRiskRoutes: riskRoutes.length
    },
    routeEfficiency,
    passengerTrend,
    peakHours,
    delayStats: {
      onTimeTrips,
      watchTrips,
      severeTrips,
      worstRoute,
      highestOccupancyRoute
    },
    riskRoutes,
    pipeline: {
      architecture: meta.mode.toUpperCase(),
      transformStage: meta.transformStage,
      storageModel: meta.storageModel,
      sourceRecordCount: meta.sourceRecordCount,
      persistedRowCount: meta.persistedRowCount,
      transformedRowCount: sortedRows.length,
      transformDurationMs: meta.transformDurationMs,
      averageIngestionDurationMs: meta.metricStats.ingestion.averageMs,
      averageQueryDurationMs: meta.metricStats.analytics.averageMs,
      latestQueryDurationMs: meta.metricStats.analytics.latestMs,
      storageEngine: meta.storageEngine,
      generatedAt: new Date().toISOString()
    }
  };
}

function buildEtlAnalytics({ cleanRows, routes, defaults, metricStats, storageEngine }) {
  const hydratedRows = hydrateCleanRows(cleanRows, routes, defaults);

  return buildAnalyticsPayload(hydratedRows, {
    mode: "etl",
    transformStage: "Transform before load",
    storageModel: "Pre-aggregated hourly route summaries in trips_clean",
    sourceRecordCount: hydratedRows.reduce((sum, row) => sum + row.tripCount, 0),
    persistedRowCount: hydratedRows.length,
    transformDurationMs: 0,
    metricStats,
    storageEngine
  });
}

function buildEltAnalytics({ rawRows, routes, defaults, metricStats, storageEngine }) {
  const transformStart = performance.now();
  const transformedRows = aggregateRawRows(rawRows, routes, defaults);
  const transformDurationMs = roundNumber(performance.now() - transformStart);

  return buildAnalyticsPayload(transformedRows, {
    mode: "elt",
    transformStage: "Transform during analytics queries",
    storageModel: "Raw event logs in trips_raw",
    sourceRecordCount: rawRows.length,
    persistedRowCount: rawRows.length,
    transformDurationMs,
    metricStats,
    storageEngine
  });
}

function buildComparison({ etlAnalytics, eltAnalytics }) {
  const queryDifference = roundNumber(eltAnalytics.pipeline.averageQueryDurationMs - etlAnalytics.pipeline.averageQueryDurationMs);
  const loadDifference = roundNumber(etlAnalytics.pipeline.averageIngestionDurationMs - eltAnalytics.pipeline.averageIngestionDurationMs);
  const transformDifference = roundNumber(eltAnalytics.pipeline.transformDurationMs - etlAnalytics.pipeline.transformDurationMs);

  return {
    generatedAt: new Date().toISOString(),
    ingestionBenchmark: {
      etlAverageMs: etlAnalytics.pipeline.averageIngestionDurationMs,
      eltAverageMs: eltAnalytics.pipeline.averageIngestionDurationMs,
      fasterForLoading: etlAnalytics.pipeline.averageIngestionDurationMs <= eltAnalytics.pipeline.averageIngestionDurationMs ? "ETL" : "ELT",
      differenceMs: Math.abs(loadDifference)
    },
    queryBenchmark: {
      etlAverageMs: etlAnalytics.pipeline.averageQueryDurationMs,
      eltAverageMs: eltAnalytics.pipeline.averageQueryDurationMs,
      fasterForAnalytics: etlAnalytics.pipeline.averageQueryDurationMs <= eltAnalytics.pipeline.averageQueryDurationMs ? "ETL" : "ELT",
      differenceMs: Math.abs(queryDifference)
    },
    processingBenchmark: {
      etlTransformDuringReadMs: etlAnalytics.pipeline.transformDurationMs,
      eltTransformDuringReadMs: eltAnalytics.pipeline.transformDurationMs,
      extraReadTimeMs: Math.abs(transformDifference)
    },
    outputParity: {
      totalPassengersDifference: Math.abs(etlAnalytics.summary.totalPassengers - eltAnalytics.summary.totalPassengers),
      totalTripsDifference: Math.abs(etlAnalytics.summary.totalTrips - eltAnalytics.summary.totalTrips),
      averageDelayDifference: roundNumber(Math.abs(etlAnalytics.summary.averageDelay - eltAnalytics.summary.averageDelay)),
      busiestHourMatch: etlAnalytics.summary.busiestHour === eltAnalytics.summary.busiestHour
    },
    architecturalDifferences: [
      {
        pipeline: "ETL",
        strength: "Fast dashboard reads because transformations are completed before storage.",
        tradeoff: "Ingestion is more compute-heavy and the raw source grain is not kept in the analytics table."
      },
      {
        pipeline: "ELT",
        strength: "Keeps full raw trip logs for flexible re-analysis and auditability.",
        tradeoff: "Each analytics request must aggregate and transform data at read time."
      }
    ]
  };
}

module.exports = {
  buildComparison,
  buildEltAnalytics,
  buildEtlAnalytics
};
