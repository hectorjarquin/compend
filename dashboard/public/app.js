let state = { type: '', status: '', search: '', tags: [], limit: 20, offset: 0, total: 0 };
let loadVersion = 0;
let expandedSlug = null;

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function timeAgo(ts) {
  const sec = Math.floor(Date.now() / 1000 - ts);
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

function typeClass(t) {
  t = (t || '').toLowerCase();
  if (t.startsWith('skill')) return 'skill';
  if (t.startsWith('agent')) return 'agent';
  if (t.startsWith('instr')) return 'instruction';
  if (t.startsWith('prompt')) return 'prompt';
  if (t.startsWith('workflow')) return 'workflow';
  if (t.startsWith('ref')) return 'reference';
  return 'default';
}

/* ─────────── TOASTS ─────────── */

function toast(msg, type, duration) {
  type = type || 'info';
  duration = duration || 4000;
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  container.appendChild(el);
  const timer = setTimeout(() => removeToast(el), duration);
  el._timer = timer;
}

function removeToast(el) {
  if (el._removing) return;
  el._removing = true;
  clearTimeout(el._timer);
  el.classList.add('removing');
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
}

/* ─────────── SKELETON ─────────── */

function showSkeleton() {
  const tbody = document.getElementById('tbody');
  const skeleton = document.getElementById('loading-skeleton');
  if (skeleton) skeleton.style.display = '';
  if (tbody) tbody.innerHTML = '';
}

function hideSkeleton() {
  const skeleton = document.getElementById('loading-skeleton');
  if (skeleton) skeleton.style.display = 'none';
}

function initSkeleton() {
  const tbody = document.getElementById('skeleton-body');
  if (!tbody) return;
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push('<tr class="skeleton-row"><td class="skeleton-cell tiny"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell wide"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell tiny"></td></tr>');
  }
  tbody.innerHTML = rows.join('');
}

/* ─────────── DETAIL TOGGLE ─────────── */

function toggleDetail(slug) {
  const detail = document.querySelector('.detail-row[data-slug="' + CSS.escape(slug) + '"]');
  if (!detail) return;
  const open = detail.style.display !== 'none';
  if (open) {
    detail.style.display = 'none';
    detail.querySelector('.detail').classList.remove('open');
    expandedSlug = null;
  } else {
    if (expandedSlug) {
      const prev = document.querySelector('.detail-row[data-slug="' + CSS.escape(expandedSlug) + '"]');
      if (prev) {
        prev.style.display = 'none';
        prev.querySelector('.detail').classList.remove('open');
      }
    }
    detail.style.display = '';
    detail.querySelector('.detail').classList.add('open');
    expandedSlug = slug;
    loadConceptBody(slug, detail.querySelector('.detail'));
  }
}

async function loadConceptBody(slug, detailEl) {
  try {
    const r = await fetch('/api/concepts/' + encodeURIComponent(slug));
    if (!r.ok) throw new Error('Failed to load');
    const concept = await r.json();
    const fm = concept.frontmatter ? JSON.stringify(concept.frontmatter, null, 2) : '{}';
    const refs = (concept.references || []).length
      ? '\n\nReferences:\n' + concept.references.map(ref => '  • ' + esc(ref.slug) + ' (' + esc(ref.type) + ')').join('\n')
      : '';
    const deps = (concept.dependencies || []).length
      ? '\n\nDependencies:\n' + concept.dependencies.map(d => '  • ' + esc(d.slug) + (d.title ? ' — ' + esc(d.title) : '')).join('\n')
      : '';
    detailEl.innerHTML = '<pre>' + esc(concept.body) + '\n\n─── Frontmatter ───\n' + esc(fm) + refs + deps + '</pre>';
  } catch (e) {
    detailEl.innerHTML = '<pre>Error loading concept</pre>';
  }
}

/* ─────────── API ─────────── */

