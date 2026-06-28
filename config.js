import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const DEFAULTS = {
  port: 3457,
  dbPath: join(homedir(), '.compend', 'concepts.db'),
  search: {
    limit: 10,
    alpha: 0.3
  },
  dashboard: {
    paginationLimit: 50,
    maxLimit: 200
  },
  schemas: {
    default: {
      types: {
        skill:       { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        agent:       { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        instruction: { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        prompt:      { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        workflow:    { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        reference:   { statuses: [], defaults: {} },
        knowledge:   { statuses: [], defaults: {} }
      }
    }
  }
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(target, key)) {
      target[key] = JSON.parse(JSON.stringify(source[key]));
      continue;
    }
    const tv = target[key];
    const sv = source[key];
    if (isObject(tv) && isObject(sv)) {
      deepMerge(tv, sv);
    } else {
      target[key] = sv;
    }
  }
  return target;
}

function readConfigFile() {
  try {
    const filePath = join(homedir(), '.compend', 'config.json');
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Compend: config.json parse error — using defaults:', e.message);
    return {};
  }
}

function resolveTilde(p) {
  if (typeof p === 'string' && p.startsWith('~')) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

function applyEnvOverrides(cfg) {
  if (process.env.COMPEND_PORT && process.env.COMPEND_PORT.trim()) {
    cfg.port = parseInt(process.env.COMPEND_PORT.trim(), 10) || cfg.port;
  }
  if (process.env.COMPEND_DB_PATH && process.env.COMPEND_DB_PATH.trim()) {
    cfg.dbPath = resolveTilde(process.env.COMPEND_DB_PATH.trim());
  }
}

let _cfg = null;

export function getConfig() {
  if (_cfg) return _cfg;
  const defaults = JSON.parse(JSON.stringify(DEFAULTS));
  _cfg = deepMerge(defaults, readConfigFile());
  applyEnvOverrides(_cfg);
  _cfg.dbPath = resolveTilde(_cfg.dbPath);
  return _cfg;
}

export function getDbPath() {
  const path = getConfig().dbPath;
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return path;
}

export function resolveTypeSchema(type) {
  const schemas = getConfig().schemas || {};
  const projectSchema = schemas.default || {};
  const types = projectSchema.types || {};
  return types[type] || null;
}

export function getIndexPaths() {
  const paths = [];

  try {
    const opencodePaths = [
      join(homedir(), '.config', 'opencode', 'opencode.json'),
    ];
    for (const p of opencodePaths) {
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf-8').trim();
        if (raw) {
          const cfg = JSON.parse(raw);
          if (cfg.skills && Array.isArray(cfg.skills.paths)) {
            for (const sp of cfg.skills.paths) {
              paths.push(resolveTilde(sp));
            }
          }
          if (cfg.instructions && Array.isArray(cfg.instructions)) {
            for (const ip of cfg.instructions) {
              paths.push(resolveTilde(ip));
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('Compend: could not read opencode.json:', e.message);
  }

  try {
    const compendCfg = readConfigFile();
    if (compendCfg.index && Array.isArray(compendCfg.index.paths)) {
      for (const p of compendCfg.index.paths) {
        paths.push(resolveTilde(p));
      }
    }
  } catch (e) {
    console.warn('Compend: could not read compend config paths:', e.message);
  }

  return paths;
}
