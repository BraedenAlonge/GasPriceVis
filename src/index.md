---
title: Drive the Cost Across America
toc: false
---

<link rel="stylesheet" href="./styles.css">

<section class="hero">
  <p class="eyebrow">CSC 477 Interactive Visualization with D3</p>
  <h1>Drive the Cost Across America</h1>
  <p>Explore how route choice, state gas prices, and vehicle MPG shape the cost and tailpipe CO2 emissions of a road trip.</p>
  <a class="repo-link" href="https://github.com/BraedenAlonge/GasPriceVis">Public GitHub repository</a>
  ·
  <a class="repo-link" href="https://braedenalonge.github.io/GasPriceVis/">Live demo</a>
</section>

```js
import {DriveMap} from "./components/DriveMap.js";
```

```js
const [gasPrices, centroids, geoData, cities] = await Promise.all([
  FileAttachment("./data/state-gas-prices.csv").csv({typed: true}),
  FileAttachment("./data/state-centroids.csv").csv({typed: true}),
  FileAttachment("./data/us-states.geojson").json(),
  FileAttachment("./data/us-cities.csv").csv({typed: true})
]);
```

```js
const map = DriveMap({gasPrices, centroids, cities, geoData});
display(map);
void Promise.all([
  FileAttachment("./data/interstate-network.json").json(),
  FileAttachment("./data/interstate-lines.geojson").json()
]).then(([network, roadLines]) => {
  map.setRoadLines(roadLines);
  map.setNetworkData(network);
});
```

<section class="writeup">
<div class="writeup-card">

## Design Rationale

### Why a Map

A road trip crosses states, and state gas prices vary geographically. A map makes the route, state boundaries, and regional price differences visible at the same time.

### How routes are chosen

Between each pair of stops, the app builds a path in this order:

1. **Highway network (preferred).** After `interstate-network.json` loads, each stop is snapped to the nearest node on a preprocessed graph of U.S. interstates and U.S. routes from the [National Transportation Atlas Database (NTAD) National Highway System](https://www.bts.gov/ntad). **Dijkstra’s algorithm** finds the shortest path by road miles along that graph. The drawn route and mileage follow the geometry of those segments.
2. **Short same-state trips.** If two stops are in the same state and within about 35 miles, the leg is a straight line instead of forcing a highway detour. Note that this graphic is designed more intentionally for state-to-state travel rather than many same-state stops.
3. **Fallback before the network loads.** Until the graph is ready, legs are straight lines between stops. If snapping or routing fails, the app falls back to a straight line for that leg.

Each piece of the path is assigned to the state it passes through (using state polygons), so cost and “current state” can change as the car moves—even when a leg crosses borders. This is an approximate model for comparison, not turn-by-turn navigation.

### Gas prices

State fill colors, per-state cost breakdown, and running trip cost all use state-level regular gasoline averages from [AAA Fuel Prices](https://gasprices.aaa.com/) ([state averages](https://gasprices.aaa.com/state-gas-price-averages/)). The values in `state-gas-prices.csv` are a **snapshot dated May 27, 2026**. They do not update live in the app; your MPG and route shape the gallons used, and each state’s snapshot price is applied to the miles driven there.

### D3 Interaction and Animation

D3 draws the state map, encodes gas price with fill color, projects the routed path, animates the car, and renders the cost-by-state bar chart. Users click the map to add stops, adjust MPG, and run the trip animation.

### Calculations

For each traveled state segment, `gallonsUsed = milesDriven / MPG`, `cost = gallonsUsed × currentStateGasPrice`, and `CO2 = gallonsUsed × 8.887 kg`. CO2 emissions are estimated using 8.887 kg CO2 per gallon of gasoline burned.

### Limitations and Accessibility

Routing follows major interstates and U.S. routes in the NTAD extract only, state-level average gas prices hide local variation, MPG varies by vehicle and driving conditions, and emissions include only gasoline tailpipe CO2. The interface provides labeled form controls, real buttons, text summaries, and reduced-motion behavior that completes the trip instantly instead of animating.

## Data

Local files loaded by the visualization (`src/data/`):

| File | Role | Source |
|------|------|--------|
| `state-gas-prices.csv` | Regular gasoline price ($/gal) by state; choropleth fill and cost math | [AAA state gas price averages](https://gasprices.aaa.com/state-gas-price-averages/) — **May 27, 2026** snapshot |
| `us-states.geojson` | Lower 48 + DC state boundaries for the map and click-to-add stops | [U.S. Census cartographic boundaries](https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html) via [topojson/us-atlas](https://github.com/topojson/us-atlas) |
| `state-centroids.csv` | State names and coordinates for the stats panel (“current state”) | Geographic centroids derived from the same state polygons as `us-states.geojson` ([us-atlas](https://github.com/topojson/us-atlas)) |
| `us-cities.csv` | City search, map labels, and stop coordinates | Project-maintained list of major cities; coordinates aligned with [GeoNames](https://www.geonames.org/) and [U.S. Census place gazetteers](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) |
| `interstate-network.json` | Routable graph (nodes, edges, mileages) for Dijkstra routing | [NTAD National Highway System](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Highway_System/FeatureServer/0) ([NTAD](https://www.bts.gov/ntad)), preprocessed in-repo |
| `interstate-lines.geojson` | Faint road lines drawn under the map | [NTAD National Highway System](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Highway_System/FeatureServer/0) ([NTAD](https://www.bts.gov/ntad)), simplified for display |

</div>
</section>
