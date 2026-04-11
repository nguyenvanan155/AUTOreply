/**
 * Orchestrator
 * Central coordinator for all bot automation actions.
 * Manages auto mode polling, manual link replies, and safety limits.
 */

const { v4: uuidv4 } = require('uuid');
const sessionManager = require('./sessionManager');
const { collectReviews, filterNewReviews, detectCaptcha } = require('./reviewCollector');
const { replyToReview, replyViaDirectLink } = require('./reviewReplier');
const { getRandomReply } = require('./sheetReplyFetcher');
const { randomDelay, shouldTakeBreak, takeBreak } = require('./humanBehavior');
const db = require('../db/database');

// ─── Configuration ─────────────────────────────────────────────
// Change your Google Sheet URL here
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1KDO1FPP9v-8n3iGfDIIUP9vSAyjGpWqRprVpY2CgV7k/edit?usp=sharing';


// State
let autoModeActive = false;
let autoModeInterval = null;
let isProcessing = false;
let currentAction = '';
let sessionReplyCounts = new Map(); // accountId -> count
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

// Event emitter callback (for WebSocket broadcast)
let eventCallback = null;

function setEventCallback(cb) {
  eventCallback = cb;
}

function emit(type, data) {
  if (eventCallback) {
    eventCallback({ type, data, timestamp: new Date().toISOString() });
  }
}

function setCurrentAction(action) {
  currentAction = action;
  emit('action', { action });
}

function getStatus() {
  return {
    autoModeActive,
    isProcessing,
    currentAction,
    sessionReplyCounts: Object.fromEntries(sessionReplyCounts),
  };
}

// ─── Auto Mode ─────────────────────────────────────────────────

async function startAutoMode() {
  if (autoModeActive) {
    emit('log', { level: 'warn', message: 'Auto mode is already running' });
    return;
  }

  // Validate Google Sheet URL is configured
  const sheetUrl = GOOGLE_SHEET_URL;
  if (!sheetUrl) {
    emit('log', { level: 'error', message: 'Google Sheet URL not configured. Please set it in Settings.' });
    return;
  }

  autoModeActive = true;
  sessionReplyCounts.clear();
  consecutiveErrors = 0;

  emit('status', { autoModeActive: true });
  emit('log', { level: 'info', message: '🚀 Auto mode started' });
  db.addLog(null, 'AUTO_MODE_START', 'Auto mode started');

  // Run immediately, then set interval
  await runAutoModeCycle();

  const pollInterval = parseInt(db.getSetting('poll_interval_ms') || '300000');
  autoModeInterval = setInterval(async () => {
    if (!isProcessing && autoModeActive) {
      await runAutoModeCycle();
    }
  }, pollInterval);
}

function stopAutoMode() {
  autoModeActive = false;
  if (autoModeInterval) {
    clearInterval(autoModeInterval);
    autoModeInterval = null;
  }
  isProcessing = false;
  setCurrentAction('Idle');
  emit('status', { autoModeActive: false });
  emit('log', { level: 'info', message: '🛑 Auto mode stopped' });
  db.addLog(null, 'AUTO_MODE_STOP', 'Auto mode stopped');
}

async function runAutoModeCycle() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const maps = db.getAllMaps();
    if (maps.length === 0) {
      emit('log', { level: 'warn', message: 'No maps configured. Add a map in the Maps section.' });
      isProcessing = false;
      return;
    }

    const maxReplies = parseInt(db.getSetting('max_replies_per_session') || '20');

    for (const map of maps) {
      if (!autoModeActive) break;

      const account = db.getAccount(map.account_id);
      if (!account || account.status !== 'active') {
        emit('log', { level: 'warn', message: `Skipping map "${map.name}" — account not active` });
        continue;
      }

      // Check reply limit
      const replyCount = sessionReplyCounts.get(account.id) || 0;
      if (replyCount >= maxReplies) {
        emit('log', { level: 'warn', message: `Account "${account.name}" reached reply limit (${maxReplies})` });
        continue;
      }

      await processMap(map, account, maxReplies);

      // Delay between maps
      if (autoModeActive) {
        await randomDelay(5000, 15000);
      }
    }
  } catch (err) {
    emit('log', { level: 'error', message: `Auto mode cycle error: ${err.message}` });
  }

  isProcessing = false;
  setCurrentAction('Waiting for next poll...');
}

