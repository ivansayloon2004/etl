const { calculateOccupancy, roundNumber } = require("../lib/helpers");

class MemoryStore {
  constructor(config) {
    this.kind = "memory";
    this.config = config;
    this.routeSequence = 1;
    this.cleanSequence = 1;
    this.rawSequence = 1;
    this.routes = [];
    this.tripsClean = [];
    this.tripsRaw = [];
  }

  async init() {
    if (!this.routes.length) {
      this.seedRoutes();
    }
  }

  seedRoutes() {
    const defaults = [
      ["North Loop", "Central District -> North Terminal", 60, 12],
      ["Harbor Express", "Harbor Front -> Financial Center", 55, 10],
      ["University Shuttle", "West Station -> University Belt", 70, 8],
      ["Airport Connector", "Airport -> South Exchange", 50, 14],
      ["Riverside Line", "Riverside Park -> Old Town", 45, 11]
    ];

    for (const [routeName, corridor, busCapacity, delayThreshold] of defaults) {
      this.routes.push({
        id: this.routeSequence,
        routeName,
        corridor,
        busCapacity,
        delayThreshold
      });
      this.routeSequence += 1;
    }
  }

  async listRoutes() {
    return [...this.routes].sort((left, right) => left.routeName.localeCompare(right.routeName));
  }

  async ensureRoute({ routeName, busCapacity, delayThreshold }) {
    const existing = this.routes.find((route) => route.routeName.toLowerCase() === routeName.toLowerCase());

    if (existing) {
      return { ...existing };
    }

    const route = {
      id: this.routeSequence,
      routeName,
      corridor: "Custom route",
      busCapacity,
      delayThreshold
    };

    this.routeSequence += 1;
    this.routes.push(route);

    return { ...route };
  }

  async upsertCleanTrip({ routeId, passengerCount, delayMinutes, tripDate, tripHour, busCapacity, delayThreshold }) {
    const existing = this.tripsClean.find((trip) => trip.routeId === routeId && trip.tripDate === tripDate && trip.tripHour === tripHour);

    if (existing) {
      const tripCount = existing.tripCount + 1;
      const totalPassengers = existing.totalPassengers + passengerCount;
      const averageDelay = roundNumber(((existing.averageDelay * existing.tripCount) + delayMinutes) / tripCount);
      const occupancyRate = calculateOccupancy(totalPassengers, tripCount, busCapacity);

      existing.totalPassengers = totalPassengers;
      existing.averageDelay = averageDelay;
      existing.occupancyRate = occupancyRate;
      existing.tripCount = tripCount;
      existing.riskFlag = averageDelay > delayThreshold;
      existing.updatedAt = new Date().toISOString();

      return { ...existing };
    }

    const record = {
      id: this.cleanSequence,
      routeId,
      totalPassengers: passengerCount,
      averageDelay: roundNumber(delayMinutes),
      occupancyRate: calculateOccupancy(passengerCount, 1, busCapacity),
      tripDate,
      tripHour,
      tripCount: 1,
      riskFlag: delayMinutes > delayThreshold,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.cleanSequence += 1;
    this.tripsClean.push(record);
    return { ...record };
  }

  async insertRawTrip({ routeName, passengerCount, delayMinutes, timestamp }) {
    const record = {
      id: this.rawSequence,
      routeName,
      passengerCount,
      delayMinutes: roundNumber(delayMinutes),
      timestamp
    };

    this.rawSequence += 1;
    this.tripsRaw.push(record);

    return { ...record };
  }

  async fetchCleanTrips() {
    return this.tripsClean.map((trip) => ({ ...trip }));
  }

  async fetchRawTrips() {
    return this.tripsRaw.map((trip) => ({ ...trip }));
  }
}

module.exports = {
  MemoryStore
};
