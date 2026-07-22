let state = { type: '', status: '', search: '', tags: [], limit: 20, offset: 0, total: 0 };
let loadVersion = 0;

var baseBadge = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
var typeColors = {
  skill:       baseBadge + ' bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  agent:       baseBadge + ' bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  instruction: baseBadge + ' bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  prompt:      baseBadge + ' bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  workflow:    baseBadge + ' bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  reference:   baseBadge + ' bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  knowledge:   baseBadge + ' bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
};
var statusColors = {
  stable:     baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  draft:      baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  deprecated: baseBadge + ' bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

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
    rows.push('<tr class="skeleton-row"><td class="skeleton-cell tiny"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell wide"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell tiny"></td><td class="skeleton-cell tiny"></td></tr>');
  }
  tbody.innerHTML = rows.join('');
}

/* ─────────── PREVIEW MODAL ─────────── */

var previewHistory = [];
var previewForward = [];
var previewNavVersion = 0;

function navSlugLabel(slug) {
  return slug.split('/').pop();
}

function renderPreviewNav() {
  document.getElementById('preview-back').disabled = previewHistory.length <= 1;
  document.getElementById('preview-forward').disabled = previewForward.length === 0;
}

function renderPreviewTitle(slug, label) {
  document.getElementById('preview-title').textContent = label || navSlugLabel(slug);
  renderPreviewNav();
}

function renderMeta(c) {
  var el = document.getElementById('preview-meta');
  var parts = [];
  if (c.type) {
    var tc = typeClass(c.type);
    parts.push('<span class="' + (typeColors[tc] || baseBadge + ' bg-muted text-muted-foreground') + '">' + esc(c.type) + '</span>');
  }
  if (c.status) {
    parts.push('<span class="' + (statusColors[c.status] || baseBadge + ' bg-muted text-muted-foreground') + '">' + esc(c.status) + '</span>');
  }
  var ts = c.updated_at || c.created_at || 0;
  if (ts) parts.push('<span class="text-muted-foreground">' + new Date(ts * 1000).toISOString().slice(0, 10) + '</span>');
  el.innerHTML = parts.join(' <span class="text-muted-foreground">·</span> ');
}

function showPreviewLoading() {
  document.getElementById('preview-body').textContent = '';
  document.getElementById('preview-loading').classList.remove('hidden');
}

function hidePreviewLoading() {
  document.getElementById('preview-loading').classList.add('hidden');
}

function renderPreviewBody(concept) {
  document.getElementById('preview-body').textContent = concept.body || 'No content.';
}

function renderPreviewChips(concept) {
  var refBy = concept.referenced_by || [];
  var refs = concept.references || [];

  var refBySelect = document.getElementById('preview-refby-select');
  refBySelect.innerHTML = '<option value="" disabled selected>Referenced by (' + refBy.length + ')</option>' +
    refBy.map(function (a) {
      return '<option value="' + esc(a.slug) + '">' + esc(a.title || a.slug.split('/').pop()) + '</option>';
    }).join('');
  refBySelect.value = '';
  refBySelect.disabled = refBy.length === 0;

  var refSelect = document.getElementById('preview-refs-select');
  refSelect.innerHTML = '<option value="" disabled selected>References (' + refs.length + ')</option>' +
    refs.map(function (r) {
      return '<option value="' + esc(r.slug) + '">' + esc(r.title || r.slug.split('/').pop()) + '</option>';
    }).join('');
  refSelect.value = '';
  refSelect.disabled = refs.length === 0;
}

