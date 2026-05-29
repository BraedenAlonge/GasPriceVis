const currencyFormatter = new Intl.NumberFormat("en-US", {

  style: "currency",

  currency: "USD",

  maximumFractionDigits: 2

});



const numberFormatter = new Intl.NumberFormat("en-US", {

  maximumFractionDigits: 1

});



export function initStatsPanel(container) {

  container.replaceChildren();

  container.classList.add("stats-panel-root");



  const chipRow = document.createElement("div");

  chipRow.className = "stats-chip-row";



  const labels = ["Route", "State", "Gas price", "Miles", "Gallons", "Cost", "CO₂"];

  const values = labels.map((label) => {

    const chip = document.createElement("div");

    chip.className = "stat-chip";

    const valueNode = document.createElement("strong");

    valueNode.className = "chip-value";

    chip.innerHTML = `<span class="chip-label">${label}</span>`;

    chip.append(valueNode);

    chipRow.append(chip);

    return valueNode;

  });



  const live = document.createElement("p");

  live.className = "sr-only";

  live.setAttribute("aria-live", "polite");



  container.append(chipRow, live);

  return {values, live};

}



export function updateStatsPanel(nodes, {appState, totals, currentState, routeStates, totalDistance}) {

  if (!nodes) return;



  const routeText = routeStates.length ? routeStates.join(" → ") : "No route";

  const finished = appState.progressMiles >= totalDistance && totalDistance > 0;



  const nextValues = [

    routeText,

    currentState ? currentState.abbr : "—",

    currentState ? `${formatCurrency(currentState.gasPrice)}/gal` : "—",

    `${formatMiles(totals.miles)} / ${formatMiles(totalDistance)}`,

    formatNumber(totals.gallons),

    formatCurrency(totals.cost),

    `${formatNumber(totals.co2Kg)} kg`

  ];



  nodes.values.forEach((node, index) => {

    node.textContent = nextValues[index];

  });



  nodes.live.textContent = finished

    ? `Trip complete: ${formatCurrency(totals.cost)}, ${formatNumber(totals.co2Kg)} kg CO2.`

    : `Driving ${routeText}. ${formatMiles(totals.miles)} miles so far.`;

}



/** @deprecated Use initStatsPanel + updateStatsPanel */

export function renderStatsPanel(container, props) {

  const nodes = initStatsPanel(container);

  updateStatsPanel(nodes, props);

  return nodes;

}



export function formatCurrency(value) {

  return currencyFormatter.format(Number.isFinite(value) ? value : 0);

}



export function formatMiles(value) {

  return numberFormatter.format(Number.isFinite(value) ? value : 0);

}



export function formatNumber(value) {

  return numberFormatter.format(Number.isFinite(value) ? value : 0);

}

