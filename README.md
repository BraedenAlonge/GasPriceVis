# Drive the Cost Across America

Observable Framework + D3 project for CSC 477 Interactive Visualization with D3.

**Assignment design write-up (rationale + references):** see [DESIGN_WRITEUP.txt](./DESIGN_WRITEUP.txt) in the repository root.

This visualization lets users choose a start state, end state, optional stops, and vehicle MPG, then watch a car move across an approximate state-to-state route. As the car moves, the current state gas price changes and the app updates miles, gallons, cost, and estimated tailpipe CO2 emissions.

## Run Locally

```bash
npm install
npm run dev
```

Observable Framework prints a local preview URL.

## Build

```bash
npm run build
```

The static site is written to `dist/`.

## Data

- `src/data/state-gas-prices.csv`: AAA Fuel Prices regular gasoline snapshot from May 27, 2026.
- `src/data/state-centroids.csv`: state centroid coordinates used for approximate segment distances.
- `src/data/state-neighbors.json`: lower-48 plus DC adjacency graph for shortest-path routing.
- `src/data/us-states.geojson`: lower-48 plus DC state boundaries generated from the `us-atlas` TopoJSON package.

The route model is intentionally approximate. It is meant to support visual comparison, not exact road navigation.

## Methodology

For each state segment:

- `gallonsUsed = milesDriven / MPG`
- `cost = gallonsUsed * currentStateGasPrice`
- `co2Kg = gallonsUsed * 8.887`

CO2 emissions are estimated using 8.887 kg CO2 per gallon of gasoline burned.

## Deployment

1. Push the project to a public GitHub repository.
2. Confirm `npm run build` succeeds.
3. Deploy the generated `dist/` folder to GitHub Pages or another static host.
4. Update the public repository link in `src/index.md` if your GitHub URL differs from the placeholder.

## Project Structure

```text
src/
  components/
    DriveMap.js
    RouteBreakdown.js
    StatsPanel.js
    TripControls.js
  data/
    state-centroids.csv
    state-gas-prices.csv
    state-neighbors.json
    us-states.geojson
  index.md
  styles.css
```
