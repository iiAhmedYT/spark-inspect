# Spark Inspect

<p align="center">
  <strong>Inspect Spark profiler reports like a pro.</strong><br>
  Deterministic JSON for humans, AI agents, and performance investigations.
</p>

<p align="center">
  <a href="https://spark-inspect.vercel.app"><img src="https://img.shields.io/badge/live_app-spark--inspect.vercel.app-d7f36a?style=for-the-badge&labelColor=111510" alt="Live app"></a>
  <a href="https://spark-inspect.vercel.app/api/inspect"><img src="https://img.shields.io/badge/API-online-ff9a5c?style=for-the-badge&labelColor=111510" alt="API online"></a>
  <a href="https://github.com/lucko/spark"><img src="https://img.shields.io/badge/works_with-Lucko%20Spark-8b7cff?style=for-the-badge&labelColor=111510" alt="Works with Lucko Spark"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-5fa04e?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 18 or newer">
  <img src="https://img.shields.io/badge/protobufjs-7.x-blue?style=flat-square" alt="protobufjs 7">
  <img src="https://img.shields.io/badge/agent-ready-yes-d7f36a?style=flat-square&labelColor=303820" alt="Agent ready">
  <img src="https://img.shields.io/badge/no_build_step-static-9ca3af?style=flat-square" alt="No build step">
</p>

