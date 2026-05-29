import * as d3 from "d3";

const EARTH_RADIUS_MILES = 3958.8;
const MAX_SNAP_MILES = 200;
const FALLBACK_SNAP_MILES = 250;
const SAME_STATE_DIRECT_MILES = 35;

export function buildFreewayGraph(network) {
  const nodeById = new Map(network.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(network.edges.map((edge) => [edge.id, edge]));
  const adjacency = new Map();
  const spatialIndex = buildSpatialIndex(network.nodes);
  let edgeSpatialIndex = null;

  for (const node of network.nodes) adjacency.set(node.id, []);
  for (const edge of network.edges) {
    adjacency.get(edge.from).push({nodeId: edge.to, edgeId: edge.id, miles: edge.miles});
    adjacency.get(edge.to).push({nodeId: edge.from, edgeId: edge.id, miles: edge.miles});
  }

  return {
    nodeById,
    edgeById,
    adjacency,
    spatialIndex,
    get edgeSpatialIndex() {
      if (!edgeSpatialIndex) edgeSpatialIndex = buildEdgeSpatialIndex(network.edges);
      return edgeSpatialIndex;
    }
  };
}

export function routeOnFreeways(fromWp, toWp, network, graph, stateFeatures) {
  const directMiles = haversineDistance([fromWp.lon, fromWp.lat], [toWp.lon, toWp.lat]);
  if (fromWp.abbr === toWp.abbr && directMiles <= SAME_STATE_DIRECT_MILES) {
    return {...buildDirectLeg(fromWp, toWp, stateFeatures), edgeIds: []};
  }

  const route = findFreewayRoute(fromWp, toWp, graph);
  if (route.nodePath.length >= 2) {
    const coords = buildPathCoords(fromWp, toWp, route, graph);
    return {...buildLegFromCoords(dedupeCoords(coords), stateFeatures), edgeIds: route.edgeIds};
  }

  const coords = [[fromWp.lon, fromWp.lat], [toWp.lon, toWp.lat]];
  return {...buildLegFromCoords(coords, stateFeatures), edgeIds: []};
}

function findFreewayRoute(fromWp, toWp, graph) {
  const startSnap = snapToNetwork(fromWp.lon, fromWp.lat, graph);
  const endSnap = snapToNetwork(toWp.lon, toWp.lat, graph);

  let best = tryRouteBetween(startSnap, endSnap, graph);

  if (best.nodePath.length < 2) {
    const startCandidates = nearestNodes(fromWp.lon, fromWp.lat, graph.spatialIndex, MAX_SNAP_MILES).slice(0, 12);
    const endCandidates = nearestNodes(toWp.lon, toWp.lat, graph.spatialIndex, MAX_SNAP_MILES).slice(0, 12);
    for (const start of startCandidates) {
      for (const end of endCandidates) {
        const attempt = tryRouteBetween(
          {nodeId: start.id, connector: [start.lon, start.lat]},
          {nodeId: end.id, connector: [end.lon, end.lat]},
          graph
        );
        if (attempt.nodePath.length >= 2 && attempt.distance < best.distance) best = attempt;
      }
    }
  }

  if (best.nodePath.length < 2) {
    const start = nearestNode(fromWp.lon, fromWp.lat, graph.spatialIndex, FALLBACK_SNAP_MILES);
    const end = nearestNode(toWp.lon, toWp.lat, graph.spatialIndex, FALLBACK_SNAP_MILES);
    if (start && end) {
      const attempt = tryRouteBetween(
        {nodeId: start.id, connector: [start.lon, start.lat]},
        {nodeId: end.id, connector: [end.lon, end.lat]},
        graph
      );
      if (attempt.nodePath.length >= 2) best = attempt;
    }
  }

  return best;
}

function tryRouteBetween(startSnap, endSnap, graph) {
  if (!startSnap?.nodeId || !endSnap?.nodeId) {
    return {nodePath: [], edgeIds: [], distance: Infinity, startSnap, endSnap};
  }

  const nodePath = shortestNetworkPath(startSnap.nodeId, endSnap.nodeId, graph);
  if (nodePath.length < 2) {
    return {nodePath: [], edgeIds: [], distance: Infinity, startSnap, endSnap};
  }

  const edgeIds = [];
  let distance = 0;
  for (let i = 0; i < nodePath.length - 1; i += 1) {
    const edge = findEdgeBetween(nodePath[i], nodePath[i + 1], graph.edgeById);
    if (!edge) continue;
    edgeIds.push(edge.id);
    distance += edge.miles;
  }

  return {nodePath, edgeIds, distance, startSnap, endSnap};
}

function buildPathCoords(fromWp, toWp, route, graph) {
  const coords = [];

  if (route.startSnap?.connector) {
    coords.push([fromWp.lon, fromWp.lat]);
    coords.push(route.startSnap.connector);
  } else {
    coords.push([fromWp.lon, fromWp.lat]);
  }

  for (let i = 0; i < route.nodePath.length - 1; i += 1) {
    const edge = findEdgeBetween(route.nodePath[i], route.nodePath[i + 1], graph.edgeById);
    if (!edge?.coords?.length) continue;
    appendEdgeGeometry(coords, edge, route.nodePath[i], graph);
  }

  if (route.endSnap?.connector) {
    coords.push(route.endSnap.connector);
    coords.push([toWp.lon, toWp.lat]);
  } else {
    const last = coords.at(-1);
    const atEnd =
      last &&
      haversineDistance(last, [toWp.lon, toWp.lat]) <= 0.15;
    if (!atEnd) coords.push([toWp.lon, toWp.lat]);
  }

  return dedupeCoords(coords);
}

function appendEdgeGeometry(coords, edge, fromNodeId, graph) {
  let segment = edge.from === fromNodeId ? edge.coords : [...edge.coords].reverse();
  if (segment.length < 2) return;

  const fromNode = graph.nodeById.get(edge.from);
  const toNode = graph.nodeById.get(edge.to);
  if (fromNode && toNode) {
    const nodeSpan = haversineDistance([fromNode.lon, fromNode.lat], [toNode.lon, toNode.lat]);
    const path = pathLengthCoords(segment);
    if (nodeSpan > 20 && path < nodeSpan * 0.25) return;
  }

  const last = coords.at(-1);
  const distToStart = haversineDistance(last, segment[0]);
  const distToEnd = haversineDistance(last, segment.at(-1));
  if (distToEnd < distToStart) segment = [...segment].reverse();

  const gap = haversineDistance(last, segment[0]);
  coords.push(...segment.slice(gap > 0.15 ? 1 : 0));
}

function pathLengthCoords(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) total += haversineDistance(coords[i - 1], coords[i]);
  return total;
}

