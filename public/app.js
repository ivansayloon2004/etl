const state = {
  activeMode: "etl",
  health: null,
  routes: [],
  etl: null,
  elt: null,
  comparison: null
};

const elements = {};

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatMinutes(value) {
  return `${Number(value || 0).toFixed(1)} min`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function setStatus(message) {
  elements.appStatus.textContent = message;
}

function toLocalDateTimeInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function getActiveAnalytics() {
  if (state.activeMode === "compare") {
    return state.etl || state.elt;
  }

  return state[state.activeMode];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function renderMetricGrid() {
  if (state.activeMode === "compare" && state.comparison) {
    const comparison = state.comparison;

    elements.metricGrid.innerHTML = [
      {
        label: "ETL Avg Query",
        value: `${comparison.queryBenchmark.etlAverageMs.toFixed(2)} ms`,
        hint: "Read time from pre-aggregated ETL tables."
      },
      {
        label: "ELT Avg Query",
        value: `${comparison.queryBenchmark.eltAverageMs.toFixed(2)} ms`,
        hint: "Read time including on-demand transformations."
      },
      {
        label: "Faster Loader",
        value: comparison.ingestionBenchmark.fasterForLoading,
        hint: `${comparison.ingestionBenchmark.differenceMs.toFixed(2)} ms average difference during ingestion.`
      },
      {
        label: "Output Parity",
        value: comparison.outputParity.totalPassengersDifference === 0 ? "Aligned" : "Different",
        hint: `Passenger delta: ${comparison.outputParity.totalPassengersDifference}, delay delta: ${comparison.outputParity.averageDelayDifference} min.`
      }
    ]
      .map(
        (card) => `
          <article class="metric-card">
            <span class="metric-label">${card.label}</span>
            <strong class="metric-value">${card.value}</strong>
            <p class="metric-hint">${card.hint}</p>
          </article>
        `
      )
      .join("");

    return;
  }

  const analytics = getActiveAnalytics();

  if (!analytics) {
    elements.metricGrid.innerHTML = `<div class="empty-state">Analytics will appear here after the first data load.</div>`;
    return;
  }

  const cards = [
    {
      label: "Tracked Trips",
      value: formatNumber(analytics.summary.totalTrips),
      hint: `${analytics.pipeline.architecture} ${analytics.pipeline.transformStage.toLowerCase()}.`
    },
    {
      label: "Passengers",
      value: formatNumber(analytics.summary.totalPassengers),
      hint: `Stored rows: ${formatNumber(analytics.pipeline.persistedRowCount)}`
    },
    {
      label: "Avg Delay",
      value: formatMinutes(analytics.summary.averageDelay),
      hint: `Busiest hour: ${analytics.summary.busiestHour}`
    },
    {
      label: "Avg Occupancy",
      value: formatPercent(analytics.summary.averageOccupancyPercent),
      hint: `${formatNumber(analytics.summary.highRiskRoutes)} routes currently flagged.`
    }
  ];

  elements.metricGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="metric-card">
          <span class="metric-label">${card.label}</span>
          <strong class="metric-value">${card.value}</strong>
          <p class="metric-hint">${card.hint}</p>
        </article>
      `
    )
    .join("");
}

function renderTrendChart() {
  const analytics = getActiveAnalytics();

  if (!analytics || analytics.passengerTrend.length === 0) {
    elements.passengerTrend.innerHTML = `<div class="empty-state">No trend data yet. Generate sample trips or add a manual trip.</div>`;
    return;
  }

  const points = analytics.passengerTrend;
  const width = 640;
  const height = 240;
  const padding = 28;
  const values = points.map((point) => point.totalPassengers);
  const maxValue = Math.max(...values, 1);
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const polyline = points
    .map((point, index) => {
      const x = padding + step * index;
      const y = height - padding - ((point.totalPassengers / maxValue) * (height - padding * 2));
      return `${x},${y}`;
    })
    .join(" ");

  const area = `${padding},${height - padding} ${polyline} ${width - padding},${height - padding}`;

  elements.passengerTrend.innerHTML = `
    <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Passenger trend chart">
      <defs>
        <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(11, 143, 141, 0.35)"></stop>
          <stop offset="100%" stop-color="rgba(11, 143, 141, 0.02)"></stop>
        </linearGradient>
      </defs>
      <polyline fill="url(#trend-fill)" stroke="none" points="${area}"></polyline>
      <polyline fill="none" stroke="#0b8f8d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${polyline}"></polyline>
      ${points
        .map((point, index) => {
          const x = padding + step * index;
          const y = height - padding - ((point.totalPassengers / maxValue) * (height - padding * 2));
          return `<circle cx="${x}" cy="${y}" r="5" fill="#f1a73b" stroke="#ffffff" stroke-width="2"></circle>`;
        })
        .join("")}
    </svg>
    <div class="trend-labels">
      ${points
        .map(
          (point) => `
            <div>
              <strong>${point.tripDate}</strong>
              <span>${formatNumber(point.totalPassengers)} passengers</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPeakHours() {
  const analytics = getActiveAnalytics();

  if (!analytics) {
    elements.peakHours.innerHTML = `<div class="empty-state">Peak hour analytics will show up here.</div>`;
    return;
  }

  const topHours = [...analytics.peakHours]
    .sort((left, right) => right.totalPassengers - left.totalPassengers)
    .slice(0, 6);
  const maxPassengers = Math.max(...topHours.map((hour) => hour.totalPassengers), 1);

  elements.peakHours.innerHTML = topHours
    .map((hour) => {
      const height = Math.max(14, (hour.totalPassengers / maxPassengers) * 180);

      return `
        <div class="mini-bar">
          <span>${hour.hourLabel}</span>
          <div class="mini-bar-fill" style="height:${height}px;"></div>
          <strong>${formatNumber(hour.totalPassengers)}</strong>
        </div>
      `;
    })
    .join("");
}

function renderDelayProfile() {
  const analytics = getActiveAnalytics();

  if (!analytics) {
    elements.delayProfile.innerHTML = `<div class="empty-state">Delay profiles will appear here after analytics load.</div>`;
    return;
  }

  const riskRows = analytics.riskRoutes.slice(0, 3);
  const worstRoute = analytics.delayStats.worstRoute ? analytics.delayStats.worstRoute.routeName : "No data";
  const highestOccupancyRoute = analytics.delayStats.highestOccupancyRoute ? analytics.delayStats.highestOccupancyRoute.routeName : "No data";

  elements.delayProfile.innerHTML = `
    <div class="delay-grid">
      <div class="delay-box">
        <span class="detail-label">On-Time Trips</span>
        <strong>${formatNumber(analytics.delayStats.onTimeTrips)}</strong>
      </div>
      <div class="delay-box">
        <span class="detail-label">Watch Trips</span>
        <strong>${formatNumber(analytics.delayStats.watchTrips)}</strong>
      </div>
      <div class="delay-box">
        <span class="detail-label">Severe Trips</span>
        <strong>${formatNumber(analytics.delayStats.severeTrips)}</strong>
      </div>
    </div>
    <div class="comparison-card">
      <strong>Prediction Summary</strong>
      <p>Worst delay pattern: <b>${worstRoute}</b></p>
      <p>Highest occupancy route: <b>${highestOccupancyRoute}</b></p>
      ${
        riskRows.length
          ? riskRows.map((route) => `<p>${route.explanation}</p>`).join("")
          : "<p>No routes are currently near the high-risk threshold.</p>"
      }
    </div>
  `;
}

function riskClassName(riskLevel) {
  if (riskLevel === "High Risk") {
    return "high-risk";
  }

  if (riskLevel === "Watch") {
    return "watch";
  }

  return "stable";
}

function renderRouteTable() {
  const analytics = getActiveAnalytics();

  if (!analytics || analytics.routeEfficiency.length === 0) {
    elements.routeTableBody.innerHTML = `<tr><td colspan="7">No route rows available yet.</td></tr>`;
    return;
  }

  elements.routeTableBody.innerHTML = analytics.routeEfficiency
    .map(
      (route) => `
        <tr>
          <td>${route.routeName}</td>
          <td>${formatNumber(route.tripCount)}</td>
          <td>${formatNumber(route.totalPassengers)}</td>
          <td>${formatMinutes(route.averageDelay)}</td>
          <td>
            <div class="occupancy-track">
              <div class="occupancy-fill" style="width:${Math.min(route.occupancyPercent, 100)}%;"></div>
            </div>
            ${formatPercent(route.occupancyPercent)}
          </td>
          <td>${route.efficiencyScore.toFixed(1)}</td>
          <td><span class="pill ${riskClassName(route.riskLevel)}">${route.riskLevel}</span></td>
        </tr>
      `
    )
    .join("");
}

function renderComparison() {
  if (!state.comparison) {
    elements.comparisonGrid.innerHTML = `<div class="empty-state">Comparison metrics will show here after analytics refresh.</div>`;
    return;
  }

  const comparison = state.comparison;

  const cards = [
    {
      title: "Query Speed",
      value: comparison.queryBenchmark.fasterForAnalytics,
      body: `Difference: ${comparison.queryBenchmark.differenceMs.toFixed(2)} ms. ETL ${comparison.queryBenchmark.etlAverageMs.toFixed(2)} ms vs ELT ${comparison.queryBenchmark.eltAverageMs.toFixed(2)} ms.`
    },
    {
      title: "Load Speed",
      value: comparison.ingestionBenchmark.fasterForLoading,
      body: `Difference: ${comparison.ingestionBenchmark.differenceMs.toFixed(2)} ms between average ETL and ELT ingestion time.`
    },
    {
      title: "Read-Time Transform",
      value: `${comparison.processingBenchmark.eltTransformDuringReadMs.toFixed(2)} ms`,
      body: `ELT spends this much transforming raw data during analytics requests, while ETL is already transformed.`
    },
    {
      title: "Output Difference",
      value: comparison.outputParity.busiestHourMatch ? "Matched" : "Varied",
      body: `Passenger delta ${comparison.outputParity.totalPassengersDifference}, trip delta ${comparison.outputParity.totalTripsDifference}, delay delta ${comparison.outputParity.averageDelayDifference} minutes.`
    }
  ];

  elements.comparisonGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="comparison-card">
          <strong>${card.title}</strong>
          <span class="big-number">${card.value}</span>
          <p>${card.body}</p>
        </article>
      `
    )
    .join("");
}

function renderArchitectureNotes() {
  if (!state.comparison) {
    elements.architectureNotes.innerHTML = `<div class="empty-state">Architecture notes will appear here after comparison is loaded.</div>`;
    return;
  }

  const noteCards = [
    ...state.comparison.architecturalDifferences.map(
      (difference) => `
        <article class="note-card">
          <strong>${difference.pipeline}</strong>
          <p>${difference.strength}</p>
          <p>${difference.tradeoff}</p>
        </article>
      `
    ),
    `
      <article class="note-card">
        <strong>How to Present This</strong>
        <p>Use ETL to explain faster dashboard reads from prepared summaries.</p>
        <p>Use ELT to explain flexible analysis because raw trip logs remain unchanged in storage.</p>
      </article>
    `,
    `
      <article class="note-card">
        <strong>Why It Matters</strong>
        <p>Transit agencies need quick dashboards for operations and raw logs for future auditing, forecasting, and model training.</p>
      </article>
    `
  ];

  elements.architectureNotes.innerHTML = noteCards.join("");
}

function updateStatusStrip() {
  elements.storageEngine.textContent = state.health ? state.health.storageEngine.toUpperCase() : "Loading...";
  elements.timezoneLabel.textContent = state.health ? state.health.timeZone : "Asia/Singapore";
  elements.modeLabel.textContent = state.activeMode === "compare" ? "COMPARE" : state.activeMode.toUpperCase();
  elements.trendCaption.textContent =
    state.activeMode === "compare"
      ? "Charts continue to show the shared analytics output while comparison cards highlight pipeline differences."
      : `Daily ridership by ${state.activeMode.toUpperCase()} pipeline.`;
}

function renderDashboard() {
  renderMetricGrid();
  renderTrendChart();
  renderPeakHours();
  renderDelayProfile();
  renderRouteTable();
  renderComparison();
  renderArchitectureNotes();
  updateStatusStrip();
}

async function refreshDashboard() {
  setStatus("Refreshing ETL, ELT, and comparison analytics...");
  const [health, etl, elt, comparison] = await Promise.all([
    fetchJson("/health", { method: "GET" }),
    fetchJson("/etl/analytics", { method: "GET" }),
    fetchJson("/elt/analytics", { method: "GET" }),
    fetchJson("/comparison", { method: "GET" })
  ]);

  state.health = health;
  state.etl = etl;
  state.elt = elt;
  state.comparison = comparison;

  renderDashboard();
  setStatus("Analytics refreshed.");
}

async function loadRoutes() {
  state.routes = await fetchJson("/routes", { method: "GET" });
  elements.routeOptions.innerHTML = state.routes.map((route) => `<option value="${route.routeName}"></option>`).join("");
}

async function loadSampleCsv() {
  const response = await fetch("/samples/trips-example.csv");
  const text = await response.text();
  elements.csvText.value = text.trim();
  setStatus("Sample CSV loaded.");
}

function setActiveMode(mode) {
  state.activeMode = mode;
  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  renderDashboard();
}

async function handleTripSubmit(event) {
  event.preventDefault();
  const payload = {
    routeName: elements.routeName.value,
    passengerCount: Number(elements.passengerCount.value),
    delayMinutes: Number(elements.delayMinutes.value),
    timestamp: new Date(elements.tripTimestamp.value).toISOString(),
    capacity: Number(elements.busCapacity.value)
  };
  const pipeline = elements.pipelineSelect.value;

  setStatus(`Sending manual trip to ${pipeline.toUpperCase()}...`);
  await fetchJson(`/${pipeline}/add-trip`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await refreshDashboard();
  setStatus(`Manual trip added to ${pipeline.toUpperCase()}.`);
}

async function handleBulkUpload(pipeline) {
  setStatus(`Uploading CSV rows to ${pipeline.toUpperCase()}...`);
  const result = await fetchJson(`/${pipeline}/bulk-upload`, {
    method: "POST",
    body: JSON.stringify({ csvText: elements.csvText.value })
  });
  await refreshDashboard();
  setStatus(`Imported ${result.imported} rows into ${pipeline.toUpperCase()}.`);
}

async function handleSeedData() {
  setStatus("Generating simulated data for both pipelines...");
  await fetchJson("/simulate", {
    method: "POST",
    body: JSON.stringify({ pipeline: "both", count: 48 })
  });
  await refreshDashboard();
  setStatus("Demo data generated for ETL and ELT.");
}

function bindEvents() {
  elements.tripForm.addEventListener("submit", (event) => {
    handleTripSubmit(event).catch((error) => setStatus(error.message));
  });

  elements.refreshBtn.addEventListener("click", () => {
    refreshDashboard().catch((error) => setStatus(error.message));
  });

  elements.seedDataBtn.addEventListener("click", () => {
    handleSeedData().catch((error) => setStatus(error.message));
  });

  elements.loadSampleBtn.addEventListener("click", () => {
    loadSampleCsv().catch((error) => setStatus(error.message));
  });

  elements.uploadEtlBtn.addEventListener("click", () => {
    handleBulkUpload("etl").catch((error) => setStatus(error.message));
  });

  elements.uploadEltBtn.addEventListener("click", () => {
    handleBulkUpload("elt").catch((error) => setStatus(error.message));
  });

  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.addEventListener("click", () => setActiveMode(button.dataset.mode));
  });
}

async function init() {
  Object.assign(elements, {
    appStatus: document.getElementById("app-status"),
    architectureNotes: document.getElementById("architecture-notes"),
    busCapacity: document.getElementById("bus-capacity"),
    comparisonGrid: document.getElementById("comparison-grid"),
    csvText: document.getElementById("csv-text"),
    delayMinutes: document.getElementById("delay-minutes"),
    delayProfile: document.getElementById("delay-profile"),
    loadSampleBtn: document.getElementById("load-sample-btn"),
    metricGrid: document.getElementById("metric-grid"),
    modeLabel: document.getElementById("mode-label"),
    passengerCount: document.getElementById("passenger-count"),
    passengerTrend: document.getElementById("passenger-trend"),
    peakHours: document.getElementById("peak-hours"),
    pipelineSelect: document.getElementById("pipeline-select"),
    refreshBtn: document.getElementById("refresh-btn"),
    routeName: document.getElementById("route-name"),
    routeOptions: document.getElementById("route-options"),
    routeTableBody: document.getElementById("route-table-body"),
    seedDataBtn: document.getElementById("seed-data-btn"),
    storageEngine: document.getElementById("storage-engine"),
    timezoneLabel: document.getElementById("timezone-label"),
    trendCaption: document.getElementById("trend-caption"),
    tripForm: document.getElementById("trip-form"),
    tripTimestamp: document.getElementById("trip-timestamp"),
    uploadEltBtn: document.getElementById("upload-elt-btn"),
    uploadEtlBtn: document.getElementById("upload-etl-btn")
  });

  elements.tripTimestamp.value = toLocalDateTimeInputValue();
  bindEvents();
  await loadSampleCsv();
  await loadRoutes();
  await refreshDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => setStatus(error.message));
});
