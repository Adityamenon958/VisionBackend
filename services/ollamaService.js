const axios = require('axios');

/**
 * Ollama Service
 *
 * Talks to a local Ollama instance to generate answers.
 * This service is provider-specific but exposes a simple, unified interface:
 *   askOllama(question, context, source) -> Promise<string>
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';

/**
 * Build a prompt for Ollama based on source and context.
 * We keep this aligned with the Gemini prompts so behavior is consistent.
 */
function buildPrompt(source, question, context) {
  const safeQuestion = (question || '').trim();

  const commonInstructions = [
    'You are an AI assistant helping a non-technical user.',
    'Explain concepts in simple, clear language.',
    'Do NOT suggest code changes or API calls.',
    'Do NOT modify any system state.',
    'Answer in plain text only (no markdown, no code blocks).'
  ].join(' ');

  if (source === 'training_details') {
    const {
      epochs,
      batchSize,
      imageSize,
      mAP,
      precision,
      recall,
      loss,
      device,
      numClasses
    } = context || {};

    return [
      commonInstructions,
      '',
      'Context about the trained model (read-only):',
      `- Epochs: ${epochs ?? 'unknown'}`,
      `- Batch Size: ${batchSize ?? 'unknown'}`,
      `- Image Size: ${imageSize ?? 'unknown'}`,
      `- mAP: ${mAP ?? 'unknown'}`,
      `- Precision: ${precision ?? 'unknown'}`,
      `- Recall: ${recall ?? 'unknown'}`,
      `- Loss: ${loss ?? 'unknown'}`,
      `- Device: ${device ?? 'unknown'}`,
      `- Number of Classes: ${numClasses ?? 'unknown'}`,
      '',
      'User question:',
      safeQuestion
    ].join('\n');
  }

  if (source === 'training_config') {
    const {
      datasetSize,
      numClasses,
      avgImageResolution,
      hardware
    } = context || {};

    return [
      commonInstructions,
      '',
      'Context about the dataset and hardware (read-only):',
      `- Dataset Size: ${datasetSize ?? 'unknown'}`,
      `- Number of Classes: ${numClasses ?? 'unknown'}`,
      `- Average Image Resolution: ${avgImageResolution ?? 'unknown'}`,
      `- Hardware: ${hardware ?? 'unknown'}`,
      '',
      'User question:',
      safeQuestion
    ].join('\n');
  }

  // Fallback: generic prompt
  return [
    commonInstructions,
    '',
    'Context (raw JSON):',
    JSON.stringify(context || {}, null, 2),
    '',
    'User question:',
    safeQuestion
  ].join('\n');
}

/**
 * Basic response filter to enforce plain text and length limits.
 */
function filterResponse(text) {
  if (!text || typeof text !== 'string') {
    return 'The AI response was empty or invalid.';
  }

  let cleaned = text;

  // Remove common markdown/code fencing
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`/g, '');

  // Collapse excessive whitespace
  cleaned = cleaned.replace(/\s+\n/g, '\n').trim();

  // Enforce a hard length limit to avoid huge payloads
  const MAX_CHARS = 2000;
  if (cleaned.length > MAX_CHARS) {
    cleaned = cleaned.slice(0, MAX_CHARS) + '...';
  }

  return cleaned;
}

/**
 * Ask Ollama a question with context.
 *
 * @param {string} question - User question
 * @param {object} context - Read-only context object
 * @param {string} source - "training_details" | "training_config" | other
 * @returns {Promise<string>} - Answer text
 */
async function askOllama(question, context, source) {
  const prompt = buildPrompt(source, question, context);

  try {
    const url = `${OLLAMA_BASE_URL.replace(/\/+$/, '')}/api/generate`;

    const response = await axios.post(url, {
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: 1000
      }
    }, {
      timeout: 60000 // 60s safety timeout
    });

    const raw = response?.data?.response || '';
    return filterResponse(raw);
  } catch (error) {
    console.error('Error calling Ollama:', error.message || error);
    throw new Error('Ollama is not available right now.');
  }
}

module.exports = {
  askOllama
};

