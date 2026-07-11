import Database from 'better-sqlite3';
import { load } from 'sqlite-vec';
import { load as yamlLoad, JSON_SCHEMA } from 'js-yaml';
import { createEmbedding } from './embedding.js';
import { getDbPath, getConfig, resolveTypeSchema, getIndexPaths } from './config.js';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath, sep } from 'node:path';
import { createHash } from 'node:crypto';

let db;

export function initDb() {
  if (db) return db;

  const path = getDbPath();
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  load(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS concepts (
      id              INTEGER PRIMARY KEY,
      slug            TEXT NOT NULL UNIQUE,
      type            TEXT NOT NULL,
      title           TEXT,
      description     TEXT,
      tags            TEXT,
      status          TEXT DEFAULT 'stable',
      frontmatter     TEXT NOT NULL DEFAULT '{}',
      body            TEXT NOT NULL,
      file_path       TEXT,
      file_hash       TEXT,
      source          TEXT DEFAULT 'local',
      timestamp       TEXT,
      resource        TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      last_synced_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_concepts_type ON concepts(type);
    CREATE INDEX IF NOT EXISTS idx_concepts_slug ON concepts(slug);
    CREATE INDEX IF NOT EXISTS idx_concepts_status ON concepts(status);
    CREATE INDEX IF NOT EXISTS idx_concepts_source ON concepts(source);

    CREATE VIRTUAL TABLE IF NOT EXISTS concepts_fts USING fts5(
      title, description, tags, body,
      content=concepts,
      content_rowid=id,
      tokenize='unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS concepts_vec USING vec0(
      embedding float[256]
    );
  `);

  // Migrations
  try { db.exec('ALTER TABLE concepts ADD COLUMN timestamp TEXT'); } catch {}
  try { db.exec('ALTER TABLE concepts ADD COLUMN resource TEXT'); } catch {}
  try { db.exec('ALTER TABLE concepts ADD COLUMN body_length INTEGER DEFAULT 0'); } catch {}
  try { db.exec("UPDATE concepts SET body_length = LENGTH(body) WHERE body_length = 0 AND body != ''"); } catch {}

  const needsAutoIndex = db.prepare('SELECT COUNT(*) as c FROM concepts').get().c === 0;
  if (needsAutoIndex) {
    autoIndex();
  }

  return db;
}

function autoIndex() {
  const paths = getIndexPaths();
  if (paths.length === 0) return;
  try {
    indexConcepts(paths);
  } catch (e) {
    console.warn('Compend: auto-index failed:', e.message);
  }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const frontmatter = yamlLoad(match[1], { schema: JSON_SCHEMA }) || {};
    return { frontmatter, body: content.slice(match[0].length) };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

function normalizeTags(input) {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

let _instructionPaths = null;
function getInstructionPaths() {
  if (_instructionPaths) return _instructionPaths;
  _instructionPaths = new Set();
  try {
    const paths = getIndexPaths();
    for (const p of paths) {
      if (p.endsWith('.md') && !p.includes('/skills/') && !p.includes('/editorial-skills/')) {
        _instructionPaths.add(p);
      }
    }
  } catch {}
  return _instructionPaths;
}

function inferType(pathStr, frontmatter) {
  if (frontmatter.type) return frontmatter.type;
  const lower = pathStr.toLowerCase();
  if (lower.includes('/references/')) return 'reference';
  if (lower.includes('/example/')) return 'reference';
  if (lower.endsWith('skill.md')) return 'skill';
  if (lower.includes('/skills/')) return 'skill';
  if (getInstructionPaths().has(pathStr)) return 'instruction';
  if (lower.includes('instruction')) return 'instruction';
  if (lower.includes('agent')) return 'agent';
  if (lower.includes('prompt')) return 'prompt';
  if (lower.includes('workflow')) return 'workflow';
  return 'reference';
}

function deriveSlug(filePath, scanPaths) {
  for (const scanPath of scanPaths) {
    if (filePath.startsWith(scanPath + sep) || filePath.startsWith(scanPath)) {
      let rel = relative(scanPath, filePath);
      if (!rel || rel === '.' || rel === '') {
        rel = filePath.split(sep).pop();
      }
      const hasDir = rel.includes(sep) || rel.includes('/');
      rel = rel.replace(/\.md$/i, '');
      rel = rel.replace(/\/SKILL$/i, '');
      if (!hasDir) {
        const normed = scanPath.replace(/\/+$/, '');
        const segments = normed.split(sep).filter(Boolean);
        let prefix = (segments[segments.length - 1] || '').replace(/\.md$/i, '');
        if (prefix === 'skills' && segments.length > 1) {
          prefix = segments[segments.length - 2] + '/' + prefix;
        }
        if (prefix && rel !== prefix) rel = prefix + '/' + rel;
      }
      return rel || filePath.split(sep).pop().replace(/\.md$/i, '');
    }
  }
  const parts = filePath.split(sep);
  const name = parts[parts.length - 1].replace(/\.md$/i, '');
  return name;
}

function indexSingleFile(filePath, scanPaths) {
  const content = readFileSync(filePath, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex');
  const slug = deriveSlug(filePath, scanPaths);

  const existing = db.prepare('SELECT id, file_hash FROM concepts WHERE file_path = ?').get(filePath);
  if (existing && existing.file_hash === hash) {
    return { slug, action: 'skipped' };
  }

  const { frontmatter, body } = parseFrontmatter(content);
  const type = inferType(filePath, frontmatter);
  const schema = resolveTypeSchema(type);
  let status = frontmatter.status || (schema ? schema.defaults.status : 'stable');
  if (schema && schema.statuses && schema.statuses.length > 0 && !schema.statuses.includes(status)) {
    status = schema.defaults.status;
  }

  const title = frontmatter.title || frontmatter.name || '';
  const description = frontmatter.description || '';
  const tags = JSON.stringify(normalizeTags(frontmatter.tags));
  const frontmatterJson = JSON.stringify(frontmatter);
  const timestamp = frontmatter.timestamp || null;
  const resource = frontmatter.resource || null;
  const bodyLength = body.length;

  const now = Math.floor(Date.now() / 1000);
  const embedding = createEmbedding(body);

  if (existing) {
    db.prepare(`
      UPDATE concepts SET type=?, title=?, description=?, tags=?, status=?, frontmatter=?, body=?,
      body_length=?, file_hash=?, timestamp=?, resource=?, updated_at=?
      WHERE id=?
    `).run(type, title, description, tags, status, frontmatterJson, body, bodyLength, hash, timestamp, resource, now, existing.id);

    db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(existing.id);
    db.prepare('INSERT INTO concepts_fts (rowid, title, description, tags, body) VALUES (?, ?, ?, ?, ?)')
      .run(existing.id, title, description, tags, body);

    db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(existing.id);
    db.prepare('INSERT INTO concepts_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
      .run(existing.id, Buffer.from(embedding.buffer));

    return { slug, action: 'updated' };
  }

  const result = db.prepare(`
    INSERT INTO concepts (slug, type, title, description, tags, status, frontmatter, body, body_length, file_path, file_hash, source, timestamp, resource, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, ?)
  `).run(slug, type, title, description, tags, status, frontmatterJson, body, bodyLength, filePath, hash, timestamp, resource, now, now);

  const id = result.lastInsertRowid;
  db.prepare('INSERT INTO concepts_fts (rowid, title, description, tags, body) VALUES (?, ?, ?, ?, ?)')
    .run(id, title, description, tags, body);
  db.prepare('INSERT INTO concepts_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
    .run(id, Buffer.from(embedding.buffer));

  return { slug, action: 'added' };
}

export function indexFile(absolutePath) {
  initDb();
  const added = [], updated = [], removed = [];

  if (!existsSync(absolutePath)) {
    const existing = db.prepare("SELECT id, slug FROM concepts WHERE file_path = ? AND source = 'local'").get(absolutePath);
    if (existing) {
      db.prepare('DELETE FROM concepts WHERE id = ?').run(existing.id);
      db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(existing.id);
      db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(existing.id);
      removed.push(existing.slug);
    }
    return { added, updated, removed, total: db.prepare('SELECT COUNT(*) as c FROM concepts').get().c };
  }

  const st = statSync(absolutePath);

  if (st.isDirectory()) {
    const files = [];
    walkDir(absolutePath, files);
    const scanPaths = [absolutePath];

    for (const filePath of files) {
      const result = indexSingleFile(filePath, scanPaths);
      if (result.action === 'added') added.push(result.slug);
      if (result.action === 'updated') updated.push(result.slug);
    }
  } else {
    const paths = getIndexPaths();
    const result = indexSingleFile(absolutePath, paths);
    if (result.action === 'added') added.push(result.slug);
    if (result.action === 'updated') updated.push(result.slug);
  }

  return { added, updated, removed, total: db.prepare('SELECT COUNT(*) as c FROM concepts').get().c };
}

export function deindexConcepts({ slug, path } = {}) {
  initDb();
  const removed = [];

  if (slug) {
    const concept = db.prepare("SELECT id, slug FROM concepts WHERE slug = ? AND source = 'local'").get(slug);
    if (concept) {
      db.prepare('DELETE FROM concepts WHERE id = ?').run(concept.id);
      db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(concept.id);
      db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(concept.id);
      removed.push(concept.slug);
    }
  } else if (path) {
    const rows = db.prepare("SELECT id, slug FROM concepts WHERE file_path LIKE ? AND source = 'local'").all(path + '%');
    for (const r of rows) {
      db.prepare('DELETE FROM concepts WHERE id = ?').run(r.id);
      db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(r.id);
      db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(r.id);
      removed.push(r.slug);
    }
  }

  return { removed, total: db.prepare('SELECT COUNT(*) as c FROM concepts').get().c };
}

const SKIP_FILES = new Set(['readme.md', 'changelog.md', 'contributing.md', 'license.md']);

function walkDir(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      walkDir(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.md') && !SKIP_FILES.has(entry.name.toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

export function indexConcepts(scanPaths) {
  initDb();
  const paths = scanPaths || getIndexPaths();
  const added = [], updated = [];
  const currentFiles = new Set();
  const allPaths = [];

  for (const p of paths) {
    if (!existsSync(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) {
      walkDir(p, allPaths);
    } else if (st.isFile() && p.endsWith('.md')) {
      allPaths.push(p);
    }
  }

  for (const filePath of allPaths) {
    const result = indexSingleFile(filePath, paths);
    currentFiles.add(filePath);
    if (result.action === 'added') added.push(result.slug);
    if (result.action === 'updated') updated.push(result.slug);
  }

  const removed = [];
  const localConcepts = db.prepare('SELECT id, slug, file_path FROM concepts WHERE source = \'local\'').all();
  for (const c of localConcepts) {
    if (!currentFiles.has(c.file_path)) {
      db.prepare('DELETE FROM concepts WHERE id = ?').run(c.id);
      db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(c.id);
      db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(c.id);
      removed.push(c.slug);
    }
  }

  return { added, updated, removed, total: db.prepare('SELECT COUNT(*) as c FROM concepts').get().c };
}

export function searchHybrid({ query, type, tags, limit, alpha } = {}) {
  initDb();
  const cfg = getConfig();
  const searchLimit = limit || cfg.search.limit;
  const alphaValue = alpha !== undefined ? alpha : cfg.search.alpha;

  let vectorResults = [];
  if (alphaValue > 0) {
    const queryEmbedding = createEmbedding(query);
    let vecSql = `SELECT c.id, vec_distance_cosine(v.embedding, ?) AS distance
      FROM concepts c
      JOIN concepts_vec v ON v.rowid = c.id
      WHERE v.embedding MATCH ?`;
    const vecParams = [Buffer.from(queryEmbedding.buffer), Buffer.from(queryEmbedding.buffer)];

    if (type) {
      const types = Array.isArray(type) ? type : [type];
      if (types.length > 0) {
        vecSql += ' AND c.type IN (' + types.map(() => '?').join(',') + ')';
        vecParams.push(...types);
      }
    }

    vecSql += ' ORDER BY distance LIMIT ?';
    vecParams.push(Math.max(searchLimit * 3, 50));

    try {
      vectorResults = db.prepare(vecSql).all(...vecParams);
    } catch {}
  }

  let ftsResults = [];
  const escapedQuery = query.replace(/"/g, '').replace(/'/g, '');
  if (escapedQuery.trim()) {
    let ftsSql = `SELECT c.id, c.slug, c.type, c.title, c.description, c.tags, c.status, c.source, c.body_length,
      bm25(concepts_fts, 0) AS rank
      FROM concepts c
      JOIN concepts_fts f ON f.rowid = c.id
      WHERE concepts_fts MATCH ?`;
    const ftsParams = ['"' + escapedQuery.replace(/\s+/g, '" OR "') + '"'];

    if (type) {
      const types = Array.isArray(type) ? type : [type];
      if (types.length > 0) {
        ftsSql += ' AND c.type IN (' + types.map(() => '?').join(',') + ')';
        ftsParams.push(...types);
      }
    }
    ftsSql += ' ORDER BY rank LIMIT ?';
    ftsParams.push(Math.max(searchLimit * 3, 50));

    try {
      ftsResults = db.prepare(ftsSql).all(...ftsParams);
    } catch {}
  }

  if (ftsResults.length === 0 && vectorResults.length === 0) return [];

  const scores = new Map();

  if (ftsResults.length > 0) {
    const maxRank = Math.max(...ftsResults.map(r => Math.abs(r.rank)), 1);
    for (const r of ftsResults) {
      const normalized = 1 - (Math.abs(r.rank) / maxRank);
      scores.set(r.id, { id: r.id, slug: r.slug, type: r.type, title: r.title,
        description: r.description, tags: r.tags, status: r.status, source: r.source, body_length: r.body_length, score: normalized });
    }
  }

  if (vectorResults.length > 0) {
    const maxDist = Math.max(...vectorResults.map(r => r.distance), 1);
    for (const r of vectorResults) {
      const normalized = 1 - (r.distance / maxDist);
      if (scores.has(r.id)) {
        scores.get(r.id).score = (1 - alphaValue) * scores.get(r.id).score + alphaValue * normalized;
      } else {
        const concept = db.prepare('SELECT c.id, c.slug, c.type, c.title, c.description, c.tags, c.status, c.source, c.body_length FROM concepts c WHERE c.id = ?').get(r.id);
        if (concept) {
          scores.set(r.id, { ...concept, score: alphaValue * normalized });
        }
      }
    }
  }

  if (tags && tags.length > 0) {
    for (const [id, entry] of scores) {
      const conceptTags = typeof entry.tags === 'string' ? JSON.parse(entry.tags || '[]') : (entry.tags || []);
      const hasAll = tags.every(t => conceptTags.includes(t));
      if (!hasAll) scores.delete(id);
    }
  }

  const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score).slice(0, searchLimit);

  return sorted.map(r => {
    let tagsParsed = typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : (r.tags || []);
    let snippet = '';
    if (r.description) {
      snippet = r.description;
    } else {
      const raw = db.prepare('SELECT body FROM concepts WHERE id = ?').get(r.id);
      if (raw) snippet = raw.body.slice(0, 200).replace(/\n/g, ' ');
    }
    return {
      id: r.id,
      slug: r.slug,
      type: r.type,
      title: r.title,
      description: r.description,
      tags: tagsParsed,
      status: r.status,
      source: r.source,
      body_length: r.body_length || 0,
      approx_tokens: Math.round((r.body_length || 0) / 4),
      score: Math.round(r.score * 100) / 100,
      snippet
    };
  });
}

export function getConcept(slug, resolveDeps = false, visited = new Set()) {
  initDb();
  const concept = db.prepare('SELECT * FROM concepts WHERE slug = ?').get(slug);
  if (!concept) return null;

  let frontmatter = {};
  try { frontmatter = JSON.parse(concept.frontmatter || '{}'); } catch {}

  const references = db.prepare('SELECT slug, title, type FROM concepts WHERE slug LIKE ? ESCAPE \'\\\' AND source = ?')
    .all(slug.replace(/_/g, '\\_').replace(/%/g, '\\%') + '/%', concept.source)
    .map(r => ({ slug: r.slug, title: r.title, type: r.type }));

  let dependencies = [];
  if (frontmatter.dependencies && Array.isArray(frontmatter.dependencies)) {
    for (const depSlug of frontmatter.dependencies) {
      const dep = db.prepare('SELECT title FROM concepts WHERE slug = ?').get(depSlug);
      dependencies.push({ slug: depSlug, title: dep ? dep.title : null });
    }
  }

  let resolved = [];
  if (resolveDeps) {
    visited.add(slug);
    for (const dep of dependencies) {
      if (!visited.has(dep.slug)) {
        const fullDep = getConcept(dep.slug, true, visited);
        if (fullDep) resolved.push(fullDep);
      }
    }
  }

  const result = {
    id: concept.id,
    slug: concept.slug,
    type: concept.type,
    title: concept.title,
    description: concept.description,
    tags: typeof concept.tags === 'string' ? JSON.parse(concept.tags || '[]') : (concept.tags || []),
    status: concept.status,
    source: concept.source,
    timestamp: concept.timestamp,
    resource: concept.resource,
    body_length: concept.body_length,
    approx_tokens: Math.round((concept.body_length || 0) / 4),
    frontmatter,
    body: concept.body,
    references,
    dependencies
  };
  if (resolveDeps) result.resolved = resolved;
  return result;
}

export function getConceptContext(slug) {
  initDb();
  const concept = db.prepare(
    'SELECT type, title, body FROM concepts WHERE slug = ?'
  ).get(slug);
  if (!concept) return null;
  return `(${concept.type}) ${slug}: ${concept.title || ''}\n\n${concept.body}`;
}

export function listConcepts({ type, tags, status, limit, offset } = {}) {
  initDb();
  const cfg = getConfig();
  const listLimit = limit || cfg.dashboard.paginationLimit;
  const listOffset = offset || 0;

  const conditions = [];
  const params = [];

  if (type) { conditions.push('type = ?'); params.push(type); }
  if (status) { conditions.push('status = ?'); params.push(status); }

  let whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  if (tags && tags.length > 0) {
    const tagConditions = tags.map(() => 'tags LIKE ?').join(' AND ');
    whereClause += (conditions.length > 0 ? ' AND ' : 'WHERE ') + tagConditions;
    for (const t of tags) params.push('%"' + t + '"%');
  }

  const total = db.prepare('SELECT COUNT(*) as c FROM concepts ' + whereClause).get(...params).c;
  const rows = db.prepare('SELECT id, slug, type, title, description, tags, status, source, timestamp, resource, body_length, created_at, updated_at FROM concepts ' + whereClause + ' ORDER BY updated_at DESC LIMIT ? OFFSET ?')
    .all(...params, listLimit, listOffset)
    .map(r => ({
      id: r.id,
      slug: r.slug,
      type: r.type,
      title: r.title,
      description: r.description,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : (r.tags || []),
      status: r.status,
      source: r.source,
      timestamp: r.timestamp,
      body_length: r.body_length,
      approx_tokens: Math.round((r.body_length || 0) / 4)
    }));

  return { concepts: rows, total, limit: listLimit, offset: listOffset };
}

export function getTags(type) {
  initDb();
  let sql = 'SELECT DISTINCT tags FROM concepts';
  const params = [];
  if (type) { sql += ' WHERE type = ?'; params.push(type); }
  const rows = db.prepare(sql).all(...params);
  const counts = new Map();
  for (const r of rows) {
    const list = typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : (r.tags || []);
    for (const t of list) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function getChanges(since) {
  initDb();
  const ts = typeof since === 'number' ? since : Math.floor(new Date(since).getTime() / 1000);
  const rows = db.prepare('SELECT id, slug, type, title, status FROM concepts WHERE updated_at > ? ORDER BY updated_at DESC').all(ts);
  return rows;
}

export function getDeps(slug) {
  initDb();
  const concept = db.prepare('SELECT frontmatter FROM concepts WHERE slug = ?').get(slug);
  if (!concept) return { dependencies: [], dependents: [] };

  let frontmatter = {};
  try { frontmatter = JSON.parse(concept.frontmatter || '{}'); } catch {}

  const dependencies = (frontmatter.dependencies || []).map(depSlug => {
    const dep = db.prepare('SELECT title FROM concepts WHERE slug = ?').get(depSlug);
    return { slug: depSlug, title: dep ? dep.title : null };
  });

  const dependents = db.prepare('SELECT slug, title FROM concepts WHERE frontmatter LIKE ?')
    .all('%' + slug + '%')
    .filter(r => {
      try {
        const fm = JSON.parse(r.frontmatter || '{}');
        return fm.dependencies && fm.dependencies.includes(slug);
      } catch { return false; }
    })
    .map(r => ({ slug: r.slug, title: r.title }));

  return { dependencies, dependents };
}