export function buildDirectLeg(fromWp, toWp, stateFeatures) {
  const coords = [[fromWp.lon, fromWp.lat], [toWp.lon, toWp.lat]];
  return buildLegFromCoords(coords, stateFeatures);
}

export function buildLegFromCoords(coords, stateFeatures) {
  if (coords.length < 2) {
    return {coords: [], routeSegments: [], routeUnits: [], routeStates: []};
  }

  const routeSegments = [];
  const routeUnits = [];
  const routeStates = [];
  let cursor = 0;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const fromCoord = coords[i];
    const toCoord = coords[i + 1];
    const distanceMiles = haversineDistance(fromCoord, toCoord);
    if (distanceMiles <= 0) continue;

    const fromState = stateAt(fromCoord, stateFeatures);
    const toState = stateAt(toCoord, stateFeatures);
    const fromAbbr = fromState?.properties?.abbr || "US";
    const toAbbr = toState?.properties?.abbr || fromAbbr;

    routeSegments.push({
      fromAbbr,
      toAbbr,
      fromCoord,
      toCoord,
      distanceMiles,
      startMiles: cursor,
      endMiles: cursor + distanceMiles
    });

    if (distanceMiles <= 0.01 || fromAbbr === toAbbr) {
      routeUnits.push(createStateUnit(fromAbbr, fromState, cursor, cursor + distanceMiles));
    } else {
      const half = distanceMiles / 2;
      routeUnits.push(createStateUnit(fromAbbr, fromState, cursor, cursor + half));
      routeUnits.push(createStateUnit(toAbbr, toState, cursor + half, cursor + distanceMiles));
    }

    for (const abbr of [fromAbbr, toAbbr]) {
      if (abbr && !routeStates.includes(abbr)) routeStates.push(abbr);
    }
    cursor += distanceMiles;
  }

  return {coords, routeSegments, routeUnits, routeStates};
}