function showError(msg) {
  const el = document.getElementById('error');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
  console.error(msg);
}

async function loadStatsAndTypes() {
  const r = await fetch('/api/stats');
  if (!r.ok) throw new Error('Failed to load stats');
  const data = await r.json();
  const stats = document.getElementById('stats');
  stats.textContent = data.total + ' concept' + (data.total !== 1 ? 's' : '') + ' · '
    + data.types.map(t => t.type + ': ' + t.count).join(' · ');

  const sel = document.getElementById('type');
  const current = sel.value;
  sel.innerHTML = '<option value="">all</option>' + data.types.map(t =>
    '<option value="' + esc(t.type) + '">' + esc(t.type) + ' (' + t.count + ')</option>'
  ).join('');
  if (data.types.some(t => t.type === current)) sel.value = current;
  else sel.value = '';
  state.type = sel.value;
}

async function loadTags() {
  const r = await fetch('/api/tags' + (state.type ? '?type=' + encodeURIComponent(state.type) : ''));
  if (!r.ok) return;
  const data = await r.json();
  const bar = document.getElementById('tags-filter');
  if (data.tags.length === 0) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = data.tags.map(t =>
    '<label class="tag-check"><input type="checkbox" value="' + esc(t.name) + '"'
    + (state.tags.includes(t.name) ? ' checked' : '')
    + '> ' + esc(t.name) + ' <span class="tag-count">' + t.count + '</span></label>'
  ).join('');
}

async function loadConcepts() {
  const version = ++loadVersion;
  showSkeleton();

  const params = new URLSearchParams();
  if (state.type) params.set('type', state.type);
  if (state.status) params.set('status', state.status);
  params.set('limit', state.limit);
  params.set('offset', state.offset);
  if (state.search) params.set('search', state.search);
  if (state.tags.length) params.set('tags', state.tags.join(','));

  const r = await fetch('/api/concepts?' + params.toString());
  if (!r.ok) throw new Error('Failed to load concepts');
  const data = await r.json();
  if (version !== loadVersion) return;

  hideSkeleton();
  document.getElementById('error').style.display = 'none';

  const concepts = data.concepts || [];
  state.total = data.total;

  const tbody = document.getElementById('tbody');
  const pagination = document.getElementById('pagination');

  if (concepts.length === 0) {
    const msg = state.search ? 'No results for "' + esc(state.search) + '"' : 'No concepts indexed';
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty">' + msg + '</div></td></tr>';
    pagination.innerHTML = '';
    return;
  }

  let savedScroll = 0;
  if (expandedSlug) {
    const el = document.querySelector('.detail-row[data-slug="' + CSS.escape(expandedSlug) + '"] .detail');
    if (el) savedScroll = el.scrollTop;
  }

  tbody.innerHTML = concepts.map(function (c) {
    const tc = typeClass(c.type);
    const tagPills = (c.tags || []).map(function (t) { return '<span class="tag-pill">' + esc(t) + '</span>'; }).join(' ');
    return '<tr class="concept-row" data-slug="' + esc(c.slug) + '" tabindex="0" role="button" aria-label="Concept: ' + esc(c.title || c.slug) + '">'
      + '<td><span class="type-badge type-' + tc + '">' + esc(c.type) + '</span></td>'
      + '<td class="title-cell">' + esc(c.title || c.slug) + '</td>'
      + '<td class="desc-cell">' + esc(c.description || '') + '</td>'
      + '<td class="tags-cell">' + (tagPills || '<span class="related-none">—</span>') + '</td>'
      + '<td class="status-cell">' + (c.status ? '<span class="status-badge status-' + c.status + '">' + esc(c.status) + '</span>' : '<span class="related-none">—</span>') + '</td></tr>'
      + '<tr class="detail-row" data-slug="' + esc(c.slug) + '" style="display:none"><td colspan="5"><div class="detail"><pre>Loading...</pre></div></td></tr>';
  }).join('');

  if (expandedSlug) {
    const detail = tbody.querySelector('.detail-row[data-slug="' + CSS.escape(expandedSlug) + '"]');
    if (detail) {
      detail.style.display = '';
      detail.querySelector('.detail').classList.add('open');
      if (savedScroll > 0) {
        const el = detail.querySelector('.detail');
        if (el) el.scrollTop = savedScroll;
      }
    }
  }

  const tp = Math.ceil(data.total / state.limit);
  const cp = Math.floor(state.offset / state.limit) + 1;
  pagination.innerHTML = '<button id="page-prev"' + (cp <= 1 ? ' disabled' : '') + ' aria-label="Previous page">← Prev</button>'
    + '<span>Page ' + cp + ' of ' + tp + '</span>'
    + '<button id="page-next"' + (cp >= tp ? ' disabled' : '') + ' aria-label="Next page">Next →</button>';
}

