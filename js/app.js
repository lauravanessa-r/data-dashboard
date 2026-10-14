/**
 * app.js
 * Loads a CSV file, detects column types and renders the dashboard:
 * KPIs, filter, chart builder, histogram, summary statistics and data preview.
 */

// ---------- Application state ----------
const state = {
  fileName: "",
  rows: [],        // all rows from the CSV (array of objects)
  columns: [],     // column names
  types: {},       // column name -> "numeric" | "date" | "category"
  charts: {},      // active Chart.js instances, so they can be destroyed
};

const SAMPLE_PATH = "data/sample-sales.csv";
const MAX_GROUPS = 15; // max bars/slices in the main chart

// ---------- DOM references ----------
const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $("file-input"),
  sampleBtn: $("sample-btn"),
  dropzone: $("dropzone"),
  error: $("error"),
  dashboard: $("dashboard"),
  fileName: $("file-name"),
  filterCol: $("filter-col"),
  filterVal: $("filter-val"),
  filterInfo: $("filter-info"),
  chartType: $("chart-type"),
  xCol: $("x-col"),
  yCol: $("y-col"),
  agg: $("agg"),
  histCol: $("hist-col"),
};

// ---------- Helpers ----------
const isMissing = (value) => value === null || value === undefined || String(value).trim() === "";

function toNumber(value) {
  if (isMissing(value)) return NaN;
  return Number(String(value).trim());
}

function looksLikeDate(value) {
  // Accepts ISO-like dates: 2025-01-31, 2025/01/31 or 2025-01
  return /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?/.test(String(value).trim()) && !Number.isNaN(Date.parse(value));
}

/** Classifies a column by checking what at least 90% of its non-empty values look like. */
function detectType(values) {
  const present = values.filter((v) => !isMissing(v));
  if (!present.length) return "category";
  const threshold = present.length * 0.9;
  const numeric = present.filter((v) => !Number.isNaN(toNumber(v))).length;
  if (numeric >= threshold) return "numeric";
  const dates = present.filter(looksLikeDate).length;
  if (dates >= threshold) return "date";
  return "category";
}

function columnsOfType(...types) {
  return state.columns.filter((col) => types.includes(state.types[col]));
}

function fillSelect(select, options, { includeAll = false, allLabel = "All" } = {}) {
  select.innerHTML = "";
  if (includeAll) select.append(new Option(allLabel, ""));
  options.forEach((opt) => select.append(new Option(opt, opt)));
}

/** Reads a CSS variable so charts match the light/dark theme. */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const PALETTE = ["#3b5bdb", "#f08c00", "#2f9e44", "#e03131", "#7048e8", "#1098ad", "#d6336c", "#5c940d", "#868e96", "#f59f00"];

// ---------- Loading data ----------
function parseCsv(source, name) {
  hideError();
  Papa.parse(source, {
    header: true,
    skipEmptyLines: true,
    complete: (result) => {
      if (!result.data.length || !result.meta.fields?.length) {
        showError("The file is empty or is not a valid CSV.");
        return;
      }
      loadData(result.data, result.meta.fields, name);
    },
    error: () => showError("The file could not be read. Please check that it is a valid CSV."),
  });
}

function loadData(rows, columns, name) {
  state.rows = rows;
  state.columns = columns.filter((c) => c && c.trim() !== "");
  state.fileName = name;
  state.types = {};
  state.columns.forEach((col) => {
    state.types[col] = detectType(rows.map((r) => r[col]));
  });

  setupControls();
  els.dropzone.hidden = true;
  els.dashboard.hidden = false;
  els.fileName.textContent = name;
  render();
}

async function loadSample() {
  try {
    const response = await fetch(SAMPLE_PATH);
    if (!response.ok) throw new Error();
    parseCsv(await response.text(), "sample-sales.csv (sample data)");
  } catch {
    showError("The sample file could not be loaded. If you opened index.html directly, run a local server (see README).");
  }
}

function showError(message) {
  els.dropzone.hidden = false;
  els.dashboard.hidden = true;
  els.error.textContent = message;
  els.error.hidden = false;
}

function hideError() {
  els.error.hidden = true;
}

