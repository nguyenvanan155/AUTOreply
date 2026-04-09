const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/reviews — List reviews with optional filters
router.get('/', (req, res) => {
  try {
    const { map_id, account_id, status, limit } = req.query;
    const filters = {};
    if (map_id) filters.map_id = map_id;
    if (account_id) filters.account_id = account_id;
    if (status) filters.status = status;
    if (limit) filters.limit = parseInt(limit);

    const reviews = db.getAllReviews(filters);
    res.json({ success: true, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/reviews/stats — Review statistics
router.get('/stats', (req, res) => {
  try {
    const stats = db.getReviewStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
