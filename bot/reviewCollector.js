/**
 * Review Collector
 * Scrapes reviews from Google Maps location pages.
 */

const { randomDelay, simulateScroll, simulateMouseMovement } = require('./humanBehavior');

/**
 * Detect CAPTCHA or anti-bot challenge.
 */
async function detectCaptcha(page) {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 });
    const captchaIndicators = [
      'unusual traffic',
      'verify you are human',
      'are you a robot',
      'automated queries',
      'recaptcha',
      'captcha',
    ];
    const lowerText = bodyText.toLowerCase();
    return captchaIndicators.some(indicator => lowerText.includes(indicator));
  } catch {
    return false;
  }
}

/**
 * Navigate to a Google Maps location and collect reviews.
 * @param {import('playwright').Page} page
 * @param {string} mapUrl - Google Maps URL for the location
 * @returns {Array<{ reviewId, author, rating, text, hasOwnerReply }>}
 */
async function collectReviews(page, mapUrl) {
  // Navigate to the map location
  await page.goto(mapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(2000, 5000);

  // Check for CAPTCHA
  if (await detectCaptcha(page)) {
    throw new Error('CAPTCHA_DETECTED');
  }

  // Click on "Reviews" tab if visible
  try {
    const reviewsTab = page.getByRole('tab', { name: /Reviews/i });
    if (await reviewsTab.isVisible({ timeout: 5000 })) {
      await reviewsTab.click();
      await randomDelay(2000, 4000);
    }
  } catch {
    // Reviews tab might not exist or already selected
  }

  // Sort by "Newest" to get latest reviews first
  try {
    const sortButton = page.locator('button[aria-label*="Sort"]').first();
    if (await sortButton.isVisible({ timeout: 3000 })) {
      await sortButton.click();
      await randomDelay(1000, 2000);

      const newestOption = page.getByRole('menuitemradio', { name: /Newest/i });
      if (await newestOption.isVisible({ timeout: 3000 })) {
        await newestOption.click();
        await randomDelay(2000, 4000);
      }
    }
  } catch {
    // Sort might not be available
  }

  // Scroll to load more reviews
  await loadMoreReviews(page, 3);

  // Extract reviews
  const reviews = await extractReviews(page);
  return reviews;
}

/**
 * Scroll the reviews panel to load more reviews.
 */
async function loadMoreReviews(page, scrollCount = 3) {
  for (let i = 0; i < scrollCount; i++) {
    try {
      // Find the scrollable reviews panel in Google Maps
      // The reviews are in a scrollable div inside [role="main"]
      await page.evaluate(() => {
        // Try the specific scrollable container first
        const scrollable = document.querySelector('.m6QErb.DxyBCb.kA9KIf.dS8AEf');
        if (scrollable) {
          scrollable.scrollTop = scrollable.scrollHeight;
          return;
        }
        // Fallback: scroll the main content area
        const panels = document.querySelectorAll('[role="main"]');
        if (panels.length) {
          panels[0].scrollTop = panels[0].scrollHeight;
        }
      });
    } catch {
      // Ignore scroll errors
    }
    await randomDelay(1500, 3000);
  }
}

/**
 * Extract review data from the current page.
 */
async function extractReviews(page) {
  return page.evaluate(() => {
    const reviews = [];
    const seen = new Set();

    // Primary selector: .jftiEf is the actual Google Maps review card container
    const reviewElements = document.querySelectorAll('.jftiEf');

    reviewElements.forEach((el, index) => {
      try {
        // Author name — .d4r55 is the reviewer name element
        const authorEl = el.querySelector('.d4r55');
        const author = authorEl ? authorEl.textContent.trim() : '';

        // Skip reviews with no author name (can't match them for replying)
        if (!author) return;

        // Rating: .kvMYJc holds the star rating with aria-label like "5 stars"
        const starsEl = el.querySelector('.kvMYJc');
        let rating = 0;
        if (starsEl) {
          const match = starsEl.getAttribute('aria-label')?.match(/(\d)/);
          if (match) rating = parseInt(match[1]);
        }

        // Review text — .wiI7pd is the review body text
        const textEl = el.querySelector('.wiI7pd');
        const text = textEl ? textEl.textContent.trim() : '';

        // Check if owner/business already replied — .CDe7pd is the owner response container
        const ownerReply = el.querySelector('.CDe7pd');
        const hasOwnerReply = !!ownerReply;

        // Try to get a stable review ID from data attributes
        const reviewId = el.getAttribute('data-review-id')
          || el.getAttribute('data-retrieval-id')
          || `review_${author.replace(/\s+/g, '_')}_${index}`;

        // De-duplicate by reviewId
        if (seen.has(reviewId)) return;
        seen.add(reviewId);

        reviews.push({ reviewId, author, rating, text, hasOwnerReply });
      } catch {
        // Skip malformed review elements
      }
    });

    return reviews;
  });
}

/**
 * Filter out reviews that already have owner replies or are in the processed list.
 */
function filterNewReviews(collected, processedIds) {
  return collected.filter(review => {
    if (review.hasOwnerReply) return false;
    if (processedIds.has(review.reviewId)) return false;
    return true;
  });
}

module.exports = {
  collectReviews,
  filterNewReviews,
  detectCaptcha,
};