async function processMap(map, account, maxReplies) {
  setCurrentAction(`Processing map: ${map.name}`);
  emit('log', { level: 'info', message: `📍 Processing map: "${map.name}" with account "${account.name}"` });

  try {
    // Launch or get browser session
    const session = await sessionManager.launchSession(account.id, { headless: true });
    const page = session.page;

    // Check login status
    setCurrentAction(`Checking login for ${account.name}...`);
    const isLoggedIn = await sessionManager.checkLoginStatus(page);
    if (!isLoggedIn) {
      db.updateAccountStatus(account.id, 'not_logged_in');
      emit('log', { level: 'error', message: `Account "${account.name}" is not logged in. Please log in first.` });
      return;
    }

    // Collect reviews
    setCurrentAction(`Collecting reviews from ${map.name}...`);
    const collected = await collectReviews(page, map.url);
    emit('log', { level: 'info', message: `Found ${collected.length} reviews on "${map.name}"` });

    // Get already processed review IDs
    const existingReviews = db.getAllReviews({ map_id: map.id });
    const processedIds = new Set(existingReviews.map(r => r.review_id));

    // Filter new reviews with diagnostic info
    const alreadyReplied = collected.filter(r => r.hasOwnerReply).length;
    const alreadyInDb = collected.filter(r => !r.hasOwnerReply && processedIds.has(r.reviewId)).length;
    const newReviews = filterNewReviews(collected, processedIds);

    if (newReviews.length === 0 && collected.length > 0) {
      emit('log', { level: 'warn', message: `${newReviews.length} new reviews to reply on "${map.name}" (${alreadyReplied} already have owner reply, ${alreadyInDb} already processed in DB)` });
    } else {
      emit('log', { level: 'info', message: `${newReviews.length} new reviews to reply on "${map.name}"` });
    }

    if (newReviews.length === 0) return;

    const sheetUrl = GOOGLE_SHEET_URL;
    let replyCount = sessionReplyCounts.get(account.id) || 0;

    for (const review of newReviews) {
      if (!autoModeActive) break;
      if (replyCount >= maxReplies) {
        emit('log', { level: 'warn', message: `Reply limit reached for "${account.name}"` });
        break;
      }

      // Save review to DB
      const reviewRecord = db.createReview({
        id: uuidv4(),
        review_id: review.reviewId,
        map_id: map.id,
        account_id: account.id,
        author: review.author,
        rating: review.rating,
        text: review.text,
      });

      if (!reviewRecord) continue;

      // Get reply from Google Sheet
      setCurrentAction(`Getting reply for review by ${review.author}...`);
      try {
        const replyText = await getRandomReply(sheetUrl);
        emit('log', { level: 'info', message: `💬 Reply for ${review.author}: "${replyText.substring(0, 80)}..."` });

        // Check for break
        if (shouldTakeBreak(replyCount, parseInt(db.getSetting('break_after_replies') || '7'))) {
          const breakMs = parseInt(db.getSetting('break_duration_min_ms') || '120000');
          const breakMaxMs = parseInt(db.getSetting('break_duration_max_ms') || '300000');
          emit('log', { level: 'info', message: '☕ Taking a break to appear human...' });
          setCurrentAction('Taking a break...');
          await takeBreak(breakMs, breakMaxMs);
        }

        // Post reply
        setCurrentAction(`Replying to ${review.author}'s review...`);
        const result = await replyToReview(page, review.author, replyText);

        if (result.success) {
          db.updateReviewStatus(reviewRecord.id, 'replied', replyText);
          replyCount++;
          sessionReplyCounts.set(account.id, replyCount);
          consecutiveErrors = 0;
          emit('log', { level: 'success', message: `✅ Replied to ${review.author}'s review (${replyCount}/${maxReplies})` });
          db.addLog(account.id, 'REPLY_SUCCESS', `Replied to ${review.author}: "${replyText.substring(0, 100)}"`);
          emit('progress', { replyCount, maxReplies, accountId: account.id });
        } else {
          if (result.error === 'CAPTCHA_DETECTED') {
            emit('log', { level: 'error', message: '🚨 CAPTCHA detected! Stopping automation.' });
            db.addLog(account.id, 'CAPTCHA_DETECTED', 'Automation stopped due to CAPTCHA');
            stopAutoMode();
            return;
          }

          db.updateReviewStatus(reviewRecord.id, 'error', '');
          consecutiveErrors++;
          emit('log', { level: 'error', message: `❌ Failed to reply to ${review.author}: ${result.error}` });

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            emit('log', { level: 'error', message: `🛑 ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Stopping.` });
            stopAutoMode();
            return;
          }
        }
      } catch (genErr) {
        emit('log', { level: 'error', message: `AI generation error: ${genErr.message}` });
        db.updateReviewStatus(reviewRecord.id, 'error', '');
      }

      // Delay between replies
      await randomDelay(
        parseInt(db.getSetting('min_delay_ms') || '3000'),
        parseInt(db.getSetting('max_delay_ms') || '10000')
      );
    }
  } catch (err) {
    if (err.message === 'CAPTCHA_DETECTED') {
      emit('log', { level: 'error', message: '🚨 CAPTCHA detected! Stopping.' });
      stopAutoMode();
      return;
    }
    emit('log', { level: 'error', message: `Error processing "${map.name}": ${err.message}` });
  }
}

// ─── Manual Link Mode ──────────────────────────────────────────

