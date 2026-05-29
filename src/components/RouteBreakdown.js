import * as d3 from "d3";
import {formatCurrency} from "./StatsPanel.js";

export function renderRouteBreakdown(
  container,
  {breakdown, progressMiles = 0, routeUnits = [], mpg = 30, metric = "cost", totalDistance = 0, isDriving = false}
) {
  const width = 920;
  const rowHeight = 34;
  const margin = {top: 12, right: 122, bottom: 28, left: 118};
  const emptyHeight = 120;
  const hasStarted = isDriving || progressMiles > 0;

  let svg = d3.select(container).select("svg.breakdown-chart");
  if (svg.empty()) {
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgNode.classList.add("breakdown-chart");
    svgNode.setAttribute("role", "img");
    svgNode.setAttribute("aria-label", "Bar chart showing route cost by state");
    container.append(svgNode);
    svg = d3.select(svgNode);
  }

  if (!hasStarted || breakdown.length === 0) {
    svg.attr("viewBox", `0 0 ${width} ${emptyHeight}`);
    svg.selectAll("*").remove();
    svg
      .append("text")
      .attr("x", width / 2)
      .attr("y", emptyHeight / 2)
      .attr("text-anchor", "middle")
      .attr("class", "empty-chart")
      .text(
        breakdown.length === 0
          ? "Click the map to add stops, then press Drive."
          : "Press Drive to watch costs accumulate by state."
      );
    return;
  }

  const filledByState = computeFilledCosts(routeUnits, mpg, progressMiles);
  const rows = breakdown
    .map((item) => ({
      ...item,
      filledCost: filledByState.get(item.abbr)?.cost ?? 0,
      filledMiles: filledByState.get(item.abbr)?.miles ?? 0
    }))
    .filter((item) => item.filledCost > 0)
    .sort((a, b) => d3.descending(a.filledCost, b.filledCost));

  const height = Math.max(emptyHeight, margin.top + margin.bottom + rows.length * rowHeight);
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  if (rows.length === 0) {
    svg.selectAll("g.breakdown-row, g.chart-axis").remove();
    let emptyText = svg.select("text.empty-chart");
    if (emptyText.empty()) {
      emptyText = svg.append("text").attr("class", "empty-chart");
    }
    emptyText
      .attr("x", width / 2)
      .attr("y", emptyHeight / 2)
      .attr("text-anchor", "middle")
      .text("Costs will appear as the car enters each state.");
    return;
  }

  svg.select("text.empty-chart").remove();

  const maxFilled = d3.max(rows, (d) => d.filledCost) || 1;
  const maxFinal = d3.max(breakdown, (d) => d[metric]) || maxFilled;
  const x = d3
    .scaleLinear()
    .domain([0, Math.max(maxFilled, maxFinal * 0.05)])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3
    .scaleBand()
    .domain(rows.map((d) => d.abbr))
    .range([margin.top, height - margin.bottom])
    .padding(0.22);

  const row = svg.selectAll("g.breakdown-row").data(rows, (d) => d.abbr);
  row.exit().remove();

  const rowEnter = row.enter().append("g").attr("class", "breakdown-row");
  rowEnter.append("text").attr("class", "row-label");
  rowEnter.append("rect").attr("class", "bar-fill").attr("rx", 7);
  rowEnter.append("text").attr("class", "bar-value");

  const rowMerge = rowEnter.merge(row);

  rowMerge.select(".row-label")
    .attr("x", margin.left - 12)
    .attr("y", (d) => y(d.abbr) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .text((d) => `${d.abbr} ${d.name}`);

  rowMerge
    .select(".bar-fill")
    .attr("x", margin.left)
    .attr("y", (d) => y(d.abbr))
    .attr("height", y.bandwidth())
    .attr("width", (d) => Math.max(0, x(d.filledCost) - margin.left));

  rowMerge
    .select(".bar-value")
    .attr("x", (d) => Math.min(x(d.filledCost) + 8, width - 8))
    .attr("y", (d) => y(d.abbr) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .text((d) => formatCurrency(d.filledCost));

  let axis = svg.select("g.chart-axis");
  if (axis.empty()) axis = svg.append("g").attr("class", "chart-axis");
  axis.attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(5).tickFormat((d) => formatCurrency(d)));
}

function computeFilledCosts(routeUnits, mpg, progressMiles) {
  const effectiveMpg = clamp(Number(mpg) || 30, 5, 120);
  const filled = new Map();
  routeUnits.forEach((unit) => {
    const miles = Math.max(0, Math.min(progressMiles, unit.endMiles) - unit.startMiles);
    if (miles <= 0) return;
    const gallons = miles / effectiveMpg;
    const cost = gallons * unit.gasPrice;
    const current = filled.get(unit.stateAbbr) || {cost: 0, miles: 0};
    current.cost += cost;
    current.miles += miles;
    filled.set(unit.stateAbbr, current);
  });
  return filled;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
