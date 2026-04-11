/**
 * Google Sheet Reply Fetcher
 * Fetches pre-written reply content from a public Google Sheet.
 * Replaces AI-generated replies with human-written content from the sheet.
 */

let cachedReplies = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // Re-fetch every 5 minutes

/**
 * Extract sheet ID from a full Google Sheets URL.
 * Supports formats like:
 *   https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
 *   SHEET_ID (raw ID)
 */
function extractSheetId(urlOrId) {
  if (!urlOrId) return null;
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Assume it's a raw ID if no URL pattern matched
  if (/^[a-zA-Z0-9_-]+$/.test(urlOrId)) return urlOrId;
  return null;
}

/**
 * Parse CSV text into an array of strings (column A values).
 * Handles quoted fields with commas and newlines inside them.
 */
function parseCSVColumnA(csvText) {
  const replies = [];
  const lines = csvText.split('\n');

  for (const line of lines) {
    let value = line.trim();
    if (!value) continue;

    // Handle quoted CSV fields: "some text, with commas"
    if (value.startsWith('"')) {
      // Find the closing quote (might span multiple lines, but we handle single-line for simplicity)
      const endQuote = value.lastIndexOf('"');
      if (endQuote > 0) {
        value = value.substring(1, endQuote);
      } else {
        value = value.substring(1);
      }
      // Unescape doubled quotes
      value = value.replace(/""/g, '"');
    } else {
      // Take only the first column (everything before the first comma)
      const commaIdx = value.indexOf(',');
      if (commaIdx !== -1) {
        value = value.substring(0, commaIdx);
      }
    }

    value = value.trim();
    if (value.length > 0) {
      replies.push(value);
    }
  }

  return replies;
}

/**
 * Fetch replies from the Google Sheet.
 * Uses the public CSV export endpoint (sheet must be publicly accessible).
 * @param {string} sheetUrlOrId - Google Sheet URL or ID
 * @param {string} [sheetName] - Optional sheet/tab name (defaults to first sheet)
 * @returns {Promise<string[]>} Array of reply texts
 */
async function fetchRepliesFromSheet(sheetUrlOrId, sheetName) {
  const sheetId = extractSheetId(sheetUrlOrId);
  if (!sheetId) {
    throw new Error('Invalid Google Sheet URL or ID. Please check your settings.');
  }

  // Try multiple CSV export URLs for compatibility
  const urls = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : ''}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${sheetName ? `&gid=0` : ''}`,
  ];

  let csvText = null;
  let lastError = null;

  for (const csvUrl of urls) {
    try {
      console.log(`[Sheet] Trying: ${csvUrl}`);
      const response = await fetch(csvUrl);
      if (response.ok) {
        csvText = await response.text();
        console.log(`[Sheet] Success from: ${csvUrl}`);
        break;
      }
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err.message;
    }
  }

  if (!csvText) {
    throw new Error(`Failed to fetch Google Sheet (${lastError}). Make sure the sheet is shared as "Anyone with the link can view".`);
  }
  const replies = parseCSVColumnA(csvText);

  console.log(`[Sheet] Fetched ${replies.length} replies from Google Sheet`);
  return replies;
}

/**
 * Get a random reply from the Google Sheet.
 * Caches results to avoid repeated fetches.
 * @param {string} sheetUrlOrId - Google Sheet URL or ID
 * @returns {Promise<string>} A random reply text
 */
async function getRandomReply(sheetUrlOrId) {
  const now = Date.now();

  // Refresh cache if expired or empty
  if (cachedReplies.length === 0 || now - lastFetchTime > CACHE_TTL_MS) {
    try {
      cachedReplies = await fetchRepliesFromSheet(sheetUrlOrId);
      lastFetchTime = now;
    } catch (err) {
      // If cache exists but refresh failed, use stale cache
      if (cachedReplies.length > 0) {
        console.log(`[Sheet] Refresh failed, using cached replies (${cachedReplies.length} available)`);
      } else {
        throw err;
      }
    }
  }

  if (cachedReplies.length === 0) {
    throw new Error('No reply content found in the Google Sheet. Please add reply texts to column A.');
  }

  // Pick a random reply
  const index = Math.floor(Math.random() * cachedReplies.length);
  return cachedReplies[index];
}

/**
 * Clear the cached replies (forces re-fetch on next call).
 */
function clearCache() {
  cachedReplies = [];
  lastFetchTime = 0;
}

/**
 * Get the number of cached replies.
 */
function getCachedCount() {
  return cachedReplies.length;
}

module.exports = {
  getRandomReply,
  fetchRepliesFromSheet,
  clearCache,
  getCachedCount,
  extractSheetId,
};
