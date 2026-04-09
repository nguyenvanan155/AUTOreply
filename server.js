require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const db = require('./db/database');
const orchestrator = require('./bot/orchestrator');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ─────────────────────────────────────────────────

app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/maps', require('./routes/maps'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/automation', require('./routes/automation'));
app.use('/api/settings', require('./routes/settings'));

// Activity logs endpoint
app.get('/api/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = db.getRecentLogs(limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── WebSocket ──────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected (${wsClients.size} total)`);

  // Send current status on connect
  ws.send(JSON.stringify({
    type: 'status',
    data: orchestrator.getStatus(),
    timestamp: new Date().toISOString(),
  }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Client disconnected (${wsClients.size} total)`);
  });

  ws.on('error', () => {
    wsClients.delete(ws);
  });
});

function broadcastToClients(event) {
  const message = JSON.stringify(event);
  wsClients.forEach(ws => {
    if (ws.readyState === 1) { // OPEN
      ws.send(message);
    }
  });
}

// Connect orchestrator events to WebSocket
orchestrator.setEventCallback(broadcastToClients);

// ─── Initialize ─────────────────────────────────────────────────

// Initialize DB (creates tables if not exist)
db.getDb();

// Load Gemini API key from .env if available
if (process.env.GEMINI_API_KEY) {
  const currentKey = db.getSetting('gemini_api_key');
  if (!currentKey) {
    db.updateSetting('gemini_api_key', process.env.GEMINI_API_KEY);
    console.log('[Init] Gemini API key loaded from environment');
  }
}

// ─── Start Server ───────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║                                                  ║');
  console.log('  ║      Maps Auto-Reply made by ins: _eldrie        ║');
  console.log('  ║                                                  ║');
  console.log(`  ║    http://localhost:${PORT}                      ║`);
  console.log('  ║                                                  ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Closing all browser sessions...');
  orchestrator.stopAutoMode();
  const sessionManager = require('./bot/sessionManager');
  await sessionManager.closeAllSessions();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  orchestrator.stopAutoMode();
  const sessionManager = require('./bot/sessionManager');
  await sessionManager.closeAllSessions();
  process.exit(0);
});
