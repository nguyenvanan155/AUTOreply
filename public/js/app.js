/* ═══════════════════════════════════════════════════════════════
   Google Maps Auto-Reply — Frontend Application
   ═══════════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────────
let accounts = [];
let maps = [];
let ws = null;
let wsReconnectTimer = null;

// ─── API Client ─────────────────────────────────────────────────

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`/api${path}`, opts);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    return data;
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

// ─── Tab Navigation ─────────────────────────────────────────────

document.getElementById('tabNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;

  const tab = btn.dataset.tab;

  // Update active tab button
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Update active panel
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${tab}`).classList.add('active');

  // Load data for the tab
  onTabActivated(tab);
});

function onTabActivated(tab) {
  switch (tab) {
    case 'dashboard': loadDashboard(); break;
    case 'accounts': loadAccounts(); break;
    case 'maps': loadMaps(); break;
    case 'reviews': loadReviews(); break;
    case 'logs': loadLogs(); break;
    case 'settings': loadSettings(); break;
    case 'automation': loadAutomationStatus(); break;
  }
}

// ─── Dashboard ──────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const [statsRes, logsRes] = await Promise.all([
      api('GET', '/reviews/stats'),
      api('GET', '/logs?limit=30'),
    ]);

    const stats = statsRes.data;
    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statReplied').textContent = stats.replied;
    document.getElementById('statPending').textContent = stats.pending;
    document.getElementById('statErrors').textContent = stats.errors;

    const logsEl = document.getElementById('dashboardLogs');
    if (logsRes.data.length === 0) {
      logsEl.innerHTML = '<div class="empty-state" style="padding:1.5rem"><p style="color:var(--text-muted)">No recent activity</p></div>';
    } else {
      logsEl.innerHTML = logsRes.data.map(log => `
        <div class="log-entry info">
          <span class="log-time">${formatTime(log.created_at)}</span>
          <span class="log-message">${escapeHtml(log.action)} — ${escapeHtml(log.details)}</span>
        </div>
      `).join('');
    }
  } catch {}
}

// ─── Accounts ───────────────────────────────────────────────────

async function loadAccounts() {
  try {
    const res = await api('GET', '/accounts');
    accounts = res.data;
    document.getElementById('accountCount').textContent = accounts.length;
    renderAccounts();
    populateAccountSelects();
  } catch {}
}

function renderAccounts() {
  const container = document.getElementById('accountsList');

  if (accounts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">👤</div>
        <p>No accounts added yet. Add your first Google account to get started.</p>
        <button class="btn btn-primary" onclick="openAddAccountModal()">+ Add Account</button>
      </div>
    `;
    return;
  }

  container.innerHTML = accounts.map(acc => {
    const statusBadge = getStatusBadge(acc.status);
    return `
      <div class="card" id="account-${acc.id}">
        <div class="card-header">
          <div class="card-title">👤 ${escapeHtml(acc.name)}</div>
          <div class="card-actions">
            <button class="btn btn-ghost btn-sm" onclick="deleteAccount('${acc.id}')" title="Delete">🗑️</button>
          </div>
        </div>
        ${acc.email ? `<div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:8px">${escapeHtml(acc.email)}</div>` : ''}
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px">
          ${statusBadge}
        </div>
        <div class="card-meta">
          <div class="card-meta-item">🕐 ${formatDate(acc.created_at)}</div>
        </div>
        <div style="display:flex; gap:6px; margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="loginAccount('${acc.id}')">🔑 Login</button>
          <button class="btn btn-ghost btn-sm" onclick="checkAccountStatus('${acc.id}')">🔍 Check Status</button>
        </div>
      </div>
    `;
  }).join('');
}

function getStatusBadge(status) {
  const map = {
    active: '<span class="badge badge-success">● Active</span>',
    not_logged_in: '<span class="badge badge-warning">○ Not Logged In</span>',
    logging_in: '<span class="badge badge-info">◌ Logging In...</span>',
    error: '<span class="badge badge-error">✕ Error</span>',
  };
  return map[status] || '<span class="badge badge-neutral">Unknown</span>';
}

function openAddAccountModal() {
  document.getElementById('newAccountName').value = '';
  document.getElementById('newAccountEmail').value = '';
  openModal('addAccountModal');
}

async function addAccount() {
  const name = document.getElementById('newAccountName').value.trim();
  const email = document.getElementById('newAccountEmail').value.trim();

  if (!name) {
    toast('Account name is required', 'error');
    return;
  }

  try {
    await api('POST', '/accounts', { name, email });
    closeModal('addAccountModal');
    toast('Account added successfully', 'success');
    loadAccounts();
  } catch {}
}

async function deleteAccount(id) {
  if (!confirm('Delete this account? This will remove all associated data.')) return;

  try {
    await api('DELETE', `/accounts/${id}`);
    toast('Account deleted', 'success');
    loadAccounts();
  } catch {}
}

async function loginAccount(id) {
  try {
    const res = await api('POST', `/accounts/${id}/login`);
    toast(res.message || 'Browser opened for login', 'info');
    loadAccounts();
  } catch {}
}

async function checkAccountStatus(id) {
  toast('Checking account status...', 'info');
  try {
    const res = await api('POST', `/accounts/${id}/check-status`);
    const status = res.data.isLoggedIn ? 'Active ✓' : 'Not logged in ✕';
    toast(`Account status: ${status}`, res.data.isLoggedIn ? 'success' : 'warning');
    loadAccounts();
  } catch {}
}

// ─── Maps ───────────────────────────────────────────────────────

async function loadMaps() {
  try {
    const res = await api('GET', '/maps');
    maps = res.data;
    document.getElementById('mapCount').textContent = maps.length;
    renderMaps();
  } catch {}
}

function renderMaps() {
  const container = document.getElementById('mapsList');

  if (maps.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📍</div>
        <p>No map locations added yet. Add a Google Maps URL to start monitoring.</p>
        <button class="btn btn-primary" onclick="openAddMapModal()">+ Add Map</button>
      </div>
    `;
    return;
  }

  container.innerHTML = maps.map(map => `
    <div class="card" id="map-${map.id}">
      <div class="card-header">
        <div class="card-title">📍 ${escapeHtml(map.name)}</div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEditMapModal('${map.id}')" title="Edit">✏️</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteMap('${map.id}')" title="Delete">🗑️</button>
        </div>
      </div>
      <div style="font-size:0.8rem; color:var(--text-secondary); word-break:break-all; margin-bottom:8px">
        ${escapeHtml(map.url.length > 80 ? map.url.substring(0, 80) + '...' : map.url)}
      </div>
      <div class="card-meta">
        <div class="card-meta-item">👤 ${escapeHtml(map.account_name || 'Unknown')}</div>
        <div class="card-meta-item">🕐 ${formatDate(map.created_at)}</div>
      </div>
    </div>
  `).join('');
}

function openAddMapModal() {
  document.getElementById('newMapName').value = '';
  document.getElementById('newMapUrl').value = '';
  populateAccountSelect('newMapAccount');
  openModal('addMapModal');
}

function openEditMapModal(id) {
  const map = maps.find(m => m.id === id);
  if (!map) return;

  document.getElementById('editMapId').value = id;
  document.getElementById('editMapName').value = map.name;
  document.getElementById('editMapUrl').value = map.url;
  populateAccountSelect('editMapAccount', map.account_id);
  openModal('editMapModal');
}

async function addMap() {
  const name = document.getElementById('newMapName').value.trim();
  const url = document.getElementById('newMapUrl').value.trim();
  const account_id = document.getElementById('newMapAccount').value;

  if (!name || !url || !account_id) {
    toast('All fields are required', 'error');
    return;
  }

  try {
    await api('POST', '/maps', { name, url, account_id });
    closeModal('addMapModal');
    toast('Map location added', 'success');
    loadMaps();
  } catch {}
}

async function updateMap() {
  const id = document.getElementById('editMapId').value;
  const name = document.getElementById('editMapName').value.trim();
  const url = document.getElementById('editMapUrl').value.trim();
  const account_id = document.getElementById('editMapAccount').value;

  if (!name || !url || !account_id) {
    toast('All fields are required', 'error');
    return;
  }

  try {
    await api('PUT', `/maps/${id}`, { name, url, account_id });
    closeModal('editMapModal');
    toast('Map updated', 'success');
    loadMaps();
  } catch {}
}

async function deleteMap(id) {
  if (!confirm('Delete this map location?')) return;

  try {
    await api('DELETE', `/maps/${id}`);
    toast('Map deleted', 'success');
    loadMaps();
  } catch {}
}

// ─── Automation ─────────────────────────────────────────────────

async function loadAutomationStatus() {
  try {
    const res = await api('GET', '/automation/status');
    updateAutoModeUI(res.data.autoModeActive);
    populateAccountSelect('linkAccountSelect');
  } catch {}
}

function updateAutoModeUI(isRunning) {
  const statusEl = document.getElementById('autoStatus');
  const statusText = document.getElementById('autoStatusText');
  const btnStart = document.getElementById('btnStartAuto');
  const btnStop = document.getElementById('btnStopAuto');

  if (isRunning) {
    statusEl.className = 'auto-status running';
    statusText.textContent = 'Running — monitoring reviews...';
    btnStart.style.display = 'none';
    btnStop.style.display = 'inline-flex';
  } else {
    statusEl.className = 'auto-status stopped';
    statusText.textContent = 'Stopped';
    btnStart.style.display = 'inline-flex';
    btnStop.style.display = 'none';
  }
}

async function startAutoMode() {
  try {
    await api('POST', '/automation/start');
    updateAutoModeUI(true);
    toast('Auto mode started', 'success');
  } catch {}
}

async function stopAutoMode() {
  try {
    await api('POST', '/automation/stop');
    updateAutoModeUI(false);
    toast('Auto mode stopped', 'info');
  } catch {}
}

// Link input counter
document.getElementById('linkInput')?.addEventListener('input', (e) => {
  const links = e.target.value.split('\n').filter(l => l.trim().length > 0);
  document.getElementById('linkCount').textContent = `${links.length} link${links.length !== 1 ? 's' : ''} detected`;
});

async function replyToLinks() {
  const accountId = document.getElementById('linkAccountSelect').value;
  const rawLinks = document.getElementById('linkInput').value.trim();

  if (!accountId) {
    toast('Please select an account', 'error');
    return;
  }
  if (!rawLinks) {
    toast('Please paste at least one review link', 'error');
    return;
  }

  const links = rawLinks.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (links.length === 0) {
    toast('No valid links found', 'error');
    return;
  }

  try {
    await api('POST', '/automation/reply-links', { links, account_id: accountId });
    toast(`Processing ${links.length} review links...`, 'success');
    document.getElementById('linkInput').value = '';
    document.getElementById('linkCount').textContent = '0 links detected';
  } catch {}
}

// ─── Reviews ────────────────────────────────────────────────────

async function loadReviews() {
  try {
    const status = document.getElementById('reviewFilterStatus').value;
    const query = status ? `?status=${status}` : '';
    const res = await api('GET', `/reviews${query}`);
    renderReviews(res.data);
  } catch {}
}

function renderReviews(reviews) {
  const container = document.getElementById('reviewsList');

  if (reviews.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⭐</div>
        <p>No reviews found matching your filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = reviews.map(review => {
    const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
    const badge = review.status === 'replied'
      ? '<span class="badge badge-success">Replied</span>'
      : review.status === 'error'
      ? '<span class="badge badge-error">Error</span>'
      : '<span class="badge badge-warning">Pending</span>';

    return `
      <div class="review-item">
        <div class="review-header">
          <span class="review-author">${escapeHtml(review.author)}</span>
          <div style="display:flex; align-items:center; gap:8px">
            <span class="review-stars">${stars}</span>
            ${badge}
          </div>
        </div>
        ${review.text ? `<div class="review-text">"${escapeHtml(review.text.substring(0, 300))}"</div>` : ''}
        ${review.reply_text ? `<div class="review-reply">↪ ${escapeHtml(review.reply_text)}</div>` : ''}
        <div class="card-meta">
          <div class="card-meta-item">🕐 ${formatDate(review.detected_at)}</div>
          ${review.replied_at ? `<div class="card-meta-item">✅ ${formatDate(review.replied_at)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ─── Logs ───────────────────────────────────────────────────────

async function loadLogs() {
  try {
    const res = await api('GET', '/logs?limit=200');
    const container = document.getElementById('historyLogs');

    if (res.data.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:2rem"><p>No activity logs yet.</p></div>';
      return;
    }

    container.innerHTML = res.data.map(log => `
      <div class="log-entry info">
        <span class="log-time">${formatTime(log.created_at)}</span>
        <span class="log-message"><strong>${escapeHtml(log.action)}</strong> — ${escapeHtml(log.details)}</span>
      </div>
    `).join('');
  } catch {}
}

// ─── Settings ───────────────────────────────────────────────────

async function loadSettings() {
  try {
    const res = await api('GET', '/settings');
    const s = res.data;

    // Don't overwrite if user is currently editing
    if (s.gemini_api_key_masked) {
      document.getElementById('apiKeyHint').textContent = `Current: ${s.gemini_api_key_masked}`;
    }
    document.getElementById('settingModel').value = s.gemini_model || 'gemini-1.5-flash';
    document.getElementById('settingLanguage').value = s.reply_language || 'auto';
    document.getElementById('settingPollInterval').value = Math.round((parseInt(s.poll_interval_ms) || 300000) / 60000);
    document.getElementById('settingMaxReplies').value = s.max_replies_per_session || '20';
    document.getElementById('settingMinDelay').value = Math.round((parseInt(s.min_delay_ms) || 3000) / 1000);
    document.getElementById('settingMaxDelay').value = Math.round((parseInt(s.max_delay_ms) || 10000) / 1000);
    document.getElementById('settingBreakAfter').value = s.break_after_replies || '7';
  } catch {}
}

async function saveSettings() {
  const apiKey = document.getElementById('settingApiKey').value.trim();
  const settings = {
    gemini_model: document.getElementById('settingModel').value,
    reply_language: document.getElementById('settingLanguage').value,
    poll_interval_ms: String(parseInt(document.getElementById('settingPollInterval').value) * 60000),
    max_replies_per_session: document.getElementById('settingMaxReplies').value,
    min_delay_ms: String(parseInt(document.getElementById('settingMinDelay').value) * 1000),
    max_delay_ms: String(parseInt(document.getElementById('settingMaxDelay').value) * 1000),
    break_after_replies: document.getElementById('settingBreakAfter').value,
  };

  // Only update API key if user entered a new one
  if (apiKey) {
    settings.gemini_api_key = apiKey;
  }

  try {
    await api('PUT', '/settings', settings);
    toast('Settings saved successfully', 'success');
    document.getElementById('settingApiKey').value = '';
    loadSettings();
  } catch {}
}

// ─── WebSocket ──────────────────────────────────────────────────

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    document.getElementById('wsDot').classList.add('connected');
    document.getElementById('wsLabel').textContent = 'Connected';
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
  };

  ws.onclose = () => {
    document.getElementById('wsDot').classList.remove('connected');
    document.getElementById('wsLabel').textContent = 'Disconnected';
    // Auto reconnect
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch {}
  };
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'log':
      addLiveLog(msg.data.level, msg.data.message);
      break;
    case 'status':
      if (msg.data.autoModeActive !== undefined) {
        updateAutoModeUI(msg.data.autoModeActive);
      }
      break;
    case 'action':
      updateActionBar(msg.data.action);
      break;
    case 'progress':
      // Could update progress indicators
      break;
  }
}

function addLiveLog(level, message) {
  const container = document.getElementById('liveLogs');
  const now = new Date().toLocaleTimeString('en-US', { hour12: false });

  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `
    <span class="log-time">${now}</span>
    <span class="log-message">${escapeHtml(message)}</span>
  `;

  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  // Keep only last 500 entries
  while (container.children.length > 500) {
    container.removeChild(container.firstChild);
  }
}

function clearLiveLogs() {
  const container = document.getElementById('liveLogs');
  container.innerHTML = `
    <div class="log-entry info">
      <span class="log-time">${new Date().toLocaleTimeString('en-US', { hour12: false })}</span>
      <span class="log-message">Logs cleared</span>
    </div>
  `;
}

function updateActionBar(action) {
  const bar = document.getElementById('actionBar');
  const text = document.getElementById('currentAction');

  if (action && action !== 'Idle') {
    bar.style.display = 'flex';
    text.textContent = action;
  } else {
    bar.style.display = 'none';
  }
}

// ─── Modal System ───────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
    }
  });
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});

// ─── Toast Notifications ────────────────────────────────────────

function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ─── Helpers ────────────────────────────────────────────────────

function populateAccountSelects() {
  populateAccountSelect('newMapAccount');
  populateAccountSelect('editMapAccount');
  populateAccountSelect('linkAccountSelect');
}

function populateAccountSelect(selectId, selectedValue = '') {
  const select = document.getElementById(selectId);
  if (!select) return;

  const currentValue = selectedValue || select.value;
  select.innerHTML = '<option value="">Select account...</option>';

  accounts.forEach(acc => {
    const option = document.createElement('option');
    option.value = acc.id;
    option.textContent = `${acc.name}${acc.email ? ` (${acc.email})` : ''} — ${acc.status}`;
    if (acc.id === currentValue) option.selected = true;
    select.appendChild(option);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr + 'Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr) {
  if (!dateStr) return '--:--';
  try {
    return new Date(dateStr + 'Z').toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return dateStr;
  }
}

// ─── Initialize ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  loadDashboard();
  loadAccounts();
  loadMaps();
});
