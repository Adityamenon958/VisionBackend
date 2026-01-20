const { askAI } = require('../services/aiService');

/**
 * AI Controller
 *
 * Handles the Ask AI endpoint:
 *   POST /api/ai/ask
 *
 * This endpoint is read-only and only returns advisory text.
 */

const MAX_CONTEXT_SIZE = 5000; // ~5KB JSON string length

/**
 * POST /api/ai/ask
 *
 * Body:
 * {
 *   provider?: "ollama" | "gemini",  // optional, default from env or "ollama"
 *   source: "training_details" | "training_config",
 *   question: string,
 *   context?: object
 * }
 *
 * Response:
 * {
 *   answer: string,
 *   provider: "ollama" | "gemini"
 * }
 */
const askAIHandler = async (req, res) => {
  try {
    const {
      provider,
      source,
      question,
      context = {}
    } = req.body || {};

    const selectedProvider = provider || process.env.AI_DEFAULT_PROVIDER || 'ollama';

    // Validate provider
    if (selectedProvider !== 'ollama' && selectedProvider !== 'gemini') {
      return res.status(400).json({
        error: 'Invalid provider',
        message: 'Provider must be "ollama" or "gemini"',
        provided: selectedProvider
      });
    }

    // Validate source
    if (source !== 'training_details' && source !== 'training_config') {
      return res.status(400).json({
        error: 'Invalid source',
        message: 'Source must be "training_details" or "training_config"',
        provided: source
      });
    }

    // Validate question
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid question',
        message: 'Question must be a non-empty string'
      });
    }

    // Validate context size
    let contextSize = 0;
    try {
      contextSize = JSON.stringify(context || {}).length;
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid context',
        message: 'Context must be a JSON-serializable object'
      });
    }

    if (contextSize > MAX_CONTEXT_SIZE) {
      return res.status(400).json({
        error: 'Context too large',
        message: 'Context must be less than 5KB'
      });
    }

    // Delegate to AI service
    const result = await askAI(selectedProvider, question, context, source);

    // Always return an answer string, even on provider errors
    return res.status(200).json({
      answer: result.answer,
      provider: result.provider
    });
  } catch (error) {
    console.error('Error in askAIHandler:', error);
    return res.status(500).json({
      answer: 'The AI assistant is currently unavailable. Please try again later.',
      provider: req.body?.provider || process.env.AI_DEFAULT_PROVIDER || 'ollama'
    });
  }
};

module.exports = {
  askAIHandler
};