function navigateConcept(slug) {
  var idx = previewHistory.findIndex(function (h) { return h.slug === slug; });
  if (idx !== -1) {
    var removed = previewHistory.splice(idx + 1);
    previewForward = removed.reverse().concat(previewForward);
  } else {
    if (previewHistory.length >= 10) previewHistory.shift();
    previewHistory.push({ slug: slug, label: navSlugLabel(slug) });
    previewForward = [];
  }

  var version = ++previewNavVersion;
  renderPreviewTitle(slug);
  showPreviewLoading();
  var section = document.querySelector('#preview-dialog section');
  if (section) section.scrollTop = 0;

  fetch('/api/concepts/' + encodeURIComponent(slug))
    .then(function (r) { if (!r.ok) throw new Error('Not found'); return r.json(); })
    .then(function (concept) {
      if (version !== previewNavVersion) return;
      var h = previewHistory[previewHistory.findIndex(function (h) { return h.slug === slug; })];
      if (h) h.label = concept.title || concept.slug;
      hidePreviewLoading();
      renderPreviewTitle(slug, h ? h.label : concept.title);
      renderMeta(concept);
      renderPreviewBody(concept);
      renderPreviewChips(concept);
    })
    .catch(function () {
      if (version !== previewNavVersion) return;
      previewHistory = previewHistory.filter(function (h) { return h.slug !== slug; });
      hidePreviewLoading();
      renderPreviewTitle(slug);
      renderPreviewBody({ body: 'Error loading concept.' });
      toast('Concept not found: ' + slug, 'error');
    });
}

