# Changelog

All notable changes to Compend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.2] - 2026-07-11

### Added
- `notifySubscribers` config key — array of service names (e.g., `["cordenar"]`).
  On index events, `notifyDash()` also POSTs event payloads to each
  subscriber's endpoint. Subscribers register via `~/.{name}/manifest.json`
  with `notifyEndpoint`. Env override: `COMPEND_NOTIFY_SUBSCRIBERS`
  (comma-separated). Opt-in — empty array preserves existing behavior.
- Manifest resolution: when a subscriber name is configured, Compend reads
  `~/.{name}/manifest.json` at notify-time for the target endpoint URL.

## [2.0.1] - 2026-07-06

### Added
- `compend_context` tool — retrieve concept body as formatted text for prompt
  injection. Returns `(type) slug: title` followed by the full markdown body.
  Unified contract for both local and remote concept retrieval.

### Changed
- `compend_search` `type` parameter now accepts an array of concept types
  (e.g., `["skill", "reference"]`). Single strings still work (backward
  compatible). Empty arrays are safely ignored.

### Fixed
- Empty array passed to `compend_search` `type` parameter no longer causes
  an SQL syntax error.

## [2.0.0] - 2026-06-30

### Changed
- Relicensed from GPL-3.0-only to MIT. Prior versions remain GPL-3.0-only.

### Added
- LICENSE file included in repository and npm package for the first time.
- Concept Best Practices section — copy-pasteable agent instructions for
  the skill discovery protocol.

## [1.2.0] - 2026-06-29

### Added
- `resolve_dependencies` parameter on `compend_get`. When `true`, recursively
  resolves all dependency bodies in one call. Returns a `resolved[]` array with
  full concept objects. Circular deps handled via visited tracking. One call
  instead of N+2 for deep dependency trees.
- `body_length` field on all concept responses (`compend_search`,
  `compend_list`, `compend_get`). Character count of the concept body, computed
  at index time. Auto-migrated with backfill for existing databases — no manual
  steps. Companion `approx_tokens` field (`Math.round(body_length / 4)`)
  included in all responses for quick context-pressure estimation.

### Changed
- `compend_get`, `compend_search`, `compend_list` all include `body_length` in
  their response objects.
- Database schema: `concepts` table gains `body_length INTEGER` column with
  auto-migration + backfill on `initDb()`.

## [1.1.0] - 2026-06-28

### Removed
- opencode.json auto-discovery from `getIndexPaths()`. Compend no longer
  reads opencode.json for `skills.paths` or `instructions[]`. All index
  paths now come from `~/.compend/config.json` → `index.paths`. If you
  previously relied on auto-discovery, add your paths to the compend
  config file.

### Changed
- `getIndexPaths()` reads only `~/.compend/config.json` — zero tool
  dependencies. Compend works identically with Claude, Copilot, openCode,
  Codex, or standalone.

## [1.0.0] - 2026-06-27

### Added
- Initial release
- 5 MCP tools: `compend_index`, `compend_deindex`, `compend_search`, `compend_get`, `compend_list`
- `compend_index` mirrors filesystem into index — accepts file path, directory path, or no args (all configured paths)
- `compend_deindex` removes concepts by slug or path prefix (files never touched)
- `compend_search` with hybrid FTS5 + vec0 weighted scoring (MurmurHash3 256-dim, alpha 0-1)
- `compend_get` returns full concept: frontmatter JSON, markdown body, children (references), and dependencies
- `compend_list` browse with type, tag, and status filters + pagination
- Dashboard on port 3457: read-only, dark/light theme, SSE real-time updates, type/tag/status filters, rendered markdown viewer
- CLI: `compend` (start dashboard), `compend stop`, `compend restart`
- 7 extensible concept types: skill, agent, instruction, prompt, workflow, reference, knowledge
- Type schemas in config.js with per-type status validation (matching Hemisphere's kind schema pattern)
- OKF frontmatter parsing (YAML + markdown body) with automatic type inference
- Auto-index on first run from ~/.compend/config.json `index.paths`
- Parent/child concept resolution via slug hierarchy (file path convention)
- Dependency resolution from OKF frontmatter `dependencies` field
- `~/.compend/config.json` config with env var overrides (`COMPEND_PORT`, `COMPEND_DB_PATH`)
- Index paths from `~/.compend/config.json` `index.paths`

## [0.0.1] - 2026-06-27

### Added
- Placeholder release to secure npm namespace
- Logo SVG (48x48 book icon, currentColor)
- GPL-3.0-only license