/* ─────────── EVENT WIRING ─────────── */

document.getElementById('type').addEventListener('change', function () {
  state.type = this.value;
  state.offset = 0;
  state.tags = [];
  loadTags().catch(showError);
  loadConcepts().catch(showError);
});

document.getElementById('status').addEventListener('change', function () {
  state.status = this.value;
  state.offset = 0;
  loadConcepts().catch(showError);
});

let searchTimer = null;
document.getElementById('search').addEventListener('input', function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () {
    state.search = this.value.trim();
    state.offset = 0;
    loadConcepts().catch(showError);
  }.bind(this), 200);
});

document.getElementById('tags-filter').addEventListener('change', function (e) {
  if (e.target.type === 'checkbox') {
    if (e.target.checked) {
      state.tags.push(e.target.value);
    } else {
      state.tags = state.tags.filter(t => t !== e.target.value);
    }
    state.offset = 0;
    loadConcepts().catch(showError);
  }
});

document.getElementById('tbody').addEventListener('click', function (e) {
  const row = e.target.closest('.concept-row');
  if (row) {
    toggleDetail(row.dataset.slug);
  }
});

document.getElementById('tbody').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    const row = e.target.closest('.concept-row');
    if (row) {
      e.preventDefault();
      toggleDetail(row.dataset.slug);
    }
  }
});

document.getElementById('pagination').addEventListener('click', function (e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.id === 'page-prev' && state.offset > 0) {
    state.offset = Math.max(0, state.offset - state.limit);
    loadConcepts().catch(showError);
  } else if (btn.id === 'page-next') {
    state.offset += state.limit;
    loadConcepts().catch(showError);
  }
});

document.getElementById('theme-btn').addEventListener('click', function () {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  document.documentElement.setAttribute('data-theme', isLight ? '' : 'light');
  localStorage.setItem('compend-theme', isLight ? 'dark' : 'light');
  this.setAttribute('aria-label', isLight ? 'Switch to dark theme' : 'Switch to light theme');
});

/* ===== SSE: Real-Time Updates ===== */
const es = new EventSource('/api/events');

es.onerror = function () {};

es.addEventListener('index_complete', function (e) {
  try {
    const data = JSON.parse(e.data);
    toast('Index complete: +' + (data.added || 0) + ' ~' + (data.updated || 0) + ' -' + (data.removed || 0), 'success');
    loadConcepts().catch(showError);
    loadStatsAndTypes().catch(showError);
  } catch (_) {}
});

setInterval(function () {
  if (es.readyState === EventSource.CLOSED) {
    loadConcepts().catch(function () {});
  }
}, 30000);

/* Init */
(function () {
  initSkeleton();
  if (document.documentElement.getAttribute('data-theme') === 'light') {
    document.getElementById('theme-btn').setAttribute('aria-label', 'Switch to dark theme');
  }
  loadStatsAndTypes()
    .then(function () { return loadTags(); })
    .then(function () { return loadConcepts(); })
    .catch(showError);
})();
