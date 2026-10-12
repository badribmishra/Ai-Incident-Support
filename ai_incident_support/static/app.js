/**
 * OpsShield Command — Incident Management & AI Triage Center Frontend
 */

let allIncidents = [];
let currentView = 'board'; // 'board' | 'stream' | 'analytics' | 'services'
let searchQuery = '';
let priorityFilter = 'all';
let categoryFilter = 'all';
let sortBy = 'newest';
let selectedIncidentId = null;
let draggedIncidentId = null;
let lastPostmortemText = '';

// Icons for categories
const DOMAIN_ICONS = {
  'Database': '🗄️',
  'Authentication': '🔐',
  'Payments': '💳',
  'Infrastructure': '☁️',
  'API': '⚡',
  'Application': '📦',
  'Other': '🏷️'
};

// 1-Click Incident Templates
const PRESETS = {
  db: {
    title: 'PostgreSQL Connection Saturation on Primary Shard',
    description: 'Active connections spiked to 98% of pool limit. Read queries to /checkout and /users failing with 500 internal server errors. Replica lag at 14s.',
    assignee: 'Alex Rivera (DBA)'
  },
  auth: {
    title: 'Okta SSO SAML Assertion Latency & 504 Timeout',
    description: 'Enterprise SSO federation failing for customer identity portal. Intermittent 504 gateway timeouts during Okta SAML assertion exchange.',
    assignee: 'Marcus Vance (Security)'
  },
  stripe: {
    title: 'Stripe Webhook Signature Verification 502 Spike',
    description: 'Payment confirmation webhooks failing with HTTP 502. Checkout completions delayed. Over 1,200 pending events queued.',
    assignee: 'Sarah Chen (Payments)'
  },
  hardware: {
    title: 'Engineering Workstation Power Delivery Failure',
    description: 'Developer laptop battery depleted, failing to recognize USB-C power delivery chargers. Device completely unresponsive.',
    assignee: 'IT Helpdesk'
  }
};

