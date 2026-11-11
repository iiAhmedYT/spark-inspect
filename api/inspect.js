const path = require("node:path");
const protobuf = require("protobufjs");

const TYPES = {
  "application/x-spark-sampler": "SamplerData",
  "application/x-spark-heap": "HeapData",
  "application/x-spark-health": "HealthData"
};
const schemaRoot = path.join(__dirname, "..", "proto");
let rootPromise;

function loadSchema() {
  if (!rootPromise) {
    rootPromise = protobuf.load([
      path.join(schemaRoot, "spark", "spark.proto"),
      path.join(schemaRoot, "spark", "spark_sampler.proto"),
      path.join(schemaRoot, "spark", "spark_heap.proto")
    ]);
  }
  return rootPromise;
}

function json(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

function codeFromInput(value) {
  if (!value) throw new Error("Missing Spark URL or code.");
  const text = String(value).trim();
  if (/^[A-Za-z0-9_-]+$/.test(text)) return text;
  const url = new URL(text);
  if (url.hostname !== "spark.lucko.me" && url.hostname !== "spark-usercontent.lucko.me" && url.hostname !== "bytebin.lucko.me") {
    throw new Error("Only spark.lucko.me and its Bytebin hosts are supported.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) throw new Error("Spark URL has no report code.");
  return parts[parts.length - 1];
}

async function fetchReport(input) {
  const code = codeFromInput(input);
  const headers = { Accept: Object.keys(TYPES).join(",") };
  const hosts = ["https://spark-usercontent.lucko.me", "https://bytebin.lucko.me"];
  let lastStatus = 404;
  for (const host of hosts) {
    const response = await fetch(`${host}/${encodeURIComponent(code)}`, { headers });
    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0];
    if (!TYPES[contentType]) throw new Error(`Unsupported Spark content type: ${contentType || "missing"}.`);
    return { code, contentType, bytes: new Uint8Array(await response.arrayBuffer()) };
  }
  throw new Error(`Spark payload request failed with HTTP ${lastStatus}. The report may have expired.`);
}

function total(node) {
  return (node.times || []).reduce((sum, value) => sum + Number(value), 0);
}

function resolveSampler(data) {
  const resolve = (node, flat) => {
    const resolved = { ...node };
    resolved.children = (node.childrenRefs || []).map((ref) => {
      const child = flat[ref];
      return child ? resolve(child, flat) : null;
    }).filter(Boolean);
    resolved.totalTime = total(node);
    return resolved;
  };
  const threads = (data.threads || []).map((thread) => {
    const root = resolve(thread, thread.children || []);
    return { ...root, totalTime: total(root) };
  });
  return threads;
}

function nodeName(node) {
  if (node.className) {
    return `${node.className}.${node.methodName}${node.lineNumber ? `:${node.lineNumber}` : ""}`;
  }
  return node.name || "unknown";
}

function flatten(nodes, threadName, result = []) {
  for (const node of nodes) {
    result.push({
      thread: threadName,
      name: nodeName(node),
      className: node.className || null,
      methodName: node.methodName || null,
      methodDesc: node.methodDesc || null,
      lineNumber: node.lineNumber || null,
      totalTime: node.totalTime || total(node)
    });
    flatten(node.children || [], threadName, result);
  }
  return result;
}

function entries(map) {
  return Object.entries(map || {}).map(([key, value]) => ({ key, value }));
}

function sourceFor(node, mappings) {
  if (!node.className) return null;
  const methodKey = `${node.className};${node.methodName};${node.methodDesc}`;
  const lineKey = `${node.className};${node.lineNumber}`;
  return mappings.methods[methodKey] || mappings.lines[lineKey] || mappings.classes[node.className] || null;
}

function sourceMappings(data) {
  return {
    classes: entries(data.classSources),
    methods: entries(data.methodSources),
    lines: entries(data.lineSources)
  };
}

function pluginPerformance(nodes, mappings) {
  const grouped = new Map();
  for (const node of nodes) {
    const source = sourceFor(node, mappings);
    if (!source) continue;
    const current = grouped.get(source) || { source, totalTime: 0, methods: 0, topMethods: [] };
    current.totalTime += node.totalTime || 0;
    const methodKey = `${node.className}\0${node.methodName}\0${node.methodDesc}`;
    const method = current.topMethods.find((item) => item.key === methodKey);
    if (method) {
      method.totalTime += node.totalTime || 0;
      method.occurrences += 1;
    } else {
      current.methods += 1;
      current.topMethods.push({
        key: methodKey,
        name: node.name,
        thread: node.thread,
        methodDesc: node.methodDesc,
        totalTime: node.totalTime || 0,
        occurrences: 1
      });
    }
    grouped.set(source, current);
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    topMethods: item.topMethods.sort((a, b) => b.totalTime - a.totalTime).slice(0, 10).map(({ key, ...method }) => method)
  })).sort((a, b) => b.totalTime - a.totalTime);
}

function decorateTree(node, mappings) {
  node.source = sourceFor(node, mappings);
  node.children = (node.children || []).sort((a, b) => (b.totalTime || 0) - (a.totalTime || 0)).map((child) => decorateTree(child, mappings));
  return node;
}

function pluginTreeNodes(node, source) {
  const children = (node.children || []).flatMap((child) => pluginTreeNodes(child, source))
    .sort((a, b) => (b.totalTime || 0) - (a.totalTime || 0));
  if (node.source === source) return [{ ...node, children }];
  return children;
}

function metadata(data) {
  return json(data.metadata) || {};
}

