const ROUTE_BLUEPRINTS = [
  {
    routeName: "North Loop",
    basePassengers: 36,
    baseDelay: 6
  },
  {
    routeName: "Harbor Express",
    basePassengers: 28,
    baseDelay: 4
  },
  {
    routeName: "University Shuttle",
    basePassengers: 48,
    baseDelay: 3
  },
  {
    routeName: "Airport Connector",
    basePassengers: 31,
    baseDelay: 9
  },
  {
    routeName: "Riverside Line",
    basePassengers: 24,
    baseDelay: 7
  }
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickPeakAwareHour() {
  const roll = Math.random();

  if (roll < 0.35) {
    return randomBetween(6, 9);
  }

  if (roll < 0.7) {
    return randomBetween(16, 19);
  }

  if (roll < 0.9) {
    return randomBetween(11, 14);
  }

  return randomBetween(5, 22);
}

function generateTimestamp(dayOffset, hour) {
  const date = new Date();
  date.setDate(date.getDate() - dayOffset);
  date.setHours(hour, randomBetween(0, 59), randomBetween(0, 59), 0);
  return date.toISOString();
}

function generateTrips(count = 24) {
  const items = [];

  for (let index = 0; index < count; index += 1) {
    const route = ROUTE_BLUEPRINTS[randomBetween(0, ROUTE_BLUEPRINTS.length - 1)];
    const hour = pickPeakAwareHour();
    const peakMultiplier = hour >= 6 && hour <= 9 ? 1.25 : hour >= 16 && hour <= 19 ? 1.2 : 0.9;
    const passengerCount = Math.max(4, Math.round(route.basePassengers * peakMultiplier + randomBetween(-8, 10)));
    const delayMinutes = Math.max(0, Number((route.baseDelay + randomBetween(-2, 8) * (peakMultiplier > 1 ? 1.2 : 0.8)).toFixed(1)));

    items.push({
      routeName: route.routeName,
      passengerCount,
      delayMinutes,
      timestamp: generateTimestamp(randomBetween(0, 6), hour)
    });
  }

  return items;
}

module.exports = {
  generateTrips
};
