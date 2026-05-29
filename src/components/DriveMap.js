import * as d3 from "d3";
import {
  buildDirectLeg,
  buildFreewayGraph,
  mergeRouteLegs,
  routeOnFreeways,
  haversineDistance as freewayHaversine
} from "./FreewayRouter.js";
import {renderRouteBreakdown} from "./RouteBreakdown.js";
import {formatCurrency, formatNumber, initStatsPanel, updateStatsPanel} from "./StatsPanel.js";
import {renderTripControls} from "./TripControls.js";
import {normalizeCities} from "./CitySearch.js";

const CO2_KG_PER_GALLON = 8.887;
const SVG_WIDTH = 1100;
const SVG_HEIGHT = 680;
const LOWER_48_EXCLUDED = new Set(["AK", "HI", "PR"]);
const PARTICLE_TTL_MS = 3000;
const MAX_PARTICLES = 40;
const UI_UPDATE_MS = 120;
const MIN_TRIP_SECONDS = 5;
const MAX_TRIP_SECONDS = 10;

const FIPS_TO_STATE = {
  "01": {abbr: "AL", name: "Alabama"},
  "04": {abbr: "AZ", name: "Arizona"},
  "05": {abbr: "AR", name: "Arkansas"},
  "06": {abbr: "CA", name: "California"},
  "08": {abbr: "CO", name: "Colorado"},
  "09": {abbr: "CT", name: "Connecticut"},
  "10": {abbr: "DE", name: "Delaware"},
  "11": {abbr: "DC", name: "District of Columbia"},
  "12": {abbr: "FL", name: "Florida"},
  "13": {abbr: "GA", name: "Georgia"},
  "16": {abbr: "ID", name: "Idaho"},
  "17": {abbr: "IL", name: "Illinois"},
  "18": {abbr: "IN", name: "Indiana"},
  "19": {abbr: "IA", name: "Iowa"},
  "20": {abbr: "KS", name: "Kansas"},
  "21": {abbr: "KY", name: "Kentucky"},
  "22": {abbr: "LA", name: "Louisiana"},
  "23": {abbr: "ME", name: "Maine"},
  "24": {abbr: "MD", name: "Maryland"},
  "25": {abbr: "MA", name: "Massachusetts"},
  "26": {abbr: "MI", name: "Michigan"},
  "27": {abbr: "MN", name: "Minnesota"},
  "28": {abbr: "MS", name: "Mississippi"},
  "29": {abbr: "MO", name: "Missouri"},
  "30": {abbr: "MT", name: "Montana"},
  "31": {abbr: "NE", name: "Nebraska"},
  "32": {abbr: "NV", name: "Nevada"},
  "33": {abbr: "NH", name: "New Hampshire"},
  "34": {abbr: "NJ", name: "New Jersey"},
  "35": {abbr: "NM", name: "New Mexico"},
  "36": {abbr: "NY", name: "New York"},
  "37": {abbr: "NC", name: "North Carolina"},
  "38": {abbr: "ND", name: "North Dakota"},
  "39": {abbr: "OH", name: "Ohio"},
  "40": {abbr: "OK", name: "Oklahoma"},
  "41": {abbr: "OR", name: "Oregon"},
  "42": {abbr: "PA", name: "Pennsylvania"},
  "44": {abbr: "RI", name: "Rhode Island"},
  "45": {abbr: "SC", name: "South Carolina"},
  "46": {abbr: "SD", name: "South Dakota"},
  "47": {abbr: "TN", name: "Tennessee"},
  "48": {abbr: "TX", name: "Texas"},
  "49": {abbr: "UT", name: "Utah"},
  "50": {abbr: "VT", name: "Vermont"},
  "51": {abbr: "VA", name: "Virginia"},
  "53": {abbr: "WA", name: "Washington"},
  "54": {abbr: "WV", name: "West Virginia"},
  "55": {abbr: "WI", name: "Wisconsin"},
  "56": {abbr: "WY", name: "Wyoming"}
};