// ---------- Controls ----------
function setupControls() {
  const categories = columnsOfType("category");
  const groupable = columnsOfType("category", "date");
  const numeric = columnsOfType("numeric");

  fillSelect(els.filterCol, categories, { includeAll: true, allLabel: "No filter" });
  fillSelect(els.filterVal, [], { includeAll: true });
  els.filterVal.disabled = true;

  fillSelect(els.xCol, groupable);
  fillSelect(els.yCol, numeric);
  fillSelect(els.histCol, numeric);

  // Sensible defaults: prefer a date column for X and the last numeric column for Y.
  const dateCol = columnsOfType("date")[0];
  if (dateCol) {
    els.xCol.value = dateCol;
    els.chartType.value = "line";
  }
  if (numeric.length) {
    // Prefer a column that sounds like a total (revenue, sales, amount...) for the main chart.
    const keywords = ["revenue", "sales", "amount", "total", "value", "price"];
    const preferred =
      keywords.map((k) => numeric.find((c) => c.toLowerCase().includes(k))).find(Boolean) || numeric[0];
    els.yCol.value = preferred;
    els.histCol.value = preferred;
  }
  // Without numeric columns, the only valid aggregation is count.
  els.agg.value = numeric.length ? "sum" : "count";
}

function updateFilterValues() {
  const col = els.filterCol.value;
  if (!col) {
    fillSelect(els.filterVal, [], { includeAll: true });
    els.filterVal.disabled = true;
    return;
  }
  const values = [...new Set(state.rows.map((r) => r[col]).filter((v) => !isMissing(v)))].sort();
  fillSelect(els.filterVal, values, { includeAll: true });
  els.filterVal.disabled = false;
}

function filteredRows() {
  const col = els.filterCol.value;
  const val = els.filterVal.value;
  if (!col || !val) return state.rows;
  return state.rows.filter((r) => r[col] === val);
}

// ---------- Rendering ----------
function render() {
  const rows = filteredRows();
  els.filterInfo.textContent =
    rows.length === state.rows.length ? "" : `Showing ${rows.length} of ${state.rows.length} rows`;

  renderKpis(rows);
  renderMainChart(rows);
  renderHistogram(rows);
  renderStatsTable(rows);
  renderColumnsTable(rows);
  renderPreview(rows);
}

function renderKpis(rows) {
  let missing = 0;
  rows.forEach((r) => state.columns.forEach((c) => { if (isMissing(r[c])) missing += 1; }));

  const seen = new Set();
  let duplicates = 0;
  rows.forEach((r) => {
    const key = JSON.stringify(state.columns.map((c) => r[c]));
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  });

  $("kpi-rows").textContent = formatNumber(rows.length);
  $("kpi-cols").textContent = formatNumber(state.columns.length);
  $("kpi-missing").textContent = formatNumber(missing);
  $("kpi-dupes").textContent = formatNumber(duplicates);
}

/** Groups rows by the X column and aggregates the Y column (sum, mean or count). */
function aggregate(rows, xCol, yCol, method) {
  const groups = new Map();
  const isDate = state.types[xCol] === "date";

  rows.forEach((r) => {
    if (isMissing(r[xCol])) return;
    // Dates are grouped by month (YYYY-MM) to keep the chart readable.
    const key = isDate ? String(r[xCol]).trim().slice(0, 7).replace("/", "-") : r[xCol];
    if (!groups.has(key)) groups.set(key, []);
    const y = toNumber(r[yCol]);
    groups.get(key).push(y);
  });

  let result = [...groups.entries()].map(([label, ys]) => {
    const valid = ys.filter((v) => !Number.isNaN(v));
    let value;
    if (method === "count" || !yCol) value = ys.length;
    else if (method === "mean") value = Stats.mean(valid);
    else value = Stats.sum(valid);
    return { label, value };
  });

  if (isDate) {
    result.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    result.sort((a, b) => b.value - a.value);
    result = result.slice(0, MAX_GROUPS);
  }
  return result;
}

function renderMainChart(rows) {
  const xCol = els.xCol.value;
  const yCol = els.yCol.value;
  const method = els.agg.value;
  const type = els.chartType.value;
  if (!xCol) return;

  const data = aggregate(rows, xCol, yCol, method);
  const aggLabel = { sum: "Sum of", mean: "Average", count: "Count of rows" }[method];
  const label = method === "count" || !yCol ? aggLabel : `${aggLabel} ${yCol}`;
  const primary = cssVar("--primary");

  drawChart("main", "main-chart", {
    type,
    data: {
      labels: data.map((d) => d.label),
      datasets: [{
        label,
        data: data.map((d) => d.value),
        backgroundColor: type === "doughnut" ? PALETTE : primary,
        borderColor: type === "doughnut" ? cssVar("--surface") : primary,
        borderWidth: type === "line" ? 2 : 1,
        tension: 0.3,
        borderRadius: type === "bar" ? 6 : 0,
      }],
    },
    options: chartOptions(type !== "doughnut", type === "doughnut"),
  });
}

