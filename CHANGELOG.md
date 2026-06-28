# Changelog

All notable changes to Compend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
