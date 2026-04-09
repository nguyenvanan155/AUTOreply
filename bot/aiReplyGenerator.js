/**
 * AI Reply Generator
 * Uses Google Gemini API to generate human-like review replies.
 * Supports multiple models with random rotation for variety.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Available models
const AVAILABLE_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-001',
  'gemini-2.5-flash',
];

let genAI = null;
let activeModels = []; // Array of model instances for rotation
let modelNames = [];   // Track which model names are active
let modelIndex = 0;    // Round-robin counter

/**
 * Initialize Gemini with one or multiple models.
 * @param {string} apiKey
 * @param {string|string[]} models - Single model name or array of model names
 */
function initGemini(apiKey, models = 'gemini-2.5-flash') {
  genAI = new GoogleGenerativeAI(apiKey);
  activeModels = [];
  modelNames = [];
  modelIndex = 0;

  // Support both single string and array of models
  const modelList = Array.isArray(models) ? models : [models];

  for (const name of modelList) {
    try {
      // Strip "models/" prefix if present (API accepts both formats)
      const cleanName = name.replace(/^models\//, '');
      const model = genAI.getGenerativeModel({ model: cleanName });
      activeModels.push(model);
      modelNames.push(cleanName);
    } catch (err) {
      console.error(`[AI] Failed to init model "${name}": ${err.message}`);
    }
  }

  if (activeModels.length === 0) {
    throw new Error('No valid Gemini models could be initialized');
  }

  console.log(`[AI] Initialized ${activeModels.length} model(s): ${modelNames.join(', ')}`);
}

/**
 * Get the next model using round-robin rotation.
 * Returns { model, name }
 */
function getNextModel() {
  if (activeModels.length === 0) {
    throw new Error('No Gemini models initialized. Set your API key and models in settings.');
  }

  const idx = modelIndex % activeModels.length;
  modelIndex++;

  return {
    model: activeModels[idx],
    name: modelNames[idx],
  };
}

/**
 * Get a random model (for more variety than round-robin).
 * Returns { model, name }
 */
function getRandomModel() {
  if (activeModels.length === 0) {
    throw new Error('No Gemini models initialized. Set your API key and models in settings.');
  }

  const idx = Math.floor(Math.random() * activeModels.length);
  return {
    model: activeModels[idx],
    name: modelNames[idx],
  };
}

function getSentimentCategory(rating) {
  if (rating >= 4) return 'positive';
  if (rating === 3) return 'neutral';
  return 'negative';
}

function buildPrompt(reviewText, rating, businessName, language = 'auto') {
  const sentiment = getSentimentCategory(rating);

  const languageInstr = language === 'auto'
    ? 'Reply in the SAME LANGUAGE as the review. If the review is in Vietnamese, reply in Vietnamese. If in English, reply in English. Etc.'
    : `Reply in ${language}.`;

  const sentimentGuides = {
    positive: `The reviewer is happy (${rating}/5 stars). Express genuine gratitude. Mention something specific from their review if possible. Be warm and enthusiastic but not over-the-top.`,
    neutral: `The reviewer gave a mixed rating (${rating}/5 stars). Thank them for their feedback. Acknowledge their experience. If they mention issues, briefly address them and express desire to improve.`,
    negative: `The reviewer is unhappy (${rating}/5 stars). Show empathy and concern. Apologize sincerely for their experience. Offer to make things right without being defensive. Be professional and caring.`,
  };

  return `You are a business owner replying to a Google Maps review for "${businessName}".

REVIEW (${rating}/5 stars):
"${reviewText}"

GUIDELINES:
- ${sentimentGuides[sentiment]}
- Write 2-3 sentences maximum.
- Sound like a real human, not a bot or template.
- Do NOT use phrases like "Dear valued customer" or "We appreciate your feedback".
- Do NOT start with "Thank you for your review" — be creative.
- Be conversational and natural.
- Vary your opening — don't always start the same way.
- ${languageInstr}
- Do NOT include any greeting like "Hi" or "Hello" followed by the reviewer's name unless it feels truly natural.
- Do NOT use exclamation marks excessively.
- Keep it genuine and short.

Reply ONLY with the response text, nothing else.`;
}

/**
 * Generate a reply for a review.
 * Randomly picks from enabled models for variety.
 * Falls back to other models on failure.
 * @param {string} reviewText
 * @param {number} rating (1-5)
 * @param {string} businessName
 * @param {string} language - 'auto' to match review language, or specific language
 * @returns {Promise<{ text: string, modelUsed: string }>}
 */
async function generateReply(reviewText, rating, businessName, language = 'auto') {
  if (activeModels.length === 0) {
    throw new Error('Gemini API not initialized. Set your API key in settings.');
  }

  const prompt = buildPrompt(reviewText, rating, businessName, language);

  // Try each model (start with random, fallback to others)
  const startIdx = Math.floor(Math.random() * activeModels.length);
  const triedModels = [];

  for (let attempt = 0; attempt < activeModels.length; attempt++) {
    const idx = (startIdx + attempt) % activeModels.length;
    const model = activeModels[idx];
    const name = modelNames[idx];

    let retries = 2;
    while (retries > 0) {
      try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        let text = response.text().trim();

        // Clean up: remove quotes if the model wrapped the response
        if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
          text = text.slice(1, -1);
        }

        return { text, modelUsed: name };
      } catch (err) {
        retries--;
        triedModels.push(`${name}(${err.message.substring(0, 50)})`);
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }
  }

  throw new Error(`All models failed: ${triedModels.join(', ')}`);
}

/**
 * Get list of currently active model names.
 */
function getActiveModelNames() {
  return [...modelNames];
}

/**
 * Get list of all available models.
 */
function getAvailableModels() {
  return [...AVAILABLE_MODELS];
}

module.exports = {
  initGemini,
  generateReply,
  getSentimentCategory,
  getActiveModelNames,
  getAvailableModels,
  AVAILABLE_MODELS,
};
