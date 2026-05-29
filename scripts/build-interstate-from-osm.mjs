/**
 * Builds a routable highway graph from US DOT National Highway System (NTAD)
 * interstate + US route geometry, plus a simplified GeoJSON for map display.
 *
 * Source: https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Highway_System/FeatureServer/0
 *
 * Usage: node scripts/build-interstate-from-osm.mjs
 * Cache: scripts/.cache/ntad-nhs-highways.geojson
 */
import {mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE_DIR = join(__dirname, ".cache");
const CACHE_FILE = join(CACHE_DIR, "ntad-nhs-highways.geojson");
const PARTIAL_CACHE = join(CACHE_DIR, "ntad-nhs-highways.partial.geojson");
const PROGRESS_FILE = join(CACHE_DIR, "ntad-nhs-fetch-progress.json");
const NETWORK_OUT = join(ROOT, "src/data/interstate-network.json");
const LINES_OUT = join(ROOT, "src/data/interstate-lines.geojson");

const LOWER_48 = {south: 24.52, west: -124.85, north: 49.38, east: -66.95};
const CLUSTER_MILES = 0.35;
const SIMPLIFY_TOLERANCE = 0.001;
const DISPLAY_SIMPLIFY_INTERSTATE = 0.008;
const DISPLAY_SIMPLIFY_US = 0.028;
const MIN_EDGE_MILES = 0.35;
const COORD_DECIMALS = 5;
const NTAD_URL =
  "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Highway_System/FeatureServer/0/query";
const NTAD_WHERE_INTERSTATES = "SIGNT1='I' AND NHS>0";
const NTAD_WHERE_FULL = "(SIGNT1='I' OR SIGNT1='U') AND NHS>0";

async function fetchWithRetry(url, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {"User-Agent": "GasPriceVis/1.0 (CSC477 educational project)"}
      });
      if (!response.ok) throw new Error(`NTAD API error: ${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      lastError = error;
      const waitMs = attempt * 2000;
      console.log(`  fetch failed (attempt ${attempt}/${attempts}): ${error.message}; retrying in ${waitMs}ms…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

function savePartialFetch(features, offset) {
  mkdirSync(CACHE_DIR, {recursive: true});
  writeFileSync(PARTIAL_CACHE, JSON.stringify({type: "FeatureCollection", features}));
  writeFileSync(PROGRESS_FILE, JSON.stringify({offset, features: features.length, updated: new Date().toISOString()}));
}

async function fetchNtadHighways(whereClause) {
  if (existsSync(CACHE_FILE)) {
    console.log("Using cached NTAD data:", CACHE_FILE);
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  }

  mkdirSync(CACHE_DIR, {recursive: true});
  let features = [];
  let offset = 0;
  if (existsSync(PROGRESS_FILE) && existsSync(PARTIAL_CACHE)) {
    const progress = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
    features = JSON.parse(readFileSync(PARTIAL_CACHE, "utf8")).features || [];
    offset = progress.offset || features.length;
    console.log(`Resuming NTAD fetch at offset ${offset} (${features.length} segments cached)…`);
  } else {
    console.log("Fetching interstate + US highway geometry from US DOT NTAD…");
  }

  const pageSize = 2000;
  let pagesSinceSave = 0;

  while (true) {
    const url = new URL(NTAD_URL);
    url.searchParams.set("where", whereClause);
    url.searchParams.set(
      "geometry",
      `${LOWER_48.west},${LOWER_48.south},${LOWER_48.east},${LOWER_48.north}`
    );
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "SIGNT1,SIGNN1,LNAME,NHS");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("f", "geojson");
    url.searchParams.set("resultRecordCount", String(pageSize));
    url.searchParams.set("resultOffset", String(offset));

    const page = await fetchWithRetry(url);
    const batch = page.features || [];
    features.push(...batch);
    offset += batch.length;
    pagesSinceSave += 1;
    console.log(`  fetched ${batch.length} segments (total ${features.length})`);

    if (pagesSinceSave >= 5) {
      savePartialFetch(features, offset);
      pagesSinceSave = 0;
    }

    if (batch.length < pageSize) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const collection = {type: "FeatureCollection", features};
  writeFileSync(CACHE_FILE, JSON.stringify(collection));
  if (existsSync(PARTIAL_CACHE)) {
    try {
      unlinkSync(PARTIAL_CACHE);
      unlinkSync(PROGRESS_FILE);
    } catch {
      // ignore cleanup errors
    }
  }
  return collection;
}

function roundCoord([lon, lat]) {
  const f = 10 ** COORD_DECIMALS;
  return [Math.round(lon * f) / f, Math.round(lat * f) / f];
}

function inLower48(lon, lat) {
  return lon >= LOWER_48.west && lon <= LOWER_48.east && lat >= LOWER_48.south && lat <= LOWER_48.north;
}

function haversine(a, b) {
  const r = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const [lon1, lat1] = a.map(toRad);
  const [lon2, lat2] = b.map(toRad);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function pathLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) total += haversine(coords[i - 1], coords[i]);
  return total;
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(x - projX, y - projY);
}