export function DriveMap({gasPrices = [], centroids = [], cities = [], freewayNetwork = null, roadLines = null, geoData} = {}) {
  const priceByAbbr = normalizeGasPrices(gasPrices);
  const centroidByAbbr = normalizeCentroids(centroids);
  const cityCatalog = normalizeCities(cities).filter((city) => !LOWER_48_EXCLUDED.has(city.stateAbbr));
  const mapLabelCities = cityCatalog.filter((city) => city.mapLabel);
  const revealedCityKeys = new Set();
  let highlightedCityKey = null;
  let networkData = freewayNetwork;
  let roadLinesData = roadLines;
  let freewayGraph = null;
  let graphBuildScheduled = false;
  let roadLinesRendered = false;
  let roadLinesRenderScheduled = false;

  const mapStates = {
    type: "FeatureCollection",
    features: (geoData?.features || [])
      .map((item) => {
        const state = FIPS_TO_STATE[String(item.id).padStart(2, "0")];
        if (!state || LOWER_48_EXCLUDED.has(state.abbr)) return null;
        return {...item, properties: {...item.properties, ...state}};
      })
      .filter(Boolean)
  };

  const appState = {
    waypoints: [],
    mpg: 30,
    routeStates: [],
    routeSegments: [],
    routeUnits: [],
    displayPoints: [],
    activeEdgeIds: [],
    progressMiles: 0,
    isDriving: false,
    tripDurationSec: 7,
    totals: {miles: 0, gallons: 0, cost: 0, co2Kg: 0}
  };

  const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  let timer = null;
  let tripStartTime = 0;
  let particles = [];
  let nextParticleId = 0;
  let lastEmitMiles = 0;
  let lastUiUpdateMs = 0;
  let statsNodes = null;
  let edgeById = new Map();
  let nextWaypointId = 1;
  let routeRefreshHandle = 0;
  let routeCache = null;
  let driveRafId = 0;
  let animFrame = 0;
  let carNode = null;
  let routePathNode = null;
  let lastCurrentAbbr = "";
  let stateClassesDirty = true;
  let roadCanvas = null;
  let roadCanvasCtx = null;

  const projection = d3.geoAlbersUsa().fitSize([SVG_WIDTH, SVG_HEIGHT], mapStates);
  const path = d3.geoPath(projection);
  const priceValues = [...priceByAbbr.values()].map((item) => item.gasPrice).filter(Number.isFinite);
  const color = d3
    .scaleQuantize()
    .domain(d3.extent(priceValues))
    .range(["#1e4976", "#2563a8", "#3b82c4", "#e07b39", "#dc4444"]);

  const root = document.createElement("section");
  root.className = "drive-map-app";

  root.innerHTML = `
    <div class="toolbar"></div>
    <div class="map-stage">
      <canvas class="road-canvas" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" aria-hidden="true"></canvas>
      <svg class="us-map" role="img" aria-label="United States map colored by regular gasoline price"></svg>
    </div>
    <div class="price-legend"></div>
    <div class="stats-bar"></div>
    <div class="breakdown-panel">
      <p class="breakdown-title">Cost breakdown by state</p>
    </div>
  `;

  const controlsNode = root.querySelector(".toolbar");
  const statsNode = root.querySelector(".stats-bar");
  const breakdownNode = root.querySelector(".breakdown-panel");
  const legendNode = root.querySelector(".price-legend");
  roadCanvas = root.querySelector(".road-canvas");
  roadCanvasCtx = roadCanvas?.getContext("2d", {alpha: true}) || null;
  const svg = d3.select(root.querySelector(".us-map")).attr("viewBox", `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);

  statsNodes = initStatsPanel(statsNode);

  const stateLayer = svg.append("g").attr("class", "state-layer");
  const cityLayer = svg.append("g").attr("class", "city-layer");
  const cityDotLayer = svg.append("g").attr("class", "city-dot-layer");
  const routeLayer = svg.append("g").attr("class", "route-layer");
  const markerLayer = svg.append("g").attr("class", "marker-layer");
  const exhaustLayer = svg.append("g").attr("class", "exhaust-layer");
  const carLayer = svg.append("g").attr("class", "map-car-layer");

  renderControls();
  renderStaticMap();
  renderHtmlLegend();
  renderRouteScene();
  renderDynamicOutputs();

  root.setNetworkData = setNetworkData;
  root.setRoadLines = setRoadLines;
  if (networkData?.edges?.length) scheduleGraphBuild();
  if (roadLinesData?.features?.length) scheduleRoadLinesRender();

  return root;

  function setRoadLines(lines) {
    roadLinesData = lines;
    roadLinesRendered = false;
    scheduleRoadLinesRender();
  }

  function scheduleRoadLinesRender() {
    if (roadLinesRenderScheduled || roadLinesRendered || !roadLinesData?.features?.length) return;
    roadLinesRenderScheduled = true;
    const run = () => {
      roadLinesRenderScheduled = false;
      renderRoadLinesOnce();
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, {timeout: 2500});
    else setTimeout(run, 50);
  }

  function renderRoadLinesOnce() {
    if (roadLinesRendered || !roadLinesData?.features?.length || !roadCanvasCtx) return;
    const ctx = roadCanvasCtx;
    ctx.clearRect(0, 0, SVG_WIDTH, SVG_HEIGHT);
    ctx.strokeStyle = "rgba(148, 180, 210, 0.22)";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const geoPath = d3.geoPath(projection, ctx);
    for (const feature of roadLinesData.features) {
      geoPath(feature);
      ctx.stroke();
    }
    roadLinesRendered = true;
  }

  function setNetworkData(network) {
    networkData = network;
    edgeById = new Map((network.edges || []).map((edge) => [edge.id, edge]));
    freewayGraph = null;
    graphBuildScheduled = false;
    scheduleGraphBuild();
  }

  function scheduleGraphBuild() {
    if (graphBuildScheduled || freewayGraph || !networkData?.edges?.length) return;
    graphBuildScheduled = true;
    const run = () => {
      freewayGraph = buildFreewayGraph(networkData);
      graphBuildScheduled = false;
      if (appState.waypoints.length >= 2) {
        refreshRoute();
        renderRouteScene();
        renderDynamicOutputs({forceUi: true});
      }
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, {timeout: 1500});
    else setTimeout(run, 30);
  }

  function setAppState(patch, {controls = true, route = true} = {}) {
    Object.assign(appState, patch);
    if ("mpg" in patch) {
      const num = Number(appState.mpg);
      appState.mpg = Number.isFinite(num) ? num : 30;
    }

    if ("waypoints" in patch) {
      appState.progressMiles = 0;
      particles = [];
      lastEmitMiles = 0;
      stateClassesDirty = true;
      pauseTrip({silent: true});
      renderCityDots();
    }

    if (route) {
      if (freewayGraph) scheduleRouteRefresh();
      else {
        refreshRoute();
        renderRouteScene();
      }
    }
    if (controls) renderControls();
    renderDynamicOutputs({forceUi: true});
  }

  function scheduleRouteRefresh() {
    if (routeRefreshHandle) cancelAnimationFrame(routeRefreshHandle);
    routeRefreshHandle = requestAnimationFrame(() => {
      routeRefreshHandle = 0;
      refreshRoute();
      renderRouteScene();
      renderDynamicOutputs({forceUi: true});
    });
  }

  function refreshRoute() {
    if (appState.waypoints.length < 2) {
      appState.routeStates = [];
      appState.routeSegments = [];
      appState.routeUnits = [];
      appState.displayPoints = [];
      appState.activeEdgeIds = [];
      appState.tripDurationSec = 7;
      appState.progressMiles = 0;
      appState.totals = {miles: 0, gallons: 0, cost: 0, co2Kg: 0};
      routeCache = null;
      return;
    }

    const built = freewayGraph
      ? computeRouteFromWaypoints(
          appState.waypoints,
          networkData,
          freewayGraph,
          mapStates.features,
          priceByAbbr
        )
      : computeDirectRouteFromWaypoints(appState.waypoints, mapStates.features, priceByAbbr);

    appState.routeStates = built.routeStates;
    appState.routeSegments = built.routeSegments;
    appState.routeUnits = built.routeUnits;
    appState.displayPoints = built.displayPoints;
    appState.activeEdgeIds = built.activeEdgeIds;
    appState.tripDurationSec = computeTripDuration(getTotalDistance(appState.routeSegments));
    appState.progressMiles = Math.min(appState.progressMiles, getTotalDistance(appState.routeSegments));
    appState.totals = calculateTripTotals(appState.routeUnits, appState.mpg, appState.progressMiles);
    routeCache =
      appState.routeSegments.length > 0
        ? buildRouteCache(appState.displayPoints, appState.routeSegments, projection)
        : null;
  }

  function renderControls() {
    renderTripControls(controlsNode, {
      appState,
      cities: cityCatalog,
      onChange: (patch, options) => setAppState(patch, options),
      onRevealCity: revealCityFromSearch,
      onSkipAnimation: skipAnimation,
      onDrive: startTrip,
      onPause: () => pauseTrip(),
      onReset: resetTrip,
      onUndo: undoWaypoint,
      onClearRoute: clearRoute
    });
  }

  function setHighlightedCity(city) {
    highlightedCityKey = city?.displayName ?? null;
    renderCityDots();
    renderCityLabels();
  }

  function revealCityFromSearch(city) {
    if (appState.isDriving) return;
    if (!city.mapLabel) revealedCityKeys.add(city.displayName);
    setHighlightedCity(city);
    addCityWaypoint(city);
  }

  function addCityWaypoint(city) {
    if (appState.isDriving) return;
    addWaypoint({
      id: nextWaypointId++,
      abbr: city.stateAbbr,
      name: city.displayName,
      label: city.city,
      lon: city.longitude,
      lat: city.latitude
    });
  }

  function waypointMatchesCity(city) {
    return appState.waypoints.some(
      (wp) =>
        wp.abbr === city.stateAbbr &&
        Math.abs(wp.lon - city.longitude) < 0.02 &&
        Math.abs(wp.lat - city.latitude) < 0.02
    );
  }

  function getVisibleCityDots() {
    const byKey = new Map();
    mapLabelCities.forEach((city) => byKey.set(city.displayName, city));
    for (const key of revealedCityKeys) {
      const city = cityCatalog.find((item) => item.displayName === key);
      if (city) byKey.set(key, city);
    }
    return [...byKey.values()];
  }

  function renderStaticMap() {
    stateLayer
      .selectAll("path.state")
      .data(mapStates.features, (d) => d.properties.abbr)
      .join("path")
      .attr("class", "state")
      .attr("d", path)
      .attr("fill", (d) => color(getGasPrice(d.properties.abbr).gasPrice))
      .append("title")
      .text((d) => `${d.properties.name}: ${formatCurrency(getGasPrice(d.properties.abbr).gasPrice)}/gal`);

    svg.on("click", handleMapClick);
    renderCityLabels();
    renderCityDots();
  }

  function renderCityDots() {
    const dots = getVisibleCityDots();
    cityDotLayer
      .selectAll("g.city-dot")
      .data(dots, (d) => d.displayName)
      .join(
        (enter) => {
          const g = enter
            .append("g")
            .attr("class", "city-dot")
            .style("cursor", "pointer");
          g.append("circle").attr("class", "city-dot-hit").attr("r", 10);
          g.append("circle").attr("class", "city-dot-core").attr("r", 2.5);
          g.on("click", (event, city) => {
            event.stopPropagation();
            if (appState.isDriving) return;
            setHighlightedCity(city);
            addCityWaypoint(city);
          });
          return g;
        },
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("transform", (d) => {
        const pt = projection([d.longitude, d.latitude]);
        return pt ? `translate(${pt[0]},${pt[1]})` : null;
      })
      .classed("is-highlighted", (d) => d.displayName === highlightedCityKey)
      .classed("is-stop", (d) => waypointMatchesCity(d))
      .attr("aria-label", (d) => d.displayName)
      .attr("role", "button")
      .call((sel) => {
        sel.select(".city-dot-core").attr("r", (d) => (d.displayName === highlightedCityKey ? 3.5 : 2.5));
      });
  }

  function renderCityLabels() {
    cityLayer
      .selectAll("text.city-label")
      .data(mapLabelCities, (d) => d.displayName)
      .join("text")
      .attr("class", "city-label")
      .attr("transform", (d) => {
        const pt = projection([d.longitude, d.latitude]);
        return pt ? `translate(${pt[0]},${pt[1]})` : null;
      })
      .attr("text-anchor", "middle")
      .attr("dy", "-0.35em")
      .text((d) => d.city)
      .classed("is-highlighted", (d) => d.displayName === highlightedCityKey);
  }

  function handleMapClick(event) {
    if (appState.isDriving) return;

    const [px, py] = d3.pointer(event, svg.node());
    const coords = projection.invert([px, py]);
    if (!coords || !Number.isFinite(coords[0])) return;

    const state = findStateAt(coords, mapStates.features);
    if (!state) return;

    const abbr = state.properties.abbr;
    addWaypoint({
      id: nextWaypointId++,
      abbr,
      name: state.properties.name,
      lon: coords[0],
      lat: coords[1]
    });
  }

  function addWaypoint(waypoint) {
    setAppState({waypoints: [...appState.waypoints, waypoint]});
  }

  function undoWaypoint() {
    if (appState.waypoints.length === 0) return;
    setAppState({waypoints: appState.waypoints.slice(0, -1)});
  }

  function clearRoute() {
    revealedCityKeys.clear();
    setHighlightedCity(null);
    setAppState({waypoints: []});
  }

  function renderHtmlLegend() {
    legendNode.replaceChildren();
    const label = document.createElement("span");
    label.className = "legend-heading";
    label.textContent = "Regular gas price:";
    legendNode.append(label);

    color.range().forEach((rangeColor) => {
      const [min, max] = color.invertExtent(rangeColor);
      const item = document.createElement("span");
      item.className = "legend-chip";
      item.innerHTML = `<i style="background:${rangeColor}"></i>${formatCurrency(min)}–${formatCurrency(max)}`;
      legendNode.append(item);
    });
  }

  function renderRouteScene() {
    renderRoute();
    renderMarkers();
  }

  function renderDynamicOutputs({forceUi = false} = {}) {
    if (!appState.isDriving) {
      appState.totals = calculateTripTotals(appState.routeUnits, appState.mpg, appState.progressMiles);
      updateStateClassesIfNeeded(forceUi);
      moveCar(getCachedPointAtMiles(appState.progressMiles));
    }
    if (forceUi || !appState.isDriving) updateUiPanels();
  }

  function updateUiPanels() {
    appState.totals = calculateTripTotals(appState.routeUnits, appState.mpg, appState.progressMiles);
    const totalDistance = routeCache?.totalMiles ?? getTotalDistance(appState.routeSegments);
    const currentState = getCurrentState(
      appState.progressMiles,
      appState.routeUnits,
      appState.waypoints.at(-1)?.abbr,
      priceByAbbr,
      centroidByAbbr
    );

    updateStatsPanel(statsNodes, {
      appState,
      totals: appState.totals,
      currentState,
      routeStates: appState.waypoints.map((wp) => wp.abbr),
      totalDistance
    });

    renderRouteBreakdown(breakdownNode, {
      breakdown: calculateStateBreakdown(appState.routeUnits, appState.mpg),
      progressMiles: appState.progressMiles,
      routeUnits: appState.routeUnits,
      mpg: appState.mpg,
      totalDistance,
      isDriving: appState.isDriving
    });
  }

  function updateStateClassesIfNeeded(force = false) {
    const currentAbbr =
      getCurrentState(
        appState.progressMiles,
        appState.routeUnits,
        appState.waypoints.at(-1)?.abbr,
        priceByAbbr,
        centroidByAbbr
      )?.abbr || "";

    if (!force && !stateClassesDirty && currentAbbr === lastCurrentAbbr) return;
    lastCurrentAbbr = currentAbbr;
    stateClassesDirty = false;

    const waypointAbbrs = new Set(appState.waypoints.map((wp) => wp.abbr));
    const startAbbr = appState.waypoints[0]?.abbr;
    const endAbbr = appState.waypoints.at(-1)?.abbr;
    const routeSet = new Set(appState.routeStates);

    stateLayer.selectAll("path.state").each(function (d) {
      const abbr = d.properties.abbr;
      const el = d3.select(this);
      el.classed("is-waypoint", waypointAbbrs.has(abbr));
      el.classed("is-start", abbr === startAbbr);
      el.classed("is-end", abbr === endAbbr);
      el.classed("is-route", routeSet.has(abbr));
      el.classed("is-current", abbr === currentAbbr);
    });
  }

  function renderRoute() {
    if (!routePathNode) routePathNode = routeLayer.append("path").attr("class", "route-line-map");
    routePathNode.attr("d", routeCache?.routePathD || null);
  }

  function renderMarkers() {
    markerLayer
      .selectAll("g.waypoint-marker")
      .data(appState.waypoints, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append("g").attr("class", "waypoint-marker");
          g.append("circle").attr("class", "marker-ring").attr("r", 9);
          g.append("text").attr("class", "marker-label").attr("dy", "0.35em").attr("text-anchor", "middle");
          return g;
        },
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("transform", (wp, i) => {
        const pt = projection([wp.lon, wp.lat]) || [0, 0];
        return `translate(${pt[0]},${pt[1]})`;
      })
      .call((sel) => {
        sel.select(".marker-ring").classed("is-start", (_, i) => i === 0);
        sel.select(".marker-label").text((_, i) => i + 1);
      });
  }

  function ensureCarNode() {
    if (carNode) return carNode;
    carNode = carLayer.append("g").attr("class", "map-car");
    carNode.append("ellipse").attr("class", "car-shadow").attr("cx", 0).attr("cy", 8).attr("rx", 16).attr("ry", 4);
    carNode.append("path").attr("class", "car-body").attr("d", "M-20,4 L-16,-4 L-8,-9 L10,-9 L18,-4 L22,4 Z");
    carNode.append("path").attr("class", "car-cabin").attr("d", "M-11,-7 L-4,-8 L8,-8 L15,-4 L15,-2 L-9,-2 Z");
    carNode.append("rect").attr("class", "car-bumper").attr("x", -21).attr("y", 2).attr("width", 4).attr("height", 3).attr("rx", 1);
    carNode.append("rect").attr("class", "car-bumper").attr("x", 17).attr("y", 2).attr("width", 4).attr("height", 3).attr("rx", 1);
    carNode.append("circle").attr("class", "car-wheel").attr("cx", -11).attr("cy", 5).attr("r", 4.5);
    carNode.append("circle").attr("class", "car-wheel").attr("cx", 11).attr("cy", 5).attr("r", 4.5);
    carNode.append("circle").attr("class", "car-hub").attr("cx", -11).attr("cy", 5).attr("r", 1.8);
    carNode.append("circle").attr("class", "car-hub").attr("cx", 11).attr("cy", 5).attr("r", 1.8);
    return carNode;
  }

  function moveCar(point) {
    if (!point) {
      carNode?.attr("display", "none");
      return;
    }
    ensureCarNode().attr("display", null).attr("transform", `translate(${point.x},${point.y})`);
  }

  function getCachedPointAtMiles(miles) {
    if (!routeCache?.projectedSegments?.length) return null;
    return pointAtMiles(miles, routeCache.projectedSegments);
  }

  function emitExhaust(carPoint) {
    if (prefersReducedMotion || !carPoint) return;

    const co2Rate = CO2_KG_PER_GALLON / Math.max(1, appState.mpg);
    const emitEvery = clamp(2.5 / co2Rate, 1.5, 10);

    while (lastEmitMiles + emitEvery <= appState.progressMiles) {
      lastEmitMiles += emitEvery;
      particles.push({
        id: nextParticleId++,
        x: carPoint.x - 18,
        y: carPoint.y,
        r: 3 + Math.random() * 4,
        driftX: (Math.random() - 0.5) * 2,
        driftY: (Math.random() - 0.5) * 1,
        createdAt: performance.now()
      });
    }

    if (particles.length > MAX_PARTICLES) particles = particles.slice(-MAX_PARTICLES);
  }

  function renderExhaust() {
    if (!particles.length) {
      exhaustLayer.selectAll("circle.exhaust").remove();
      return;
    }

    const now = performance.now();
    particles = particles.filter((p) => now - p.createdAt < PARTICLE_TTL_MS);
    if (!particles.length) {
      exhaustLayer.selectAll("circle.exhaust").remove();
      return;
    }

    exhaustLayer
      .selectAll("circle.exhaust")
      .data(particles, (d) => d.id)
      .join(
        (enter) => enter.append("circle").attr("class", "exhaust"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("cx", (d) => d.x + d.driftX)
      .attr("cy", (d) => d.y + d.driftY - (now - d.createdAt) * 0.02)
      .attr("r", (d) => d.r * (1 - (now - d.createdAt) / PARTICLE_TTL_MS))
      .attr("opacity", (d) => Math.max(0, 0.5 - (now - d.createdAt) / PARTICLE_TTL_MS));
  }

  function tickDrive(now) {
    const elapsed = (now - tripStartTime) / 1000;
    const t = clamp(elapsed / appState.tripDurationSec, 0, 1);
    const eased = d3.easeCubicInOut(t);
    const total = routeCache?.totalMiles ?? 0;
    const miles = total * eased;
    const point = getCachedPointAtMiles(miles);

    if (point) {
      appState.progressMiles = miles;
      moveCar(point);
      if (animFrame % 4 === 0) emitExhaust(point);
      if (animFrame % 5 === 0) renderExhaust();
    }
    animFrame += 1;

    if (now - lastUiUpdateMs >= UI_UPDATE_MS) {
      appState.totals = calculateTripTotals(appState.routeUnits, appState.mpg, appState.progressMiles);
      updateUiPanels();
      updateStateClassesIfNeeded();
      lastUiUpdateMs = now;
    }

    if (t >= 1) pauseTrip();
    else driveRafId = requestAnimationFrame(tickDrive);
  }

  function skipAnimation() {
    if (!appState.isDriving) return;
    const total = routeCache?.totalMiles ?? getTotalDistance(appState.routeSegments);
    appState.progressMiles = total;
    const point = getCachedPointAtMiles(total);
    if (point) {
      moveCar(point);
      renderExhaust();
    }
    appState.totals = calculateTripTotals(appState.routeUnits, appState.mpg, appState.progressMiles);
    updateStateClassesIfNeeded(true);
    pauseTrip();
  }

  function startTrip() {
    if (appState.waypoints.length < 2) return;

    if (prefersReducedMotion) {
      appState.progressMiles = routeCache?.totalMiles ?? getTotalDistance(appState.routeSegments);
      renderDynamicOutputs({forceUi: true});
      renderControls();
      return;
    }

    if (appState.progressMiles >= (routeCache?.totalMiles ?? 0)) {
      appState.progressMiles = 0;
      particles = [];
      lastEmitMiles = 0;
    }

    if (!routeCache?.projectedSegments?.length) return;

    appState.isDriving = true;
    root.classList.add("is-driving");
    tripStartTime = performance.now();
    lastUiUpdateMs = 0;
    animFrame = 0;
    stateClassesDirty = true;
    renderControls();
    updateUiPanels();
    updateStateClassesIfNeeded(true);
    if (driveRafId) cancelAnimationFrame(driveRafId);
    driveRafId = requestAnimationFrame(tickDrive);
  }

  function pauseTrip({silent = false} = {}) {
    appState.isDriving = false;
    root.classList.remove("is-driving");
    if (driveRafId) {
      cancelAnimationFrame(driveRafId);
      driveRafId = 0;
    }
    timer?.stop();
    timer = null;
    particles = [];
    lastEmitMiles = 0;
    exhaustLayer.selectAll("circle.exhaust").remove();
    if (!silent) {
      renderControls();
      renderDynamicOutputs({forceUi: true});
    }
  }

  function resetTrip() {
    pauseTrip();
    appState.progressMiles = 0;
    renderDynamicOutputs({forceUi: true});
    renderControls();
  }

  function getGasPrice(abbr) {
    return priceByAbbr.get(abbr) || priceByAbbr.get("US") || {gasPrice: 4.459, state: "National Average", abbr: "US"};
  }
}

export function computeDirectRouteFromWaypoints(waypoints, stateFeatures, priceByAbbr) {
  if (waypoints.length < 2) {
    return {routeStates: [], routeSegments: [], routeUnits: [], displayPoints: [], activeEdgeIds: []};
  }

  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    legs.push(buildDirectLeg(waypoints[i], waypoints[i + 1], stateFeatures));
  }

  const merged = mergeRouteLegs(legs);
  merged.routeUnits = merged.routeUnits.map((unit) => {
    const gas = priceByAbbr.get(unit.stateAbbr) || priceByAbbr.get("US");
    return {...unit, gasPrice: gas.gasPrice};
  });
  return merged;
}

export function computeRouteFromWaypoints(waypoints, freewayNetwork, freewayGraph, stateFeatures, priceByAbbr) {
  if (waypoints.length < 2) {
    return {routeStates: [], routeSegments: [], routeUnits: [], displayPoints: [], activeEdgeIds: []};
  }

  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    legs.push(routeOnFreeways(waypoints[i], waypoints[i + 1], freewayNetwork, freewayGraph, stateFeatures));
  }

  const merged = mergeRouteLegs(legs);
  merged.routeUnits = merged.routeUnits.map((unit) => {
    const gas = priceByAbbr.get(unit.stateAbbr) || priceByAbbr.get("US");
    return {...unit, gasPrice: gas.gasPrice};
  });
  return merged;
}

export function haversineDistance(coordA, coordB) {
  return freewayHaversine(coordA, coordB);
}

export function calculateTripTotals(routeUnits, mpg, progressMiles = Infinity) {
  const effectiveMpg = clamp(Number(mpg) || 30, 5, 120);
  return routeUnits.reduce(
    (totals, unit) => {
      const miles = clamp(Math.min(progressMiles, unit.endMiles) - unit.startMiles, 0, unit.miles);
      const gallons = miles / effectiveMpg;
      totals.miles += miles;
      totals.gallons += gallons;
      totals.cost += gallons * unit.gasPrice;
      totals.co2Kg += gallons * CO2_KG_PER_GALLON;
      return totals;
    },
    {miles: 0, gallons: 0, cost: 0, co2Kg: 0}
  );
}

export function calculateStateBreakdown(routeUnits, mpg) {
  const effectiveMpg = clamp(Number(mpg) || 30, 5, 120);
  const grouped = d3.rollups(
    routeUnits,
    (items) => {
      const miles = d3.sum(items, (item) => item.miles);
      const gallons = miles / effectiveMpg;
      const gasPrice = items[0].gasPrice;
      return {
        abbr: items[0].stateAbbr,
        name: items[0].stateName,
        miles,
        gallons,
        gasPrice,
        cost: gallons * gasPrice,
        co2Kg: gallons * CO2_KG_PER_GALLON
      };
    },
    (item) => item.stateAbbr
  );
  return grouped.map(([, value]) => value).sort((a, b) => d3.descending(a.cost, b.cost));
}

export function interpolateAlongRoute(progressMiles, routeSegments, projection) {
  if (!routeSegments.length) return null;
  const segment =
    routeSegments.find((item) => progressMiles >= item.startMiles && progressMiles <= item.endMiles) ||
    routeSegments.at(-1);
  const t = segment.distanceMiles === 0 ? 1 : clamp((progressMiles - segment.startMiles) / segment.distanceMiles, 0, 1);
  const start = projection(segment.fromCoord);
  const end = projection(segment.toCoord);
  if (!start || !end) return null;

  return {
    x: start[0] + (end[0] - start[0]) * t,
    y: start[1] + (end[1] - start[1]) * t,
    angle: (Math.atan2(end[1] - start[1], end[0] - start[0]) * 180) / Math.PI
  };
}

export function getCurrentState(progressMiles, routeUnits, fallbackAbbr, priceByAbbr, centroidByAbbr) {
  const unit = routeUnits.find((item) => progressMiles >= item.startMiles && progressMiles <= item.endMiles) || routeUnits.at(-1);
  const abbr = unit?.stateAbbr || fallbackAbbr;
  const centroid = centroidByAbbr.get(abbr);
  const gas = priceByAbbr.get(abbr) || priceByAbbr.get("US");
  if (!abbr || !centroid || !gas) return null;
  return {abbr, name: centroid.name, gasPrice: gas.gasPrice};
}

function buildRouteCache(displayPoints, routeSegments, projection) {
  const totalMiles = getTotalDistance(routeSegments);
  const projectedSegments = routeSegments
    .map((segment) => {
      const start = projection(segment.fromCoord);
      const end = projection(segment.toCoord);
      if (!start || !end) return null;
      return {
        startMiles: segment.startMiles,
        endMiles: segment.endMiles,
        distanceMiles: segment.distanceMiles,
        x0: start[0],
        y0: start[1],
        x1: end[0],
        y1: end[1]
      };
    })
    .filter(Boolean);

  let routePathD = null;
  if (displayPoints.length >= 2) {
    const parts = [];
    displayPoints.forEach((coord, index) => {
      const projected = projection(coord);
      if (!projected) return;
      parts.push(`${index === 0 ? "M" : "L"}${projected[0]},${projected[1]}`);
    });
    routePathD = parts.length ? parts.join(" ") : null;
  }

  return {totalMiles, projectedSegments, routePathD};
}

function pointAtMiles(miles, projectedSegments) {
  if (!projectedSegments?.length) return null;
  const segment =
    projectedSegments.find((item) => miles >= item.startMiles && miles <= item.endMiles) ||
    projectedSegments.at(-1);
  const t =
    segment.distanceMiles === 0 ? 1 : clamp((miles - segment.startMiles) / segment.distanceMiles, 0, 1);
  return {
    x: segment.x0 + (segment.x1 - segment.x0) * t,
    y: segment.y0 + (segment.y1 - segment.y0) * t
  };
}

function findStateAt(coords, features) {
  return features.find((feature) => d3.geoContains(feature, coords));
}


function computeTripDuration(totalMiles) {
  if (totalMiles <= 0) return MIN_TRIP_SECONDS;
  const ratio = clamp(totalMiles / 2000, 0, 1);
  return MIN_TRIP_SECONDS + ratio * (MAX_TRIP_SECONDS - MIN_TRIP_SECONDS);
}

function normalizeGasPrices(records) {
  const prices = new Map();
  records.forEach((record) => {
    const abbr = String(record.state_abbr || "").trim();
    const gasPrice = Number(record.gas_price);
    if (!abbr || !Number.isFinite(gasPrice)) return;
    prices.set(abbr, {state: String(record.state || "").trim(), abbr, gasPrice});
  });
  if (!prices.has("US")) prices.set("US", {state: "National Average", abbr: "US", gasPrice: 4.459});
  return prices;
}

function normalizeCentroids(records) {
  return new Map(
    records
      .map((record) => ({
        name: String(record.state || "").trim(),
        abbr: String(record.state_abbr || "").trim(),
        latitude: Number(record.latitude),
        longitude: Number(record.longitude)
      }))
      .filter((record) => record.abbr && Number.isFinite(record.latitude) && Number.isFinite(record.longitude))
      .map((record) => [record.abbr, record])
  );
}

function getTotalDistance(routeSegments) {
  return d3.sum(routeSegments, (segment) => segment.distanceMiles);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
