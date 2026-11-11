const API = "https://spark-inspect.vercel.app/api/inspect";
const $ = (id) => document.getElementById(id);
let report;
let reportInput = "";

function value(object, path, fallback = undefined) {
  return path.split(".").reduce((current, key) => current == null ? undefined : current[key], object) ?? fallback;
}
function fmt(value, suffix = "") {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}${suffix}` : "—";
}
function bytes(value) {
  if (!Number.isFinite(Number(value))) return "—";
  let number = Number(value); const units = ["B", "KB", "MB", "GB", "TB"]; let unit = 0;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit++; }
  return `${number.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function duration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  if (!Number.isFinite(totalSeconds)) return "—";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}m`);
  if (!parts.length || seconds) parts.push(`${seconds}s`);
  return parts.join(" ");
}
function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}
function metric(label, main, detail) {
  return `<div class="metric"><strong>${esc(main)}</strong><span>${esc(label)} · ${esc(detail)}</span></div>`;
}
function details(entries) {
  return entries.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([key, val]) => `<dt>${esc(key)}</dt><dd>${esc(typeof val === "object" ? JSON.stringify(val) : val)}</dd>`).join("");
}
function topEntries(object) {
  return object && typeof object === "object" ? Object.entries(object) : [];
}

function render() {
  $("results").hidden = false;
  const meta = report.metadata || {};
  const platform = meta.platformMetadata || {};
  const stats = report.statistics || {};
  const ps = stats.platformStatistics || {};
  const ss = stats.systemStatistics || {};
  const tps = ps.tps || {};
  const cpu = ss.cpu || {};
  const heap = value(ss, "memory.physical") || value(ps, "memory.heap") || {};
  const hottest = Math.max(...(report.hotspots || []).map((item) => item.totalTime || 0), 1);

  $("report-type").textContent = report.contentType?.split("/").pop() || "";
  $("report-title").textContent = `${platform.name || "Spark"} ${platform.version || "report"}`;
  $("report-subtitle").textContent = `${platform.minecraftVersion || "Unknown Minecraft"} · ${platform.brand || "Unknown brand"} · ${report.live ? "live profiler" : "completed report"} · code ${report.code}`;
  $("hero-metrics").innerHTML = [
    metric("TPS", fmt(tps.last1m ?? tps.last5m), "last 1m"),
    metric("MSPT", fmt(value(ps, "mspt.last1m.mean") ?? value(ps, "mspt.last1m")), "last 1m mean"),
    metric("CPU", fmt(value(cpu, "processUsage.last1m"), "%"), "process / last 1m"),
    metric("Heap", `${bytes(heap.used)} / ${bytes(heap.total || heap.max)}`, "used / total")
  ].join("");

  $("platform-details").innerHTML = details([
    ["Platform", platform.name], ["Version", platform.version], ["Minecraft", platform.minecraftVersion],
    ["Brand", platform.brand], ["Spark version", platform.sparkVersion], ["Ticks", meta.numberOfTicks],
    ["Interval", meta.interval ? `${meta.interval} ms` : undefined], ["Mode", meta.samplerMode]
  ]);
  const sources = topEntries(meta.sources);
  $("sources").innerHTML = sources.length ? sources.map(([name, data]) => `<span class="chip">${esc(name)}${data.version ? ` · ${esc(data.version)}` : ""}</span>`).join("") : `<span class="muted">No source metadata in this report.</span>`;
  $("threads").innerHTML = (report.threads || []).map((thread) => `<div class="list-item"><strong>${esc(thread.name)}</strong><span>${fmt(thread.totalTime)} samples · ${thread.sampleWindows} windows</span></div>`).join("") || `<span class="muted">No sampler threads.</span>`;
  $("hotspots").innerHTML = table(report.hotspots || [], hottest);
  $("health-metrics").innerHTML = [
    metric("Players", ps.playerCount ?? value(report.timeWindowStatistics?.[0], "players"), "snapshot"),
    metric("Entities", value(ps, "world.totalEntities") ?? value(report.timeWindowStatistics?.[0], "entities"), "snapshot"),
    metric("Uptime", duration(ps.uptime), "platform"),
    metric("Report windows", report.timeWindowStatistics ? Object.keys(report.timeWindowStatistics).length : 0, "available")
  ].join("");
  $("windows").innerHTML = windowsTable(report.timeWindowStatistics);
  $("system-details").innerHTML = details([
    ["CPU threads", cpu.threads], ["CPU model", cpu.modelName], ["OS", value(ss, "os.name")],
    ["OS version", value(ss, "os.version")], ["Architecture", value(ss, "os.arch")],
    ["Java", value(ss, "java.version")], ["JVM", value(ss, "jvm.version")], ["Uptime", ss.uptime != null ? duration(ss.uptime) : undefined]
  ]);
  $("memory-details").textContent = JSON.stringify({ memory: ss.memory, gc: ss.gc, disk: ss.disk }, null, 2);
  $("world-details").textContent = JSON.stringify(value(ps, "world") || {}, null, 2);
  renderPlugins("");
  const configurations = Object.entries(report.serverConfigurations || {});
  $("server-configurations").innerHTML = configurations.length
    ? configurations.map(([key, val]) => {
      const formatted = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val ?? "");
      return `<details class="configuration-entry"><summary>${esc(key)}</summary><pre>${esc(formatted)}</pre></details>`;
    }).join("")
    : `<p class="muted">No server configuration records in this report.</p>`;
  $("raw-json").textContent = JSON.stringify(report, null, 2);
  $("thread-select").innerHTML = (report.threads || []).map((thread) => `<option value="${esc(thread.name)}">${esc(thread.name)}</option>`).join("");
  if (report.threads?.length) loadTree(report.threads[0].name);
  renderSearch("");
}
function renderPlugins(query) {
  const needle = query.toLowerCase();
  const performance = Object.fromEntries((report.pluginPerformance || []).map((item) => [item.source, item]));
  const plugins = Object.entries(report.plugins || {})
    .map(([id, plugin]) => {
      const item = performance[id] || performance[plugin.name] || { source: id, totalTime: 0, methods: 0, topMethods: [] };
      return { id, plugin, item };
    })
    .filter(({ id, plugin }) => `${id} ${JSON.stringify(plugin)}`.toLowerCase().includes(needle))
    .sort((a, b) => b.item.totalTime - a.item.totalTime || a.plugin.name.localeCompare(b.plugin.name));
  $("plugin-count").textContent = `${plugins.length} of ${Object.keys(report.plugins || {}).length}`;
  $("plugin-performance").innerHTML = plugins.length ? plugins.map(({ id, plugin, item }, index) => {
    const methods = item.topMethods.length
      ? item.topMethods.map((method) => `${esc(method.name)} <span class="muted">(${fmt(method.totalTime)}${method.occurrences > 1 ? ` · ${method.occurrences} occurrences` : ""})</span>`).join("<br>")
      : `<span class="muted">No sampler-attributed methods</span>`;
    return `<details class="plugin-entry"><summary><span class="plugin-rank-index">${String(index + 1).padStart(2, "0")}</span><span class="plugin-rank-name"><strong>${esc(plugin.name || id)}</strong><span>${esc(id)} · ${plugin.builtin ? "built-in" : "external"}</span></span><span class="plugin-rank-stats"><span class="plugin-rank-time">${item.totalTime ? fmt(item.totalTime) : "—"}</span><span class="plugin-rank-methods">${item.methods ? `${item.methods.toLocaleString()} methods` : "no mapped methods"}</span></span></summary><div class="plugin-details"><div><h4>Plugin details</h4><p><strong>Version:</strong> ${esc(plugin.version || "—")}</p><p><strong>Author:</strong> ${esc(plugin.author || "—")}</p><p>${esc(plugin.description || "No description reported.")}</p></div><div><h4>Top attributed methods</h4><p class="plugin-methods">${methods}</p></div><div class="plugin-tree-slot" data-plugin-source="${esc(item.source || id)}"><h4>Attributed call tree</h4><p class="muted">Expand to load this plugin’s sampled call branches.</p></div></div></details>`;
  }).join("") : `<p class="muted">No matching plugin records.</p>`;
  document.querySelectorAll(".plugin-entry").forEach((entry) => entry.addEventListener("toggle", () => {
    const slot = entry.querySelector(".plugin-tree-slot");
    if (entry.open && slot && !slot.dataset.loaded) loadPluginTree(slot);
  }));
}

function table(rows, max) {
  if (!rows.length) return `<p class="muted">No sampler data in this report.</p>`;
  return `<table><thead><tr><th>Node</th><th>Thread</th><th>Sampled time</th></tr></thead><tbody>${rows.map((row) => `<tr><td><span class="bar" style="width:${Math.max(3, (row.totalTime / max) * 110)}px"></span>${esc(row.name)}</td><td>${esc(row.thread)}</td><td>${fmt(row.totalTime)}</td></tr>`).join("")}</tbody></table>`;
}
function windowsTable(input) {
  const rows = Array.isArray(input) ? input.map((item, index) => [index, item]) : Object.entries(input || {});
  if (!rows.length) return `<p class="muted">No window statistics in this report.</p>`;
  return `<table><thead><tr><th>Window</th><th>Ticks</th><th>TPS</th><th>MSPT median / max</th><th>CPU</th><th>Players</th><th>Entities</th></tr></thead><tbody>${rows.map(([key, row]) => `<tr><td>${esc(key)}</td><td>${esc(row.ticks)}</td><td>${fmt(row.tps)}</td><td>${fmt(row.msptMedian)} / ${fmt(row.msptMax)}</td><td>${fmt(row.cpuProcess, "%")}</td><td>${esc(row.players)}</td><td>${esc(row.entities)}</td></tr>`).join("")}</tbody></table>`;
}
async function renderSearch(query) {
  const needle = query.toLowerCase();
  if (needle.length > 1 && reportInput && !reportInput.startsWith("{")) {
    $("search-count").textContent = "searching…";
    try {
      const params = new URLSearchParams({ url: reportInput, operation: "search", q: query });
      const response = await fetch(`${API}?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Search failed.");
      const matches = body.matches || [];
      $("search-count").textContent = `${matches.length} matches`;
      $("search-results").innerHTML = table(matches, Math.max(...matches.map((item) => item.totalTime || 0), 1));
    } catch (error) {
      $("search-count").textContent = error.message;
    }
    return;
  }
  const matches = (report.hotspots || []).filter((item) => `${item.name} ${item.thread}`.toLowerCase().includes(needle));
  $("search-count").textContent = `${matches.length} shown`;
  $("search-results").innerHTML = table(matches, Math.max(...matches.map((item) => item.totalTime || 0), 1));
}
function treeNode(node, threadTime, parentTime = null) {
  const children = node.children || [];
  const total = Number(node.totalTime) || 0;
  const childTotal = children.reduce((sum, child) => sum + (Number(child.totalTime) || 0), 0);
  const self = Math.max(0, total - childTotal);
  const percentage = threadTime ? (total / threadTime) * 100 : 0;
  const significance = parentTime && total ? Math.min(total, parentTime) / Math.max(total, parentTime) : 1;
  const importance = parentTime && total !== parentTime ? significance : 0;
  const percentStyle = `filter:hue-rotate(-${25 * importance}deg) saturate(${1 + 13 * importance});${significance < 0.01 ? `opacity:${0.5 + (significance * 100) / 2}` : ""}`;
  const title = node.className ? `${node.className}.${node.methodName || ""}` : (node.name || "unknown");
  const signature = node.lineNumber ? `line ${node.lineNumber}` : "";
  const childMarkup = children.map((child) => treeNode(child, threadTime, total)).join("");
  return `<li class="tree-node ${children.length ? "" : "leaf"}"><details><summary><span class="tree-node-name"><strong>${esc(title)}</strong>${signature ? `<small>${esc(signature)}</small>` : ""}</span><span class="tree-node-stats"><span class="tree-node-time" style="${percentStyle}">${fmt(total)} ms</span><span class="tree-node-percent" style="${percentStyle}">${percentage.toFixed(1)}%</span><span class="tree-node-bar"><span style="width:${Math.min(100, percentage)}%"></span></span></span>${self > 0 && children.length ? `<span class="tree-node-self">self ${fmt(self)} ms · ${(self / Math.max(threadTime, 1) * 100).toFixed(1)}%</span>` : ""}</summary>${children.length ? `<ul class="tree-node-children">${childMarkup}</ul>` : ""}</details></li>`;
}
async function loadTree(thread) {
  if (!thread || reportInput.startsWith("{")) {
    $("call-tree").innerHTML = `<p class="muted">Tree loading requires a Spark URL or code.</p>`;
    return;
  }
  $("tree-status").textContent = "loading…";
  try {
    const params = new URLSearchParams({ url: reportInput, operation: "tree", thread });
    const response = await fetch(`${API}?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Tree request failed.");
    $("call-tree").innerHTML = `<ul class="tree-node">${treeNode(body.thread, body.thread.totalTime || 1)}</ul>`;
    $("tree-status").textContent = `${body.thread.children?.length || 0} root calls`;
  } catch (error) {
    $("tree-status").textContent = error.message;
  }
}
async function loadPluginTree(slot) {
  slot.dataset.loaded = "true";
  slot.querySelector(".muted").textContent = "loading…";
  try {
    const params = new URLSearchParams({ url: reportInput, operation: "plugin-tree", source: slot.dataset.pluginSource });
    const response = await fetch(`${API}?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Plugin tree request failed.");
    const trees = body.threads || [];
    slot.innerHTML = trees.length
      ? `<h4>Attributed call tree</h4>${trees.map((thread) => `<section class="plugin-thread"><strong>${esc(thread.name)}</strong><ul class="tree-node">${thread.children.map((node) => treeNode(node, thread.totalTime || 1)).join("")}</ul></section>`).join("")}`
      : `<h4>Attributed call tree</h4><p class="muted">No mapped call branches found.</p>`;
  } catch (error) {
    delete slot.dataset.loaded;
    slot.querySelector(".muted").textContent = error.message;
  }
}
async function load(input) {
  const text = input.trim();
  if (!text) throw new Error("Enter a Spark report URL or code.");
  reportInput = text;
  if (text.startsWith("{")) { report = JSON.parse(text); return; }
  const params = new URLSearchParams({ url: text, operation: "overview" });
  const response = await fetch(`${API}?${params}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed with HTTP ${response.status}.`);
  report = body;
}

$("inspect-button").addEventListener("click", async () => {
  $("inspect-button").disabled = true; $("status").textContent = "Fetching and decoding report…";
  try { await load($("report-input").value); render(); $("status").textContent = ""; } catch (error) { $("status").textContent = error.message; }
  finally { $("inspect-button").disabled = false; }
});
$("copy-button").addEventListener("click", async () => { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); $("copy-button").textContent = "Copied"; setTimeout(() => { $("copy-button").textContent = "Copy JSON"; }, 1200); });
$("download-button").addEventListener("click", () => { const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${report.code || "spark-report"}.json`; link.click(); URL.revokeObjectURL(link.href); });
$("node-search").addEventListener("input", (event) => renderSearch(event.target.value));
$("plugin-search").addEventListener("input", (event) => renderPlugins(event.target.value));
$("thread-select").addEventListener("change", (event) => loadTree(event.target.value));
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.id !== `tab-${tab.dataset.tab}`; });
}));
const initial = window.location.hash.slice(1);
if (initial) { $("report-input").value = decodeURIComponent(initial); $("inspect-button").click(); }