// ==========================================================================
// Theme Management
// ==========================================================================
function initTheme() {
  const saved = localStorage.getItem('opsshield_theme');
  const theme = saved || 'dark'; // Dark mode default for ops center feel
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('opsshield_theme', theme);
  const sun = document.getElementById('theme-sun');
  const moon = document.getElementById('theme-moon');
  if (sun && moon) {
    if (theme === 'dark') {
      sun.style.display = 'block';
      moon.style.display = 'none';
    } else {
      sun.style.display = 'none';
      moon.style.display = 'block';
    }
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  showToast(`Switched to ${next} theme`, 'info');
}

// ==========================================================================
// Live UTC Clock
// ==========================================================================
function initClock() {
  const clockEl = document.getElementById('utc-clock');
  function update() {
    const now = new Date();
    const utc = now.toISOString().slice(11, 19) + ' UTC';
    if (clockEl) clockEl.textContent = utc;
  }
  update();
  setInterval(update, 1000);
}

// ==========================================================================
// Data Fetching & Sync
// ==========================================================================
async function load() {
  try {
    const res = await fetch('/api/incidents');
    if (!res.ok) throw new Error('API error');
    allIncidents = await res.json();
    updateKPIs();
    render();
    loadMetrics();
  } catch (err) {
    console.error(err);
    showToast('Failed to load incidents', 'error');
  }
}

async function loadMetrics() {
  try {
    const res = await fetch('/api/system/metrics');
    if (!res.ok) return;
    const metrics = await res.json();

    // Update SLA widgets
    const sideSlaVal = document.getElementById('side-sla-val');
    const sideSlaBar = document.getElementById('side-sla-bar');
    const sideMttrVal = document.getElementById('side-mttr-val');
    if (sideSlaVal) sideSlaVal.textContent = `${metrics.sla_compliance}%`;
    if (sideSlaBar) sideSlaBar.style.width = `${metrics.sla_compliance}%`;
    if (sideMttrVal) sideMttrVal.textContent = metrics.avg_mttr;

    // Update Analytics Tab
    const analyticsSlaText = document.getElementById('analytics-sla-text');
    const analyticsCircleFill = document.getElementById('analytics-circle-fill');
    const analyticsMttrVal = document.getElementById('analytics-mttr-val');
    if (analyticsSlaText) analyticsSlaText.textContent = `${metrics.sla_compliance}%`;
    if (analyticsCircleFill) {
      analyticsCircleFill.setAttribute('stroke-dasharray', `${Math.round(metrics.sla_compliance)}, 100`);
    }
    if (analyticsMttrVal) analyticsMttrVal.textContent = metrics.avg_mttr;

    // Render Services Grid if active
    renderServicesGrid(metrics.services || []);
  } catch (e) {
    console.warn(e);
  }
}

// ==========================================================================
// KPI Strip & Counters
// ==========================================================================
function updateKPIs() {
  const total = allIncidents.length;
  const openCount = allIncidents.filter(x => x.status === 'Open').length;
  const progCount = allIncidents.filter(x => x.status === 'In Progress').length;
  const resolvedCount = allIncidents.filter(x => x.status === 'Resolved').length;
  const p1Count = allIncidents.filter(x => x.priority === 'P1').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-open').textContent = openCount;
  document.getElementById('stat-in-progress').textContent = progCount;
  document.getElementById('stat-p1').textContent = p1Count;
  document.getElementById('stat-resolved').textContent = resolvedCount;

  // Sidebar counters
  const sideActive = document.getElementById('side-active-count');
  const sideTotal = document.getElementById('side-total-count');
  if (sideActive) sideActive.textContent = openCount + progCount;
  if (sideTotal) sideTotal.textContent = total;

  // Kanban column counters
  const bOpen = document.getElementById('board-count-open');
  const bProg = document.getElementById('board-count-progress');
  const bRes = document.getElementById('board-count-resolved');
  if (bOpen) bOpen.textContent = openCount;
  if (bProg) bProg.textContent = progCount;
  if (bRes) bRes.textContent = resolvedCount;
}

// ==========================================================================
// View Switcher (Board, Stream, Analytics, Services)
// ==========================================================================
function switchMainView(view) {
  currentView = view;

  // Update tabs
  document.querySelectorAll('.view-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.v === view);
  });

  // Update sidebar nav items
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  // Update view panels
  document.querySelectorAll('.view-panel').forEach(p => {
    p.classList.remove('active');
  });

  const targetPanel = document.getElementById(`view-${view}`);
  if (targetPanel) targetPanel.classList.add('active');

  // Update breadcrumb
  const titles = {
    board: 'Kanban Board',
    stream: 'Incident Stream',
    analytics: 'Telemetry & MTTR',
    services: 'Production Infrastructure'
  };
  const titleEl = document.getElementById('view-title');
  if (titleEl) titleEl.textContent = titles[view] || 'Operations';

  render();
}

