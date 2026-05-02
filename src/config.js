const path = require("node:path");

module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "",
  busCapacity: Number(process.env.BUS_CAPACITY || 60),
  delayRiskThreshold: Number(process.env.DELAY_RISK_THRESHOLD || 12),
  analyticsTimeZone: process.env.ANALYTICS_TIMEZONE || "Asia/Singapore",
  enableMemoryFallback: String(process.env.ENABLE_MEMORY_FALLBACK || "true").toLowerCase() !== "false",
  schemaPath: path.resolve(__dirname, "..", "sql", "schema.sql")
};