function statistics(data) {
  const meta = metadata(data);
  return {
    platform: json(meta.platformMetadata || meta.platform),
    platformStatistics: json(meta.platformStatistics),
    systemStatistics: json(meta.systemStatistics),
    timeWindowStatistics: json(data.timeWindowStatistics),
    metrics: json(meta.metrics)
  };
}

function overview(data, report) {
  const meta = metadata(data);
  const output = {
    code: report.code,
    contentType: report.contentType,
    live: Boolean(data.channelInfo?.channelId),
    metadata: meta,
    statistics: statistics(data)
  };
  output.plugins = json(meta.sources || {});
  output.serverConfigurations = json(meta.serverConfigurations || {});
  if (report.contentType === "application/x-spark-sampler") {
    const threads = resolveSampler(data);
    const nodes = threads.flatMap((thread) => flatten(thread.children || [], thread.name));
    output.threads = threads.map((thread) => ({
      name: thread.name,
      totalTime: thread.totalTime,
      sampleWindows: thread.times?.length || 0
    }));
    output.hotspots = nodes.sort((a, b) => b.totalTime - a.totalTime).slice(0, 50);
    output.timeWindows = json(data.timeWindows);
    output.timeWindowStatistics = json(data.timeWindowStatistics);
    output.sourceMappings = sourceMappings(data);
    output.pluginPerformance = pluginPerformance(nodes, {
      classes: Object.fromEntries(output.sourceMappings.classes.map((item) => [item.key, item.value])),
      methods: Object.fromEntries(output.sourceMappings.methods.map((item) => [item.key, item.value])),
      lines: Object.fromEntries(output.sourceMappings.lines.map((item) => [item.key, item.value]))
    });
  } else if (report.contentType === "application/x-spark-heap") {
    output.entries = json(data.entries || []);
  }
  return output;
}

async function inspect(input, operation, query) {
  const report = await fetchReport(input);
  const root = await loadSchema();
  const type = root.lookupType(`spark.${TYPES[report.contentType]}`);
  const data = type.decode(report.bytes);
  const result = {
    code: report.code,
    contentType: report.contentType,
    operation,
    live: Boolean(data.channelInfo?.channelId)
  };

  if (operation === "overview") return { ...result, ...overview(data, report) };
  if (operation === "metadata") return { ...result, metadata: metadata(data) };
  if (operation === "plugins") return {
    ...result,
    plugins: json(metadata(data).sources || {}),
    serverConfigurations: json(metadata(data).serverConfigurations || {}),
    ...(report.contentType === "application/x-spark-sampler" ? (() => {
      const threads = resolveSampler(data);
      const nodes = threads.flatMap((thread) => flatten(thread.children || [], thread.name));
      const mappings = {
        classes: Object.fromEntries(entries(data.classSources).map((item) => [item.key, item.value])),
        methods: Object.fromEntries(entries(data.methodSources).map((item) => [item.key, item.value])),
        lines: Object.fromEntries(entries(data.lineSources).map((item) => [item.key, item.value]))
      };
      return { pluginPerformance: pluginPerformance(nodes, mappings) };
    })() : {})
  };
  if (operation === "statistics") return { ...result, statistics: statistics(data) };
  if (report.contentType === "application/x-spark-sampler") {
    const threads = resolveSampler(data);
    if (operation === "threads") {
      return { ...result, threads: threads.map((thread) => ({ name: thread.name, totalTime: thread.totalTime, sampleWindows: thread.times?.length || 0 })) };
    }
    const nodes = threads.flatMap((thread) => flatten(thread.children || [], thread.name));
    if (operation === "hotspots") {
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 200);
      return { ...result, hotspots: nodes.sort((a, b) => b.totalTime - a.totalTime).slice(0, limit) };
    }
    if (operation === "search") {
      const needle = String(query.q || "").toLowerCase();
      if (!needle) throw new Error("search requires a q parameter.");
      return { ...result, matches: nodes.filter((node) => node.name.toLowerCase().includes(needle)).slice(0, 200) };
    }
    if (operation === "tree" || operation === "plugin-tree") {
      const selected = query.thread ? threads.find((thread) => thread.name === query.thread) : null;
      if (query.thread && !selected) throw new Error("tree requires a valid thread parameter.");
      if (operation === "plugin-tree" && !query.source) throw new Error("plugin-tree requires a source parameter.");
      const mappings = {
        classes: Object.fromEntries(entries(data.classSources).map((item) => [item.key, item.value])),
        methods: Object.fromEntries(entries(data.methodSources).map((item) => [item.key, item.value])),
        lines: Object.fromEntries(entries(data.lineSources).map((item) => [item.key, item.value]))
      };
      const decorated = (selected ? [selected] : threads).map((thread) => decorateTree(thread, mappings));
      if (operation === "plugin-tree") {
        return {
          ...result,
          source: query.source,
          threads: decorated.map((thread) => ({
            ...thread,
            children: thread.children.flatMap((child) => pluginTreeNodes(child, query.source))
              .sort((a, b) => (b.totalTime || 0) - (a.totalTime || 0))
          })).filter((thread) => thread.children.length)
        };
      }
      return { ...result, thread: decorated[0] };
    }
  }
  if (report.contentType === "application/x-spark-heap" && operation === "entries") {
    return { ...result, entries: json(data.entries || []) };
  }
  throw new Error(`Operation "${operation}" is not available for this report type.`);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const input = req.query.url || req.query.code || body.url || body.code;
    const operation = req.query.operation || body.operation || "metadata";
    const output = await inspect(input, operation, { ...req.query, ...body });
    res.setHeader(
      "Cache-Control",
      output.live || req.query.live === "true" || body.live === true
        ? "no-store"
        : "public, s-maxage=3600, stale-while-revalidate=86400"
    );
    return res.status(200).json(output);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};