// ==========================================================================
// Filtering & Sorting
// ==========================================================================
function getFilteredIncidents() {
  const pSelect = document.getElementById('priority-select');
  const cSelect = document.getElementById('category-select');
  const sSelect = document.getElementById('sort-select');

  priorityFilter = pSelect ? pSelect.value : 'all';
  categoryFilter = cSelect ? cSelect.value : 'all';
  sortBy = sSelect ? sSelect.value : 'newest';

  let list = allIncidents.filter(item => {
    if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const searchable = [
        item.title,
        item.description,
        item.assignee,
        item.category,
        item.priority,
        item.status,
        item.ai_root_cause,
        item.ai_summary,
        `#inc-${item.id}`
      ].join(' ').toLowerCase();

      if (!searchable.includes(q)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (sortBy === 'newest') return new Date(b.created_at) - new Date(a.created_at);
    if (sortBy === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
    if (sortBy === 'priority') {
      const rank = { 'P1': 1, 'P2': 2, 'P3': 3, 'P4': 4 };
      return (rank[a.priority] || 9) - (rank[b.priority] || 9);
    }
    return 0;
  });

  return list;
}

function render() {
  const list = getFilteredIncidents();

  if (currentView === 'board') {
    renderKanbanBoard(list);
  } else if (currentView === 'stream') {
    renderStreamView(list);
  } else if (currentView === 'analytics') {
    renderAnalyticsDashboard(allIncidents);
  }
}

// ==========================================================================
// RENDER: KANBAN BOARD
// ==========================================================================
function renderKanbanBoard(list) {
  const openWrap = document.getElementById('kanban-open-list');
  const progWrap = document.getElementById('kanban-progress-list');
  const resWrap = document.getElementById('kanban-resolved-list');

  const openList = list.filter(x => x.status === 'Open');
  const progList = list.filter(x => x.status === 'In Progress');
  const resList = list.filter(x => x.status === 'Resolved');

  if (openWrap) openWrap.innerHTML = openList.map(x => renderKanbanCard(x)).join('') || emptyKanbanCol('No open tickets');
  if (progWrap) progWrap.innerHTML = progList.map(x => renderKanbanCard(x)).join('') || emptyKanbanCol('No active tickets');
  if (resWrap) resWrap.innerHTML = resList.map(x => renderKanbanCard(x)).join('') || emptyKanbanCol('No resolved tickets');
}

function emptyKanbanCol(msg) {
  return `<div style="text-align:center; padding:32px 10px; color:var(--text-muted); font-size:12px; border:1px dashed var(--border-subtle); border-radius:10px;">${msg}</div>`;
}

function renderKanbanCard(x) {
  const pClass = (x.priority || 'p3').toLowerCase();
  const icon = DOMAIN_ICONS[x.category] || '📦';
  const initials = getInitials(x.assignee);
  const nextTarget = x.status === 'Open' ? 'In Progress' : (x.status === 'In Progress' ? 'Resolved' : 'Open');
  const moveLabel = x.status === 'Open' ? 'Investigate →' : (x.status === 'In Progress' ? 'Resolve →' : 'Reopen ↺');

  return `
    <article class="kanban-card ${pClass}" draggable="true" ondragstart="handleDragStart(event, ${x.id})" onclick="openInspector(${x.id})">
      <div class="k-card-header">
        <div class="k-card-tags">
          <span class="k-inc-id">#INC-${String(x.id).padStart(3, '0')}</span>
          <span class="badge-priority ${pClass}">${x.priority}</span>
          <span class="badge-domain">${icon} ${esc(x.category)}</span>
        </div>
        <span class="k-card-time">${formatTimeAgo(x.created_at)}</span>
      </div>

      <h4 class="k-card-title">${esc(x.title)}</h4>

      ${x.ai_summary ? `
      <div class="k-card-ai-snippet" title="${esc(x.ai_summary)}">
        ✨ ${esc(x.ai_summary)}
      </div>
      ` : ''}

      <div class="k-card-footer" onclick="event.stopPropagation()">
        <div class="k-card-assignee">
          <span class="avatar-mini">${initials}</span>
          <span>${esc(x.assignee || 'Unassigned')}</span>
        </div>
        <button class="k-card-btn-move" onclick="updateIncidentField(${x.id}, 'status', '${nextTarget}')">
          ${moveLabel}
        </button>
      </div>
    </article>
  `;
}

// Drag & Drop
function handleDragStart(e, id) {
  draggedIncidentId = id;
  e.dataTransfer.setData('text/plain', String(id));
}

function handleDragOver(e) {
  e.preventDefault();
  const col = e.currentTarget;
  col.classList.add('drag-over');
}

function handleDrop(e, targetStatus) {
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
  if (draggedIncidentId) {
    updateIncidentField(draggedIncidentId, 'status', targetStatus);
    draggedIncidentId = null;
  }
}

// ==========================================================================
// RENDER: STREAM VIEW
// ==========================================================================
function renderStreamView(list) {
  const container = document.getElementById('stream-list');
  const metaCount = document.getElementById('stream-meta-count');
  if (metaCount) metaCount.textContent = `Showing ${list.length} incident${list.length === 1 ? '' : 's'}`;

  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:60px; color:var(--text-muted); font-size:14px; background:var(--bg-surface); border-radius:14px; border:1px dashed var(--border-medium);">No incidents matching active filters.</div>`;
    return;
  }

  container.innerHTML = list.map(x => {
    const pClass = (x.priority || 'p3').toLowerCase();
    const sClass = (x.status || 'open').toLowerCase().replace(' ', '-');
    const icon = DOMAIN_ICONS[x.category] || '📦';
    const initials = getInitials(x.assignee);

    return `
      <article class="stream-card ${pClass}" onclick="openInspector(${x.id})">
        <div class="stream-top-row">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-family:var(--font-mono); font-size:12px; font-weight:700; color:var(--text-muted);">#INC-${String(x.id).padStart(3, '0')}</span>
            <span class="badge-priority ${pClass}">${x.priority}</span>
            <span class="badge-status ${sClass}">${x.status}</span>
            <span class="badge-domain">${icon} ${esc(x.category)}</span>
          </div>
          <span style="font-size:12px; color:var(--text-muted);">${formatTimeAgo(x.created_at)}</span>
        </div>

        <h3 class="stream-title">${esc(x.title)}</h3>
        <p class="stream-desc">${esc(x.description)}</p>

        <!-- AI Copilot Box -->
        <div class="stream-ai-box">
          <div class="stream-ai-header">
            <span>✨ AI Copilot Triage</span>
            <span style="font-family:var(--font-mono); font-size:10px; font-weight:600;">Heuristic / GPT-4o</span>
          </div>
          <div class="stream-ai-grid">
            <div class="stream-ai-col">
              <b>Summary & Impact</b>
              <p>${esc(x.ai_summary || 'Analysis pending')}</p>
            </div>
            <div class="stream-ai-col">
              <b>Likely Root Cause</b>
              <p>${esc(x.ai_root_cause || 'Investigation required')}</p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="stream-card-footer" onclick="event.stopPropagation()">
          <div style="display:flex; align-items:center; gap:7px;">
            <span class="avatar-mini">${initials}</span>
            <span>${esc(x.assignee || 'Unassigned')}</span>
          </div>

          <div class="stream-actions">
            ${x.status !== 'In Progress' ? `
              <button class="btn-stream-act primary" onclick="updateIncidentField(${x.id}, 'status', 'In Progress')">▶ Investigate</button>
            ` : ''}
            ${x.status !== 'Resolved' ? `
              <button class="btn-stream-act" onclick="updateIncidentField(${x.id}, 'status', 'Resolved')">✓ Resolve</button>
            ` : `
              <button class="btn-stream-act" onclick="updateIncidentField(${x.id}, 'status', 'Open')">↺ Reopen</button>
            `}
            <button class="btn-stream-act" onclick="retriageIncident(${x.id})">✨ Re-Triage</button>
            <button class="btn-stream-act" onclick="openInspector(${x.id})">Inspect →</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ==========================================================================
// RENDER: ANALYTICS DASHBOARD
// ==========================================================================
function renderAnalyticsDashboard(list) {
  const barsWrap = document.getElementById('severity-breakdown-bars');
  const catGrid = document.getElementById('category-distribution-bars');
  if (!barsWrap || !catGrid) return;

  const total = list.length || 1;
  const p1 = list.filter(x => x.priority === 'P1').length;
  const p2 = list.filter(x => x.priority === 'P2').length;
  const p3 = list.filter(x => x.priority === 'P3').length;
  const p4 = list.filter(x => x.priority === 'P4').length;

  const sevs = [
    { label: 'P1 — Critical', count: p1, pct: Math.round((p1 / total) * 100), color: 'var(--p1-color)' },
    { label: 'P2 — High', count: p2, pct: Math.round((p2 / total) * 100), color: 'var(--p2-color)' },
    { label: 'P3 — Medium', count: p3, pct: Math.round((p3 / total) * 100), color: 'var(--p3-color)' },
    { label: 'P4 — Low', count: p4, pct: Math.round((p4 / total) * 100), color: 'var(--p4-color)' },
  ];

  barsWrap.innerHTML = sevs.map(s => `
    <div class="sev-bar-item">
      <div class="sev-bar-labels">
        <span style="color:var(--text-secondary);">${s.label}</span>
        <span style="font-family:var(--font-mono);">${s.count} (${s.pct}%)</span>
      </div>
      <div class="sev-bar-track">
        <div class="sev-bar-fill" style="width:${Math.max(s.pct, 4)}%; background:${s.color};"></div>
      </div>
    </div>
  `).join('');

  // Domain breakdown
  const domains = ['Database', 'Authentication', 'Infrastructure', 'Payments', 'API', 'Application'];
  catGrid.innerHTML = domains.map(d => {
    const c = list.filter(x => x.category === d).length;
    const icon = DOMAIN_ICONS[d] || '📦';
    return `
      <div class="cat-kpi-card">
        <span class="cat-kpi-title">${icon} ${d}</span>
        <span class="cat-kpi-val">${c}</span>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// RENDER: SYSTEM SERVICES GRID
// ==========================================================================
function renderServicesGrid(services) {
  const container = document.getElementById('services-grid-container');
  if (!container || !services.length) return;

  container.innerHTML = services.map(s => `
    <div class="service-card">
      <div class="service-card-top">
        <span class="service-name">
          <span class="status-indicator-dot ${s.status === 'operational' ? 'online' : ''}" style="margin-left:0; background:${s.status === 'operational' ? '#10b981' : '#f43f5e'};"></span>
          <span>${esc(s.name)}</span>
        </span>
        <span class="service-status-badge ${s.status}">
          ${s.status === 'operational' ? 'Operational' : 'Degraded (Sev-1)'}
        </span>
      </div>
      <div class="service-metrics-row">
        <span>Latency: <b>${esc(s.latency)}</b></span>
        <span>Uptime: <b>${esc(s.uptime)}</b></span>
        <span>Synthetic Health: <b class="text-resolved">Passed</b></span>
      </div>
    </div>
  `).join('');
}

// ==========================================================================
// SLIDE-OUT INCIDENT INSPECTOR DRAWER
// ==========================================================================
function openInspector(id) {
  const incident = allIncidents.find(x => x.id === id);
  if (!incident) return;
  selectedIncidentId = id;

  document.getElementById('drawer-id').textContent = `#INC-${String(incident.id).padStart(3, '0')}`;
  
  const pBadge = document.getElementById('drawer-priority');
  pBadge.className = `badge-priority ${(incident.priority || 'p3').toLowerCase()}`;
  pBadge.textContent = incident.priority;

  const sBadge = document.getElementById('drawer-status');
  sBadge.className = `badge-status ${(incident.status || 'open').toLowerCase().replace(' ', '-')}`;
  sBadge.textContent = incident.status;

  document.getElementById('drawer-title').textContent = incident.title;
  document.getElementById('drawer-category').textContent = `${DOMAIN_ICONS[incident.category] || '📦'} ${incident.category}`;
  document.getElementById('drawer-assignee').textContent = incident.assignee || 'Unassigned';
  document.getElementById('drawer-timestamp').textContent = new Date(incident.created_at).toLocaleString();
  document.getElementById('drawer-desc').textContent = incident.description;

  document.getElementById('drawer-ai-summary').textContent = incident.ai_summary || 'No summary generated.';
  document.getElementById('drawer-ai-rootcause').textContent = incident.ai_root_cause || 'Investigation required.';

  // Render Runbook Checklist
  const nextStepsEl = document.getElementById('drawer-ai-nextsteps');
  if (nextStepsEl) {
    const steps = (incident.ai_next_steps || '').split(/\n+/).filter(Boolean);
    if (steps.length === 0) {
      nextStepsEl.innerHTML = '<p class="ai-text">No runbook steps defined.</p>';
    } else {
      nextStepsEl.innerHTML = steps.map((step, idx) => `
        <label class="runbook-item" id="runbook-item-${idx}">
          <input type="checkbox" onchange="toggleRunbookCheck(${idx})">
          <span>${esc(step)}</span>
        </label>
      `).join('');
    }
  }

  // Set Status Select in Drawer Footer
  const statusSelect = document.getElementById('drawer-status-select');
  if (statusSelect) statusSelect.value = incident.status;

  // Timeline
  renderDrawerTimeline(incident);

  // Show Drawer
  document.getElementById('inspector-overlay').classList.add('active');
  document.getElementById('inspector-drawer').classList.add('active');
}

function toggleRunbookCheck(idx) {
  const item = document.getElementById(`runbook-item-${idx}`);
  if (item) item.classList.toggle('checked');
}

function closeInspector() {
  document.getElementById('inspector-overlay').classList.remove('active');
  document.getElementById('inspector-drawer').classList.remove('active');
  selectedIncidentId = null;
}

function renderDrawerTimeline(x) {
  const tl = document.getElementById('drawer-timeline');
  if (!tl) return;
  const createdTime = new Date(x.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  tl.innerHTML = `
    <div class="tl-node">
      <div class="tl-time">${createdTime}</div>
      <div class="tl-msg">Ticket opened & received initial triage as <b>${x.priority}</b>.</div>
    </div>
    <div class="tl-node">
      <div class="tl-time">${createdTime}</div>
      <div class="tl-msg">AI Copilot generated hypothesis: <i>"${esc(x.ai_root_cause.slice(0, 80))}..."</i></div>
    </div>
    <div class="tl-node">
      <div class="tl-time">Active</div>
      <div class="tl-msg">Currently assigned to <b>${esc(x.assignee)}</b> with status <b>${esc(x.status)}</b>.</div>
    </div>
  `;
}

async function updateDrawerStatus() {
  if (!selectedIncidentId) return;
  const select = document.getElementById('drawer-status-select');
  const newStatus = select.value;
  await updateIncidentField(selectedIncidentId, 'status', newStatus);
  openInspector(selectedIncidentId); // refresh drawer state
}

async function retriageFromDrawer() {
  if (!selectedIncidentId) return;
  const btn = document.getElementById('drawer-btn-retriage');
  if (btn) btn.innerHTML = '<span>Triaging...</span>';
  await retriageIncident(selectedIncidentId);
  openInspector(selectedIncidentId);
  if (btn) btn.innerHTML = `<span>Re-evaluate</span>`;
}

async function deleteFromDrawer() {
  if (!selectedIncidentId) return;
  const id = selectedIncidentId;
  closeInspector();
  await deleteIncident(id);
}

// Operational Actions in Drawer
async function generateAndShowPostmortem() {
  if (!selectedIncidentId) return;
  try {
    showToast('Synthesizing post-mortem report...', 'info');
    const res = await fetch(`/api/incidents/${selectedIncidentId}/postmortem`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to generate postmortem');
    const data = await res.json();
    lastPostmortemText = data.postmortem;

    document.getElementById('postmortem-text').textContent = data.postmortem;
    document.getElementById('postmortem-modal').classList.add('active');
  } catch (e) {
    showToast('Failed to generate post-mortem', 'error');
  }
}

function closePostmortemModal(e) {
  if (e.target.id === 'postmortem-modal') {
    closePostmortemModalDirect();
  }
}
function closePostmortemModalDirect() {
  document.getElementById('postmortem-modal').classList.remove('active');
}

function copyPostmortemMarkdown() {
  navigator.clipboard.writeText(lastPostmortemText);
  showToast('Post-mortem markdown copied to clipboard!', 'success');
}

function copySlackAlert() {
  if (!selectedIncidentId) return;
  const inc = allIncidents.find(x => x.id === selectedIncidentId);
  if (!inc) return;

  const msg = `🚨 *[${inc.priority}] ${inc.title}*\n*Domain:* ${inc.category} | *Status:* ${inc.status} | *Owner:* ${inc.assignee}\n*Summary:* ${inc.ai_summary}\n*Root Cause:* ${inc.ai_root_cause}\n*Runbook:* ${inc.ai_next_steps.split('\n')[0] || 'Investigating logs'}`;
  navigator.clipboard.writeText(msg);
  showToast('Slack broadcast alert copied to clipboard!', 'success');
}

function runSimulatedDiagnostic() {
  showToast('Running synthetic ping & trace diagnostics...', 'info');
  setTimeout(() => {
    showToast('Diagnostic completed: TCP handshake 14ms · 0 socket drops detected', 'success');
  }, 1200);
}

// ==========================================================================
// CRUD Backend Calls
// ==========================================================================
async function updateIncidentField(id, field, value) {
  try {
    const res = await fetch(`/api/incidents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    if (!res.ok) throw new Error('Failed to update incident');
    showToast(`Incident #${id} marked as ${value}`, 'info');
    await load();
  } catch (err) {
    console.error(err);
    showToast('Failed to update status', 'error');
  }
}

async function retriageIncident(id) {
  try {
    showToast(`AI analyzing incident #${id}...`, 'info');
    const res = await fetch(`/api/incidents/${id}/retriage`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to re-triage');
    const updated = await res.json();
    showToast(`Incident #${id} triaged as ${updated.priority} (${updated.category})`, 'success');
    await load();
  } catch (err) {
    console.error(err);
    showToast('Failed to re-triage ticket', 'error');
  }
}

async function deleteIncident(id) {
  if (!confirm(`Are you sure you want to delete incident #${id}?`)) return;

  try {
    const res = await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete incident');
    showToast(`Incident #${id} permanently deleted`, 'info');
    await load();
  } catch (err) {
    console.error(err);
    showToast('Failed to delete incident', 'error');
  }
}

async function seedDemoIncidents() {
  try {
    showToast('Seeding 4 realistic production incident scenarios with AI...', 'info');
    const res = await fetch('/api/seed', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to seed demo data');
    const data = await res.json();
    showToast(`Generated ${data.count} incident scenarios with AI triage!`, 'success');
    await load();
  } catch (err) {
    showToast('Failed to seed scenarios', 'error');
  }
}

// ==========================================================================
// CREATE INCIDENT MODAL
// ==========================================================================
function openModal() {
  document.getElementById('create-modal').classList.add('active');
  setTimeout(() => document.getElementById('form-title').focus(), 100);
}

function openModalWithStatus(status) {
  openModal();
  const statusSel = document.getElementById('form-initial-status');
  if (statusSel) statusSel.value = status;
}

function closeModal() {
  document.getElementById('create-modal').classList.remove('active');
}

function handleBackdropClick(e) {
  if (e.target.id === 'create-modal') closeModal();
}

function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  document.getElementById('form-title').value = p.title;
  document.getElementById('form-desc').value = p.description;
  document.getElementById('form-assignee').value = p.assignee;
  showToast('Template populated! Click "Create & Trigger AI Triage"', 'info');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('form-title').value.trim();
  const description = document.getElementById('form-desc').value.trim();
  const assignee = document.getElementById('form-assignee').value.trim() || 'Unassigned';
  const initialStatus = document.getElementById('form-initial-status').value || 'Open';

  const submitBtn = document.getElementById('btn-submit');
  const spinner = document.getElementById('btn-submit-spinner');
  const btnText = document.getElementById('btn-submit-text');

  if (!title || !description) {
    showToast('Title and description required', 'error');
    return;
  }

  submitBtn.disabled = true;
  spinner.style.display = 'inline-block';
  btnText.textContent = 'AI Triaging Incident...';

  try {
    const res = await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, assignee })
    });
    if (!res.ok) throw new Error(await res.text());

    const created = await res.json();

    // If initial status was In Progress, update it
    if (initialStatus !== 'Open') {
      await fetch(`/api/incidents/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: initialStatus })
      });
    }

    showToast(`Incident #${created.id} logged & triaged as ${created.priority}!`, 'success');
    document.getElementById('form-title').value = '';
    document.getElementById('form-desc').value = '';
    closeModal();
    await load();
  } catch (err) {
    showToast(err.message || 'Error creating incident', 'error');
  } finally {
    submitBtn.disabled = false;
    spinner.style.display = 'none';
    btnText.textContent = 'Create & Trigger AI Triage';
  }
}

// ==========================================================================
// COMMAND PALETTE (⌘K)
// ==========================================================================
function openCommandPalette() {
  const modal = document.getElementById('cmd-palette-modal');
  modal.classList.add('active');
  const input = document.getElementById('cmd-input');
  input.value = '';
  setTimeout(() => input.focus(), 80);
  renderCmdResults('');
}

function closeCommandPalette() {
  document.getElementById('cmd-palette-modal').classList.remove('active');
}

function handleCmdBackdropClick(e) {
  if (e.target.id === 'cmd-palette-modal') closeCommandPalette();
}

function handleCmdSearch() {
  const q = document.getElementById('cmd-input').value;
  renderCmdResults(q);
}

function renderCmdResults(q) {
  const resultsEl = document.getElementById('cmd-results');
  if (!resultsEl) return;
  const query = q.toLowerCase().trim();

  // System Commands
  const actions = [
    { title: 'Create New Incident', sub: 'Action · Press N', act: () => { closeCommandPalette(); openModal(); } },
    { title: 'Switch to Kanban Board', sub: 'Navigation', act: () => { closeCommandPalette(); switchMainView('board'); } },
    { title: 'Switch to Stream View', sub: 'Navigation', act: () => { closeCommandPalette(); switchMainView('stream'); } },
    { title: 'Switch to Telemetry & MTTR', sub: 'Navigation', act: () => { closeCommandPalette(); switchMainView('analytics'); } },
    { title: 'Toggle Light/Dark Theme', sub: 'Preferences', act: () => { closeCommandPalette(); toggleTheme(); } },
    { title: 'Seed 4 Realistic Scenarios', sub: 'Simulation', act: () => { closeCommandPalette(); seedDemoIncidents(); } }
  ];

  // Match incidents
  const matchedIncidents = allIncidents.filter(x => 
    !query || x.title.toLowerCase().includes(query) || x.category.toLowerCase().includes(query) || String(x.id).includes(query)
  ).slice(0, 5);

  let html = '';

  if (query) {
    html += '<div style="font-size:10px; font-weight:700; color:var(--text-muted); padding:6px 14px; text-transform:uppercase;">Incidents</div>';
    matchedIncidents.forEach(inc => {
      html += `
        <div class="cmd-item" onclick="closeCommandPalette(); openInspector(${inc.id});">
          <div class="cmd-item-title">
            <span class="badge-priority ${(inc.priority || 'p3').toLowerCase()}">${inc.priority}</span>
            <span>#INC-${inc.id} ${esc(inc.title)}</span>
          </div>
          <span style="font-size:11px; color:var(--text-muted);">${inc.status}</span>
        </div>
      `;
    });
  }

  html += '<div style="font-size:10px; font-weight:700; color:var(--text-muted); padding:6px 14px; text-transform:uppercase;">Quick Actions</div>';
  actions.filter(a => !query || a.title.toLowerCase().includes(query)).forEach((a, i) => {
    html += `
      <div class="cmd-item" onclick="cmdPaletteActions[${i}]()">
        <div class="cmd-item-title">⚡ ${a.title}</div>
        <span style="font-size:11px; color:var(--text-muted);">${a.sub}</span>
      </div>
    `;
  });

  window.cmdPaletteActions = actions.map(a => a.act);
  resultsEl.innerHTML = html;
}

// ==========================================================================
// Search & Filter Helpers
// ==========================================================================
function handleSearch() {
  const input = document.getElementById('search-input');
  searchQuery = input ? input.value : '';
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = searchQuery ? 'block' : 'none';
  render();
}

function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  searchQuery = '';
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  render();
}

function filterByPriority(p) {
  const select = document.getElementById('priority-select');
  if (select) select.value = p;
  render();
}

function filterByStatus(status) {
  switchMainView('stream');
  searchQuery = status;
  const input = document.getElementById('search-input');
  if (input) input.value = status;
  render();
}

// ==========================================================================
// Utilities
// ==========================================================================
function getInitials(name) {
  if (!name || name === 'Unassigned') return 'UN';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '🚨';

  toast.innerHTML = `<span>${icon}</span> <span>${esc(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// ==========================================================================
// Global Keyboard Shortcuts
// ==========================================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeInspector();
    closeCommandPalette();
    closePostmortemModalDirect();
  }

  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

  // ⌘K or Ctrl+K for Command Palette
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommandPalette();
  }

  // N for new incident
  if ((e.key === 'n' || e.key === 'N') && !isInput && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    openModal();
  }

  // / for search
  if (e.key === '/' && !isInput) {
    e.preventDefault();
    const s = document.getElementById('search-input');
    if (s) { s.focus(); s.select(); }
  }
});

// Bootstrapping
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initClock();
  load();
});
