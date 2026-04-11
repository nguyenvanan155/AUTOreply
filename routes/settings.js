const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/settings — Get all settings
router.get('/', (req, res) => {
  try {
    const settings = db.getAllSettings();
    // Remove API keys from response (no longer used)
    delete settings.gemini_api_key;
    delete settings.groq_api_key;
    delete settings.openrouter_api_key;
    delete settings.deepseek_api_key;
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/settings — Update settings
router.put('/', (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, error: 'Settings object required' });
    }

    db.updateSettings(settings);
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