export function mergeRouteLegs(legs) {
  const routeSegments = [];
  const routeUnits = [];
  const routeStates = [];
  const displayPoints = [];
  const activeEdgeIds = [];
  let cursor = 0;

  legs.forEach((leg) => {
    if (!leg.coords.length) return;

    if (displayPoints.length === 0) displayPoints.push(...leg.coords);
    else displayPoints.push(...leg.coords.slice(1));

    leg.edgeIds?.forEach((id) => {
      if (!activeEdgeIds.includes(id)) activeEdgeIds.push(id);
    });

    leg.routeSegments.forEach((segment) => {
      routeSegments.push({
        ...segment,
        startMiles: cursor + segment.startMiles,
        endMiles: cursor + segment.endMiles
      });
    });

    leg.routeUnits.forEach((unit) => {
      routeUnits.push({
        ...unit,
        startMiles: cursor + unit.startMiles,
        endMiles: cursor + unit.endMiles
      });
    });

    leg.routeStates.forEach((abbr) => {
      if (!routeStates.includes(abbr)) routeStates.push(abbr);
    });

    const legDistance = leg.routeSegments.length ? leg.routeSegments.at(-1).endMiles : 0;
    cursor += legDistance;
  });

  return {routeSegments, routeUnits, routeStates, displayPoints, activeEdgeIds};
}

function shortestNetworkPath(startId, endId, graph) {
  if (!startId || !endId) return [];
  if (startId === endId) return [startId];

  const dist = new Map([[startId, 0]]);
  const prev = new Map();
  const visited = new Set();
  const heap = new MinHeap();
  heap.push(0, startId);

  while (heap.length) {
    const {cost: currentCost, value: nodeId} = heap.pop();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    if (nodeId === endId) break;

    for (const edge of graph.adjacency.get(nodeId) || []) {
      if (visited.has(edge.nodeId)) continue;
      const alt = currentCost + edge.miles;
      if (alt < (dist.get(edge.nodeId) ?? Infinity)) {
        dist.set(edge.nodeId, alt);
        prev.set(edge.nodeId, {nodeId, edgeId: edge.edgeId});
        heap.push(alt, edge.nodeId);
      }
    }
  }

  if (!prev.has(endId) && startId !== endId) return [];

  const path = [endId];
  let current = endId;
  while (prev.has(current)) {
    current = prev.get(current).nodeId;
    path.unshift(current);
  }
  return path;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get length() {
    return this.items.length;
  }

  push(cost, value) {
    const item = {cost, value};
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 1) return this.items.pop();
    const top = this.items[0];
    this.items[0] = this.items.pop();
    this.bubbleDown(0);
    return top;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].cost <= this.items[index].cost) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  bubbleDown(index) {
    const length = this.items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.items[left].cost < this.items[smallest].cost) smallest = left;
      if (right < length && this.items[right].cost < this.items[smallest].cost) smallest = right;
      if (smallest === index) break;
      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }
}

