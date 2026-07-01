<img src="logo.svg" height="48" alt="" />

# Compend

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**Author:** [Hector Jarquin](https://hectorjarquin.com)

A reference engine for AI agents. Index your Markdown skills, prompts, and knowledge bases — and serve them as just-in-time grounding with hybrid search and dynamic context. No retraining. No keys. No Python.

## Quick Start

```bash
npm install -g compend
```

Once installed, run the dashboard:

```bash
compend
# → http://localhost:3457
```

### CLI commands

```bash
compend              # Start the dashboard
compend stop         # Stop a running instance
compend restart      # Stop then restart
```

### MCP server

Add to `opencode.json`:

```json
{
  "mcp": {
    "compend": {
      "type": "local",
      "command": ["node", "/usr/lib/node_modules/compend/index.js"],
      "enabled": true
    }
  }
}
```

Find your exact path with `npm root -g` — append `/compend/index.js`. For nvm users the path is typically `~/.nvm/versions/node/vX/lib/node_modules/compend/index.js`.

### Dashboard

Browse, search and read knowledge concepts visually at `http://localhost:3457`.

Port configurable via `~/.compend/config.json` or `COMPEND_PORT`.

**Features:** dark/light theme toggle with SVG icon, WCAG 2.1 AA accessibility (keyboard navigation, ARIA labels, focus-visible outlines), real-time SSE updates (no polling), toast notifications, skeleton loading, search with debounce, type, tag, and status filters, expandable detail rows with rendered markdown body.

## Installation

### Prerequisites

- Node.js 18+
- C++ build tools (`build-essential` on Debian/Ubuntu, Xcode CLI tools on macOS) — required to compile `better-sqlite3`

### From npm (recommended)

```bash
npm install -g compend
```

The `compend` CLI is now available globally. The MCP server runs via your AI client — see [Configuration](#configuration).

### From git

```bash
git clone https://github.com/hectorjarquin/compend.git ~/compend
cd ~/compend
npm install
npm link  # creates global compend command
```

### Configuration

```json
{
  "mcp": {
    "compend": {
      "type": "local",
      "command": ["node", "/usr/lib/node_modules/compend/index.js"],
      "enabled": true
    }
  }
}
```

Find your exact path with `npm root -g` — append `/compend/index.js`.

Concepts are discovered from paths configured in `~/.compend/config.json` → `index.paths`. Add custom project knowledge bundles and skill directories there.

## Updating

### npm

```bash
npm install -g compend@latest
```

Then restart your MCP client to pick up the new tools, and run `compend restart` to refresh the dashboard.

Database migrations run automatically on first launch — no manual steps required.

### From git

```bash
cd ~/compend
git pull
npm install
npm link
compend restart
```

## MCP Tools (Agent-Facing)

### `compend_index`

Mirror the filesystem source of truth into the index. No args scans all configured paths. Pass `{ path }` to index a single `.md` file or a directory (recursively). Uses SHA-256 hash diffing — unchanged files are skipped. Files missing from disk are removed from the index.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | no | — | Absolute path to a `.md` file or directory to index. Omit to scan all configured paths. |

Returns `{ added: [...slugs], updated: [...slugs], removed: [...slugs], total: N }`.

### `compend_deindex`

Remove concepts from the index. Pass `{ slug }` to remove one concept, or `{ path }` to remove all concepts under a directory path. Files on disk are never touched — deindex is index-only. If the file still exists, the next `compend_index` will re-index it.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `slug` | string | no | — | Concept slug to remove |
| `path` | string | no | — | Directory or file path — all concepts whose `file_path` starts with this are removed |

Returns `{ removed: [...slugs], total: N }`.

### `compend_search`

Hybrid FTS + vector search across indexed concepts. Returns metadata with snippet and relevance score.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Search query text |
| `type` | string | no | — | Filter by concept type (skill, agent, instruction, etc.) |
| `tags` | string[] | no | — | Filter by tags (AND match) |
| `limit` | number | no | `10` | Max results |
| `alpha` | number | no | `0.3` | Vector weight. `0` = FTS-only, `1` = vector-only |

Returns concepts sorted by relevance (score 0–1) with `id`, `slug`, `type`, `title`, `description`, `tags`, `status`, `source`, `body_length`, `approx_tokens`, `score`, and `snippet`.

### `compend_get`

Retrieve a full concept by slug. Includes frontmatter JSON, markdown body, child references (concepts whose slug starts with `{slug}/`), and dependencies (from the OKF `dependencies` frontmatter field). Set `resolve_dependencies: true` to recursively fetch all dependency bodies in one call — returns a `resolved[]` array with full concept objects.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `slug` | string | yes | — | Concept slug (e.g. `"wp-image-to-blocks"`) |
| `resolve_dependencies` | boolean | no | `false` | If `true`, recursively resolve dependency bodies. Returns `resolved[]` array with full concept objects. |

Returns `{ id, slug, type, title, description, tags, status, frontmatter, body, body_length, approx_tokens, references: [...], dependencies: [...] }`. With `resolve_dependencies: true`, also includes `resolved: [...]`.

### `compend_list`

List concepts with optional filters. Returns compact metadata including `body_length` — no body.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | string | no | — | Filter by concept type |
| `tags` | string[] | no | — | Filter by tags (AND match) |
| `status` | string | no | — | Filter by status (stable, draft, deprecated) |
| `limit` | number | no | `50` | Max results |
| `offset` | number | no | `0` | Pagination offset |

Returns `{ concepts: [...], total, limit, offset }`.

## HTTP API (Dashboard-Facing)

The dashboard exposes REST endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stats` | Get total concept count and counts by type |
| `GET` | `/api/tags?type=` | List tags with concept counts, optional type filter |
| `GET` | `/api/concepts?type=&status=&tags=&search=&limit=&offset=` | Paginated concept list. `search=` triggers FTS+vector. |
| `GET` | `/api/concepts/{slug}` | Full concept including frontmatter, body, references, and dependencies |
| `POST` | `/api/notify` | SSE event relay from MCP server (internal — called by `notifyDash()`) |
| `GET` | `/api/events` | SSE (Server-Sent Events) stream for real-time dashboard updates |

## Concept Types

Seven types are built into the default schema, extensible via `~/.compend/config.json`:

| Type | Statuses | Default | Description |
|------|----------|---------|-------------|
| `skill` | `stable`, `draft`, `deprecated` | `stable` | Agent skill definition (SKILL.md) |
| `agent` | `stable`, `draft`, `deprecated` | `stable` | Agent/subagent definition |
| `instruction` | `stable`, `draft`, `deprecated` | `stable` | Instruction files injected into system prompt |
| `prompt` | `stable`, `draft`, `deprecated` | `stable` | Prompt templates |
| `workflow` | `stable`, `draft`, `deprecated` | `stable` | Multi-step pipeline definitions |
| `reference` | — (no validation) | — | Reference documents, examples, templates |
| `knowledge` | — (no validation) | — | Project domain knowledge (OKF bundles) |

Type is inferred from OKF frontmatter, file path, or directory location. Unknown types pass through without validation — existing data is never affected. Custom types can be added via `~/.compend/config.json`:

```json
{
  "schemas": {
    "default": {
      "types": {
        "template": { "statuses": ["draft","published","retired"], "defaults": { "status": "draft" } }
      }
    }
  }
}
```

## Concept Best Practices

Add these instructions to your `CLAUDE.md`, `AGENTS.md`, or `.opencode/`
instruction file.

```
Skills, agents, instructions, prompts, workflows, references, and
knowledge bases are indexed in the Compend MCP server. The
available_skills block in the system prompt does NOT reflect
Compend-indexed skills — you must discover them via compend_search.

Before any task that might have pre-existing guidance, run the
discovery cascade:

1. Compend (global index) — compend_search({ query }). Compend
   returns structured metadata: skills, agents, instructions, prompts,
   workflows, references, and knowledge bases. If multiple results
   match, load the most relevant via compend_get({ slug }).
2. Convention files (local) — in parallel with Compend, check the repo
   and its parent directories for convention files: .opencode/,
   AGENTS.md, CLAUDE.md, .cursor/rules/, and project-root instruction
   files. Skip paths already tracked in ~/.compend/config.json →
   index.paths (already indexed).
3. Ad-hoc (context) — if no match in Compend or convention files,
   pattern-match from context: existing code, file structure, naming
   conventions, and neighboring files.

Use compend_get({ slug, resolve_dependencies: true }) to load a skill
with its full dependency tree in one call.

Check approx_tokens in search results before loading — skip skills that
would overwhelm your context window.

If you already know the exact slug and file path from a prior session,
use read directly. Compend is a discovery engine, not a retrieval tool.

Compend stores seven concept types: skill, agent, instruction, prompt,
workflow, reference, and knowledge.

To index new content: compend_index({ path }). After indexing, verify
discoverability with compend_search.
```

## Configuration

### Config File (`~/.compend/config.json`)

Create an optional JSON config file to customize operational settings. All keys are optional — missing keys use the code defaults.

**Priority chain** (highest wins): code defaults < config file < environment variables.

```json
{
  "port": 3457,
  "dbPath": "~/.compend/concepts.db",
  "search": {
    "limit": 10,
    "alpha": 0.3
  },
  "dashboard": {
    "paginationLimit": 50,
    "maxLimit": 200
  },
  "schemas": {
    "default": {
      "types": {}
    }
  },
  "index": {
    "paths": []
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `port` | number | `3457` | Dashboard HTTP server port |
| `dbPath` | string | `~/.compend/concepts.db` | SQLite database file path (supports `~`) |
| `search.limit` | number | `10` | Default search result count |
| `search.alpha` | number | `0.3` | Vector weight in hybrid search (0–1) |
| `dashboard.paginationLimit` | number | `50` | Default page size for dashboard API |
| `dashboard.maxLimit` | number | `200` | Hard cap on API page size |
| `schemas.default.types` | object | built-in set | Type definitions with `statuses` and `defaults` |
| `index.paths` | string[] | `[]` | Paths to scan for `.md` files. These are the only paths Compend indexes. Add skill directories, knowledge bundles, and convention files here. |

### Environment Variables

| Variable | Equivalent Config Key | Default |
|----------|----------------------|---------|
| `COMPEND_PORT` | `port` | `3457` |
| `COMPEND_DB_PATH` | `dbPath` | `~/.compend/concepts.db` |

### Path Discovery

Compend indexes only paths configured in `~/.compend/config.json` →
`index.paths`. No tool configs are read — Compend is tool-agnostic and
works identically with any AI client.

```json
{
  "index": {
    "paths": [
      "/home/user/.github/skills",
      "/home/user/projects/my-project/knowledge"
    ]
  }
}
```

Each path is scanned recursively for `.md` files on `compend_index`.
Add skill directories, OKF knowledge bundles, and convention file
directories here.

## Architecture

### Embedding

MurmurHash3 (32-bit x86) applied to word unigrams and bigrams, accumulated into a 256-bin `Float32Array`, then L2-normalized. Runs in ~2µs per text with no external dependencies. Collisions are inherent to feature hashing and don't materially affect retrieval quality at this dimension count.

### Hybrid Search

Three indexing layers work together:

1. **FTS5** — SQLite full-text search with BM25 ranking (`unicode61` tokenizer)
2. **Vector** — `sqlite-vec` virtual table with 256-dim float vectors, cosine distance
3. **Merge** — Weighted combination: `score = alpha * vec + (1 - alpha) * fts`. Both sides are normalized to 0–1 before merging.

### Database

- WAL journal mode for concurrent reads, `busy_timeout=5000ms` for write-contention safety across processes
- `concepts` table (slug, type, title, description, tags, status, frontmatter, body, file_path, file_hash, source, created_at, updated_at, last_synced_at)
- `concepts_fts` — FTS5 external content table on title, description, tags, body
- `concepts_vec` — `vec0` table with `float[256]`

### Index vs Source of Truth

Compend does not own content. It mirrors a source of truth — the local filesystem or a remote CMS (`compend_sync` in v2). There is no CRUD lifecycle (no create/edit/delete of concepts from the index). The source is always authoritative. The index is a mirror — always rebuildable from source.

`compend_index` uses SHA-256 hash diffing: unchanged files are skipped, changed files are updated, missing files are removed from the index. `compend_deindex` removes concepts without touching files — the next index run restores them.

### SSE Real-Time Updates

The dashboard uses Server-Sent Events for live updates — no polling. Events flow through a three-hop chain:

MCP server (index.js) → `notifyDash()` → dashboard `/api/notify` → `broadcast()` → SSE clients → `app.js` listeners

| Event | Source | Frontend Behavior |
|---|---|---|
| `index_complete` | `compend_index`, `compend_deindex` | Toast with count summary + reload list |

If the SSE connection drops, a 30-second fallback poll resumes.

## Project Structure

```
compend/
├── index.js                MCP stdio server (5 tool handlers)
├── dashboard.js            HTTP dashboard + SSE broadcast server
├── dashboard/
│   ├── api-handler.js      Dashboard REST API routes
│   └── public/
│       ├── index.html      Dashboard HTML + ARIA structure
│       ├── style.css       Full theme (dark/light), toast, skeleton
│       ├── app.js          Frontend SSE client, keyboard nav, WCAG 2.1 AA
│       └── logo.svg        Book icon (48x48, currentColor)
├── db.js                   SQLite init, CRUD, hybrid FTS+vec search
├── embedding.js            MurmurHash3 → 256-dim float vector
├── config.js               Config loader (defaults ← config.json ← env vars)
├── package.json
├── CHANGELOG.md
└── README.md
```

## Development

### Scripts

For local development (after `git clone`):

```bash
npm start           # Start dashboard server (same as compend)
npm run stop        # Stop running instance (same as compend stop)
npm run restart     # Stop then start
```

For installed users, the global `compend` CLI handles these — see [Quick Start](#quick-start).

### Testing the MCP server

Test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node index.js
```

## Roadmap

- **Remote sync** — `compend_sync` for REST-based reconciliation with distributed teams
- **Import / export** — portable OKF bundle archives across Compend instances
- **Auth / access control** — API keys for multi-client deployments

## Contributing

Open an issue or PR at [github.com/hectorjarquin/compend](https://github.com/hectorjarquin/compend).

## License

MIT License — see [LICENSE](LICENSE) for details.
