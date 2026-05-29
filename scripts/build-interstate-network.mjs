import {writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nodes = [
  {id: "sea", name: "Seattle", lon: -122.33, lat: 47.61, state: "WA"},
  {id: "por", name: "Portland", lon: -122.68, lat: 45.52, state: "OR"},
  {id: "sac", name: "Sacramento", lon: -121.49, lat: 38.58, state: "CA"},
  {id: "sf", name: "San Francisco", lon: -122.42, lat: 37.77, state: "CA"},
  {id: "la", name: "Los Angeles", lon: -118.24, lat: 34.05, state: "CA"},
  {id: "sd", name: "San Diego", lon: -117.16, lat: 32.72, state: "CA"},
  {id: "phx", name: "Phoenix", lon: -112.07, lat: 33.45, state: "AZ"},
  {id: "tuc", name: "Tucson", lon: -110.97, lat: 32.22, state: "AZ"},
  {id: "lv", name: "Las Vegas", lon: -115.14, lat: 36.17, state: "NV"},
  {id: "slc", name: "Salt Lake City", lon: -111.89, lat: 40.76, state: "UT"},
  {id: "den", name: "Denver", lon: -104.99, lat: 39.74, state: "CO"},
  {id: "abq", name: "Albuquerque", lon: -106.65, lat: 35.08, state: "NM"},
  {id: "elpaso", name: "El Paso", lon: -106.49, lat: 31.76, state: "TX"},
  {id: "dallas", name: "Dallas", lon: -96.8, lat: 32.78, state: "TX"},
  {id: "hou", name: "Houston", lon: -95.37, lat: 29.76, state: "TX"},
  {id: "sa", name: "San Antonio", lon: -98.49, lat: 29.42, state: "TX"},
  {id: "okc", name: "Oklahoma City", lon: -97.52, lat: 35.47, state: "OK"},
  {id: "kc", name: "Kansas City", lon: -94.58, lat: 39.1, state: "MO"},
  {id: "omaha", name: "Omaha", lon: -95.94, lat: 41.26, state: "NE"},
  {id: "min", name: "Minneapolis", lon: -93.27, lat: 44.98, state: "MN"},
  {id: "chi", name: "Chicago", lon: -87.63, lat: 41.88, state: "IL"},
  {id: "stl", name: "St. Louis", lon: -90.2, lat: 38.63, state: "MO"},
  {id: "mem", name: "Memphis", lon: -90.05, lat: 35.15, state: "TN"},
  {id: "nash", name: "Nashville", lon: -86.78, lat: 36.17, state: "TN"},
  {id: "atl", name: "Atlanta", lon: -84.39, lat: 33.75, state: "GA"},
  {id: "no", name: "New Orleans", lon: -90.07, lat: 29.95, state: "LA"},
  {id: "jax", name: "Jacksonville", lon: -81.66, lat: 30.33, state: "FL"},
  {id: "mia", name: "Miami", lon: -80.19, lat: 25.76, state: "FL"},
  {id: "det", name: "Detroit", lon: -83.05, lat: 42.33, state: "MI"},
  {id: "cle", name: "Cleveland", lon: -81.69, lat: 41.5, state: "OH"},
  {id: "pit", name: "Pittsburgh", lon: -79.99, lat: 40.44, state: "PA"},
  {id: "nyc", name: "New York", lon: -74.01, lat: 40.71, state: "NY"},
  {id: "phi", name: "Philadelphia", lon: -75.17, lat: 39.95, state: "PA"},
  {id: "bal", name: "Baltimore", lon: -76.61, lat: 39.29, state: "MD"},
  {id: "dc", name: "Washington DC", lon: -77.04, lat: 38.91, state: "DC"},
  {id: "rich", name: "Richmond", lon: -77.44, lat: 37.54, state: "VA"},
  {id: "clt", name: "Charlotte", lon: -80.84, lat: 35.23, state: "NC"},
  {id: "bos", name: "Boston", lon: -71.06, lat: 42.36, state: "MA"},
  {id: "buf", name: "Buffalo", lon: -78.88, lat: 42.89, state: "NY"},
  {id: "ind", name: "Indianapolis", lon: -86.16, lat: 39.77, state: "IN"},
  {id: "cinc", name: "Cincinnati", lon: -84.51, lat: 39.1, state: "OH"},
  {id: "lou", name: "Louisville", lon: -85.76, lat: 38.25, state: "KY"},
  {id: "bham", name: "Birmingham", lon: -86.8, lat: 33.52, state: "AL"},
  {id: "rno", name: "Reno", lon: -119.81, lat: 39.53, state: "NV"},
  {id: "boise", name: "Boise", lon: -116.21, lat: 43.62, state: "ID"},
  {id: "bill", name: "Billings", lon: -108.5, lat: 45.78, state: "MT"},
  {id: "chey", name: "Cheyenne", lon: -104.82, lat: 41.14, state: "WY"},
  {id: "amar", name: "Amarillo", lon: -101.83, lat: 35.2, state: "TX"},
  {id: "lbb", name: "Lubbock", lon: -101.86, lat: 33.58, state: "TX"}
];

const nodeById = new Map(nodes.map((n) => [n.id, n]));

const edgeDefs = [
  ["I-5", "sea", "por"],
  ["I-5", "por", "sac"],
  ["I-5", "sac", "sf"],
  ["I-5", "sf", "la"],
  ["I-5", "la", "sd"],
  ["I-15", "sd", "la"],
  ["I-15", "la", "lv"],
  ["I-15", "lv", "slc"],
  ["I-80", "slc", "rno"],
  ["I-80", "rno", "sf"],
  ["I-80", "sf", "sac"],
  ["I-80", "sac", "rno"],
  ["I-80", "rno", "chey"],
  ["I-80", "chey", "omaha"],
  ["I-80", "omaha", "chi"],
  ["I-80", "chi", "cle"],
  ["I-80", "cle", "pit"],
  ["I-80", "pit", "nyc"],
  ["I-10", "la", "phx"],
  ["I-10", "phx", "tuc"],
  ["I-10", "tuc", "elpaso"],
  ["I-10", "elpaso", "sa"],
  ["I-10", "sa", "hou"],
  ["I-10", "hou", "no"],
  ["I-10", "no", "jax"],
  ["I-10", "jax", "mia"],
  ["I-40", "la", "phx"],
  ["I-40", "phx", "abq"],
  ["I-40", "abq", "amar"],
  ["I-40", "amar", "okc"],
  ["I-40", "okc", "mem"],
  ["I-40", "mem", "nash"],
  ["I-40", "nash", "clt"],
  ["I-40", "clt", "rich"],
  ["I-40", "rich", "dc"],
  ["I-25", "elpaso", "abq"],
  ["I-25", "abq", "den"],
  ["I-25", "den", "chey"],
  ["I-35", "dallas", "okc"],
  ["I-35", "okc", "kc"],
  ["I-35", "kc", "min"],
  ["I-35", "dallas", "sa"],
  ["I-35", "sa", "hou"],
  ["I-70", "den", "kc"],
  ["I-70", "kc", "stl"],
  ["I-70", "stl", "ind"],
  ["I-70", "ind", "pit"],
  ["I-70", "pit", "bal"],
  ["I-75", "det", "cinc"],
  ["I-75", "cinc", "atl"],
  ["I-75", "atl", "jax"],
  ["I-75", "atl", "mia"],
  ["I-95", "bos", "nyc"],
  ["I-95", "nyc", "phi"],
  ["I-95", "phi", "bal"],
  ["I-95", "bal", "dc"],
  ["I-95", "dc", "rich"],
  ["I-95", "rich", "clt"],
  ["I-95", "clt", "jax"],
  ["I-95", "jax", "mia"],
  ["I-90", "bos", "buf"],
  ["I-90", "buf", "cle"],
  ["I-90", "cle", "chi"],
  ["I-90", "chi", "min"],
  ["I-90", "min", "bill"],
  ["I-90", "bill", "sea"],
  ["I-55", "chi", "stl"],
  ["I-55", "stl", "mem"],
  ["I-55", "mem", "no"],
  ["I-65", "chi", "ind"],
  ["I-65", "ind", "lou"],
  ["I-65", "lou", "nash"],
  ["I-65", "nash", "bham"],
  ["I-20", "dallas", "bham"],
  ["I-20", "bham", "atl"],
  ["I-84", "por", "boise"],
  ["I-84", "boise", "slc"],
  ["I-84", "slc", "den"],
  ["I-27", "lbb", "amar"],
  ["I-27", "amar", "okc"]
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildCoords(fromId, toId) {
  const a = nodeById.get(fromId);
  const b = nodeById.get(toId);
  const steps = 6;
  const coords = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    coords.push([lerp(a.lon, b.lon, t), lerp(a.lat, b.lat, t)]);
  }
  return coords;
}

function haversine(a, b) {
  const r = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const edges = edgeDefs.map(([highway, from, to], index) => {
  const coords = buildCoords(from, to);
  let miles = 0;
  for (let i = 0; i < coords.length - 1; i += 1) miles += haversine(coords[i], coords[i + 1]);
  return {id: `e${index}`, highway, from, to, coords, miles: Math.round(miles * 10) / 10};
});

const output = {nodes, edges};
writeFileSync(join(__dirname, "../src/data/interstate-network.json"), JSON.stringify(output, null, 2));
console.log(`Wrote ${nodes.length} nodes and ${edges.length} edges`);