function renderHistogram(rows) {
  const col = els.histCol.value;
  if (!col) return;
  const values = rows.map((r) => toNumber(r[col])).filter((v) => !Number.isNaN(v));
  const { labels, counts } = Stats.histogram(values);

  drawChart("hist", "hist-chart", {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: `Frequency of ${col}`, data: counts, backgroundColor: PALETTE[1], barPercentage: 1, categoryPercentage: 1 }],
    },
    options: chartOptions(true, false),
  });
}

function chartOptions(showAxes, showLegend) {
  const text = cssVar("--muted");
  const grid = cssVar("--border");
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: showLegend, position: "right", labels: { color: text } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatNumber(ctx.parsed.y ?? ctx.parsed)}` } },
    },
    scales: showAxes
      ? {
          x: { ticks: { color: text, maxRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: text, callback: (v) => formatNumber(v) }, grid: { color: grid }, beginAtZero: true },
        }
      : {},
  };
}

function drawChart(key, canvasId, config) {
  if (state.charts[key]) state.charts[key].destroy();
  state.charts[key] = new Chart($(canvasId), config);
}

/** Builds an HTML table safely (textContent avoids injecting HTML from the CSV). */
function buildTable(table, headers, rows) {
  table.innerHTML = "";
  const thead = table.createTHead().insertRow();
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    thead.append(th);
  });
  const tbody = table.createTBody();
  rows.forEach((cells) => {
    const tr = tbody.insertRow();
    cells.forEach((cell) => {
      const td = tr.insertCell();
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell;
      if (typeof cell === "string" && /^-?[\d,]+(\.\d+)?%?$/.test(cell)) td.classList.add("num");
      if (cell === "(empty)") td.classList.add("missing");
    });
  });

  // Right-align a header when every value in its column is numeric.
  headers.forEach((_, i) => {
    const cells = [...tbody.rows].map((row) => row.cells[i]).filter(Boolean);
    if (cells.length && cells.every((td) => td.classList.contains("num"))) {
      thead.cells[i].classList.add("num");
    }
  });
}

function renderStatsTable(rows) {
  const headers = ["Column", "Count", "Mean", "Std. dev.", "Min", "Q1", "Median", "Q3", "Max"];
  const body = columnsOfType("numeric").map((col) => {
    const v = rows.map((r) => toNumber(r[col])).filter((x) => !Number.isNaN(x));
    return [
      col,
      formatNumber(v.length),
      formatNumber(Stats.mean(v)),
      formatNumber(Stats.std(v)),
      formatNumber(Stats.min(v)),
      formatNumber(Stats.quantile(v, 0.25)),
      formatNumber(Stats.median(v)),
      formatNumber(Stats.quantile(v, 0.75)),
      formatNumber(Stats.max(v)),
    ];
  });
  if (!body.length) body.push(["No numeric columns found", "", "", "", "", "", "", "", ""]);
  buildTable($("stats-table"), headers, body);
}

function renderColumnsTable(rows) {
  const headers = ["Column", "Type", "Missing", "Missing %", "Unique values"];
  const body = state.columns.map((col) => {
    const values = rows.map((r) => r[col]);
    const missing = values.filter(isMissing).length;
    const unique = new Set(values.filter((v) => !isMissing(v))).size;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = state.types[col];
    const pct = rows.length ? (missing / rows.length) * 100 : 0;
    return [col, badge, formatNumber(missing), `${pct.toFixed(1)}%`, formatNumber(unique)];
  });
  buildTable($("columns-table"), headers, body);
}

function renderPreview(rows) {
  const body = rows.slice(0, 10).map((r) => state.columns.map((c) => (isMissing(r[c]) ? "(empty)" : String(r[c]))));
  buildTable($("preview-table"), state.columns, body);
}

// ---------- Events ----------
els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) parseCsv(file, file.name);
  e.target.value = ""; // allows loading the same file again
});

els.sampleBtn.addEventListener("click", loadSample);

els.filterCol.addEventListener("change", () => { updateFilterValues(); render(); });
[els.filterVal, els.chartType, els.xCol, els.yCol, els.agg, els.histCol].forEach((el) =>
  el.addEventListener("change", render)
);

// Drag and drop on the whole page
["dragenter", "dragover"].forEach((evt) =>
  document.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.add("is-dragging"); })
);
["dragleave", "drop"].forEach((evt) =>
  document.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.remove("is-dragging"); })
);
document.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".csv")) {
    showError("Please drop a .csv file.");
    return;
  }
  parseCsv(file, file.name);
});
