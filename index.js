#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { initDb, indexConcepts, indexFile, deindexConcepts, searchHybrid, getConcept, getConceptContext, listConcepts } from './db.js';
import { getConfig } from './config.js';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DASH_PORT = getConfig().port;

function notifyDash(event, data) {
  const body = JSON.stringify({ event, ...data });
  const req = http.request(`http://127.0.0.1:${DASH_PORT}/api/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  });
  req.on('error', () => {});
  req.write(body);
  req.end();

  const subscribers = getConfig().notifySubscribers;
  if (!subscribers.length) return;

  for (const name of subscribers) {
    try {
      const manifestPath = join(homedir(), '.' + name, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.notifyEndpoint) {
        const ext = http.request(manifest.notifyEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        });
        ext.on('error', () => {});
        ext.write(body);
        ext.end();
      }
    } catch {}
  }
}

const db = initDb();

process.on('SIGTERM', () => { try { db.close(); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { db.close(); } catch {} process.exit(0); });

const server = new Server(
  { name: 'compend', version: '2.0.3' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'compend_index',
      description: 'Mirror the filesystem source of truth into the index. No args scans all configured paths. Pass { path } to index a single .md file or a directory (recursively).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional. Absolute path to a .md file or directory to index.' }
        },
        required: []
      }
    },
    {
      name: 'compend_search',
      description: 'Hybrid FTS + vector search across indexed concepts. Returns metadata with snippet and relevance score.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query text' },
          type: { type: 'array', items: { type: 'string' }, description: 'Optional. Filter by concept types (e.g. ["skill", "reference"])' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional. Filter by tags (AND match)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
          alpha: { type: 'number', description: 'Vector weight 0-1, 0=only FTS, 1=only vector (default 0.3)' }
        },
        required: ['query']
      }
    },
    {
      name: 'compend_get',
      description: 'Retrieve a full concept by slug. Set resolve_dependencies:true to recursively fetch all dependency bodies in one call (resolved[] array).',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Concept slug (e.g. "wp-image-to-blocks")' },
          resolve_dependencies: { type: 'boolean', description: 'If true, recursively resolve dependency bodies. Returns a resolved[] array with full concept objects.' }
        },
        required: ['slug']
      }
    },
    {
      name: 'compend_list',
      description: 'List concepts with optional filters. Returns compact metadata (no body).',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Optional. Filter by concept type' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional. Filter by tags (AND match)' },
          status: { type: 'string', description: 'Optional. Filter by status (stable, draft, deprecated)' },
          limit: { type: 'number', description: 'Max results (default 50)' },
          offset: { type: 'number', description: 'Pagination offset (default 0)' }
        },
        required: []
      }
    },
    {
      name: 'compend_deindex',
      description: 'Remove concepts from the index. Pass { slug } to remove one concept, or { path } to remove all concepts under a directory path. Files on disk are never touched.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Concept slug to remove' },
          path: { type: 'string', description: 'Directory or file path — all concepts whose file_path starts with this are removed' }
        },
        required: []
      }
    },
    {
      name: 'compend_context',
      description: 'Retrieve a concept body as formatted text for prompt injection. Returns (type) slug: title followed by the full markdown body. Use for local and remote concept retrieval in a single call.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Concept slug (e.g. "wp-image-to-blocks")' }
        },
        required: ['slug']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'compend_index': {
        let result;
        if (args.path) {
          result = indexFile(args.path);
        } else {
          result = indexConcepts();
        }
        notifyDash('index_complete', {
          added: result.added.length,
          updated: result.updated.length,
          removed: result.removed.length,
          total: result.total
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'compend_search': {
        const { concepts: results } = searchHybrid(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      }

      case 'compend_get': {
        const concept = getConcept(args.slug, !!args.resolve_dependencies);
        if (!concept) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Concept not found: ' + args.slug }) }],
            isError: true
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(concept, null, 2) }]
        };
      }

      case 'compend_list': {
        const results = listConcepts(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      }

      case 'compend_deindex': {
        const result = deindexConcepts(args);
        notifyDash('index_complete', {
          added: 0,
          updated: 0,
          removed: result.removed.length,
          total: result.total
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'compend_context': {
        const text = getConceptContext(args.slug);
        if (!text) {
          return {
            content: [{ type: 'text', text: 'Concept not found: ' + args.slug }],
            isError: true
          };
        }
        return {
          content: [{ type: 'text', text: text }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const msg = err.message && err.message.includes('/') ? 'Internal error' : err.message;
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