function snapToNetwork(lon, lat, graph) {
  let best = {distance: Infinity, nodeId: null, connector: null};
  const {grid, cellSize} = graph.edgeSpatialIndex;
  const cx = Math.floor(lon / cellSize);
  const cy = Math.floor(lat / cellSize);

  for (let radius = 0; radius <= 16; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        for (const edge of grid.get(`${cx + dx},${cy + dy}`) || []) {
          for (let i = 0; i < edge.coords.length - 1; i += 1) {
            const proj = projectOnSegment([lon, lat], edge.coords[i], edge.coords[i + 1]);
            const miles = haversineDistance([lon, lat], proj);
            if (miles >= best.distance) continue;

            const fromNode = graph.nodeById.get(edge.from);
            const toNode = graph.nodeById.get(edge.to);
            const nodeId =
              haversineDistance(proj, [fromNode.lon, fromNode.lat]) <
              haversineDistance(proj, [toNode.lon, toNode.lat])
                ? edge.from
                : edge.to;

            best = {
              distance: miles,
              nodeId,
              connector: miles > 0.15 ? proj : null
            };
          }
        }
      }
    }
    if (best.nodeId && best.distance <= MAX_SNAP_MILES) break;
  }

  for (const node of nearestNodes(lon, lat, graph.spatialIndex, MAX_SNAP_MILES)) {
    const miles = haversineDistance([lon, lat], [node.lon, node.lat]);
    if (miles < best.distance) {
      best = {
        distance: miles,
        nodeId: node.id,
        connector: miles > 0.15 ? [node.lon, node.lat] : null
      };
    }
  }

  if (!best.nodeId || best.distance > MAX_SNAP_MILES) {
    return {nodeId: null, connector: null, distance: Infinity};
  }
  return best;
}

function buildEdgeSpatialIndex(edges, cellSize = 0.5) {
  const grid = new Map();
  for (const edge of edges) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of edge.coords) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    const x0 = Math.floor(minLon / cellSize);
    const x1 = Math.floor(maxLon / cellSize);
    const y0 = Math.floor(minLat / cellSize);
    const y1 = Math.floor(maxLat / cellSize);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = `${x},${y}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(edge);
      }
    }
  }
  return {grid, cellSize};
}

function buildSpatialIndex(nodes, cellSize = 0.35) {
  const grid = new Map();
  for (const node of nodes) {
    const key = cellKey(node.lon, node.lat, cellSize);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(node);
  }
  return {grid, cellSize};
}

function nearestNodes(lon, lat, index, maxMiles) {
  const {grid, cellSize} = index;
  const cx = Math.floor(lon / cellSize);
  const cy = Math.floor(lat / cellSize);
  const results = [];
  let radius = 0;

  while (radius <= 14) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        for (const node of grid.get(`${cx + dx},${cy + dy}`) || []) {
          const miles = haversineDistance([lon, lat], [node.lon, node.lat]);
          if (miles <= maxMiles) results.push({...node, snapMiles: miles});
        }
      }
    }
    if (results.length >= 8) break;
    radius += 1;
  }

  return results.sort((a, b) => a.snapMiles - b.snapMiles);
}

function nearestNode(lon, lat, index, maxMiles) {
  return nearestNodes(lon, lat, index, maxMiles)[0] || null;
}

function cellKey(lon, lat, cellSize) {
  return `${Math.floor(lon / cellSize)},${Math.floor(lat / cellSize)}`;
}

function projectOnSegment(point, start, end) {
  const [px, py] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return start;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  return [x1 + t * dx, y1 + t * dy];
}

function findEdgeBetween(a, b, edgeById) {
  for (const edge of edgeById.values()) {
    if ((edge.from === a && edge.to === b) || (edge.from === b && edge.to === a)) return edge;
  }
  return null;
}

function stateAt(coord, stateFeatures) {
  return stateFeatures.find((feature) => d3.geoContains(feature, coord)) || null;
}

function createStateUnit(abbr, feature, startMiles, endMiles) {
  return {
    stateAbbr: abbr,
    stateName: feature?.properties?.name || abbr,
    startMiles,
    endMiles,
    miles: endMiles - startMiles
  };
}

function dedupeCoords(coords) {
  const out = [];
  coords.forEach((coord) => {
    const prev = out.at(-1);
    if (!prev || haversineDistance(prev, coord) > 0.03) out.push(coord);
  });
  return out;
}

export function haversineDistance(coordA, coordB) {
  const [lon1, lat1] = coordA.map(toRadians);
  const [lon2, lat2] = coordB.map(toRadians);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
