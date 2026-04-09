const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'app.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      status TEXT DEFAULT 'not_logged_in',
      session_path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      account_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      review_id TEXT UNIQUE,
      map_id TEXT,
      account_id TEXT,
      author TEXT DEFAULT '',
      rating INTEGER DEFAULT 0,
      text TEXT DEFAULT '',
      reply_text TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      detected_at TEXT DEFAULT (datetime('now')),
      replied_at TEXT,
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE SET NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Insert default settings if not present
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  const defaults = {
    gemini_api_key: '',
    gemini_model: 'gemini-1.5-flash',
    poll_interval_ms: '300000',
    max_replies_per_session: '20',
    reply_language: 'auto',
    min_delay_ms: '3000',
    max_delay_ms: '10000',
    reply_delay_min_ms: '10000',
    reply_delay_max_ms: '30000',
    break_after_replies: '7',
    break_duration_min_ms: '120000',
    break_duration_max_ms: '300000',
  };
  const insertMany = db.transaction(() => {
    for (const [key, value] of Object.entries(defaults)) {
      insertSetting.run(key, value);
    }
  });
  insertMany();
}

// ─── Account CRUD ──────────────────────────────────────────────

function getAllAccounts() {
  return getDb().prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
}

function getAccount(id) {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function createAccount(id, name, email, sessionPath) {
  getDb().prepare(
    'INSERT INTO accounts (id, name, email, session_path) VALUES (?, ?, ?, ?)'
  ).run(id, name, email, sessionPath);
  return getAccount(id);
}

function updateAccountStatus(id, status) {
  getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, id);
}

function deleteAccount(id) {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

// ─── Map CRUD ──────────────────────────────────────────────────

function getAllMaps() {
  return getDb().prepare(`
    SELECT maps.*, accounts.name as account_name
    FROM maps
    LEFT JOIN accounts ON maps.account_id = accounts.id
    ORDER BY maps.created_at DESC
  `).all();
}

function getMap(id) {
  return getDb().prepare('SELECT * FROM maps WHERE id = ?').get(id);
}

function getMapsByAccount(accountId) {
  return getDb().prepare('SELECT * FROM maps WHERE account_id = ?').all(accountId);
}

function createMap(id, name, url, accountId) {
  getDb().prepare(
    'INSERT INTO maps (id, name, url, account_id) VALUES (?, ?, ?, ?)'
  ).run(id, name, url, accountId);
  return getMap(id);
}

function updateMap(id, name, url, accountId) {
  getDb().prepare(
    'UPDATE maps SET name = ?, url = ?, account_id = ? WHERE id = ?'
  ).run(name, url, accountId, id);
  return getMap(id);
}

function deleteMap(id) {
  getDb().prepare('DELETE FROM maps WHERE id = ?').run(id);
}

// ─── Review CRUD ───────────────────────────────────────────────

function getAllReviews(filters = {}) {
  let query = 'SELECT * FROM reviews WHERE 1=1';
  const params = [];

  if (filters.map_id) {
    query += ' AND map_id = ?';
    params.push(filters.map_id);
  }
  if (filters.account_id) {
    query += ' AND account_id = ?';
    params.push(filters.account_id);
  }
  if (filters.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }

  query += ' ORDER BY detected_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  return getDb().prepare(query).all(...params);
}

function getReviewByReviewId(reviewId) {
  return getDb().prepare('SELECT * FROM reviews WHERE review_id = ?').get(reviewId);
}

function createReview(data) {
  getDb().prepare(`
    INSERT OR IGNORE INTO reviews (id, review_id, map_id, account_id, author, rating, text, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(data.id, data.review_id, data.map_id, data.account_id, data.author, data.rating, data.text);
  return getReviewByReviewId(data.review_id);
}

function updateReviewStatus(id, status, replyText = '') {
  const now = status === 'replied' ? new Date().toISOString() : null;
  getDb().prepare(
    'UPDATE reviews SET status = ?, reply_text = ?, replied_at = ? WHERE id = ?'
  ).run(status, replyText, now, id);
}

function getReviewStats() {
  const total = getDb().prepare('SELECT COUNT(*) as count FROM reviews').get().count;
  const replied = getDb().prepare("SELECT COUNT(*) as count FROM reviews WHERE status = 'replied'").get().count;
  const pending = getDb().prepare("SELECT COUNT(*) as count FROM reviews WHERE status = 'pending'").get().count;
  const errors = getDb().prepare("SELECT COUNT(*) as count FROM reviews WHERE status = 'error'").get().count;
  return { total, replied, pending, errors };
}

// ─── Settings ──────────────────────────────────────────────────

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getAllSettings() {
  const rows = getDb().prepare('SELECT * FROM settings').all();
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  return obj;
}

function updateSetting(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function updateSettings(settingsObj) {
  const stmt = getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateMany = getDb().transaction(() => {
    for (const [key, value] of Object.entries(settingsObj)) {
      stmt.run(key, String(value));
    }
  });
  updateMany();
}

// ─── Activity Log ──────────────────────────────────────────────

function addLog(accountId, action, details = '') {
  getDb().prepare(
    'INSERT INTO activity_log (account_id, action, details) VALUES (?, ?, ?)'
  ).run(accountId, action, details);
}

function getRecentLogs(limit = 100) {
  return getDb().prepare(
    'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

module.exports = {
  getDb,
  // Accounts
  getAllAccounts, getAccount, createAccount, updateAccountStatus, deleteAccount,
  // Maps
  getAllMaps, getMap, getMapsByAccount, createMap, updateMap, deleteMap,
  // Reviews
  getAllReviews, getReviewByReviewId, createReview, updateReviewStatus, getReviewStats,
  // Settings
  getSetting, getAllSettings, updateSetting, updateSettings,
  // Logs
  addLog, getRecentLogs,
};
