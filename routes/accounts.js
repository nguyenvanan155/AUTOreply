const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const sessionManager = require('../bot/sessionManager');

// GET /api/accounts — List all accounts
router.get('/', (req, res) => {
  try {
    const accounts = db.getAllAccounts();
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/accounts — Add new account
router.post('/', (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Account name is required' });
    }

    const id = uuidv4().substring(0, 8);
    const sessionPath = sessionManager.getSessionPath(id);
    const account = db.createAccount(id, name, email || '', sessionPath);

    res.json({ success: true, data: account });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/accounts/:id — Remove account
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Close session if active
    await sessionManager.closeSession(id);

    // Delete session data
    sessionManager.deleteSessionData(id);

    // Delete from DB
    db.deleteAccount(id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/accounts/:id/login — Launch browser for manual login
router.post('/:id/login', async (req, res) => {
  try {
    const { id } = req.params;
    const account = db.getAccount(id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    // Launch visible browser for manual login
    const session = await sessionManager.launchSession(id, { headless: false });
    await sessionManager.openLoginPage(session.page);

    db.updateAccountStatus(id, 'logging_in');
    db.addLog(id, 'LOGIN_STARTED', `Login browser opened for ${account.name}`);

    res.json({ success: true, message: 'Browser opened. Please log in to Google manually.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/accounts/:id/check-status — Check if session is still valid
router.post('/:id/check-status', async (req, res) => {
  try {
    const { id } = req.params;
    const account = db.getAccount(id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    const session = await sessionManager.launchSession(id, { headless: true });
    const isLoggedIn = await sessionManager.checkLoginStatus(session.page);

    const status = isLoggedIn ? 'active' : 'not_logged_in';
    db.updateAccountStatus(id, status);

    // Close the session after checking (to free resources)
    await sessionManager.closeSession(id);

    res.json({ success: true, data: { status, isLoggedIn } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