async function replyToLinks(links, accountId) {
  if (isProcessing) {
    emit('log', { level: 'warn', message: 'Already processing. Please wait.' });
    return;
  }

  // Validate Google Sheet URL
  const sheetUrl = GOOGLE_SHEET_URL;
  if (!sheetUrl) {
    emit('log', { level: 'error', message: 'Google Sheet URL not configured. Please set it in Settings.' });
    return;
  }

  const account = db.getAccount(accountId);
  if (!account) {
    emit('log', { level: 'error', message: 'Account not found' });
    return;
  }

  isProcessing = true;
  const maxReplies = parseInt(db.getSetting('max_replies_per_session') || '20');
  let replyCount = sessionReplyCounts.get(accountId) || 0;

  emit('log', { level: 'info', message: `🔗 Processing ${links.length} review links with account "${account.name}"` });
  db.addLog(accountId, 'LINK_MODE_START', `Processing ${links.length} links`);

  try {
    const session = await sessionManager.launchSession(accountId, { headless: true });
    const page = session.page;

    // Check login
    const isLoggedIn = await sessionManager.checkLoginStatus(page);
    if (!isLoggedIn) {
      db.updateAccountStatus(accountId, 'not_logged_in');
      emit('log', { level: 'error', message: `Account "${account.name}" is not logged in.` });
      isProcessing = false;
      return;
    }

    for (let i = 0; i < links.length; i++) {
      const link = links[i].trim();
      if (!link) continue;

      if (replyCount >= maxReplies) {
        emit('log', { level: 'warn', message: `Reply limit reached (${maxReplies})` });
        break;
      }

      setCurrentAction(`Processing link ${i + 1}/${links.length}...`);
      emit('log', { level: 'info', message: `🔗 Opening link ${i + 1}/${links.length}: ${link.substring(0, 80)}...` });

      try {
        // Navigate to the link
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomDelay(3000, 6000);

        if (await detectCaptcha(page)) {
          emit('log', { level: 'error', message: '🚨 CAPTCHA detected! Stopping.' });
          break;
        }

        // Try to extract review info from the page
        const reviewText = await page.evaluate(() => {
          const textEl = document.querySelector('.wiI7pd, [class*="review-full-text"]');
          return textEl ? textEl.textContent.trim() : '';
        });

        const reviewRating = await page.evaluate(() => {
          const starsEl = document.querySelector('[role="img"][aria-label*="star"]');
          if (starsEl) {
            const match = starsEl.getAttribute('aria-label').match(/(\d)/);
            if (match) return parseInt(match[1]);
          }
          return 3; // default
        });

        // Get business name from page
        const businessName = await page.evaluate(() => {
          const nameEl = document.querySelector('h1, [class*="header"] [class*="name"]');
          return nameEl ? nameEl.textContent.trim() : 'Our Business';
        });

        // Get reply from Google Sheet
        const replyText = await getRandomReply(sheetUrl);

        emit('log', { level: 'info', message: `💬 Reply: "${replyText.substring(0, 80)}..."` });

        // Check for break
        if (shouldTakeBreak(replyCount, parseInt(db.getSetting('break_after_replies') || '7'))) {
          emit('log', { level: 'info', message: '☕ Taking a break...' });
          setCurrentAction('Taking a break...');
          await takeBreak(
            parseInt(db.getSetting('break_duration_min_ms') || '120000'),
            parseInt(db.getSetting('break_duration_max_ms') || '300000')
          );
        }

        // Reply via direct link method
        const result = await replyViaDirectLink(page, link, replyText);

        if (result.success) {
          replyCount++;
          sessionReplyCounts.set(accountId, replyCount);
          consecutiveErrors = 0;

          // Save to DB
          db.createReview({
            id: uuidv4(),
            review_id: `link_${uuidv4().substring(0, 8)}`,
            map_id: null,
            account_id: accountId,
            author: 'Via Direct Link',
            rating: reviewRating,
            text: reviewText.substring(0, 500),
          });

          emit('log', { level: 'success', message: `✅ Replied to link ${i + 1}/${links.length} (${replyCount}/${maxReplies})` });
          db.addLog(accountId, 'LINK_REPLY_SUCCESS', `Replied via link: ${link.substring(0, 100)}`);
          emit('progress', { current: i + 1, total: links.length, replyCount });
        } else {
          if (result.error === 'CAPTCHA_DETECTED') {
            emit('log', { level: 'error', message: '🚨 CAPTCHA detected! Stopping.' });
            break;
          }
          consecutiveErrors++;
          emit('log', { level: 'error', message: `❌ Failed on link ${i + 1}: ${result.error}` });

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            emit('log', { level: 'error', message: `🛑 Too many errors. Stopping.` });
            break;
          }
        }
      } catch (linkErr) {
        emit('log', { level: 'error', message: `Error on link ${i + 1}: ${linkErr.message}` });
        consecutiveErrors++;
      }

      // Delay between links
      await randomDelay(
        parseInt(db.getSetting('min_delay_ms') || '3000'),
        parseInt(db.getSetting('max_delay_ms') || '10000')
      );
    }
  } catch (err) {
    emit('log', { level: 'error', message: `Link mode error: ${err.message}` });
  }

  isProcessing = false;
  setCurrentAction('Idle');
  emit('log', { level: 'info', message: `✅ Link processing complete. Replied to ${replyCount} reviews.` });
  db.addLog(accountId, 'LINK_MODE_COMPLETE', `Processed links, ${replyCount} replies`);
}

module.exports = {
  startAutoMode,
  stopAutoMode,
  replyToLinks,
  getStatus,
  setEventCallback,
};
