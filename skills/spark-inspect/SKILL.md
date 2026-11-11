---
name: spark-inspect
description: 'Inspect Lucko Spark profiler reports for AI agents using the hosted deterministic JSON API. Use when analyzing Spark sampler, plugin performance, call trees, server configuration, health, heap, or live-profiler data.'
argument-hint: '[Spark report URL or code]'
---

# Spark Inspect

Use the hosted API at `https://spark-inspect.vercel.app/api/inspect`. It decodes Spark protobuf reports deterministically; it does not diagnose, summarize, or invent findings.

## Procedure

1. Extract the Spark report code from a URL such as `https://spark.lucko.me/<code>`.
2. Request `overview` first:

   ```text
   https://spark-inspect.vercel.app/api/inspect?code=<code>&operation=overview
   ```

3. Use the returned `threads`, `plugins`, `pluginPerformance`, `statistics`, and `live` fields to choose focused operations.
4. Fetch only the data needed for the question.
5. Preserve exact names, sampled times, percentages, method descriptors, source mappings, and thread names in the answer.
6. State when data is unmapped, missing, expired, or live. Do not assign unmapped frames to a plugin.

## Operations

| Operation | Required query | Purpose |
|---|---|---|
| `overview` | none | Metadata, statistics, threads, hotspots, plugins, mappings, and windows |
| `metadata` | none | Platform, plugin, and server metadata |
| `plugins` | none | Plugin metadata, configurations, and attributed performance |
| `plugin-tree` | `source`; optional `thread` | Call branches containing a mapped plugin/source |
| `tree` | `thread` | Complete resolved sampler tree for one thread |
| `threads` | none | Thread roots and sample-window counts |
| `hotspots` | optional `limit` | Flattened nodes ordered by sampled time |
| `search` | `q` | Sampler nodes matching a method-name query |
| `statistics` | none | Platform, system, metrics, and profiler windows |
| `entries` | none | Heap report entries |

Example plugin workflow:

```text
GET /api/inspect?code=<code>&operation=overview
GET /api/inspect?code=<code>&operation=plugin-tree&source=StrikePractice
GET /api/inspect?code=<code>&operation=plugin-tree&source=StrikePractice&thread=Server%20thread
```

Use the exact `source` value from `pluginPerformance`, not a guessed display name.

## Interpretation rules

- `pluginPerformance` is based on Spark source mappings. It includes only methods/classes Spark attributed to that source.
- `plugin-tree` removes generic ancestors such as `java.lang.Thread.run` when they are not attributed to the requested source.
- Repeated methods may represent separate stack occurrences; overloads remain distinguishable in API fields such as `methodDesc`.
- The browser hides JVM descriptors and source suffixes for readability, but the API preserves them.
- `totalTime` is inclusive sampled time. UI self time is derived from the node's child totals.
- A `live: true` response contains Spark live-profiler channel information. Treat it as a current snapshot, do not cache it, and do not claim continuous streaming through this API.
- A 404/expiration error means the Spark payload is no longer available; request a fresh report instead.

## Caching

Completed-report responses are cacheable at the edge for one hour and may be stale while revalidating. Live responses use `Cache-Control: no-store`. Agents should still avoid unnecessary duplicate requests and reuse the same response for related questions.
