const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

// GET /api/maps — List all maps
router.get('/', (req, res) => {
  try {
    const maps = db.getAllMaps();
    res.json({ success: true, data: maps });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/maps — Add new map location
router.post('/', (req, res) => {
  try {
    const { name, url, account_id } = req.body;

    if (!name || !url || !account_id) {
      return res.status(400).json({
        success: false,
        error: 'Name, URL, and account_id are all required',
      });
    }

    // Verify account exists
    const account = db.getAccount(account_id);
    if (!account) {
      return res.status(400).json({ success: false, error: 'Account not found' });
    }

    const id = uuidv4().substring(0, 8);
    const map = db.createMap(id, name, url, account_id);
    res.json({ success: true, data: map });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/maps/:id — Update map
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, url, account_id } = req.body;

    const existing = db.getMap(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Map not found' });
    }

    const map = db.updateMap(
      id,
      name || existing.name,
      url || existing.url,
      account_id || existing.account_id
    );

    res.json({ success: true, data: map });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/maps/:id — Remove map
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.deleteMap(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
