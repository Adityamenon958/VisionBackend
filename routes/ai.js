const express = require('express');
const router = express.Router();
const { askAIHandler } = require('../controllers/aiController');

/**
 * AI Routes
 *
 * POST /api/ai/ask - Ask AI assistant (Ollama or Gemini)
 */

// POST /api/ai/ask
router.post('/ask', askAIHandler);

module.exports = router;

