import {filterCities, resolveCityQuery} from "./CitySearch.js";

export function initTripControls(container, handlers) {
  container.replaceChildren();

  const row1 = document.createElement("div");
  row1.className = "control-row";

  const mpgField = labeledInput({
    id: "mpg",
    label: "MPG",
    className: "field-mpg",
    value: 30,
    type: "number",
    min: "5",
    max: "120",
    step: "1",
    onInput: (value) => {
      if (value === "") return;
      const num = Number(value);
      if (!Number.isFinite(num)) return;
      handlers.onChange({mpg: num}, {controls: false, route: false});
    },
    onCommit: (value) => {
      const num = clamp(Number(value) || 30, 5, 120);
      handlers.onChange({mpg: num}, {controls: false, route: true});
    }
  });

  const searchField = createCitySearchField(handlers);
  row1.append(mpgField.wrapper, searchField.wrapper);

  const hint = document.createElement("p");
  hint.className = "click-hint";

  const waypointList = document.createElement("div");
  waypointList.className = "waypoint-list";

  const row2 = document.createElement("div");
  row2.className = "control-row control-actions";

  const driveButton = document.createElement("button");
  driveButton.type = "button";
  driveButton.className = "primary-btn";
  driveButton.textContent = "Drive";
  driveButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (driveButton.dataset.driving === "true") handlers.onSkipAnimation();
    else handlers.onDrive();
  });

  const pauseButton = document.createElement("button");
  pauseButton.type = "button";
  pauseButton.className = "secondary-btn";
  pauseButton.textContent = "Pause";
  pauseButton.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onPause();
  });

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "secondary-btn";
  resetButton.textContent = "Reset trip";
  resetButton.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onReset();
  });

  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.className = "secondary-btn";
  undoButton.textContent = "Undo stop";
  undoButton.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onUndo();
  });

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "secondary-btn";
  clearButton.textContent = "Clear route";
  clearButton.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onClearRoute();
  });

  row2.append(driveButton, pauseButton, resetButton, undoButton, clearButton);
  container.append(row1, hint, waypointList, row2);

  return {
    mpgInput: mpgField.input,
    cityInput: searchField.input,
    cityList: searchField.list,
    hint,
    waypointList,
    driveButton,
    pauseButton,
    resetButton,
    undoButton,
    clearButton
  };
}

export function updateTripControls(nodes, {appState, cities}) {
  if (!nodes) return;

  if (document.activeElement !== nodes.mpgInput) {
    nodes.mpgInput.value = String(appState.mpg);
  }

  const placeholder =
    appState.waypoints.length === 0 ? "Add a starting location" : "Add next stop";
  nodes.cityInput.placeholder = placeholder;
  nodes.cityInput.disabled = appState.isDriving;
  nodes.cityInput.setAttribute("aria-label", placeholder);

  nodes.hint.textContent =
    appState.waypoints.length === 0
      ? "Search for a city or click the map to set your start point."
      : `${appState.waypoints.length} stop${appState.waypoints.length === 1 ? "" : "s"} selected. Search or click the map to add another.`;

  nodes.waypointList.replaceChildren();
  appState.waypoints.forEach((wp, index) => {
    const chip = document.createElement("span");
    chip.className = "waypoint-chip";
    const label = wp.label || wp.name || wp.abbr;
    chip.textContent = `${index + 1}. ${label}${index === 0 ? " (start)" : ""}`;
    nodes.waypointList.append(chip);
  });

  nodes.driveButton.textContent = appState.isDriving ? "Skip animation" : "Drive";
  nodes.driveButton.dataset.driving = appState.isDriving ? "true" : "false";
  nodes.driveButton.disabled = !appState.isDriving && appState.waypoints.length < 2;
  nodes.driveButton.setAttribute("aria-label", appState.isDriving ? "Skip to end of trip" : "Drive route");
  nodes.pauseButton.disabled = !appState.isDriving;
  nodes.undoButton.disabled = appState.waypoints.length === 0 || appState.isDriving;
  nodes.clearButton.disabled = appState.waypoints.length === 0 || appState.isDriving;

  syncCityOptions(nodes.cityList, cities, nodes.cityInput.value);
}

export function renderTripControls(container, options) {
  if (!container._tripControlNodes) {
    container._tripControlNodes = initTripControls(container, {
      cities: options.cities,
      onChange: options.onChange,
      onRevealCity: options.onRevealCity,
      onDrive: options.onDrive,
      onSkipAnimation: options.onSkipAnimation,
      onPause: options.onPause,
      onReset: options.onReset,
      onUndo: options.onUndo,
      onClearRoute: options.onClearRoute
    });
  }
  updateTripControls(container._tripControlNodes, options);
}

function createCitySearchField(handlers) {
  const wrapper = document.createElement("div");
  wrapper.className = "field field-city-search";

  const label = document.createElement("span");
  label.textContent = "City";
  label.htmlFor = "city-search";

  const input = document.createElement("input");
  input.id = "city-search";
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "Add a starting location";

  const list = document.createElement("datalist");
  list.id = "city-search-options";

  input.setAttribute("list", list.id);

  const submitCity = () => {
    const city = resolveCityQuery(handlers.cities, input.value);
    if (!city) return;
    handlers.onRevealCity(city);
    input.value = "";
    syncCityOptions(list, handlers.cities, "");
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitCity();
    }
  });

  input.addEventListener("change", submitCity);
  input.addEventListener("input", () => {
    syncCityOptions(list, handlers.cities, input.value);
  });

  wrapper.append(label, input, list);
  return {wrapper, input, list};
}

function syncCityOptions(list, cities, query) {
  list.replaceChildren();
  filterCities(cities, query, 12).forEach((city) => {
    const option = document.createElement("option");
    option.value = city.displayName;
    list.append(option);
  });
}

function labeledInput({id, label, className, value, onInput, onCommit, type = "text", min, max, step}) {
  const wrapper = document.createElement("label");
  wrapper.className = className ? `field ${className}` : "field";
  wrapper.htmlFor = id;

  const span = document.createElement("span");
  span.textContent = label;

  const input = document.createElement("input");
  input.id = id;
  input.type = type;
  input.inputMode = type === "number" ? "numeric" : undefined;
  input.value = String(value);
  if (min) input.min = min;
  if (max) input.max = max;
  if (step) input.step = step;
  input.addEventListener("input", (event) => onInput(event.currentTarget.value));
  if (onCommit) {
    input.addEventListener("change", (event) => onCommit(event.currentTarget.value));
  }

  wrapper.append(span, input);
  return {wrapper, input};
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