function simplifyRdp(coords, tolerance) {
  if (coords.length <= 2) return coords.slice();
  let maxDist = 0;
  let index = 0;
  const end = coords.length - 1;
  for (let i = 1; i < end; i += 1) {
    const d = perpendicularDistance(coords[i], coords[0], coords[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyRdp(coords.slice(0, index + 1), tolerance);
    const right = simplifyRdp(coords.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [coords[0], coords[end]];
}

function parseHighway(props, includeUs = false) {
  const num = Number(props.SIGNN1);
  if (!Number.isFinite(num)) return null;
  const type = String(props.SIGNT1 || "I").toUpperCase();
  if (type === "U") return includeUs ? `US-${num}` : null;
  if (type === "I") return `I-${num}`;
  return null;
}

function extractWays(geojson, {includeUs = false} = {}) {
  const ways = [];
  for (const feature of geojson.features || []) {
    if (feature.geometry?.type !== "LineString") continue;
    const highway = parseHighway(feature.properties || {}, includeUs);
    if (!highway) continue;

    const coords = feature.geometry.coordinates
      .map(roundCoord)
      .filter(([lon, lat]) => inLower48(lon, lat));
    if (coords.length < 2) continue;

    const simplified = simplifyRdp(coords, SIMPLIFY_TOLERANCE);
    ways.push({highway, coords: simplified});
  }
  return ways;
}

function buildGraph(ways) {
  const pointEntries = [];
  ways.forEach((way, wayIndex) => {
    way.coords.forEach((coord, coordIndex) => {
      pointEntries.push({coord, wayIndex, coordIndex, highway: way.highway});
    });
  });

  console.log(`Clustering ${pointEntries.length} geometry points…`);
  const parent = pointEntries.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const cellSize = 0.04;
  const grid = new Map();
  pointEntries.forEach((entry, index) => {
    const [lon, lat] = entry.coord;
    const key = `${Math.floor(lon / cellSize)},${Math.floor(lat / cellSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(index);
  });

  for (let i = 0; i < pointEntries.length; i += 1) {
    const [lon, lat] = pointEntries[i].coord;
    const cx = Math.floor(lon / cellSize);
    const cy = Math.floor(lat / cellSize);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (j <= i) continue;
          if (haversine(pointEntries[i].coord, pointEntries[j].coord) <= CLUSTER_MILES) unite(i, j);
        }
      }
    }
  }

  const clusterCoords = new Map();
  pointEntries.forEach((entry, index) => {
    const root = find(index);
    const current = clusterCoords.get(root) || {lon: 0, lat: 0, count: 0};
    current.lon += entry.coord[0];
    current.lat += entry.coord[1];
    current.count += 1;
    clusterCoords.set(root, current);
  });

  const rootToNodeId = new Map();
  const nodes = [];
  for (const [root, aggregate] of clusterCoords) {
    const [lon, lat] = roundCoord([aggregate.lon / aggregate.count, aggregate.lat / aggregate.count]);
    const id = `n${nodes.length}`;
    rootToNodeId.set(root, id);
    nodes.push({id, lon, lat});
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indexToNodeId = pointEntries.map((_, index) => rootToNodeId.get(find(index)));
  const wayOffsets = [];
  let offset = 0;
  ways.forEach((way) => {
    wayOffsets.push(offset);
    offset += way.coords.length;
  });

  const edgeMap = new Map();

  ways.forEach((way, wayIndex) => {
    const collapsed = [];
    way.coords.forEach((coord, coordIndex) => {
      const globalIndex = wayOffsets[wayIndex] + coordIndex;
      const nodeId = indexToNodeId[globalIndex];
      if (!collapsed.length || collapsed.at(-1).nodeId !== nodeId) {
        collapsed.push({nodeId, coordIndex});
      } else {
        collapsed.at(-1).coordIndex = coordIndex;
      }
    });

    for (let i = 0; i < collapsed.length - 1; i += 1) {
      const from = collapsed[i];
      const to = collapsed[i + 1];
      if (from.nodeId === to.nodeId) continue;

      const segmentCoords = way.coords.slice(from.coordIndex, to.coordIndex + 1).map(roundCoord);
      const miles = pathLength(segmentCoords);
      if (miles < MIN_EDGE_MILES) continue;

      const fromNode = nodeById.get(from.nodeId);
      const toNode = nodeById.get(to.nodeId);
      const nodeSpan = haversine([fromNode.lon, fromNode.lat], [toNode.lon, toNode.lat]);
      if (nodeSpan > 20 && miles < nodeSpan * 0.25) continue;

      const pairKey = from.nodeId < to.nodeId ? `${from.nodeId}|${to.nodeId}` : `${to.nodeId}|${from.nodeId}`;
      const existing = edgeMap.get(pairKey);
      if (!existing || segmentCoords.length > existing.coords.length) {
        edgeMap.set(pairKey, {
          from: from.nodeId,
          to: to.nodeId,
          highway: way.highway,
          coords: segmentCoords,
          miles: Math.round(miles * 10) / 10
        });
      }
    }
  });

  const edges = [...edgeMap.values()].map((edge, index) => ({id: `e${index}`, ...edge}));
  return {nodes, edges};
}

function buildDisplayGeoJson(ways, {includeUs = false} = {}) {
  const interstates = [];

  for (const way of ways) {
    if (!way.highway.startsWith("I-")) continue;
    interstates.push(simplifyRdp(way.coords, DISPLAY_SIMPLIFY_INTERSTATE));
  }

  const features = [
    {
      type: "Feature",
      id: 0,
      properties: {highway: "Interstates", routeClass: "interstate"},
      geometry: {type: "MultiLineString", coordinates: interstates}
    }
  ];

  if (includeUs) {
    const usRoutes = [];
    for (const way of ways) {
      if (!way.highway.startsWith("US-")) continue;
      usRoutes.push(simplifyRdp(way.coords, DISPLAY_SIMPLIFY_US));
    }
    features.push({
      type: "Feature",
      id: 1,
      properties: {highway: "US Highways", routeClass: "us"},
      geometry: {type: "MultiLineString", coordinates: usRoutes}
    });
  }

  return {type: "FeatureCollection", features};
}

function connectMainComponent(network) {
  const adj = new Map();
  for (const node of network.nodes) adj.set(node.id, []);
  for (const edge of network.edges) {
    adj.get(edge.from).push(edge.to);
    adj.get(edge.to).push(edge.from);
  }

  const visited = new Set();
  let largest = [];
  for (const node of network.nodes) {
    if (visited.has(node.id)) continue;
    const component = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length) {
      const id = queue.shift();
      component.push(id);
      for (const next of adj.get(id) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }

  const keep = new Set(largest);
  const nodes = network.nodes.filter((n) => keep.has(n.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = network.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  return {nodes, edges, dropped: network.nodes.length - nodes.length};
}

function summarizeWays(ways) {
  const interstates = ways.filter((way) => way.highway.startsWith("I-")).length;
  const usRoutes = ways.filter((way) => way.highway.startsWith("US-")).length;
  return {interstates, usRoutes};
}

async function main() {
  const includeUs = process.argv.includes("--with-us");
  const displayOnly = process.argv.includes("--display-only");
  const skipDisplay = process.argv.includes("--no-display");
  const whereClause = includeUs ? NTAD_WHERE_FULL : NTAD_WHERE_INTERSTATES;

  const geojson = await fetchNtadHighways(whereClause);
  const ways = extractWays(geojson, {includeUs});
  const {interstates, usRoutes} = summarizeWays(ways);
  console.log(`Extracted ${ways.length} highway segments (${interstates} interstate, ${usRoutes} US)`);

  if (!skipDisplay) {
    const lines = buildDisplayGeoJson(ways, {includeUs});
    writeFileSync(LINES_OUT, JSON.stringify(lines));
    const linesMb = (readFileSync(LINES_OUT).length / 1024 / 1024).toFixed(2);
    console.log(`Wrote ${LINES_OUT} (${linesMb} MB, ${lines.features.length} display layers)`);
  }

  if (displayOnly) return;

  let network = buildGraph(ways);
  console.log(`Graph before cleanup: ${network.nodes.length} nodes, ${network.edges.length} edges`);

  const connected = connectMainComponent(network);
  if (connected.dropped > 0 && connected.nodes.length > network.nodes.length * 0.5) {
    console.log(`Keeping largest component (dropped ${connected.dropped} isolated nodes)`);
    network = connected;
  } else if (connected.dropped > 0) {
    console.log(`Warning: largest component only ${connected.nodes.length} nodes; keeping full graph`);
  }

  writeFileSync(
    NETWORK_OUT,
    JSON.stringify({
      meta: {
        source: includeUs
          ? "US DOT NTAD National Highway System (interstates + US routes)"
          : "US DOT NTAD National Highway System (interstates only)",
        generated: new Date().toISOString(),
        nodes: network.nodes.length,
        edges: network.edges.length,
        interstates,
        usRoutes
      },
      nodes: network.nodes,
      edges: network.edges
    })
  );
  const networkMb = (readFileSync(NETWORK_OUT).length / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${NETWORK_OUT} (${networkMb} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
