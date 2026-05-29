export function normalizeCities(records = []) {
  return records
    .map((record) => ({
      city: String(record.city || "").trim(),
      state: String(record.state || "").trim(),
      stateAbbr: String(record.state_abbr || "").trim(),
      latitude: Number(record.latitude),
      longitude: Number(record.longitude),
      mapLabel: String(record.map_label || "").toLowerCase() === "true"
    }))
    .filter(
      (record) =>
        record.city &&
        record.stateAbbr &&
        Number.isFinite(record.latitude) &&
        Number.isFinite(record.longitude)
    )
    .map((record) => ({
      ...record,
      searchKey: `${record.city}, ${record.stateAbbr}`.toLowerCase(),
      displayName: `${record.city}, ${record.stateAbbr}`
    }));
}

export function filterCities(cities, query, limit = 8) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  return cities
    .filter(
      (city) =>
        city.searchKey.includes(trimmed) ||
        city.city.toLowerCase().startsWith(trimmed) ||
        city.state.toLowerCase().startsWith(trimmed)
    )
    .slice(0, limit);
}

export function resolveCityQuery(cities, query) {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const exact = cities.find((city) => city.searchKey === lower || city.displayName.toLowerCase() === lower);
  if (exact) return exact;

  const matches = filterCities(cities, trimmed, 1);
  return matches[0] || null;
}