Spark Inspect is a public, no-installation workbench and JSON API for inspecting
[Lucko's spark](https://github.com/lucko/spark) profiler reports.

It decodes Spark's protobuf payloads into deterministic JSON so people and AI
agents can inspect the same report data:

- plugin-attributed performance
- sampler hotspots and call trees
- server, platform, JVM, and plugin metadata
- TPS, MSPT, CPU, memory, garbage collection, worlds, entities, and players
- heap report entries
- live-profiler snapshot status

Spark Inspect reports data. It does not diagnose a server, invent missing
attribution, or make performance recommendations.

## Live deployment

- **Browser workbench:** [spark-inspect.vercel.app](https://spark-inspect.vercel.app)
- **Agent API:** [spark-inspect.vercel.app/api/inspect](https://spark-inspect.vercel.app/api/inspect)

Paste a Spark report URL or code into the workbench and select **Load report**.
The browser provides overview, metadata, statistics, plugins, sampler, heap,
search, and raw JSON views.

## API

The API accepts either a Spark URL or its report code. A URL may be supplied as
`url` or `code` in a query string or JSON request body.

### GET

```text
GET https://spark-inspect.vercel.app/api/inspect?code=REPORT_CODE&operation=overview
```

For example:

```text
curl "https://spark-inspect.vercel.app/api/inspect?url=https%3A%2F%2Fspark.lucko.me%2FREPORT_CODE&operation=plugins"
```

### POST

```bash
curl -X POST https://spark-inspect.vercel.app/api/inspect \
  -H "content-type: application/json" \
  -d '{
    "url": "https://spark.lucko.me/REPORT_CODE",
    "operation": "hotspots",
    "limit": 10
  }'
```

The API supports CORS for browser and tool clients. The default operation is
`metadata` when `operation` is omitted.

### Operations

| Operation | Parameters | Returns |
| --- | --- | --- |
| `overview` | None | A compact report overview containing metadata, statistics, plugins, sampler roots, hotspots, and profiler windows |
| `metadata` | None | Report, platform, server, plugin, and configuration metadata |
| `plugins` | None | Plugin/mod metadata and Spark source-attributed performance records |
| `statistics` | None | Platform, system, metrics, and profiler-window statistics |
| `threads` | None | Sampler thread roots and sample-window counts |
| `hotspots` | `limit` optional | Flattened sampler nodes ordered by sampled time |
| `search` | `q` required | Sampler nodes whose method name contains the query |
| `tree` | `thread` required | The resolved sampler call tree for a named thread |
| `plugin-tree` | `source` required; `thread` optional | Only call-tree branches containing mapped methods/classes for a plugin or source |
| `entries` | None | Heap report entries; available for Spark heap exports |

Use the exact `source` value returned in `pluginPerformance` when calling
`plugin-tree`. Do not substitute a display name or a guessed plugin name.

Example plugin investigation:

```text
GET /api/inspect?code=REPORT_CODE&operation=overview
GET /api/inspect?code=REPORT_CODE&operation=plugin-tree&source=ExamplePlugin
GET /api/inspect?code=REPORT_CODE&operation=plugin-tree&source=ExamplePlugin&thread=Server%20thread
```

### Response conventions

Every successful response includes the report code and selected operation,
followed by operation-specific fields. The API preserves exact method names,
descriptors, source mappings, thread names, and sampled times.

Important semantics:

- `totalTime` is inclusive sampled time for a tree node.
- UI self time is derived from the node's total time minus its child totals.
- Plugin performance is based on Spark's source mappings, not guessed package
  names.
- `plugin-tree` removes generic ancestors when they do not contribute useful
  source attribution.
- Repeated methods can represent separate stack occurrences.
- Method descriptors remain available in API output to distinguish overloads.
- A report can contain unmapped frames. Unmapped frames must not be assigned to
  a plugin.

Errors are returned as JSON with an error message and an appropriate HTTP
status. Expired Spark links cannot be decoded; create a fresh report in Spark.

## Live profiler reports

Spark live profiles include channel information for Spark's signed WebSocket
stream. Spark Inspect detects this payload and returns `live: true`.

Live responses use:

```text
Cache-Control: no-store
```

Completed reports use edge caching:

```text
Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
```

The current API exposes a live snapshot and cache policy, but does not proxy
Spark's signed WebSocket stream or provide continuous updates.

## Agent skill

The distributable agent skill is located at
[`skills/spark-inspect/SKILL.md`](./skills/spark-inspect/SKILL.md).

It instructs agents to:

1. Extract the report code from a Spark URL.
2. Request `overview` first.
3. Use exact plugin source values from `pluginPerformance`.
4. Request focused operations such as `plugin-tree`, `tree`, `hotspots`, or
   `search`.
5. Preserve exact values and clearly distinguish live, expired, missing, and
   unmapped data.

The machine-readable tool manifest is available at
[`agent-tool.json`](./agent-tool.json).

## Architecture

The repository is intentionally small and dependency-light:

```text
index.html                 Browser workbench markup
styles.css                 Workbench styling
app.js                     Browser loading and rendering
api/inspect.js             Vercel serverless API and protobuf decoding
proto/spark/*.proto        Spark protobuf schemas
agent-tool.json            Machine-readable API manifest
skills/spark-inspect/      Public agent skill
.github/workflows/vercel.yml Vercel deployment
vercel.json                Vercel function configuration
```

The API loads Spark payloads from the current `spark-usercontent.lucko.me`
host and falls back to the legacy `bytebin.lucko.me` host. Report decoding uses
the schemas in [`proto/spark/`](./proto/spark/) and `protobufjs`.

## Local development

The browser workbench has no build step. Any static file server can serve the
repository root:

```bash
python -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

To run the API locally with Vercel:

```bash
npm install
npx vercel dev
```

The local API is then available at:

```text
http://localhost:3000/api/inspect
```

Requirements:

- Node.js 18 or newer
- npm
- Python is optional and only needed for the example static server

Useful checks:

```bash
node --check app.js
```

## Deployment

### Manual Vercel setup

Import the repository into Vercel. No environment variables are required.
Vercel serves the static workbench and the `api/*.js` serverless functions.
The function limit is configured in [`vercel.json`](./vercel.json).

### GitHub Actions deployment

Production deployment is handled by the included
[`vercel.yml`](./.github/workflows/vercel.yml) workflow whenever `main` changes.

Add these repository secrets under **Settings → Secrets and variables →
Actions**:

- `VERCEL_TOKEN` — a Vercel personal or team token
- `VERCEL_ORG_ID` — the Vercel team or account ID
- `VERCEL_PROJECT_ID` — the Vercel project ID

The workflow runs `vercel --prod`, so it deploys both the static workbench and
the `/api/inspect` serverless function.

## Scope and limitations

- The API reads reports that are publicly fetchable from Spark's payload hosts.
- Expired or private reports cannot be recovered.
- The browser can fetch a plain Spark link only when the remote endpoint allows
  the required cross-origin request.
- The API does not currently accept local `.sparkprofile` uploads.
- The API does not currently proxy Spark's signed live WebSocket protocol.
- This project does not replace Spark's official viewer; it provides
  deterministic, agent-friendly inspection data alongside it.

## License

No license has been declared for this repository yet. Add a license before
redistributing the project or accepting external contributions.