function previewConcept(slug) {
  previewHistory = [];
  previewForward = [];
  previewNavVersion = 0;
  document.getElementById('preview-dialog').showModal();
  navigateConcept(slug);
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
  sel.innerHTML = '<option value="" disabled>Type</option><option value="">all</option>' + data.types.map(t =>
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
  const btn = document.getElementById('tags-toggle');
  btn.textContent = data.tags.length > 0 ? 'Tags (' + data.tags.length + ')' : 'Tags';
  if (data.tags.length === 0) {
    bar.innerHTML = '';
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  bar.innerHTML = data.tags.map(t =>
    '<label class="badge rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground border cursor-pointer inline-flex items-center gap-[0.5em]"><input type="checkbox" value="' + esc(t.name) + '"'
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
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty">' + msg + '</div></td></tr>';
    pagination.innerHTML = '';
    return;
  }

  tbody.innerHTML = concepts.map(function (c) {
    const tc = typeClass(c.type);
    const tagPills = (c.tags || []).map(function (t) { return '<span class="badge rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">' + esc(t) + '</span>'; }).join(' ');
    return '<tr class="border-b border-border last:border-b-0 transition-colors hover:bg-muted/50" data-slug="' + esc(c.slug) + '">'
      + '<td class="title-cell p-2">' + esc(c.title || c.slug) + '</td>'
      + '<td class="p-2"><span class="' + (typeColors[tc] || baseBadge + ' bg-muted text-muted-foreground') + '">' + esc(c.type) + '</span></td>'
      + '<td class="desc-cell p-2">' + esc(c.description || '') + '</td>'
      + '<td class="tags-cell p-2">' + (tagPills || '<span class="text-muted-foreground/60 text-xs">—</span>') + '</td>'
      + '<td class="p-2 align-middle">' + (c.status ? '<span class="' + (statusColors[c.status] || baseBadge + ' bg-muted text-muted-foreground') + '">' + esc(c.status) + '</span>' : '<span class="text-muted-foreground/60 text-xs">—</span>') + '</td>'
      + '<td class="whitespace-nowrap text-sm text-muted-foreground p-2 align-middle" title="' + new Date((c.updated_at || c.created_at || 0) * 1000).toISOString().slice(0, 19).replace('T', ' ') + '">' + timeAgo(c.updated_at || c.created_at) + '</td>'
      + '<td class="p-2"><div class="dropdown-menu">'
      + '<button class="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-accent" aria-haspopup="menu" aria-expanded="false" aria-label="Actions"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>'
      + '<div data-popover aria-hidden="true" class="z-50 rounded-lg bg-popover p-1 shadow-md ring-1 ring-border/10 min-w-40"><div role="menu">'
      + '<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent preview-action" data-slug="' + esc(c.slug) + '">Preview</div>'
      + '</div></div></div></td></tr>';
  }).join('');

  var allMenus = tbody.querySelectorAll('.dropdown-menu');
  var n = allMenus.length;
  if (n > 0) {
    for (var i = 0; i < n; i++) {
      var popover = allMenus[i].querySelector('[data-popover]');
      if (popover) {
        popover.setAttribute('data-align', i >= n - 3 ? 'end' : 'start');
        popover.setAttribute('data-side', 'left');
        popover.style.margin = '0';
      }
    }
  }

  const tp = Math.ceil(data.total / state.limit);
  const cp = Math.floor(state.offset / state.limit) + 1;
  pagination.innerHTML = '<button id="page-prev" class="btn rounded-full cursor-pointer" data-variant="outline" data-size="sm"' + (cp <= 1 ? ' disabled' : '') + ' aria-label="Previous page">← Prev</button>'
    + '<span class="text-[13px]">Page ' + cp + ' of ' + tp + '</span>'
    + '<button id="page-next" class="btn rounded-full cursor-pointer" data-variant="outline" data-size="sm"' + (cp >= tp ? ' disabled' : '') + ' aria-label="Next page">Next →</button>';

  if (window.basecoat && window.basecoat.initAll) {
    setTimeout(function () { window.basecoat.initAll({ force: true }); }, 0);
  }
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

document.getElementById('tags-toggle').addEventListener('click', function () {
  var bar = document.getElementById('tags-filter');
  var visible = !bar.classList.contains('hidden');
  bar.classList.toggle('hidden');
  this.classList.toggle('bg-accent', !visible);
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
  var item = e.target.closest('.preview-action');
  if (item) {
    previewConcept(item.dataset.slug);
    return;
  }
});

document.getElementById('preview-dialog').addEventListener('click', function (e) {
  var nav = e.target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    navigateConcept(nav.dataset.nav);
  }
});

document.getElementById('preview-back').addEventListener('click', function () {
  if (previewHistory.length <= 1) return;
  var current = previewHistory.pop();
  previewForward.unshift(current);
  var prev = previewHistory[previewHistory.length - 1];
  navigateConcept(prev.slug);
});

document.getElementById('preview-forward').addEventListener('click', function () {
  if (previewForward.length === 0) return;
  var next = previewForward.shift();
  previewHistory.push(next);
  navigateConcept(next.slug);
});

document.getElementById('preview-refby-select').addEventListener('change', function () {
  if (this.value) navigateConcept(this.value);
});

document.getElementById('preview-refs-select').addEventListener('change', function () {
  if (this.value) navigateConcept(this.value);
});

document.getElementById('preview-dialog').addEventListener('close', function () {
  previewHistory = [];
  previewForward = [];
  document.getElementById('preview-title').textContent = '';
  document.getElementById('preview-back').disabled = true;
  document.getElementById('preview-forward').disabled = true;
  document.getElementById('preview-meta').innerHTML = '';
  document.getElementById('preview-body').textContent = '';
  document.getElementById('preview-loading').classList.add('hidden');
  document.getElementById('preview-refby-select').innerHTML = '<option value="" disabled selected>Referenced by</option>';
  document.getElementById('preview-refby-select').disabled = true;
  document.getElementById('preview-refs-select').innerHTML = '<option value="" disabled selected>References</option>';
  document.getElementById('preview-refs-select').disabled = true;
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
  const isDark = document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('compend-theme', isDark ? 'light' : 'dark');
  this.setAttribute('aria-label', isDark ? 'Switch to dark theme' : 'Switch to light theme');
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
  if (document.documentElement.classList.contains('dark')) {
    document.getElementById('theme-btn').setAttribute('aria-label', 'Switch to light theme');
  }
  loadStatsAndTypes()
    .then(function () { return loadTags(); })
    .then(function () { return loadConcepts(); })
    .catch(showError);
})();
