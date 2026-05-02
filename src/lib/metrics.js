const { roundNumber } = require("./helpers");

class MetricsRegistry {
  constructor() {
    this.entries = {};
  }

  record(pipeline, action, durationMs, metadata = {}) {
    if (!this.entries[pipeline]) {
      this.entries[pipeline] = {};
    }

    if (!this.entries[pipeline][action]) {
      this.entries[pipeline][action] = [];
    }

    const entry = {
      at: new Date().toISOString(),
      durationMs: roundNumber(durationMs),
      ...metadata
    };

    this.entries[pipeline][action].push(entry);

    if (this.entries[pipeline][action].length > 40) {
      this.entries[pipeline][action].shift();
    }

    return entry;
  }

  stats(pipeline, action) {
    const series = this.entries[pipeline]?.[action] ?? [];

    if (!series.length) {
      return {
        count: 0,
        averageMs: 0,
        latestMs: 0,
        minMs: 0,
        maxMs: 0
      };
    }

    const durations = series.map((entry) => entry.durationMs);
    const total = durations.reduce((sum, value) => sum + value, 0);

    return {
      count: series.length,
      averageMs: roundNumber(total / series.length),
      latestMs: durations[durations.length - 1],
      minMs: roundNumber(Math.min(...durations)),
      maxMs: roundNumber(Math.max(...durations))
    };
  }

  pipeline(pipeline) {
    return {
      ingestion: this.stats(pipeline, "ingestion"),
      analytics: this.stats(pipeline, "analytics")
    };
  }

  snapshot() {
    return {
      etl: this.pipeline("etl"),
      elt: this.pipeline("elt"),
      comparison: {
        benchmark: this.stats("comparison", "benchmark")
      }
    };
  }
}

module.exports = new MetricsRegistry();
