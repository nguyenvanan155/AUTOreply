/**
 * Session Manager
 * Manages Playwright persistent browser contexts per Google account.
 * Each account gets its own isolated browser session stored in /sessions/account_{id}/
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

// Active browser contexts: accountId -> { context, page }
const activeSessions = new Map();

function getSessionPath(accountId) {
  const sessionPath = path.join(SESSIONS_DIR, `account_${accountId}`);
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }
  return sessionPath;
}

/**
 * Launch a persistent browser context for an account.
 * @param {string} accountId
 * @param {object} options - { headless: false } for login, true for automation
 * @returns {{ context, page }}
 */
async function launchSession(accountId, options = {}) {
  // If already active, return existing
  if (activeSessions.has(accountId)) {
    const session = activeSessions.get(accountId);
    try {
      // Test if the context is still alive
      await session.page.evaluate(() => true);
      return session;
    } catch {
      // Context died, clean up
      activeSessions.delete(accountId);
    }
  }

  const sessionPath = getSessionPath(accountId);
  const headless = options.headless !== undefined ? options.headless : false;

  const context = await chromium.launchPersistentContext(sessionPath, {
    headless,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Get existing page or create new one
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const session = { context, page };
  activeSessions.set(accountId, session);
  return session;
}

/**
 * Close a browser session.
 */
async function closeSession(accountId) {
  const session = activeSessions.get(accountId);
  if (session) {
    try {
      await session.context.close();
    } catch {
      // Already closed
    }
    activeSessions.delete(accountId);
  }
}

/**
 * Close all active sessions.
 */
async function closeAllSessions() {
  for (const [accountId] of activeSessions) {
    await closeSession(accountId);
  }
}

/**
 * Get the active page for an account.
 */
function getPage(accountId) {
  const session = activeSessions.get(accountId);
  return session ? session.page : null;
}

/**
 * Check if a session is active and logged into Google.
 */
async function checkLoginStatus(page) {
  try {
    await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Check if we're on the account page (logged in) or redirected to sign-in
    const url = page.url();
    if (url.includes('accounts.google.com/signin') || url.includes('accounts.google.com/ServiceLogin')) {
      return false;
    }

    // Try to find account info elements
    const accountInfo = await page.locator('[data-email]').first().getAttribute('data-email').catch(() => null);
    if (accountInfo) return true;

    // Alternative: check for profile image or account name
    const hasProfile = await page.locator('img[data-atf="true"]').count() > 0;
    return hasProfile || !url.includes('accounts.google.com');
  } catch {
    return false;
  }
}

/**
 * Navigate to Google login page for manual sign-in.
 */
async function openLoginPage(page) {
  await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded' });
}

/**
 * Check if an account session exists on disk.
 */
function sessionExists(accountId) {
  const sessionPath = path.join(SESSIONS_DIR, `account_${accountId}`);
  return fs.existsSync(sessionPath);
}

/**
 * Delete session data from disk.
 */
function deleteSessionData(accountId) {
  const sessionPath = path.join(SESSIONS_DIR, `account_${accountId}`);
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
}

module.exports = {
  launchSession,
  closeSession,
  closeAllSessions,
  getPage,
  checkLoginStatus,
  openLoginPage,
  sessionExists,
  deleteSessionData,
  getSessionPath,
};
