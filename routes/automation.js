const express = require('express');
const router = express.Router();
const orchestrator = require('../bot/orchestrator');

// POST /api/automation/start — Start auto mode
router.post('/start', async (req, res) => {
  try {
    orchestrator.startAutoMode();
    res.json({ success: true, message: 'Auto mode starting...' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/automation/stop — Stop auto mode
router.post('/stop', (req, res) => {
  try {
    orchestrator.stopAutoMode();
    res.json({ success: true, message: 'Auto mode stopped' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/automation/reply-links — Submit direct review links
router.post('/reply-links', async (req, res) => {
  try {
    const { links, account_id } = req.body;

    if (!links || !Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ success: false, error: 'Links array is required' });
    }

    if (!account_id) {
      return res.status(400).json({ success: false, error: 'Account ID is required' });
    }

    // Start in background
    orchestrator.replyToLinks(links, account_id);

    res.json({
      success: true,
      message: `Processing ${links.length} review links...`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/automation/status — Get automation status
router.get('/status', (req, res) => {
  try {
    const status = orchestrator.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
