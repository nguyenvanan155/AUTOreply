/**
 * AI Reply Generator
 * V2: Multi-AI Support (Gemini, Groq, OpenRouter, DeepSeek)
 * Automatically uses the lowest/fastest models and falls back if one fails.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let activeProviders = [];

// Base fetch helper for OpenAI-compatible APIs (Groq, OpenRouter, DeepSeek)
async function fetchOpenAI(url, apiKey, model, prompt) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000', // Required by OpenRouter
      'X-Title': 'Maps Auto-Reply Bot', // Required by OpenRouter
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7, // Good balance for natural text
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `HTTP ${response.status} ${response.statusText}`);
  }

  if (data.choices && data.choices.length > 0 && data.choices[0].message) {
    return data.choices[0].message.content.trim();
  }
  throw new Error('Invalid response format from API');
}

/**
 * Initialize AI providers based on available API keys.
 * Automatically ties it to the cheapest model of that provider.
 * @param {Object} keys - Map of api keys { gemini_api_key, groq_api_key, openrouter_api_key, deepseek_api_key }
 */
function initAIs(keys) {
  activeProviders = [];

  if (keys.gemini_api_key) {
    activeProviders.push({
      id: 'gemini',
      name: 'Gemini (gemini-2.5-flash)',
      generate: async (prompt) => {
        const genAI = new GoogleGenerativeAI(keys.gemini_api_key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
      }
    });
  }

  if (keys.groq_api_key) {
    // Model Llama 3 70B trên Groq
    activeProviders.push({
      id: 'groq-llama3-70b',
      name: 'Groq (llama3-70b-8192)',
      generate: async (prompt) => {
        return fetchOpenAI('https://api.groq.com/openai/v1/chat/completions', keys.groq_api_key, 'llama3-70b-8192', prompt);
      }
    });

    // Model Mixtral 8x7B trên Groq
    activeProviders.push({
      id: 'groq-mixtral',
      name: 'Groq (mixtral-8x7b-32768)',
      generate: async (prompt) => {
        return fetchOpenAI('https://api.groq.com/openai/v1/chat/completions', keys.groq_api_key, 'mixtral-8x7b-32768', prompt);
      }
    });
  }

  if (keys.openrouter_api_key) {
    activeProviders.push({
      id: 'openrouter',
      name: 'OpenRouter (meta-llama/llama-3-8b-instruct:free)',
      generate: async (prompt) => {
        return fetchOpenAI('https://openrouter.ai/api/v1/chat/completions', keys.openrouter_api_key, 'meta-llama/llama-3-8b-instruct:free', prompt);
      }
    });
  }

  if (keys.deepseek_api_key) {
    activeProviders.push({
      id: 'deepseek',
      name: 'DeepSeek (deepseek-chat)',
      generate: async (prompt) => {
        return fetchOpenAI('https://api.deepseek.com/chat/completions', keys.deepseek_api_key, 'deepseek-chat', prompt);
      }
    });
  }

  if (activeProviders.length === 0) {
    throw new Error('No AI providers configured. Please set at least one API key in settings.');
  }

  console.log(`[AI] Initialized ${activeProviders.length} AI provider(s): ${activeProviders.map(p => p.id).join(', ')}`);
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
 * Randomly picks from enabled providers.
 * Falls back to another provider (max 1 fallback = 2 API calls) on failure.
 * @param {string} reviewText
 * @param {number} rating (1-5)
 * @param {string} businessName
 * @param {string} language - 'auto' to match review language, or specific language
 * @returns {Promise<{ text: string, modelUsed: string }>}
 */
async function generateReply(reviewText, rating, businessName, language = 'auto') {
  if (activeProviders.length === 0) {
    throw new Error('AI providers not initialized. Set API keys in settings.');
  }

  const prompt = buildPrompt(reviewText, rating, businessName, language);

  // Try max 2 providers (1 main, 1 fallback) to minimize API calls
  const maxAttempts = Math.min(activeProviders.length, 2);
  const startIdx = Math.floor(Math.random() * activeProviders.length);
  const triedProviders = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const idx = (startIdx + attempt) % activeProviders.length;
    const provider = activeProviders[idx];

    try {
      let text = await provider.generate(prompt);
      
      // Clean up: remove quotes if the model wrapped the response
      if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1);
      }

      return { text, modelUsed: provider.name };
    } catch (err) {
      // Clean up the error message
      let errMsg = err.message || 'Unknown error';
      errMsg = errMsg.replace(/Error fetching from https:\/\/[^\s]+:\s*/, '');
      const match = errMsg.match(/\[\d+\s+[^\]]+\](.*)/);
      if (match) errMsg = match[1].trim();

      triedProviders.push(`${provider.id}: ${errMsg.substring(0, 80)}`);
    }
  }

  throw new Error(`All attempts failed: ${triedProviders.join(' | ')}`);
}

/**
 * Get list of currently active provider names.
 */
function getActiveModelNames() {
  return activeProviders.map(p => p.name);
}

module.exports = {
  initAIs,
  generateReply,
  getSentimentCategory,
  getActiveModelNames,
};
