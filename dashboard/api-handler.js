import { searchHybrid, getConcept, listConcepts, getTags, getChanges, getDeps } from '../db.js';
import { getConfig } from '../config.js';

export function json(data, status = 200) {
  return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

export function err(msg, status = 500) {
  return json({ error: msg }, status);
}

export function createApiHandler(db) {
  return function handleApi(path, method, params) {
    if (path === '/api/stats' && method === 'GET') {
      const total = db.prepare('SELECT COUNT(*) as c FROM concepts').get().c;
      const types = db.prepare('SELECT type, COUNT(*) as c FROM concepts GROUP BY type ORDER BY c DESC').all().map(r => ({ type: r.type, count: r.c }));
      return json({ total, types });
    }

    if (path === '/api/tags' && method === 'GET') {
      const type = params.get('type') || '';
      const results = getTags(type || undefined);
      return json({ tags: results });
    }

    if (path === '/api/concepts' && method === 'GET') {
      const type = params.get('type') || '';
      const status = params.get('status') || '';
      const search = params.get('search') || '';
      const tagsRaw = params.get('tags') || '';
      const maxLimit = getConfig().dashboard.maxLimit;
      const limit = Math.min(parseInt(params.get('limit') || String(getConfig().dashboard.paginationLimit), 10), maxLimit);
      const offset = Math.max(parseInt(params.get('offset') || '0', 10), 0);

      if (search.trim()) {
        try {
          const rows = searchHybrid({ query: search, type: type || undefined, limit, alpha: getConfig().search.alpha });
          return json({ concepts: rows, total: rows.length, limit, offset });
        } catch (e) {
          return err('Search error', 400);
        }
      }

      const result = listConcepts({
        type: type || undefined,
        status: status || undefined,
        tags: tagsRaw ? tagsRaw.split(',').filter(Boolean) : undefined,
        limit,
        offset
      });
      return json(result);
    }

    const conceptMatch = path.match(/^\/api\/concepts\/(.+)$/);
    if (conceptMatch && method === 'GET') {
      const slug = decodeURIComponent(conceptMatch[1]);
      const concept = getConcept(slug);
      if (!concept) return err('Concept not found', 404);
      return json(concept);
    }

    if (path === '/api/changes' && method === 'GET') {
      const since = params.get('since') || '0';
      const results = getChanges(parseInt(since, 10) || 0);
      return json({ changes: results });
    }

    const depsMatch = path.match(/^\/api\/deps\/(.+)$/);
    if (depsMatch && method === 'GET') {
      const slug = decodeURIComponent(depsMatch[1]);
      const results = getDeps(slug);
      return json(results);
    }

    return null;
  };
}
