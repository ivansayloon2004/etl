function roundNumber(value, decimals = 2) {
  return Number(Number(value || 0).toFixed(decimals));
}

function getDateBucket(timestamp, timeZone) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp supplied.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);

  const lookup = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }

  const tripDate = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const rawHour = Number(lookup.hour);
  const tripHour = rawHour === 24 ? 0 : rawHour;

  return { tripDate, tripHour };
}

function formatHourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function calculateOccupancy(totalPassengers, tripCount, busCapacity) {
  const denominator = Math.max(1, Number(tripCount) * Number(busCapacity));
  return roundNumber(Number(totalPassengers) / denominator, 4);
}

function calculateEfficiency(averageDelay, occupancyRate) {
  const rawScore = 100 - Number(averageDelay) * 3.8 + Number(occupancyRate) * 22;
  return roundNumber(Math.max(0, Math.min(100, rawScore)), 2);
}

function deriveRiskLevel(averageDelay, delayThreshold) {
  const delay = Number(averageDelay);
  const threshold = Number(delayThreshold);

  if (delay >= threshold) {
    return "High Risk";
  }

  if (delay >= threshold * 0.75) {
    return "Watch";
  }

  return "Stable";
}

function normalizeTripInput(payload, defaults) {
  const routeName = String(payload.routeName ?? payload.route_name ?? "").trim();
  const passengerCount = Number(payload.passengerCount ?? payload.passenger_count);
  const delayMinutes = Number(payload.delayMinutes ?? payload.delay_minutes ?? 0);
  const rawTimestamp = String(payload.timestamp ?? "").trim();
  const timestamp = rawTimestamp || new Date().toISOString();
  const capacity = Math.max(1, Math.round(Number(payload.capacity ?? payload.busCapacity ?? defaults.busCapacity)));
  const delayThreshold = Number(payload.delayThreshold ?? payload.delay_threshold ?? defaults.delayRiskThreshold);

  if (!routeName) {
    throw new Error("routeName is required.");
  }

  if (!Number.isFinite(passengerCount) || passengerCount < 0) {
    throw new Error("passengerCount must be a non-negative number.");
  }

  if (!Number.isFinite(delayMinutes)) {
    throw new Error("delayMinutes must be a valid number.");
  }

  if (!Number.isFinite(delayThreshold) || delayThreshold <= 0) {
    throw new Error("delayThreshold must be greater than 0.");
  }

  const { tripDate, tripHour } = getDateBucket(timestamp, defaults.analyticsTimeZone);

  return {
    routeName,
    passengerCount: Math.round(passengerCount),
    delayMinutes: roundNumber(delayMinutes),
    timestamp: new Date(timestamp).toISOString(),
    capacity,
    delayThreshold,
    tripDate,
    tripHour
  };
}

function averageFromWeightedTotal(totalWeightedValue, totalWeight) {
  if (!totalWeight) {
    return 0;
  }

  return roundNumber(totalWeightedValue / totalWeight);
}

module.exports = {
  averageFromWeightedTotal,
  calculateEfficiency,
  calculateOccupancy,
  deriveRiskLevel,
  formatHourLabel,
  getDateBucket,
  normalizeTripInput,
  roundNumber
};
